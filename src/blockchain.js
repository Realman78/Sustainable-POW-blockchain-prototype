'use strict';
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const MempoolManager = require('./mempool-manager');
const ComputationManager = require('./computation-manager');
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
      .update(
        (this.fromAddress || '') + 
        (this.toAddress || '') + 
        (this.amount?.toString() || '0') + 
        (this.timestamp?.toString() || Date.now().toString())
      )
      .digest('hex');
  }

  sign(signingKey) {
    // if (signingKey.getPublic('hex') !== this.fromAddress) {
    //   throw new Error('You cannot sign transactions for other wallets!');
    // }

    // const hashTx = this.calculateHash();
    // const sig = signingKey.sign(hashTx, 'base64');

    this.signature = signingKey;
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
  constructor(timestamp, transactions, computationResults, previousHash = '', hash = '') {
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.nonce = 0;
    this.hash = hash || this.calculateHash();
    this.computationResults = computationResults || [];
  }

  calculateHash() {
    return crypto
      .createHash('sha256')
      .update(
        this.previousHash +
        this.timestamp +
        JSON.stringify(this.transactions) +
        JSON.stringify(this.computationResults) +
        this.nonce
      )
      .digest('hex');
  }

  async mineBlock(difficulty, delayed, isCancelled) {
    console.log("Mining block...", this.hash)
    while (
      this.hash.substring(0, difficulty) !== Array(difficulty + 1).join('0')
    ) {
      // Check if mining should be cancelled
      if (isCancelled?.()) {
        throw new Error('Mining terminated');
      }

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
  constructor(initialWallets, delayed = false) {
    this.initialWallets = initialWallets;
    this.chain = [this.createGenesisBlock(initialWallets)];
    this.difficulty = 5;
    this.miningReward = 100;
    this.delayed = delayed;

    this.mempool = new MempoolManager({
      maxSize: 5000,
      expiryTime: 3600000 // 1 hour
    });

    setInterval(() => {
      this.mempool.cleanExpiredTransactions();
    }, 300000); // Clean every 5 minutes

    this.computationManager = new ComputationManager({
      maxPendingTasks: 100,
      taskTimeout: 300000
    });
    setInterval(() => {
      console.log("Clearing expired tasks");
      this.computationManager.cleanExpiredTasks();
    }, 60000);
  }

  addComputationTask(task) {
    this.computationManager.addTask(task);
  }

  createGenesisBlock(initialWallets) {
    const genesisTransactions = Object.entries(initialWallets).map(([wallet, amount]) =>
      new Transaction(null, wallet, parseInt(amount))
    );
    return new Block(Date.parse('2025-01-01'), genesisTransactions, [], '0', 'GENESIS_MARINCOIN');
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  defineBlock(miningRewardAddress) {
    const rewardTx = new Transaction(
      null,
      miningRewardAddress,
      this.miningReward
    );

    const maxBlockSize = 1000000; // 1MB block size limit
    const transactions = this.mempool.getTransactionsForBlock(maxBlockSize);
    transactions.push(rewardTx);
    const pendingTasks = this.computationManager.getTasksForBlock(5); // Get up to 5 tasks

    const block = new Block(
      Date.now(),
      transactions,
      pendingTasks,
      this.getLatestBlock().hash
    );

    // Don't remove transactions here!
    // They should only be removed after successful mining and block addition
    // The removal should happen in the mining loop after blockchain.addBlock() succeeds

    return block;
  }

  addBlock(block) {
    if (this.isValidBlock(block)) {
      this.chain.push(block);
      return true;
    }
    for (const result of block.computationResults) {
      this.computationManager.addCompletedTask(result);
    }
    return false;
  }
  isValidBlock(blockData) {
    // First reconstruct the Block and Transaction objects
    const transactions = blockData.transactions.map(tx => {
      const transaction = new Transaction(tx.fromAddress, tx.toAddress, tx.amount);
      transaction.timestamp = tx.timestamp;
      transaction.signature = tx.signature;
      return transaction;
    });

    const block = new Block(
      blockData.timestamp,
      transactions,
      blockData.computationResults,
      blockData.previousHash,
      blockData.hash
    );
    block.nonce = blockData.nonce;

    // Now proceed with validation
    // 1. Check if block has all required properties
    if (!block.previousHash || !block.timestamp || !block.transactions || !block.hash) {
      console.log("Block missing required properties");
      return false;
    }

    // 2. Verify block links to our latest block
    if (block.previousHash !== this.getLatestBlock().hash) {
      console.log("Block does not link to the latest block");
      return false;
    }

    // 3. Verify block hash matches its contents
    const calculatedHash = block.calculateHash();
    if (calculatedHash !== block.hash) {
      console.log("Block hash doesn't match its contents");
      return false;
    }

    // 4. Verify proof of work
    const hashPrefix = Array(this.difficulty + 1).join('0');
    if (!block.hash.startsWith(hashPrefix)) {
      console.log("Block hash doesn't meet difficulty requirement");
      return false;
    }

    // 5. Verify all transactions in the block
    for (const tx of block.transactions) {
      // Skip mining reward transaction
      if (tx.fromAddress === null) {
        if (tx.amount !== this.miningReward) {
          console.log("Invalid mining reward amount");
          return false;
        }
        continue;
      }

      // Verify transaction signature
      if (!tx.isValid()) {
        console.log("Block contains invalid transaction");
        return false;
      }

      // Verify sender has enough balance
      const senderBalance = this.getBalanceOfAddress(tx.fromAddress);
      if (senderBalance < tx.amount) {
        console.log("Sender doesn't have enough balance");
        return false;
      }
    }

    // 6. Verify mining reward transaction (should be the last transaction)
    const rewardTx = block.transactions[block.transactions.length - 1];
    if (rewardTx.fromAddress !== null || rewardTx.amount !== this.miningReward) {
      console.log("Invalid mining reward transaction");
      return false;
    }

    for (const result of blockData.computationResults) {
      const task = this.computationManager.pendingTasks.get(result.taskId);
      if (!task) {
        console.log("Unknown computation task");
        return false;
      }

      if (!this.computationManager.verifyResult(task, result)) {
        console.log("Invalid computation result");
        return false;
      }
    }

    return true;
  }

  addTransactionToMempool(transaction) {
    // Basic validation
    if (!transaction.fromAddress || !transaction.toAddress) {
      throw new Error('Transaction must include from and to address');
    }

    if (!transaction.isValid()) {
      throw new Error('Cannot add invalid transaction to chain');
    }

    if (transaction.amount <= 0) {
      throw new Error('Transaction amount should be higher than 0');
    }

    // Check if transaction is already in mempool
    const txHash = transaction.calculateHash();
    if (this.mempool.isTransactionInMempool(txHash)) {
      throw new Error('Transaction already in mempool');
    }

    // Get current balance
    const walletBalance = this.getBalanceOfAddress(transaction.fromAddress);

    // Calculate total pending amount from mempool
    const pendingAmount = Array.from(this.mempool.transactions.values())
      .filter(tx => tx.transaction.fromAddress === transaction.fromAddress)
      .reduce((sum, tx) => sum + tx.transaction.amount, 0);

    // Check if total pending + new transaction exceeds balance
    const totalAmount = pendingAmount + transaction.amount;
    if (totalAmount > walletBalance) {
      throw new Error('Total pending transactions would exceed wallet balance');
    }

    // If all checks pass, add to mempool
    this.mempool.addTransaction(transaction);
    console.log('Transaction added to mempool:', txHash, this.mempool);
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

    console.log('getBalanceOfAddress: %s', balance);
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

  isChainValid(chain) {
    // For genesis block, compare transactions without caring about order
    const genesisTransactions = this.chain[0].transactions;
    const receivedGenesisTransactions = chain[0].transactions;

    // Check if genesis transactions match (regardless of order)
    const genesisMatch = genesisTransactions.length === receivedGenesisTransactions.length &&
      genesisTransactions.every(tx1 =>
        receivedGenesisTransactions.some(tx2 =>
          tx2.fromAddress === tx1.fromAddress &&
          tx2.toAddress === tx1.toAddress &&
          tx2.amount === tx1.amount
        )
      );

    if (!genesisMatch) {
      console.log("Genesis blocks don't match");
      return false;
    }

    // Rest of the chain validation
    for (let i = 1; i < chain.length; i++) {
      const currentBlock = chain[i];
      const previousBlock = chain[i - 1];

      if (previousBlock.hash !== currentBlock.previousHash) {
        console.log("Previous hash doesn't match");
        return false;
      }

      if (!currentBlock.hasValidTransactions()) {
        console.log("Invalid transactions in block");
        return false;
      }

      if (currentBlock.hash !== currentBlock.calculateHash()) {
        console.log("Block hash doesn't match");
        return false;
      }
    }

    return true;
  }
}

module.exports.Blockchain = Blockchain;
module.exports.Block = Block;
module.exports.Transaction = Transaction;