import requests
import re
import multiprocessing

from lib.config import CLIENT_CONFIG
from lib.api.exception import TransactionRequestException, WalletLinkException
from lib.api import NaiveCoinApi
from lib.wallet import Wallet
from PyInquirer import prompt
from lib.wallet.exception import WalletException

#client return code
ECLIENT_EXIT = 1
ECLIENT_FORCE_EXIT = -1

class Client():
    def __init__(self, queue: multiprocessing.Queue) -> None:
        self.queue = queue
        self.wallet = None

    def print_nofity(self):
        while not self.queue.empty():
            print('## Transaction confirmed {} ##'.format(self.queue.get()))

    def link_request(self):

        from examples import custom_style_1
        from prompt_toolkit.validation import Validator, ValidationError

        class HttpLinkValidator(Validator):
            def validate(self, document):
                ok = re.match(r"^(?:http(s)?:\/\/\w+)(?:\:\d+)(?:[a-zA-Z0-9/]+)", document.text)
                if not ok:
                    raise ValidationError(
                        message="Invalid link format", cursor_position=len(document.text))

        question = [
            {
                'type': 'input',
                'message': 'Enter link request',
                'name': 'link',
                'validate': HttpLinkValidator
            }
        ]
        result = prompt(question, style=custom_style_1)
        try:
            link_data = NaiveCoinApi.get_link_wallet_request(self.wallet.addresses, result["link"])
            verf_data = self.wallet.sign_verification_data(link_data["verf_data"])
            res = NaiveCoinApi.send_verification_data(link_data["wallet"], verf_data)
            print("Anonymous wallet id {} created".format(res["walletId"]))
        except requests.exceptions.RequestException as req_ex:
            print("Link request timeout Error: {}".format(req_ex))
        except WalletLinkException as wallet_ex:
            print(wallet_ex)

    def check_balance(self):

        from examples import custom_style_1

        choice = self.wallet.addresses
        choice.append('Back')
        question = [
            {
                'type': 'list',
                'message': 'Select your input addresses',
                'name': 'address',
                'choices': choice,
            }
        ]
        result = prompt(question, style=custom_style_1)
        if result["address"] == 'Back':
            return
        else:
            balance_info = NaiveCoinApi.get_address_balance(result["address"])
            if balance_info["balance"] > 0:
                print("Address: {} Balance: {}".format(result["address"], balance_info["balance"]))
            else:
                print("Address: {} Balance: {} Status: {}".format(result["address"], balance_info["balance"], balance_info["status"]))

    def create_transaction(self):

        from examples import custom_style_1
        from prompt_toolkit.validation import Validator, ValidationError
        
        class NumberValidator(Validator):
            def validate(self, document):
                ok = re.match(r"^[0-9]+(?:.[0-9]+)?$", document.text)
                if not ok:
                    raise ValidationError(
                        message="Invalid address format", cursor_position=len(document.text))


        class AddressValidator(Validator):
            def validate(self, document):
                ok = re.match(r"[a-f0-9]{64}", document.text)
                if not ok:
                    raise ValidationError(
                        message="Invalid address format", cursor_position=len(document.text))

        choice = self.wallet.addresses
        choice.append('Back')
        q_select_from_address = [
            {
                'type': 'list',
                'message': 'Select your input addresses',
                'name': 'input_address',
                'choices': choice,
            }
        ]
        r_input_address = prompt(q_select_from_address, style=custom_style_1)
        if r_input_address["input_address"] == 'Back':
            return
        else:
            q_select_to_address = [
                {
                'type': 'input',
                'message': 'Enter the address you want to send',
                'name': 'output_address',
                'validate': AddressValidator
                },
                {
                'type':'input',
                'message': 'Enter amount of balance do you want to send',
                'name': 'amount',
                'validate': NumberValidator
                }
            ]
            r_output_address = prompt(q_select_to_address, style=custom_style_1)
            try: 
                transaction = self.wallet.send(r_output_address["output_address"], r_input_address["input_address"], float(r_output_address["amount"]))
                print("Transaction created {}".format(transaction.id))
                transaction.save()
            except TransactionRequestException as tx_req_ex:
                print(tx_req_ex)
            except WalletException as wallet_ex:
                print("Failed to create transaction Error: {}".format(wallet_ex))


    def transaction_history(self):
        transactions = CLIENT_CONFIG.db.fetch_all('select transaction_id, confirmed from tx', param={})
        print("**************Trasction**************")
        for tx in transactions:
            print("Id: {} Confirmed: {}".format(tx["transaction_id"], tx["confirmed"]))
        print("*************************************")

    def wallet_option(self):
        from examples import custom_style_2

        questions = [
            {
                'type': 'list',
                'name': 'wallet_option',
                'message': 'What do you want to do?',
                'choices': [
                    'Send balance',
                    'Check balance',
                    'Transaction history',
                    'Generate new address',
                    'Accept wallet link request',
                    'Exit'
                ]
            },
        ]

        while True:
            self.print_nofity()
            result = prompt(questions, style=custom_style_2)
            if result["wallet_option"] == 'Send balance':
                self.create_transaction()
            if result["wallet_option"] == 'Check balance':
                self.check_balance()
            if result["wallet_option"] == 'Transaction history':
                self.transaction_history()
            if result["wallet_option"] == 'Generate new address':
                pub_key = self.wallet.generate_address()
                self.wallet.save()
                print("Address generated", pub_key)
            if result["wallet_option"] == 'Accept wallet link request':
                self.link_request()
            if result["wallet_option"] == 'Exit':
                self.wallet = None
                return

    def create_wallet(self):
        from examples import custom_style_1
        from prompt_toolkit.validation import Validator, ValidationError

        class StrongPasswordValidator(Validator):
            def validate(self, document):
                words = document.text.split()
                if len(words) < 5:
                    raise ValidationError(
                        message="Please chose a stronger password", cursor_position=len(document.text))

        questions = [
            {
                'type': 'confirm',
                'message': 'Do you want to create your wallet',
                'name': 'do_create_wallet',
                'default': False
            }
        ]
        result = prompt(questions, style=custom_style_1)

        if result["do_create_wallet"]:
            q_create_addresss = [
                {
                    'type': 'confirm',
                    'message': 'Do you want to create your addresses',
                    'name': 'do_create_address',
                    'default': True
                },
                {
                    'type': 'input',
                    'message': 'Enter your wallet password (5 - 7 words)',
                    'name': 'password',
                    'validate': StrongPasswordValidator
                }
            ]
            result = prompt(q_create_addresss, style=custom_style_1)
            wallet = Wallet.from_password(result["password"])
            if result["do_create_address"]:
                wallet.generate_address()
            wallet.save()
            return wallet

    def load_wallet(self):
        from examples import custom_style_2
        questions = [
            {
                'type': 'password',
                'message': 'Enter your wallet password',
                'name': 'password',
                'default': 'this is my strong password'
            }
        ]
        result = prompt(questions, style=custom_style_2)
        return Wallet.load_wallet_from_password(result["password"])

    def run(self):
        import examples 

        questions = [
            {
                'type': 'list',
                'name': 'option',
                'message': 'What do you want to do?',
                'choices': [
                    'Login',
                    'Create wallet',
                    'Exit'
                ]
            },
        ]
    
        while True:
            result = prompt(questions, styles=examples.custom_style_2)    
            if result["option"] == 'Login':
                try:
                    self.wallet = self.load_wallet()
                    if self.wallet:
                        self.wallet_option()
                except WalletException as wallet_ex:
                    print("Failed to get wallet info Error:", wallet_ex)
                    continue

            if result["option"] == 'Create wallet':
                self.wallet = self.create_wallet()
                if self.wallet:
                    self.wallet_option()

            if result["option"] == 'Exit':
                return ECLIENT_EXIT, None
