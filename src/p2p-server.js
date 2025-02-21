const WebSocket = require('ws');
const readline = require('readline');
const EC = require('elliptic').ec;
const { Worker } = require('worker_threads');
const { Blockchain, Transaction, Block } = require('./blockchain');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const PeerDiscovery = require('./peer-discovery');
const { EventEmitter } = require('events');

class P2PServer {
  constructor(blockchain, port, walletId, delayed = false, initialPeers = [5999, 6000]) {
    this.blockchain = blockchain;
    this.sockets = [];
    this.port = port;
    this.walletId = walletId;
    this.key = walletId + 'key';
    this.mining = false;
    this.worker = null; // Worker thread for mining
    this.delayed = delayed;
    this.knownMessages = new Set(); // Initialize knownMessages as array
    this.messageExpiry = 5 * 60 * 1000; // 5 minutes

    this.peerDiscovery = new PeerDiscovery(port, initialPeers);
    this.peerDiscovery.on('peer_connected', (socket) => this.connectSocket(socket));

    this.initCLI();
  }

  listen() {
    const server = new WebSocket.Server({ port: this.port });
    server.on('connection', socket => this.connectSocket(socket));
    console.log(`Listening on port: ${this.port}`);

    this.peerDiscovery.start();

    this.startMining();
    this.startChainVerification();
  }

  async startMining() {
    this.mining = true;
    console.log("Started mining");
    await this.mineLoop();
  }

