const express = require('express');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const R = require('ramda');
const path = require('path');
const swaggerDocument = require('./swagger.json');
const Block = require('../blockchain/block');
const Transaction = require('../blockchain/transaction');
const TransactionAssertionError = require('../blockchain/transactionAssertionError');
const BlockAssertionError = require('../blockchain/blockAssertionError');
const HTTPError = require('./httpError');
const ArgumentError = require('../util/argumentError');
const CryptoUtil = require('../util/cryptoUtil');
const timeago = require('timeago.js');
const ItemError = require('../../shop/itemError');
const CartError = require('../../shop/cartError');
const Cart = require('../../shop/cart');
const AnonymousWallet = require('../../shop/anonymousWallet');

class HttpServer {
    constructor(node, blockchain, operator, miner, shop) {
        this.app = express();

        const projectWallet = (wallet) => {
            return {
                id: wallet.id,
                addresses: R.map((keyPair) => {
                    return keyPair.publicKey;
                }, wallet.keyPairs)
            };
        };

        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));
        this.app.set('view engine', 'pug');
        this.app.set('views', path.join(__dirname, 'views'));
        this.app.locals.formatters = {
            time: (rawTime) => {
                const timeInMS = new Date(rawTime * 1000);
                return `${timeInMS.toLocaleString()} - ${timeago().format(timeInMS)}`;
            },
            hash: (hashString) => {
                return hashString != '0' ? `${hashString.substr(0, 5)}...${hashString.substr(hashString.length - 5, 5)}` : '<empty>';
            },
            amount: (amount) => amount.toLocaleString()
        };
        this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

        this.app.get('/blockchain', (req, res) => {
            if (req.headers['accept'] && req.headers['accept'].includes('text/html'))
                res.render('blockchain/index.pug', {
                    pageTitle: 'Blockchain',
                    blocks: blockchain.getAllBlocks()
                });
            else
                throw new HTTPError(400, 'Accept content not supported');
        });

        this.app.get('/shop', (req, res) => {
            if (req.headers['accept'] && req.headers['accept'].includes('text/html'))
                res.render('shop/index.pug', {
                    pageTitle: 'Shop',
                    items: shop.getAllItems(),
                    wallet: shop.getCurrentWallet(),
                    address: shop.getCurrentCartAddress()
                });
            else
                throw new HTTPError(400, 'Accept content not supported');
        })

        this.app.get('/shop/wallet', (req, res) => {
            if (req.headers['accept'] && req.headers['accept'].includes('text/html'))
                res.render('shop/wallet/index.pug', {
                    pageTitle: 'Shop'
                });
            else
                throw new HTTPError(400, 'Accept content not supported');
        })

        this.app.get('/shop/cart/wallet/purchase', (req, res) => {
            if (req.headers['accept'] && req.headers['accept'].includes('text/html')) {
                let currentWallet = shop.getCurrentWallet()
                if (currentWallet) {
                    let unconfirmCart = shop.getUnconfirmCartPaymentForWallet(currentWallet)
                    if (!unconfirmCart) {

                        try {
                            res.render('shop/wallet/purchase.pug', {
                                pageTitle: 'Purchase',
                                items: shop.getCurrentCartItem(),
                                wallet: currentWallet,
                                paymentAddresses: shop.getCurrentWalletAddressInfo()
                            });
                        } catch (ex) {
                            //console.log(ex.message)
                            if (ex instanceof CartError) throw new HTTPError(404, 'Wallet link error')
                        }
                    }
                    else {
                        res.render('shop/wallet/confirm.pug', {
                            pageTitle: 'Shop',
                            wallet: currentWallet,
                            cartId: unconfirmCart.id,
                            shopAddress: shop.shopServiceAddress,
                            amount: unconfirmCart.totalPrice - unconfirmCart.actualReceive,
                            message: {
                                data: `You have to send more ${unconfirmCart.totalPrice - unconfirmCart.actualReceive} to continue shopping`,
                                isError: true
                            }
                        });
                    }
                }
                else {
                    res.render('shop/wallet/index.pug', {
                        pageTitle: 'Shop',
                        message: {
                            data: `Please link your wallet before making purchase`,
                            isError: true
                        }
                    });
                }
            }
            else
                throw new HTTPError(400, 'Accept content not supported');
        })

        this.app.get('/shop/cart/wallet/unlink', (req, res) => {
            if (shop.getCurrentWallet()) {
                shop.unlinkWallet()
                res.render('shop/index.pug', {
                    pageTitle: 'Shop',
                    items: shop.getAllItems(),
                    message: {
                        data: `Wallet unlinked`,
                        isError: false
                    }
                });
            } else {
                res.render('shop/index.pug', {
                    pageTitle: 'Shop',
                    items: shop.getAllItems(),
                    message: {
                        data: `Wallet not linked`,
                        isError: true
                    }
                });
            }
        })

        this.app.get('/shop/wallet/anonymous', (req, res) => {
            let linkRequest = shop.generateAddressLinkRequest()
            console.log(JSON.stringify(linkRequest))
            res.render('shop/wallet/index.pug', {
                pageTitle: 'Address',
                linkRequest: true,
                link: "http://localhost:3001/shop/cart/wallet/anonymous" + "/" + linkRequest.linkId
            })
        })

        this.app.post('/shop/cart/wallet/anonymous/verify', (req, res) => {
            let walletId = req.body.walletId
            let verf_data = req.body.verf_data
            console.log(`Wallet link verf ${JSON.stringify(req.body)}`)
            // console.log(JSON.stringify(anonymousWallet))
            try {
                let verified_wallet = shop.doVerificationForWallet(walletId, verf_data)
                res.status(201).send({
                    status: `Wallet link verificate success`,
                    walletId: verified_wallet.id,
                })
            } catch(ex){
                if(ex instanceof ArgumentError) {
                    res.status(401).send({
                        status: `Wallet link verificate failed error: ${ex.message}`,
                        walletId: walletId,
                    })
                } else {
                    res.status(501).send({
                        status: `Internal server error ${ex.message}`,
                    })
                }
            }
        })

        this.app.post('/shop/cart/wallet/anonymous/:linkId', (req, res) => {
            let paymentAddress = req.body.addresses
            let linkId = req.params.linkId
            let linkRequest = shop.getAddressLinkRequest()
            console.log(JSON.stringify(req.body))
            try {
                if (paymentAddress && Array.isArray(paymentAddress) && linkRequest.linkId === linkId) {
                    let wallet = shop.getAnonymousWalletFromAddress(paymentAddress)
                    res.status(200).send({
                        status: `Address link success`,
                        wallet: wallet.id,
                        verf_data: wallet.verf_data
                    })
                }
                else {
                    res.status(404).send({
                        status: `Invalid link request`,
                    })
                }
            } catch (ex) {
                if (ex instanceof ArgumentError) {
                    res.status(400).send({
                        status: `Error: ${ex.message}`,
                        code: 400
                    })
                } else {
                    throw new HTTPError(400, ex.message, paymentAddress)
                }
            }
        })

        this.app.post('/shop/cart/wallet', (req, res) => {
            let password = req.body.password
            let walletId = req.body.walletId

            if (password == null) throw new HTTPError(401, 'Wallet\'s password is missing.');
            let passwordHash = CryptoUtil.hash(password);

            try {
                if (!operator.checkWalletPassword(walletId, passwordHash)) throw new HTTPError(403, `Invalid password for wallet '${walletId}'`)
                let wallet = operator.getWalletById(walletId)
                if (wallet.keyPairs.length === 0) throw new HTTPError(403, `Wallet ${walletId} address empty, please create new address`)
                shop.addWalletForCart(wallet)
                //res.status(200).send(`Wallet ${walletId} added`)
                res.render('shop/index.pug', {
                    pageTitle: 'Shop',
                    items: shop.getAllItems(),
                    wallet: shop.getCurrentWallet(),
                    message: {
                        data: `Wallet link success`,
                        isError: false
                    }
                });
            } catch (ex) {
                if (ex instanceof ArgumentError || ex instanceof TransactionAssertionError) throw new HTTPError(400, ex.message, walletId, ex)
                else throw ex
            }
        })

        this.app.post('/shop/cart/item', (req, res) => {
            let itemId = req.body.itemId
            let itemCount = parseInt(req.body.itemCount)
            console.log(`Add item request ${JSON.stringify(req.body)}`)
            try {
                if (itemCount !== NaN) {
                    if (itemCount < 0 || !itemCount) {
                        throw new HTTPError(400, `Invalid item count for ${itemId}`)
                    }
                    let addedItem = shop.addItem(itemId, itemCount)
                    if (shop.getCurrentWallet()) {
                        res.render('shop/index.pug', {
                            pageTitle: 'Shop',
                            items: shop.getAllItems(),
                            wallet: shop.getCurrentWallet(),
                            message: {
                                data: `Item ${addedItem.name} added`,
                                isError: false
                            }
                        });
                    }
                } else {
                    res.render('shop/index.pug', {
                        pageTitle: 'Shop',
                        items: shop.getAllItems(),
                        wallet: shop.getCurrentWallet(),
                        message: {
                            data: `Invalid input`,
                            isError: true
                        }
                    });
                }
            } catch (ex) {
                if (ex instanceof ItemError) throw new HTTPError(404, `Item not found with id ${itemId}`)
            }
        })

        this.app.post('/shop/cart/remove/item', (req, res) => {
            let itemId = req.body.itemId
            console.log(`Remove item request ${JSON.stringify(req.body)}`)
            try {
                let removedItem = shop.removeItemForCart(itemId)
                if (shop.getCurrentWallet()) {
                    res.render('shop/wallet/purchase.pug', {
                        pageTitle: 'Purchase',
                        items: shop.getCurrentCartItem(),
                        wallet: shop.getCurrentWallet(),
                        paymentAddresses: shop.getCurrentWalletAddressInfo(),
                        message: {
                            data: `Item ${removedItem.name} removed`,
                            isError: false
                        }
                    });
                } else {
                    res.render('shop/index.pug', {
                        pageTitle: 'Shop',
                        items: shop.getAllItems(),
                        wallet: shop.getCurrentWallet(),
                        message: {
                            data: `Peform link to your wallet before doing any transaction`,
                            isError: true
                        }
                    });
                }
            } catch (ex) {
                if (ex instanceof ItemError || ex instanceof CartError) {
                    res.render('shop/index.pug', {
                        pageTitle: 'Shop',
                        items: shop.getAllItems(),
                        wallet: shop.getCurrentWallet(),
                        message: {
                            data: `Remove failed error: ${ex.message}`,
                            isError: true
                        }
                    });
                }
            }
        })

        this.app.post('/shop/cart/validate', (req, res) => {
            let cartId = req.body.cartId
            let transactionId = req.body.transactionId
            try {
                let cart = shop.confirmTransactionForCart(transactionId, cartId)
                if (Cart.isAlreadyPaid(cart)) {
                    res.render('shop/index.pug', {
                        pageTitle: 'Shop',
                        items: shop.getAllItems(),
                        wallet: shop.getCurrentWallet(),
                        message: {
                            data: 'Thank your for your payment',
                            isError: false
                        }
                    });
                } else {
                    res.render('shop/index.pug', {
                        pageTitle: 'Shop',
                        items: shop.getAllItems(),
                        wallet: shop.getCurrentWallet(),
                        message: {
                            data: `You have to pay ${cart.totalPrice - cart.actualReceive} more to complete the payment`,
                            isError: true
                        }
                    });
                }
            } catch (ex) {
                if (ex instanceof ArgumentError) {
                    let currentCart = shop.findCartById(cartId)
                    res.render('shop/wallet/confirm.pug', {
                        pageTitle: 'Shop',
                        wallet: shop.getCurrentWallet(),
                        cartId: currentCart.id,
                        shopAddress: shop.shopServiceAddress,
                        amount: currentCart.totalPrice,
                        message: {
                            data: ex.message,
                            isError: true
                        }
                    });
                } else {
                    res.render('shop/index.pug', {
                        pageTitle: 'Shop',
                        items: shop.getAllItems(),
                        wallet: shop.getCurrentWallet(),
                        message: {
                            data: ex.message,
                            isError: true
                        }
                    });
                }
            }
        })

        //NOTE: with normal wallet (web-based wallet) wallet will be store in file database 
        // so the creation of transaction will be perform on the server-side
        // with anonymous wallet (software wallet), user have make proof-of-purchase by sending their 
        // transaction id the transaction must be in the blockchain or else the shop will notify the transaction is not confirmed

        this.app.post('/shop/cart/wallet/purchase', (req, res) => {
            let paymentAddress = req.body.paymentAddress
            //console.log(JSON.stringify(req.body))
            if (!paymentAddress) {
                throw new HTTPError(404, 'Payment address cant be empty')
            }
            try {
                //before checkout we have to check if the customer have any unconfirmed cart
                let unconfirmCart = shop.getUnconfirmCartPaymentForWallet(shop.getCurrentWallet())
                if (!unconfirmCart) {
                    let cart = shop.checkOut(paymentAddress)
                    switch (shop.getCurrentWalletPaymentMethod()) {
                        case 'regular':
                            let transaction = Transaction.fromJson(shop.makePayment(cart))
                            transaction.check()
                            //if anything ok then safely add transaction to the block chain
                            let transactionCreated = blockchain.addTransaction(transaction)
                            console.log(`New transaction create ${transactionCreated.id}`)
                            res.render('shop/index.pug', {
                                pageTitle: 'Shop',
                                items: shop.getAllItems(),
                                wallet: shop.getCurrentWallet(),
                                message: {
                                    data: `Transaction confirmed`,
                                    isError: false
                                }
                            });
                            break
                        case 'anonymous':
                            shop.makePaymentForAnonymousWallet(cart)
                            res.render('shop/wallet/confirm.pug', {
                                pageTitle: 'Shop',
                                wallet: shop.getCurrentWallet(),
                                cartId: cart.id,
                                shopAddress: shop.shopServiceAddress,
                                amount: cart.totalPrice
                            });
                            break
                        default:
                            res.render('shop/index.pug', {
                                pageTitle: 'Shop',
                                items: shop.getAllItems(),
                                wallet: shop.getCurrentWallet(),
                                message: {
                                    data: `Unsupported wallet`,
                                    isError: true
                                }
                            });
                    }
                }
                else {
                    res.render('shop/wallet/confirm.pug', {
                        pageTitle: 'Shop',
                        wallet: shop.getCurrentWallet(),
                        cartId: unconfirmCart.id,
                        shopAddress: shop.shopServiceAddress,
                        amount: unconfirmCart.totalPrice - unconfirmCart.actualReceive,
                        message: {
                            data: `Your cart id ${unconfirmCart.id} with address ${unconfirmCart.paymentAddress} is not confirmed please send more ${unconfirmCart.totalPrice - unconfirmCart.actualReceive} NaiveCoin to continue shopping`,
                            isError: true
                        }
                    });
                }
            } catch (ex) {
                if (ex instanceof CartError || ex instanceof ArgumentError) {
                    res.render('shop/index.pug', {
                        pageTitle: 'Shop',
                        items: shop.getAllItems(),
                        wallet: shop.getCurrentWallet(),
                        message: {
                            data: `Transaction failed error: ${ex.message}`,
                            isError: true
                        }
                    });
                }
                if (ex instanceof TransactionAssertionError)
                    throw new HTTPError(400, ex.message, paymentAddress, ex);
                else throw ex;
            }
        })

        this.app.get('/blockchain/blocks', (req, res) => {
            res.status(200).send(blockchain.getAllBlocks());
        });

        this.app.get('/blockchain/blocks/latest', (req, res) => {
            let lastBlock = blockchain.getLastBlock();
            if (lastBlock == null) throw new HTTPError(404, 'Last block not found');

            res.status(200).send(lastBlock);
        });

        this.app.put('/blockchain/blocks/latest', (req, res) => {
            let requestBlock = Block.fromJson(req.body);
            let result = node.checkReceivedBlock(requestBlock);

            if (result == null) res.status(200).send('Requesting the blockchain to check.');
            else if (result) res.status(200).send(requestBlock);
            else throw new HTTPError(409, 'Blockchain is update.');
        });

        this.app.get('/blockchain/blocks/:hash([a-zA-Z0-9]{64})', (req, res) => {
            let blockFound = blockchain.getBlockByHash(req.params.hash);
            if (blockFound == null) throw new HTTPError(404, `Block not found with hash '${req.params.hash}'`);

            res.status(200).send(blockFound);
        });

        this.app.get('/blockchain/blocks/:index', (req, res) => {
            let blockFound = blockchain.getBlockByIndex(parseInt(req.params.index));
            if (blockFound == null) throw new HTTPError(404, `Block not found with index '${req.params.index}'`);

            res.status(200).send(blockFound);
        });

        this.app.get('/blockchain/blocks/transactions/:transactionId([a-zA-Z0-9]{64})', (req, res) => {
            let transactionFromBlock = blockchain.getTransactionFromBlocks(req.params.transactionId);
            if (transactionFromBlock == null) throw new HTTPError(404, `Transaction '${req.params.transactionId}' not found in any block`);

            res.status(200).send(transactionFromBlock);
        });

        this.app.get('/blockchain/transactions', (req, res) => {
            if (req.headers['accept'] && req.headers['accept'].includes('text/html'))
                res.render('blockchain/transactions/index.pug', {
                    pageTitle: 'Unconfirmed Transactions',
                    transactions: blockchain.getAllTransactions()
                });
            else
                res.status(200).send(blockchain.getAllTransactions());
        });

        this.app.post('/blockchain/transactions', (req, res) => {
            console.log(JSON.stringify(req.body))
            let requestTransaction = Transaction.fromJson(req.body);
            let transactionFound = blockchain.getTransactionById(requestTransaction.id);
            if (transactionFound != null) throw new HTTPError(409, `Transaction '${requestTransaction.id}' already exists`);

            try {
                let newTransaction = blockchain.addTransaction(requestTransaction);
                res.status(201).send(newTransaction);
            } catch (ex) {
                if (ex instanceof TransactionAssertionError) throw new HTTPError(400, ex.message, requestTransaction, ex);
                else throw ex;
            }
        });

        this.app.get('/blockchain/transactions/unspent', (req, res) => {
            res.status(200).send(blockchain.getUnspentTransactionsForAddress(req.query.address));
        });

        this.app.get('/operator/wallets', (req, res) => {
            let wallets = operator.getWallets();

            let projectedWallets = R.map(projectWallet, wallets);

            res.status(200).send(projectedWallets);
        });

        this.app.post('/operator/wallets', (req, res) => {
            let password = req.body.password;
            if (R.match(/\w+/g, password).length <= 4) throw new HTTPError(400, 'Password must contain more than 4 words');

            let newWallet = operator.createWalletFromPassword(password);

            let projectedWallet = projectWallet(newWallet);

            res.status(201).send(projectedWallet);
        });

        this.app.get('/operator/wallets/:walletId', (req, res) => {
            let walletFound = operator.getWalletById(req.params.walletId);
            if (walletFound == null) throw new HTTPError(404, `Wallet not found with id '${req.params.walletId}'`);

            let projectedWallet = projectWallet(walletFound);

            res.status(200).send(projectedWallet);
        });

        this.app.post('/operator/wallets/:walletId/transactions', (req, res) => {
            let walletId = req.params.walletId;
            let password = req.headers.password;

            if (password == null) throw new HTTPError(401, 'Wallet\'s password is missing.');
            let passwordHash = CryptoUtil.hash(password);

            try {
                if (!operator.checkWalletPassword(walletId, passwordHash)) throw new HTTPError(403, `Invalid password for wallet '${walletId}'`);

                let newTransaction = operator.createTransaction(walletId, req.body.fromAddress, req.body.toAddress, req.body.amount, req.body['changeAddress'] || req.body.fromAddress);

                newTransaction.check();

                let transactionCreated = blockchain.addTransaction(Transaction.fromJson(newTransaction));
                res.status(201).send(transactionCreated);
            } catch (ex) {
                if (ex instanceof ArgumentError || ex instanceof TransactionAssertionError) throw new HTTPError(400, ex.message, walletId, ex);
                else throw ex;
            }
        });

        this.app.get('/operator/wallets/:walletId/addresses', (req, res) => {
            let walletId = req.params.walletId;
            try {
                let addresses = operator.getAddressesForWallet(walletId);
                res.status(200).send(addresses);
            } catch (ex) {
                if (ex instanceof ArgumentError) throw new HTTPError(400, ex.message, walletId, ex);
                else throw ex;
            }
        });

        this.app.post('/operator/wallets/:walletId/addresses', (req, res) => {
            let walletId = req.params.walletId;
            let password = req.headers.password;

            if (password == null) throw new HTTPError(401, 'Wallet\'s password is missing.');
            let passwordHash = CryptoUtil.hash(password);

            try {
                if (!operator.checkWalletPassword(walletId, passwordHash)) throw new HTTPError(403, `Invalid password for wallet '${walletId}'`);

                let newAddress = operator.generateAddressForWallet(walletId);
                res.status(201).send({ address: newAddress });
            } catch (ex) {
                if (ex instanceof ArgumentError) throw new HTTPError(400, ex.message, walletId, ex);
                else throw ex;
            }
        });

        this.app.get('/operator/:addressId/balance', (req, res) => {
            let addressId = req.params.addressId;

            try {
                let balance = operator.getBalanceForAddress(addressId);
                res.status(200).send({ balance: balance });
            } catch (ex) {
                if (ex instanceof ArgumentError) throw new HTTPError(404, ex.message, { addressId }, ex);
                else throw ex;
            }
        });

        this.app.get('/node/peers', (req, res) => {
            res.status(200).send(node.peers);
        });

        this.app.post('/node/peers', (req, res) => {
            let newPeer = node.connectToPeer(req.body);
            res.status(201).send(newPeer);
        });

        this.app.get('/node/transactions/:transactionId([a-zA-Z0-9]{64})/confirmations', (req, res) => {
            node.getConfirmations(req.params.transactionId)
                .then((confirmations) => {
                    res.status(200).send({ confirmations: confirmations });
                });
        });

        this.app.post('/miner/mine', (req, res, next) => {
            miner.mine(req.body.rewardAddress, req.body['feeAddress'] || req.body.rewardAddress)
                .then((newBlock) => {
                    newBlock = Block.fromJson(newBlock);
                    blockchain.addBlock(newBlock);
                    res.status(201).send(newBlock);
                })
                .catch((ex) => {
                    if (ex instanceof BlockAssertionError && ex.message.includes('Invalid index')) next(new HTTPError(409, 'A new block were added before we were able to mine one'), null, ex);
                    else next(ex);
                });
        });

        this.app.use(function (err, req, res, next) {  // eslint-disable-line no-unused-vars
            if (err instanceof HTTPError) res.status(err.status);
            else res.status(500);
            res.send(err.message + (err.cause ? ' - ' + err.cause.message : ''));
        });
    }

    listen(host, port) {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(port, host, (err) => {
                if (err) reject(err);
                console.info(`Listening http on port: ${this.server.address().port}, to access the API documentation go to http://${host}:${this.server.address().port}/api-docs/`);
                resolve(this);
            });
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            this.server.close((err) => {
                if (err) reject(err);
                console.info('Closing http');
                resolve(this);
            });
        });
    }
}

module.exports = HttpServer;