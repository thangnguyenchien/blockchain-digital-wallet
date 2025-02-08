const R = require('ramda')

class Cart {
    constructor() {
        this.id = null
        this.walletId = null
        this.totalPrice = 0
        this.actualReceive = 0
        this.paymentAddress = null
        this.confirmed = false
        this.cartItems = []
        this.joinedTransactionId = []
    }

    static fromJson(data) {
        let item = new Cart()
        R.forEachObjIndexed((value, key) => {
            item[key] = value
        }, data)
        return  item
    }

    static isAlreadyPaid(cart) {
        return cart.confirmed || cart.totalPrice - cart.actualReceive <= 0
    }
}

module.exports = Cart