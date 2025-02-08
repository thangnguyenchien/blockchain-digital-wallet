import binascii
import ujson

from lib.config import CLIENT_CONFIG
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from lib.transaction.exception import TransactionInvalidException
from lib.cryptoUtil import CryptoUtil, Ed25519Util

TRANSACTION_TYPE_REGULAR = 'regular'
TRANSACTION_TYPE_FEE = 'fee'
TRANSACTION_TYPE_REWARD = 'reward'

class Transaction():
    def __init__(self, id: str, type: str, inputs = [], outputs = [], hash = None) -> None:
        self.id = id
        self.hash = hash
        self.type = type
        self.data = {
            'inputs': inputs,
            'outputs': outputs,
        }
        self.confirmed = False

    @staticmethod
    def verify(tx_obj):
        """
            Verify the transation, return the transation object if it valid else a TransactionInvalidException will be throw
        """
        current_tx_hash = tx_obj.calc_hash()
        if current_tx_hash != tx_obj.hash:
            raise TransactionInvalidException('Transacion hash invalid got {} expect {}'.format(current_tx_hash, tx_obj.hash))

        from cryptography.exceptions import InvalidSignature
        for input_txs in tx_obj.data["inputs"]:
            try:
                public_key = Ed25519PublicKey.from_public_bytes(binascii.unhexlify(input_txs["address"]))
                input_txs_hash = CryptoUtil.hash(ujson.dumps({
                    'transaction': input_txs["transaction"],
                    'index': input_txs["index"],
                    'address': input_txs["address"]
                }))
                Ed25519Util.verify_signature(public_key, input_txs["signature"], input_txs_hash)
            except InvalidSignature:
                raise TransactionInvalidException('Transation {} signature invalid'.format(input_txs["transaction"]))

        inputSum = sum(input["amount"] for input in tx_obj.data["inputs"])
        outputSum = sum(output["amount"] for output in tx_obj.data["outputs"])

        if outputSum >= inputSum:
            raise TransactionInvalidException('Transaction invalid got output amount larger than input amount got {}'.format(inputSum))

        return tx_obj
            
    @classmethod
    def from_json(cls, json_data):
        if type(json_data) == str:
            tx = ujson.loads(json_data)
        tx = json_data
        return cls(tx["id"], tx["type"], tx["data"]["inputs"], tx["data"]["outputs"], tx["hash"])

    def serialize(self):
        return {'transaction_id': self.id, 'hash': self.hash,'type': self.type ,'data': ujson.dumps(self.data), 'confirmed': self.confirmed}

    def save(self):
        SQL = 'insert into tx values(:transaction_id, :hash, :type, :data, :confirmed)'
        CLIENT_CONFIG.db.exec(SQL, param=self.serialize(), commit=True)
        return self

    def calc_hash(self) -> str:
        return CryptoUtil.hash(self.id + self.type + ujson.dumps(self.data))

    def confirm(self):
        self.hash = self.calc_hash()
        return {'id': self.id, 'hash': self.hash, 'type': self.type, 'data': self.data}
