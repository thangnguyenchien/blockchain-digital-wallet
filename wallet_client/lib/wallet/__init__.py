import binascii
import ujson

from lib.api import NaiveCoinApi
from lib.config import FEE_PER_TRANSACTION, CLIENT_CONFIG
from lib.config.log import Logger
from lib.api.exception import WalletLinkException
from lib.transaction import TRANSACTION_TYPE_REGULAR, Transaction
from lib.wallet.exception import WalletException
from lib.cryptoUtil import Ed25519Util, CryptoUtil
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, PublicFormat

class Wallet():
    def __init__(self, id, password_hash, secret, key_pairs) -> None:
        self.id = id
        self.password_hash = password_hash
        self.secret = secret
        self.key_pairs = key_pairs

    def serialize(self) -> dict:
        return {'wallet_id': self.id, 'password_hash': self.password_hash, 'secret': self.secret, 'key_pair': ujson.dumps(self.key_pairs)}
        
    def save(self):
        #before save new wallet we have to check our local db already been save
        sql_param = {}
        current_wallet = CLIENT_CONFIG.db.fetch_one('select * from wallet where password_hash=:password_hash', param={'password_hash': self.password_hash})
        if current_wallet == None:
            SQL = 'insert into wallet values(:wallet_id,:password_hash,:secret,:key_pair)'
            sql_param = self.serialize()
        else:
            #we just append the old key pair with the new one
            SQL = 'update wallet set key_pair=:key_pair where password_hash=:password_hash'
            sql_param = {'key_pair': ujson.dumps(self.key_pairs), 'password_hash': self.password_hash }
        CLIENT_CONFIG.db.exec(SQL, sql_param, commit=True)
    
    def sign_verification_data(self, verf_data):
        verf_data_copy = verf_data.copy()
        for v_data in verf_data_copy:
            _priv_key = self.get_secret_key_by_address(v_data["address"])
            if _priv_key is not None:
                v_data["signature"] = Ed25519Util.sign_hash(
                    Ed25519PrivateKey.from_private_bytes(binascii.unhexlify(_priv_key)), 
                    CryptoUtil.hash(v_data["data"])).hex()
            else:
                Logger.error("Private key for address {} not found".format(v_data["address"]))
                raise WalletLinkException("Wallet link verification failed")
        return verf_data_copy

    @classmethod
    def load_wallet_from_password(cls, password: str):
        password_hash = CryptoUtil.hash(password)
        current_wallet = CLIENT_CONFIG.db.fetch_one('select * from wallet where password_hash=:password_hash', param={'password_hash': password_hash})
        if current_wallet == None:
            raise WalletException("Wallet not found from local storage")
        return cls(current_wallet["wallet_id"], current_wallet["password_hash"], current_wallet["secret"], ujson.loads(current_wallet["key_pair"]))

    @classmethod 
    def from_password(cls, password):
        return cls(CryptoUtil.random_id(), CryptoUtil.hash(password), '', [])
        
    def get_secret_key_by_address(self, address):
        for p in self.key_pairs:
            if p["publicKey"] == address:
                return p["privateKey"]

    @property
    def addresses(self):
        return list(p["publicKey"] for p in self.key_pairs)        

    def generate_address(self):
        if self.secret == None or self.secret == '':
            self.secret = Ed25519Util.generate_secret(self.password_hash)
        #check if wallet already has previous key or else we take the last private key as the seed to generate new address 
        if not self.key_pairs:
            priv, pub = Ed25519Util.generate_key_pair_from_secret(self.secret)
        else:
            last_key_pair = self.key_pairs[-1]
            seed = Ed25519Util.generate_secret(last_key_pair["privateKey"])
            priv, pub = Ed25519Util.generate_key_pair_from_secret(seed)

        newPair = {
                'index': len(self.key_pairs) + 1,
                'publicKey': pub.public_bytes(Encoding.Raw, PublicFormat.Raw).hex(),
                'privateKey': priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, serialization.NoEncryption()).hex()
            }

        self.key_pairs.append(newPair)
        return newPair["publicKey"]

    @staticmethod
    def get_total_amount_from_uxto(uxto):
        amount = 0
        for tx in uxto:
            amount+=tx['amount']
        return amount

    def sign_per_uxto(self, utxo, secret_key):
        utxo_copy = utxo.copy()
        for tx in utxo_copy:
            txInputHash = CryptoUtil.hash(ujson.dumps({
                'transaction': tx["transaction"],
                'index': tx["index"],
                'address': tx["address"]
            }))
            tx['signature'] = Ed25519Util.sign_hash(secret_key, txInputHash).hex()
        Logger.debug("Uxto signed: {}".format(ujson.dumps(utxo_copy)))
        return utxo_copy

    def send(self, to_address, from_address, amount) -> Transaction:
        uxto = NaiveCoinApi.get_unspent_transaction_for_address(from_address) #get remain output transaction from blockchain
        signed_transaction = self.sign_and_create_transaction(uxto, to_address, from_address, amount, FEE_PER_TRANSACTION)
        transaction_created = NaiveCoinApi.send_transaction(signed_transaction)
        return Transaction.from_json(transaction_created)

    def sign_and_create_transaction(self, uxto, to_address, from_address, amount, fee, change_address='') -> dict:
        secret_key = self.get_secret_key_by_address(from_address)
        ed25519_secret_key_obj = Ed25519PrivateKey.from_private_bytes(binascii.unhexlify(secret_key))
        
        if not secret_key:
            raise WalletException("Key for address not found") 
        if not to_address or not from_address:
            raise WalletException("Transation infomation missing")
        if len(uxto) == 0:
            raise WalletException("Sender address unspent transaction empty")
        if change_address == '':
            change_address = from_address

        totalAmount = Wallet.get_total_amount_from_uxto(uxto)
        changeAmount = totalAmount - amount - fee
        input_tx = self.sign_per_uxto(uxto, ed25519_secret_key_obj)
        output_tx = []

        output_tx.append({
            'amount': amount,
            'address': to_address
        })

        if(changeAmount > 0):
            output_tx.append({
                'amount': changeAmount,
                'address': change_address
            })
        else:
            raise WalletException("Sender does not have enough to pay for the transaction")
        
        tx = Transaction(CryptoUtil.random_id(), TRANSACTION_TYPE_REGULAR, input_tx, output_tx)
        return tx.confirm()