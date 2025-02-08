#set default for current node

from lib.db import Database

CURRENT_NODE = 'http://localhost:3001'
FEE_PER_TRANSACTION = 1

class Config():
    def __init__(self) -> None:
        self.db = Database
    def config_database(self, db):
        self.db = db
        return self

#all config goes here
CLIENT_CONFIG = Config().config_database(Database.create_schema("wallet.db"))