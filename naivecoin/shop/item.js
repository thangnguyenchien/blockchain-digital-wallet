const R = require('ramda')
const CryptoUtil = require('../lib/util/cryptoUtil')

class Item {
    constructor() {
        this.id = null
        this.name = null
        this.price = 0
    }

    static createItem(name, price) {
        let newItem = new Item()
        newItem.name = name
        newItem.price = price 
        newItem.id = CryptoUtil.randomId()
        return newItem
    }

    static fromJson(data) {
        let item = new Item()
        R.forEachObjIndexed((value, key) => { item[key] = value }, data)
        return item
    }
}

module.exports = Item