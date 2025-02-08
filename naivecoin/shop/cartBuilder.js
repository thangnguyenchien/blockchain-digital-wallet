const Item = require("./item")
const ItemError = require("./itemError")
const CartError = require("./cartError")
const Cart = require("./cart")
const CryptoUtil = require("../lib/util/cryptoUtil")
const e = require("express")

class CartBuilder {
    constructor() {
        this.paymentAddress = null
        this.wallet = null
        this.cartItems = []
    }

    addWallet(wallet) {
        this.wallet = wallet
    }

    removeItem(item) {
        if(this.cartItems.some((cartItem) => cartItem.cartItemDetail.id === item.id))
            this.cartItems = this.cartItems.filter((cartItem) => cartItem.cartItemDetail.id !== item.id)
        else 
            throw new CartError(`Item not exist in cart`)
        return this
    }

    addToCart(item, count) {
        let isItemExist = this.cartItems.some((cartItem) => {
            return cartItem.cartItemDetail.id === item.id
        })
        
        if(isItemExist) {
            this.cartItems.forEach((cartItem) => {
                if(cartItem.cartItemDetail.id === item.id) {
                    cartItem.count += count
                }
            })
        } else {
            this.cartItems.push({
                cartItemDetail: item,
                count: count
            })
        }

        return this
    }

    addPaymentAddress(paymentAddress) {
        this.paymentAddress = paymentAddress
        return this
    }

    total() {
        return this.cartItems.map((cartItem) => { return cartItem.cartItemDetail.price*cartItem.count }).reduce((prev, cur) => prev + cur)
    }

    build() {
        if(this.paymentAddress === null) throw new CartError(`customer address can not be null`)
        if(this.cartItems.length === 0) throw new CartError(`item can not be empty`)
        if(this.wallet === null) throw new CartError(`wallet cannot be empty`)

        let total = this.total()
        
        return Cart.fromJson({
            id: CryptoUtil.randomId(),
            walletId: this.wallet.id,
            paymentAddress: this.paymentAddress,
            totalPrice: total,
            actualReceive: 0,
            confirmed: false,
            cartItems: this.cartItems,
            joinedTransactionId: []
        })  
    }

}

module.exports = CartBuilder