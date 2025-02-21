class MempoolManager {
    constructor(options = {}) {
      this.maxSize = options.maxSize || 5000; // Maximum number of transactions
      this.expiryTime = options.expiryTime || 3600000; // 1 hour in milliseconds
      this.transactions = new Map(); // txHash -> {transaction, timestamp, fee}
    }
  
    addTransaction(transaction, timestamp = Date.now()) {
      // Calculate transaction size and fee
      const txSize = this.calculateTransactionSize(transaction);
      const fee = this.calculateTransactionFee(transaction);
      
      // Check if mempool is full
      if (this.transactions.size >= this.maxSize) {
        this.removeLowestFeeTransactions();
      }
  
      // Add to mempool with timestamp
      const txHash = transaction.calculateHash();
      this.transactions.set(txHash, {
        transaction,
        timestamp,
        fee,
        size: txSize
      });
      console.log("dodano", this.transactions);
    }
  
    removeLowestFeeTransactions() {
      // Sort transactions by fee rate (fee/size) and remove lowest
      const sortedTxs = Array.from(this.transactions.entries())
        .sort((a, b) => (b[1].fee / b[1].size) - (a[1].fee / a[1].size));
      
      while (this.transactions.size >= this.maxSize) {
        const [hash] = sortedTxs.pop();
        this.transactions.delete(hash);
      }
    }
  
    cleanExpiredTransactions() {
      const now = Date.now();
      for (const [hash, txData] of this.transactions.entries()) {
        if (now - txData.timestamp > this.expiryTime) {
          this.transactions.delete(hash);
        }
      }
    }
  
    getTransactionsForBlock(maxBlockSize) {
      // Sort by fee rate and select transactions up to block size limit
      let currentSize = 0;
      const selectedTxs = [];
      
      const sortedTxs = Array.from(this.transactions.values())
        .sort((a, b) => (b.fee / b.size) - (a.fee / a.size));
  
      for (const txData of sortedTxs) {
        if (currentSize + txData.size <= maxBlockSize) {
          selectedTxs.push(txData.transaction);
          currentSize += txData.size;
        }
      }
  
      return selectedTxs;
    }
  
    calculateTransactionSize(transaction) {
      // Simple size calculation - can be made more sophisticated
      return JSON.stringify(transaction).length;
    }
  
    calculateTransactionFee(transaction) {
      // Implement your fee calculation logic
      // For example: fixed fee + variable fee based on size
      const baseFee = 0.001;
      const sizeMultiplier = 0.0001;
      return baseFee + (this.calculateTransactionSize(transaction) * sizeMultiplier);
    }
  
    isTransactionInMempool(txHash) {
      return this.transactions.has(txHash);
    }
  
    removeTransactions(transactions) {
      for (const tx of transactions) {
          const txHash = tx.calculateHash();
          console.log("Attempting to remove transaction:", txHash);
          const removed = this.transactions.delete(txHash);
          console.log("Transaction removed:", removed);
      }
  }
  }
  
  module.exports = MempoolManager;