  async mineLoop() {
    while (this.mining) {
      if (this.blockchain.mempool.transactions.size > 0) {
        try {
          const blockData = this.blockchain.defineBlock(this.walletId, [], []);

          if (this.blockchain.pendingCalculations && this.blockchain.pendingCalculations.length > 0) {
            await new Promise(async (resolve, reject) => {
              console.log("Creating useful worker...");
              this.worker = new Worker('./src/useful-miner.js');

              // Send the data to the worker
              this.worker.postMessage({
                blockData,
                pendingCalculations: this.blockchain.pendingCalculations,
              });


              this.worker.on('message', (message) => {
                console.log("marinpari", message);
                if (message.status === 'DONE' && message.taskId &&
                  message.output) {
                  console.log('Calculated successfully!', message.output);
                  console.log('Calculated LARINPARIN!', { output: message.output, ...this.blockchain.pendingCalculations.find(c => c.taskId === message.taskId) });

                  blockData.computationResults.push({ output: message.output, ...this.blockchain.pendingCalculations.find(c => c.taskId === message.taskId) });
                } else if (message.status === 'aborted') {
                  console.log('Calculation aborted.');
                }
                this.worker.terminate();
                this.worker = null;
                resolve();
              });

              this.worker.on('error', (error) => {
                console.error('Worker error:', error);
                this.worker.terminate();
                this.worker = null;
                reject(error);
              });

              this.worker.on('exit', (code) => {
                if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
                this.worker = null;
                resolve();
              });
            });

            this.blockchain.pendingCalculations = [];
          }

          if (this.blockchain.mempool.transactions.size > 0) {
            await new Promise((resolve, reject) => {
              console.log("Creating worker...");
              this.worker = new Worker('./src/miner.js');

              // Send the data to the worker
              this.worker.postMessage({
                blockData,
                difficulty: this.blockchain.difficulty,
                delayed: this.delayed
              });


              this.worker.on('message', (message) => {
                if (message.status === 'mined') {
                  console.log('Block mined successfully!', message.block);

                  if (message.block.previousHash !== this.blockchain.getLatestBlock().hash) {
                    return reject(new Error('Block already mined'));
                  }

                  // Add the mined block to the blockchain
                  if (this.blockchain.addBlock(message.block)) {
                    this.broadcastBlock(message.block);
                    // Reconstruct transactions to get proper Transaction objects
                    message.block.transactions.forEach(tx => {
                      if (tx.fromAddress !== null) { // Skip mining reward
                        const transaction = new Transaction(tx.fromAddress, tx.toAddress, tx.amount);
                        transaction.timestamp = tx.timestamp;
                        transaction.signature = tx.signature;
                        const txHash = transaction.calculateHash();
                        this.blockchain.mempool.transactions.delete(txHash);
                      }
                    });
                  }

                } else if (message.status === 'aborted') {
                  console.log('Mining aborted due to a new block.');
                }
                this.worker && this.worker.terminate();
                this.worker = null;
                resolve();
              });

              this.worker.on('error', (error) => {
                console.error('Worker error:', error);
                this.worker.terminate();
                this.worker = null;
                reject(error);
              });

              this.worker.on('exit', (code) => {
                if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
                this.worker = null;
                resolve();
              });
            });
          }

        } catch (error) {
          if (error.message === 'Block already mined') {
            console.log(error.message);
            continue;
          }
          console.error('Mining error:', error);
        }
      }
      // Add a delay to avoid tight looping when no transactions are pending
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  sendChain(socket) {
    socket.send(JSON.stringify({
      type: 'chain',
      chain: this.blockchain.chain
    }));
  }

  sendCalculations(socket) {
    socket.send(JSON.stringify({
      type: 'calculations',
      calculations: {
        pending: Array.from(this.blockchain.computationManager.pendingTasks.values()),
        completed: Array.from(this.blockchain.computationManager.completedTasks.values())
      }
    }));
  }

  connectSocket(socket) {
    this.sockets.push(socket);
    this.messageHandler(socket);
    this.sendChain(socket);
    this.sendCalculations(socket);
  }

  messageHandler(socket) {
    socket.on('message', message => {
      const data = JSON.parse(message);

      // Handle peer exchange messages
      if (data.type === 'peer_exchange') {
        this.handlePeerExchange(data.peers);
        return;
      }

      // Check if we've already processed this message
      if (data.messageId && this.knownMessages.has(data.messageId)) {
        return;
      }

      // Add message to known messages and set expiry
      if (data.messageId) {
        this.knownMessages.add(data.messageId);
        setTimeout(() => {
          this.knownMessages.delete(data.messageId);
        }, this.messageExpiry);

        // Propagate message to other peers
        this.sockets.forEach(s => {
          if (s !== socket && s.readyState === WebSocket.OPEN) {
            s.send(message);
          }
        });
      }
      switch (data.type) {
        case 'block':
          this.handleNewBlock(data.block);
          break;
        case 'transaction':
          this.handleNewTransaction(data.transaction);
          break;
        case 'chain':
          this.handleChainSync(data.chain);
          break;
        case 'calculations':
          this.handleCalculationsSync(data.calculations);
          break;
        case 'pending_calculations':
          this.handlePendingCalculationsSync(data.pendingCalculations);
          break;
        case 'chain_request':
          this.handleChainRequest(socket);
          break;
      }
    });
  }

  handlePeerExchange(peers) {
    peers.forEach(peer => {
      this.peerDiscovery.knownPeers.add(peer);
      if (this.peerDiscovery.connectedPeers.size < this.peerDiscovery.maxPeers) {
        this.peerDiscovery.connectToPeer(peer);
      }
    });
  }
  broadcastBlock(block) {
    console.log("broadcasting block");
    const messageId = `block_${block.hash}_${Date.now()}`;
    const message = JSON.stringify({
      type: 'block',
      block,
      messageId
    });

    this.knownMessages.add(messageId);
    this.broadcast(message);
  }
  handleNewBlock(block) {
    console.log("Received new block", block);
    if (this.blockchain.addBlock(block)) {
      // Get all transaction hashes from mempool first
      const mempoolTxs = Array.from(this.blockchain.mempool.transactions.values())
        .map(txData => txData.transaction);

      // For each transaction in the new block
      block.transactions.forEach(blockTx => {
        if (blockTx.fromAddress !== null) { // Skip mining reward
          // Find matching transaction in mempool
          const matchingTx = mempoolTxs.find(mempoolTx =>
            mempoolTx.fromAddress === blockTx.fromAddress &&
            mempoolTx.toAddress === blockTx.toAddress &&
            mempoolTx.amount === blockTx.amount
          );

          if (matchingTx) {
            const txHash = matchingTx.calculateHash();
            console.log("Removing tx from mempool:", txHash, this.blockchain.mempool.transactions.has(txHash));
            this.blockchain.mempool.transactions.delete(txHash);
          }
        }
      });

      if (this.mining && this.worker) {
        this.mining = false;
        this.worker.terminate();
        this.worker = null;

        setTimeout(() => {
          this.startMining();
        }, 1000);
      }
    }
  }

  handleNewTransaction(transaction) {
    try {
      const tx = new Transaction(
        transaction.fromAddress,
        transaction.toAddress,
        transaction.amount
      );
      tx.signature = transaction.signature;
      this.blockchain.addTransactionToMempool(tx, tx.timestamp);
    } catch (e) {
      console.error('Invalid transaction:', e);
    }
  }

  handleChainRequest(socket) {
    this.sendChain(socket);
  }

  sendChain(socket) {
    socket.send(JSON.stringify({
      type: 'chain',
      chain: this.blockchain.chain
    }));
  }

  requestLatestChain() {
    const message = JSON.stringify({
      type: 'chain_request',
      messageId: `chain_request_${Date.now()}`
    });

    const availablePeers = this.sockets.filter(s => s.readyState === WebSocket.OPEN);
    if (availablePeers.length > 0) {
      const randomPeer = availablePeers[Math.floor(Math.random() * availablePeers.length)];
      randomPeer.send(message);
    }
  }

  startChainVerification() {
    setInterval(() => {
      this.requestLatestChain();
    }, 5 * 60 * 1000);
  }

  handleChainSync(chain) {
    console.log('Received chain of length:', chain.length);
    console.log('Current chain length:', this.blockchain.chain.length);

    if (chain.length > this.blockchain.chain.length) {
      console.log('Received longer chain, validating...');

      // Convert plain objects to Block instances
      const reconstructedChain = chain.map(blockData => {
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
        return block;
      });

      if (this.blockchain.isChainValid(reconstructedChain)) {
        console.log('Chain is valid, updating local chain');
        this.blockchain.chain = reconstructedChain;
        console.log('Chain updated successfully');
      } else {
        console.log('Received chain is invalid');
      }
    } else {
      console.log('Received chain is not longer than current chain');
    }
  }
  handleCalculationsSync(calculations) {
    console.log('Received calculations', calculations);
    const { pending, completed } = calculations;
    for (const task of pending) {
      if (!this.blockchain.computationManager.isTaskPending(task.taskId)) {
        this.blockchain.computationManager.addTask(task);
      }
    }
    // Add completed tasks we don't have
    for (const result of completed) {
      if (!this.blockchain.computationManager.isTaskCompleted(result.taskId)) {
        this.blockchain.computationManager.addCompletedTask(result);
      }
    }
  }

  handlePendingCalculationsSync(calculations) {
    console.log('Received pending calculations', calculations);

    // Add each received calculation if we don't already have it
    for (const task of calculations) {
      if (!this.blockchain.computationManager.isTaskPending(task.taskId)) {
        try {
          this.blockchain.computationManager.addTask(task, task.addedAt);
        } catch (error) {
          console.error('Error adding task:', error);
        }
      }
    }
  }

  broadcastTransaction(transaction) {
    console.log("broadcasting transaction");
    const messageId = `tx_${transaction.calculateHash()}_${Date.now()}`;
    const message = JSON.stringify({
      type: 'transaction',
      transaction,
      messageId
    });

    this.knownMessages.add(messageId);
    this.broadcast(message);
  }

  broadcast(message) {
    this.sockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    });
  }

