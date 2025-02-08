const Wallet = require("../lib/operator/wallet");
const ArgumentError = require("../lib/util/argumentError");
const CryptoEdDSAUtil = require("../lib/util/cryptoEdDSAUtil");
const CryptoUtil = require("../lib/util/cryptoUtil");

//Anonymous wallet just like a fake wallet for user their private wallet
class AnonymousWallet extends Wallet {
    static fromAddresses(addresses) {
        let wallet = new AnonymousWallet();
        wallet.id = CryptoUtil.randomId();
        wallet.type = 'anonymous'
        wallet.keyPairs = addresses.map((address) => { return { publicKey: address, secretKey: ''} })
        wallet.verf_data = null
        return wallet;
    }

    generateVerifyData() {
        this.verf_data = this.keyPairs.map((pair) => {
            return { address: pair.publicKey, data: CryptoUtil.randomId(), signature: '' }
        })
        return this.verf_data
    }

    static verify(wallet) {
        if(wallet.verf_data == null || wallet.verf_data.some((data) => { data.signature == '' }) || wallet.verf_data.length == 0) {
            throw new ArgumentError('Verify data is empty or signature is not placed')
        }

        wallet.verf_data.forEach((d) => {
            let isValidSignature = CryptoEdDSAUtil.verifySignature(d.address, d.signature, CryptoUtil.hash(d.data))
            if(!isValidSignature) {
                throw new ArgumentError('Wallet verification data signature invalid')
            }
        })

        return true
    }

    static getAddresses(wallet) {
        return wallet.keyPairs.map((pair) => { return  pair.publicKey })
    }
}

module.exports = AnonymousWallet