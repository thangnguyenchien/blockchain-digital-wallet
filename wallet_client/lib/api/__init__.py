import multiprocessing
import requests
import time
import itertools

from multiprocessing import Queue
from lib.config.log import Logger
from json.decoder import JSONDecodeError
from lib.api.exception import TransactionRequestException, WalletLinkException
from lib.config import CURRENT_NODE, CLIENT_CONFIG

class NaiveCoinApi():
    def __init__(self) -> None:
        pass

    @classmethod
    def get_address_balance(cls, address, node = CURRENT_NODE):
        res = requests.get(node + '/operator/{}/balance'.format(address))
        try: 
            return res.json()
        except JSONDecodeError:
            return {'balance': -1, 'status': res.text}

    @classmethod
    def query_blockchain_transactions_id_from_node(cls, transaction_id = [], node = CURRENT_NODE):
        #we use async io here to query multiple transaction request from the serer
        import aiohttp
        import asyncio
        loop = asyncio.get_event_loop()

        async def fetch(session, url):
            async with session.get(url) as response:
                try:
                    return await response.json()
                #we return the plaintext of the respond if something happend during the query
                except aiohttp.ContentTypeError:
                    return await response.text()

        async def fetch_all(urls, loop):
            async with aiohttp.ClientSession(loop=loop) as session:
                results = await asyncio.gather(*[fetch(session, url) for url in urls], return_exceptions=False)
                return results
        
        urls = [node + "/blockchain/blocks/transactions/{}".format(id) for id in transaction_id]
        tx_id_from_block = loop.run_until_complete(fetch_all(urls, loop))

        def parse_block_input(block_data):
            block_tx_id = []
            if type(block_data) == str:
                return ''
            else:
                for transaction in block_data["transactions"]:
                    block_tx_id.append(transaction["id"])
                return block_tx_id

        tx_id_from_block = list(map(parse_block_input, tx_id_from_block))
        return list(dict.fromkeys(itertools.chain(*tx_id_from_block))) #remove duplicate transaction id

    @classmethod
    def get_unspent_transaction_for_address(cls, address, node = CURRENT_NODE):
        payload = {'address': address}
        res = requests.get(node + '/blockchain/transactions/unspent', params=payload)
        return res.json()

    @classmethod
    def get_link_wallet_request(cls, addresses, link_request):
        data = {'addresses': addresses }
        res = requests.post(link_request, data)
        try:
            res_data = res.json()
            if res.status_code == 200:
                return res_data
            else:
                raise WalletLinkException('Failed to get wallet link Error: {}'.format(res_data["status"]))
        except JSONDecodeError:
            return res.text
        
    @classmethod
    def send_verification_data(cls, wallet_id, verf_data, node = CURRENT_NODE):
        data = { 'walletId': wallet_id, 'verf_data': verf_data }
        res = requests.post(node + '/shop/cart/wallet/anonymous/verify', json=data)
        try:
            res_data = res.json()
            if res.status_code == 201:
                return res_data
            else:
                raise WalletLinkException('Failed to link verify Error: {}'.format(res_data["status"]))
        except JSONDecodeError:
            return res.text
        
    @classmethod
    def send_transaction(cls, signed_transaction: dict, node = CURRENT_NODE):
        res = requests.post(node + '/blockchain/transactions', json=signed_transaction)
        
        if res.status_code == 201:
            return res.json()
        else:
            raise TransactionRequestException('Failed to send transacion to node error: {}'.format(res.text))

#transation updater job is to check new transaction 
#for every 10 seconds, and match it with local db to confirm the transaction
class TranscationUpdater(multiprocessing.Process):
    def __init__(self, queue: Queue):
        super(TranscationUpdater, self).__init__()
        self.queue = queue

    def run(self) -> None:
        try:
            Logger.info("Transcation updater started")
            while True:
                unconfirm_transactions = CLIENT_CONFIG.db.fetch_all('select * from tx where confirmed=:confirmed', {'confirmed': False})
                unconfirm_transactions_id = list(map(lambda transaction: transaction["transaction_id"], unconfirm_transactions))
                blocks_transaction_id = NaiveCoinApi.query_blockchain_transactions_id_from_node(unconfirm_transactions_id)

                for unconfirm_id in unconfirm_transactions_id:
                    if unconfirm_id in blocks_transaction_id:
                        CLIENT_CONFIG.db.exec('update tx set confirmed=:is_confirmed where transaction_id=:transaction_id', param={'is_confirmed': True, 'transaction_id': unconfirm_id}, commit=True)
                        Logger.info('Transaction id {} confirmed'.format(unconfirm_id))
                        #print("# Transaction confirmed {}".format(unconfirm_id))
                        self.queue.put(unconfirm_id)

                time.sleep(10)

        except Exception as e:
            Logger.error("Transaction updater stopped error: {}".format(e))
            exit(-1)