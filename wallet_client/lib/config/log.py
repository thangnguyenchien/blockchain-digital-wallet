import logging

logging.basicConfig(format="%(asctime)s-[%(levelname)s]:%(message)s", filename='log.txt')
Logger = logging.getLogger()
Logger.setLevel(logging.INFO)