  // broadcastCalculations() {
  //   const message = JSON.stringify({
  //     type: 'calculations',
  //     calculations: {
  //       pending: Array.from(this.blockchain.computationManager.pendingTasks.values()),
  //       completed: Array.from(this.blockchain.computationManager.completedTasks.values())
  //     }
  //   });
  //   this.broadcast(message);
  // }

  broadcastPendingCalculations() {
    const message = JSON.stringify({
      type: 'pending_calculations',
      pendingCalculations: Array.from(this.blockchain.computationManager.pendingTasks.values())
    });
    this.broadcast(message);
  }

  addToPendingCalculations(calculation) {
    this.blockchain.computationManager.addTask(calculation);
    this.broadcastPendingCalculations();
  }

  initCLI() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const promptUser = () => {
      rl.question(
        'Command (send <addr> <amount> | balance | peer <ws://...> | chain | compute <file> <args> | quit): ',
        (input) => {
          const [cmd, ...args] = input.split(' ');

          switch (cmd) {
            case 'send':
              if (args.length < 2) {
                console.log('Error: send command requires <addr> and <amount>.');
                break;
              }
              const address = args[0];
              const amount = parseFloat(args[1]);
              if (isNaN(amount)) {
                console.log('Error: amount must be a valid number.');
                break;
              }
              this.handleSendCommand(address, amount);
              break;

            case 'balance':
              console.log(`Balance: ${this.blockchain.getBalanceOfAddress(this.walletId)}`);
              break;

            case 'peer':
              if (args.length < 1) {
                console.log('Error: peer command requires a WebSocket URL.');
                break;
              }
              this.connectToPeer(args[0]);
              break;

            case 'chain':
              console.log(JSON.stringify(this.blockchain.chain, null, 2));
              break;
            case 'calcs':
              console.log(this.blockchain.computationManager);
              // console.log(JSON.stringify(this.blockchain.completedCalculations, null, 2));
              break;
            case 'mempool':
              console.log(this.blockchain.mempool);
              // console.log(JSON.stringify(this.blockchain.completedCalculations, null, 2));
              break;

            case 'compute':
              if (args.length < 1) {
                console.log('Error: compute command requires a file name and optional arguments.');
                break;
              }
              const [executable, ...fileArgs] = args;
              const taskArgs = fileArgs.join(' ');
              const taskId = uuidv4();
              this.addToPendingCalculations({ executable, args: taskArgs, taskId });
              break;

            case 'quit':
              console.log('Exiting program...');
              process.exit(0);

            default:
              console.log('Unrecognized command. Please try again.');
          }

          // Re-prompt the user after each command
          promptUser();
        }
      );
    };
    promptUser();
  }


  handleSendCommand(toAddress, amount) {
    const tx = new Transaction(this.walletId, toAddress, amount);
    tx.sign(this.key);
    this.blockchain.addTransactionToMempool(tx);
    this.broadcastTransaction(tx);
  }

  connectToPeer(port) {
    const socket = new WebSocket("ws://localhost:" + port);
    socket.on('open', () => this.connectSocket(socket));
  }
}

module.exports = P2PServer;