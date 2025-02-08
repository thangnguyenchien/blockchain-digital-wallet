const Config = require('../lib/config')
const Wallet = require('../lib/operator/wallet')
const ArgumentError = require('../lib/util/argumentError')
const CryptoUtil = require('../lib/util/cryptoUtil')
const Db = require('../lib/util/db')
const AnonymousWallet = require('./anonymousWallet')
const Cart = require('./cart')
const CartBuilder = require('./cartBuilder')
const CartError = require('./cartError')
const Carts = require('./carts')
const Item = require('./item')
const ItemError = require('./itemError')
const Items = require('./items')
const R = require('ramda')

SHOP_ITEM_FILE = 'item.json'
SHOP_CART_HISTORY_FILE = 'cart_history.json'

class Shop {
    constructor(operator, dbName) {
        this.operator = operator
        this.shopWallet = Wallet.fromPassword("this is shop owner password here")
        this.shopServiceAddress = this.shopWallet.generateAddress()
        this.itemDb = new Db('data/' + dbName + '/' + SHOP_ITEM_FILE, new Item())
        this.cartDb = new Db('data/' + dbName + '/' + SHOP_CART_HISTORY_FILE, new Cart())
        this.shopItems = this.itemDb.read(Items)
        this.cartHistory = this.cartDb.read(Carts)
        this.cartBuilder = new CartBuilder()
        this.unconfirmAnonymousWallet = []
        this.linkRequest = null
    }

    confirmTransactionForCart(transactionId, cartId) {
        let cart = this.findCartById(cartId)
        if(cart === undefined) {
            throw new CartError(`Cart ${id} not found`)
        }

        const locateTransactionFromBlock = (transactionId) => {
            let foundBlock = this.operator.isTransactionInBlockchain(transactionId)
            return foundBlock ? foundBlock.transactions.find((tx) => { return tx.type == 'regular' && tx.id == transactionId} ) : undefined
        }
        //NOTE: we have to check if the transaction in the chain before doing any further validation for transaction
        let transaction = locateTransactionFromBlock(transactionId)
        console.log(`Transaction found ${JSON.stringify(transaction.id)}`)

        if(transaction === undefined) {
            throw new ArgumentError(`Transaction id ${transactionId} not found`)
        }
        // check if transcation id in any previous cart
        let transactionsJoined = R.uniq(this.cartHistory.map((cart) => cart.joinedTransactionId).flat())
        let isTransactionInAlreadyConfirmed = transactionsJoined.includes(transactionId)

        if(isTransactionInAlreadyConfirmed) {
            throw new ArgumentError(`Transacion id ${transactionId} already confirmed`)
        }

        console.log(JSON.stringify(transaction.data.outputs.filter((output) => R.equals(output.address, this.shopServiceAddress))))

        let shopReceivedUtxo = transaction.data.outputs.filter((output) => R.equals(output.address, this.shopServiceAddress))
                                                        .map((o) => { return o.amount }).reduce((prev, cur) => prev + cur, 0)

        let amountLeft = cart.totalPrice - shopReceivedUtxo 
        cart.actualReceive += shopReceivedUtxo
        cart.joinedTransactionId.push(transactionId)
        
        if(amountLeft <= 0) {
            cart.confirmed = true
            this.cartBuilder.cartItems = []
        }

        console.debug(`Cart ${JSON.stringify(cart)}`)

        this.cartHistory = this.cartHistory.map((oldCart) => oldCart.id == cartId ? cart : oldCart)
        this.cartDb.write(this.cartHistory)

        return cart
    }

    generateAddressLinkRequest() {
        const timestamp = new Date().getTime() / 1000
        let link = {
            linkId: CryptoUtil.randomId(),
            timestamp: timestamp
        }
        this.linkRequest = link
        return link
    }

    addWalletForCart(wallet) {
        if(this.cartBuilder.paymentAddress) {
            throw new CartError(`Cart already link with other credential please unlink before linking new wallet`)
        } 
        this.cartBuilder.addWallet(wallet)
    }

    addItem(itemId, count) {
        let item = this.getItemById(itemId)
        if(item === undefined) {
            throw new ItemError(`Invalid item found ${itemId}`)
        }
        if(this.cartBuilder.wallet !== null || this.cartBuilder.wallet !== undefined) this.cartBuilder.addToCart(item, count)
        console.log(`Add item ${JSON.stringify(item.id)}`)
        return item
    }

    getAnonymousWalletFromAddress(address) {
        let wallet = AnonymousWallet.fromAddresses(address)
        wallet.generateVerifyData()
        this.unconfirmAnonymousWallet.push(wallet)
        console.log(`Anonymous wallet ${JSON.stringify(wallet)}`)
        return wallet
    }

