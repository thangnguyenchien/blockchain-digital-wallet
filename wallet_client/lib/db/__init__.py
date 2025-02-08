import sqlite3

LOCAL_DATA_PATH = 'data/'

class Database():
    def __init__(self, name, row_format=sqlite3.Row) -> None:
        self.name = name
        self.row_format = row_format

    @classmethod
    def create_schema(cls, db_name):
        with sqlite3.connect(LOCAL_DATA_PATH + db_name) as con:
            cursor = con.cursor()
            cursor.execute("create table if not exists tx (transaction_id, hash, type, data, confirmed)")
            con.commit()
        return cls(db_name)

    def connect(self):
        connection = sqlite3.connect(LOCAL_DATA_PATH + self.name)
        connection.row_factory = self.row_format
        return connection, connection.cursor()

    def exec(self, sql, param = ..., commit=False):
        connection, cursor = self.connect()
        query_cursor = cursor.execute(sql, param)
        if commit:
            connection.commit()
            connection.close()
        return connection, query_cursor

    def fetch_one(self, select_sql, param = ...) -> sqlite3.Row:
        connection, cursor = self.exec(select_sql, param)
        result = cursor.fetchone()
        connection.close()
        return result


    def fetch_all(self, select_sql, param = ...):
        connection, cursor = self.exec(select_sql, param)
        result = cursor.fetchall()
        connection.close()
        return result