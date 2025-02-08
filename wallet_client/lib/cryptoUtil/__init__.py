import binascii
import hashlib
import numpy as np

from ..config.log import Logger
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

default_salt = b'0ffaa74d206930aaece253f090c88dbe6685b9e66ec49ad988d84fd7dff230d1' #this can be store in local db

class CryptoUtil():
    def __init__(self) -> None:
        pass

    @staticmethod
    def random_id(len=32) -> str:
        return np.random.bytes(len).hex()
        
    @staticmethod
    def hash(any: str):
        hash_inst = hashlib.sha256()
        hash_inst.update(any.encode())
        return hash_inst.hexdigest()

class Ed25519Util():
    def __init__(self) -> None:
        pass
    
    @staticmethod
    def sc_reduce32(n):
        n = int.from_bytes(n, byteorder='little')
        l = (2**252 + 27742317777372353535851937790883648493)
        reduced = n % l
        newbytes = reduced.to_bytes(32, 'little')
        return newbytes

    @staticmethod
    def generate_secret(password_any, s=default_salt) -> str:
        kdf = PBKDF2HMAC(hashes.SHA512(), 512, s, 10000)
        password_hash_byte = binascii.unhexlify(password_any)
        secret = kdf.derive(password_hash_byte).hex()
        return secret

    @staticmethod
    def generate_key_pair_from_secret(secret: str):
        priv_key = Ed25519Util.key_from_secret(binascii.unhexlify(secret))
        pub_key = priv_key.public_key()
        Logger.debug("Public key: {}".format(pub_key.public_bytes(Encoding.Raw, PublicFormat.Raw).hex()))
        return priv_key, pub_key

    #reduce the secret size to 32 byte to create ED25519 key pairs
    @staticmethod
    def key_from_secret(secret):
        return Ed25519PrivateKey.from_private_bytes(Ed25519Util.sc_reduce32(secret))

    @staticmethod
    def sign_hash(private_key: Ed25519PrivateKey, message_hash):
        signature = private_key.sign(binascii.unhexlify(message_hash))
        Logger.debug("Signature {}".format(binascii.hexlify(signature)))
        return signature
    
    @staticmethod
    def verify_signature(public_key: Ed25519PublicKey, signature: str, message_hash: str):
            signature_byte = binascii.unhexlify(signature)
            message_byte = binascii.unhexlify(message_hash)
            verf_result = public_key.verify(signature_byte, message_byte)
            return verf_result