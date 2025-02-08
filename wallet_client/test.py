import unittest

from lib.transaction import Transaction
from lib.transaction.exception import TransactionInvalidException
tx = {
            "id": "c3c1e6fbff949042b065dc9e22d065a54ab826595fd8877d2be8ddb8cbb0e27f",
            "hash": "3b5bbf698031e437787fe7b31f098e214a1eeff01fee9b95c22bccf20146982c",
            "type": "regular",
            "data": {
                "inputs": [
                    {
                        "transaction": "ab872b412afe62a087f3a8c354a27377f5fda33d7c98a1db3b1b0985801a6784",
                        "index": "0",
                        "amount": 5000000000,
                        "address": "e155df3a1bac05f88321b73931b48b54ea4300be9d1225e0b62638f537e5544c",
                        "signature": "4500f432d6b400811d83364224ce62bccd042ad92299118c0672bc5bc1390ffdfdbef135f36927d8bd77843f3a0b868d9ed3a5346dcbeda6c06f33876cfae00d",
                    }
                ],
                "outputs": [
                    {
                        "amount": 1000000000,
                        "address": "c3c96504e432e35caa94c30034e70994663988ab80f94e4b526829c99958afa8",
                    },
                    {
                        "amount": 3999999999,
                        "address": "e155df3a1bac05f88321b73931b48b54ea4300be9d1225e0b62638f537e5544c",
                    },
                ],
            },
        }

class TestTransaction(unittest.TestCase):

    def test_transaction_modify_and_recalc_hash(self):
        # we parse the JSON data into our Tranasction object for verifying
        test_tx = Transaction.from_json(tx)
        # if some one intercept the transaction infomation e.g modify the inputs transaction id 
        test_tx.data["inputs"][0]["transation"] = "3b5bbf698031e437787fe7b31f098e214a1eeff01fee9b95c22bccf20146982c"
        #we confirm the transaction to recalc the tx hash
        test_tx.confirm()
        # now we verfify it, the verify must throw the InvalidSignature if the transaction signature invalid
        with self.assertRaises(TransactionInvalidException):
            Transaction.verify(test_tx)

    def test_transaction_modify(self):
        # we parse the JSON data into our Tranasction object for verifying
        test_tx = Transaction.from_json(tx)
        # if some one intercept the transaction infomation e.g modify the outputs transaction into larger amount
        test_tx.data["outputs"][0]["amount"] = 10000000000
        # now we verfify it, the verify must throw the TransactionInvalidException if the transaction hash invalid
        with self.assertRaises(TransactionInvalidException):
            Transaction.verify(test_tx)

if __name__== "__main__":
    unittest.main()