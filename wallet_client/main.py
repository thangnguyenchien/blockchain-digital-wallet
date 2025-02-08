# 1. It must generate the required Bitcoin addresses. -> Done
# 2. The wallet needs to recognize transactions and be able to send funds to the above-mentioned addresses. -> Done
# 3. At the other end of the spectrum, the wallet needs to recognize and process Bitcoin transactions being received from other addresses. -> API
# 4. The wallet must store the transaction history, and be able to show it when needed. Remember, Bitcoins are basically just digital transaction histories. -> Local database
# 8. Upon completion of the transaction, the wallet needs to broadcast the transaction to the Bitcoin blockchain. -> Send the trasaciton to node using API
import logging

from multiprocessing import Queue
from lib.api import TranscationUpdater
from client import ECLIENT_EXIT, ECLIENT_FORCE_EXIT, Client

processes = []

logging.basicConfig(format="%(asctime)s-[%(levelname)s]:%(message)s", filename='log.txt')

def main():
    queue = Queue()
    updater = TranscationUpdater(queue)
    client = Client(queue)
    updater.start()
    
    ret, ex = client.run()

    if ret == ECLIENT_FORCE_EXIT:
        logging.error('Client has been force to close error: {}'.format(ex))

    if ret == ECLIENT_EXIT:
        pass

    updater.terminate() 

if __name__ == "__main__":
    main()
