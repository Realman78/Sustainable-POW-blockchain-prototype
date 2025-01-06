'use strict';
const { Blockchain, Transaction } = require('./blockchain');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

const myKey = ec.keyFromPrivate(
  '7c4c45907dec40c91bab3480c39032e90049f1a44f3e18c3e07c23e3273995cf'
);

const myWalletAddress = myKey.getPublic('hex');

////////
const marinCoin = new Blockchain();

marinCoin.minePendingTransactions(myWalletAddress);

const tx1 = new Transaction(myWalletAddress, 'address2', 100);
tx1.sign(myKey);
marinCoin.addTransactionToMempool(tx1);

// marinCoin.minePendingTransactions(myWalletAddress);

// const tx2 = new Transaction(myWalletAddress, 'address1', 50);
// tx2.sign(myKey);
// marinCoin.addTransaction(tx2);

// marinCoin.minePendingTransactions(myWalletAddress);

// console.log();
// console.log(
//   `Balance of xavier is ${marinCoin.getBalanceOfAddress(myWalletAddress)}`
// );

// // Uncomment this line if you want to test tampering with the chain
// // marinCoin.chain[1].transactions[0].amount = 10;

// // Check if the chain is valid
// console.log();
// console.log('Blockchain valid?', marinCoin.isChainValid() ? 'Yes' : 'No');