const Item = require('./item')
const R = require('ramda')

class Items extends Array {
    static fromJson(data) {
        let items = new Items();
        R.forEach((item) => { items.push(Item.fromJson(item)); }, data);
        return items;
    }
}

module.exports = Items