const Cart = require("./cart");
const R = require("ramda")

class Carts extends Array {
    static fromJson(data) {
        let carts = new Carts();
        R.forEach((cart) => { carts.push(Cart.fromJson(cart)); }, data);
        return carts;
    }
}

module.exports = Carts