    // payment for anonymous address only need their address infomation, the operator will check if the address participate in any blockchain
    checkOut(address) {
    
        if(this.cartBuilder.wallet === null || this.cartBuilder.wallet === undefined) {
            throw new CartError(`Wallet infomation must be added`)
        }

        let isAnonymousAddress = this.cartBuilder.wallet.type === 'anonymous'

        let paymentWalletAddresses = isAnonymousAddress ? AnonymousWallet.getAddresses(this.cartBuilder.wallet) : this.operator.getAddressesForWallet(this.cartBuilder.wallet.id)
        let paymentAddress = paymentWalletAddresses.find((paymentWalletAddress) => paymentWalletAddress === address)

        if(paymentAddress === undefined) {
            throw new CartError(`Invalid address selected for wallet ${this.cartBuilder.wallet.id}`)
        }
        console.log(`Selected address ${paymentAddress}`)
        this.cartBuilder.addPaymentAddress(paymentAddress)
        //console.log(JSON.stringify(cart))
        return this.cartBuilder.build()
    }

    makePayment(cart) {
        console.log(`Make payment for cart ${cart.id}`)
        if(this.getCurrentWalletPaymentMethod() === 'anonymous') {
            throw new CartError(`This payment method is not allow for anonymous wallet id: ${this.cartBuilder.wallet.id}`)
        }
        //at this step we good to confirm the payment
        let transaction = this.operator.createTransaction(cart.walletId, cart.paymentAddress, this.shopServiceAddress, cart.totalPrice)
        
        this.cartBuilder.cartItems = []
        cart.confirmed = true
        cart.actualReceive = cart.totalPrice
        cart.joinedTransactionId.push(transaction.id)

        this.cartHistory.push(cart)
        this.cartDb.write(this.cartHistory)

        return transaction
    }

    makePaymentForAnonymousWallet(cart) {
        //save cart history
        let balance = this.operator.getBalanceForAddress(cart.paymentAddress)
        let isEnoughBalance = balance - cart.totalPrice - Config.FEE_PER_TRANSACTION > 0 
        if(!isEnoughBalance) {
            throw new ArgumentError('The sender does not have enough to pay for the transaction.')
        }
        this.cartHistory.push(cart)
        this.cartDb.write(this.cartHistory)
    }

    doVerificationForWallet(walletId, verf_data) {
        let anonymousWallet = this.findAnonymousWalletById(walletId)
        if(!anonymousWallet) {
            throw new ArgumentError(`Wallet ${walletId} not found`)
        }

        anonymousWallet.verf_data.forEach((v_data) => {
            let ref_v_data = verf_data.find((d) => { return v_data.address == d.address})
            v_data.signature = ref_v_data.signature
        })

        console.log(`new verf data ${JSON.stringify(anonymousWallet.verf_data)}`)
        AnonymousWallet.verify(anonymousWallet)
        this.addWalletForCart(anonymousWallet)
        return anonymousWallet
    }

    getCurrentWalletPaymentMethod() {
        return this.cartBuilder.wallet.type
    }

    getOrderById(orderId) {
        return this.pendingOrder.find((order) => order.id === orderId)
    }

    getCurrentCartItem() {
        return this.cartBuilder.cartItems
    }

    getCurrentWalletAddressInfo() {
        if(this.cartBuilder.wallet === null) {
            throw new CartError(`Wallet not linked`)
        }
        let walletAddresses = this.cartBuilder.wallet.keyPairs.map((pair) => { return pair.publicKey })
        let walletAddressesInfo = walletAddresses.map((address) => { 
            try {
                let addressBalance = this.operator.getBalanceForAddress(address)
                return { 
                    address: address, 
                    balance: addressBalance,
                }  
            } catch(ex) {
                //if no transaction found just return the balance 0 with the status of it
                if(ex instanceof ArgumentError) return {
                    address: address,
                    balance: 0,
                    status: ex.message
                }
            }
        })
        return walletAddressesInfo
    }

    findCartById(cartId) {
        let cart = this.cartHistory.find((cart) => cart.id === cartId)
        if(cart === undefined) {
            throw new ArgumentError(`Cart id ${cartId} not found`)
        }
        return cart
    }

    findAnonymousWalletById(walletId) {
        return this.unconfirmAnonymousWallet.find((wallet) => wallet.id == walletId)
    }

    getAddressLinkRequest() {
        return this.linkRequest ? this.linkRequest : this.generateAddressLinkRequest()
    }

    getCurrentCartAddress() {
        console.log(`Cart address ${this.cartBuilder.paymentAddress}`)
        return this.cartBuilder.paymentAddress
    }

    getCurrentWallet() {
        //console.log(`Current wallet ${this.cart.wallet ? JSON.stringify(this.cart.wallet.id) : "None"}`)
        return this.cartBuilder.wallet
    }

    getItemById(itemId) {
        return this.shopItems.find((item) => item.id === itemId)
    }

    getAllItems() {
        return this.shopItems
    }

    removeItemForCart(itemId, cart = null) {
        let item = this.getItemById(itemId)
        if(item === undefined) {
            throw new ItemError(`Invalid item found ${itemId}`)
        }
        this.cartBuilder.removeItem(item)
        return item
    } 
    
    unlinkAddress() {
        this.cartBuilder.paymentAddress = null
    }

    unlinkWallet() {
        // unlink wallet by create new cart
        this.cartBuilder = new CartBuilder()
    }   

    getUnconfirmCartPaymentForWallet(wallet) {
        let addresses = AnonymousWallet.getAddresses(wallet)
        return this.cartHistory.find((cart) => addresses.includes(cart.paymentAddress) && !cart.confirmed && cart.totalPrice - cart.actualReceive > 0)
    }    
}   

module.exports = Shop