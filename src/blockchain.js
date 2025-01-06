'use strict';
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class Transaction {
  constructor(fromAddress, toAddress, amount) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = Date.now();
  }

  calculateHash() {
    return crypto
      .createHash('sha256')
      .update(this.fromAddress + this.toAddress + this.amount + this.timestamp)
      .digest('hex');
  }

  sign(signingKey) {
    // if (signingKey.getPublic('hex') !== this.fromAddress) {
    //   throw new Error('You cannot sign transactions for other wallets!');
    // }

    // const hashTx = this.calculateHash();
    // const sig = signingKey.sign(hashTx, 'base64');

    this.signature = signingKey;
    console.log(this.signature)
  }

  isValid() {
    if (this.fromAddress === null) return true;

    if (!this.signature || this.signature.length === 0) {
      throw new Error('No signature in this transaction');
    }

    // const publicKey = ec.keyFromPublic(this.fromAddress, 'hex');
    // return publicKey.verify(this.calculateHash(), this.signature);
    return true;
  }
}

class Block {
  constructor(timestamp, transactions, previousHash = '') {
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.nonce = 0;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto
      .createHash('sha256')
      .update(
        this.previousHash +
        this.timestamp +
        JSON.stringify(this.transactions) +
        this.nonce
      )
      .digest('hex');
  }

  async mineBlock(difficulty, delayed) {
    console.log("Mining block...", this.hash)
    while (
      this.hash.substring(0, difficulty) !== Array(difficulty + 1).join('0')
    ) {
      this.nonce++;
      this.hash = this.calculateHash();
      if (delayed) {
        await delay(1000);
        console.log("Delaying...");
      }
    }

    console.log(`Block mined: ${this.hash}`);
  }

  hasValidTransactions() {
    for (const tx of this.transactions) {
      if (!tx.isValid()) {
        return false;
      }
    }

    return true;
  }
}

class Blockchain {
  constructor(initialWallets, delayed=false) {
    this.chain = [this.createGenesisBlock(initialWallets)];
    this.difficulty = 3;
    this.pendingTransactions = [];
    this.miningReward = 100;
    this.delayed = delayed;
    console.log(this.delayed)
  }

  createGenesisBlock(initialWallets) {
    const genesisTransactions = Object.entries(initialWallets).map(([wallet, amount]) =>
      new Transaction(null, wallet, parseInt(amount))
    );
    return new Block(Date.parse('2025-01-01'), genesisTransactions, '0');
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  async minePendingTransactions(miningRewardAddress) {
    const rewardTx = new Transaction(
      null,
      miningRewardAddress,
      this.miningReward
    );
    this.pendingTransactions.push(rewardTx);

    const block = new Block(
      Date.now(),
      this.pendingTransactions,
      this.getLatestBlock().hash
    );
    await block.mineBlock(this.difficulty, this.delayed);

    if (block.previousHash !== this.getLatestBlock().hash) {
      throw new Error('Block already mined');
    }
    this.chain.push(block);

    this.pendingTransactions = [];
    return block;
  }

  addBlock(block) {
    if (this.isValidBlock(block)) {
      this.chain.push(block);
      return true;
    }
    return false;
  }

  isValidBlock(block) {
    console.log("IS BLOCK VALID")
    return (
      block.previousHash === this.getLatestBlock().hash
    );
  }


  addTransactionToMempool(transaction) {
    if (!transaction.fromAddress || !transaction.toAddress) {
      throw new Error('Transaction must include from and to address');
    }

    if (!transaction.isValid()) {
      throw new Error('Cannot add invalid transaction to chain');
    }

    if (transaction.amount <= 0) {
      throw new Error('Transaction amount should be higher than 0');
    }

    const walletBalance = this.getBalanceOfAddress(transaction.fromAddress);
    if (walletBalance < transaction.amount) {
      throw new Error('Not enough balance');
    }

    const pendingTxForWallet = this.pendingTransactions.filter(
      tx => tx.fromAddress === transaction.fromAddress
    );

    if (pendingTxForWallet.length > 0) {
      const totalPendingAmount = pendingTxForWallet
        .map(tx => tx.amount)
        .reduce((prev, curr) => prev + curr);

      const totalAmount = totalPendingAmount + transaction.amount;
      if (totalAmount > walletBalance) {
        throw new Error(
          'Pending transactions for this wallet is higher than its balance.'
        );
      }
    }

    this.pendingTransactions.push(transaction);
    console.log('transaction added: %s', transaction);
  }

  getBalanceOfAddress(address) {
    let balance = 0;

    for (const block of this.chain) {
      for (const trans of block.transactions) {
        if (trans.fromAddress === address) {
          balance -= trans.amount;
        }

        if (trans.toAddress === address) {
          balance += trans.amount;
        }
      }
    }

    console.log('getBalanceOfAdrees: %s', balance);
    return balance;
  }

  getAllTransactionsForWallet(address) {
    const txs = [];

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.fromAddress === address || tx.toAddress === address) {
          txs.push(tx);
        }
      }
    }

    console.log('get transactions for wallet count: %s', txs.length);
    return txs;
  }

  isChainValid() {
    const realGenesis = JSON.stringify(this.createGenesisBlock());

    if (realGenesis !== JSON.stringify(this.chain[0])) {
      return false;
    }

    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if (previousBlock.hash !== currentBlock.previousHash) {
        return false;
      }

      if (!currentBlock.hasValidTransactions()) {
        return false;
      }

      if (currentBlock.hash !== currentBlock.calculateHash()) {
        return false;
      }
    }

    return true;
  }
}

module.exports.Blockchain = Blockchain;
module.exports.Block = Block;
module.exports.Transaction = Transaction;