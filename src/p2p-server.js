const WebSocket = require('ws');
const readline = require('readline');
const EC = require('elliptic').ec;
const { Worker } = require('worker_threads');
const { Transaction, Block } = require('./blockchain');
const { v4: uuidv4 } = require('uuid');
const PeerDiscovery = require('./peer-discovery');
const ec = new EC('secp256k1');

class P2PServer {
  constructor(blockchain, port, walletId, delayed = false, initialPeers = [5999, 6000]) {
    this.blockchain = blockchain;
    this.sockets = [];
    this.port = port;
    this.key = ec.keyFromPrivate(walletId);
    this.walletId = this.key.getPublic('hex')
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
      if (this.blockchain.mempool.transactions.size > 0 || this.blockchain.computationManager.pendingTasks.size > 0) {
        try {
          const blockData = this.blockchain.defineBlock(this.walletId, [], []);
          let shouldMine = false;

          if (blockData.computationResults.length > 0) {
            await new Promise(async (resolve, reject) => {
              console.log("Creating useful worker for block:", blockData);
              this.worker = new Worker('./src/useful-miner.js');

              const cleanupWorker = () => {
                if (this.worker) {
                  try {
                    this.worker.terminate();
                  } catch (error) {
                    console.error('Error terminating worker:', error);
                  }
                  this.worker = null;
                }
              };

              // Send the data to the worker
              this.worker.postMessage({
                pendingCalculations: blockData.computationResults,
              });


              this.worker.on('message', (message) => {
                console.log("marinpari", message);
                if (message.status === 'DONE' && message.taskId && message.output) {
                  console.log('Calculated successfully!', message.output);

                  // Update the task with its result
                  const solvedTask = blockData.computationResults.find(task => task.taskId === message.taskId);
                  blockData.computationResults = blockData.computationResults.filter(task => task.taskId !== message.taskId);
                  blockData.computationResults.push({
                    taskId: message.taskId,
                    output: message.output,
                    executedAt: message.executedAt,
                    executable: solvedTask.executable,
                    args: solvedTask.args
                  });

                  // Update computation manager
                  this.blockchain.computationManager.pendingTasks.delete(message.taskId);

                  // Check if all tasks are completed
                  const allTasksCompleted = blockData.computationResults.every(result => result.output !== undefined);
                  if (allTasksCompleted) {
                    shouldMine = true;
                    cleanupWorker();
                    resolve();
                  }
                } else if (message.status === 'ERROR') {
                  console.log('Calculation aborted. Something went wrong.');
                  cleanupWorker();
                  resolve();
                }
              });

              this.worker.on('error', (error) => {
                console.error('Worker error:', error);
                cleanupWorker();
                reject(error);
              });

              this.worker.on('exit', (code) => {
                if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
                this.worker = null;
                resolve();
              });
            });
          }

          if (shouldMine || this.blockchain.mempool.transactions.size > 0) {
            await new Promise((resolve, reject) => {
              console.log("Creating worker...");
              this.worker = new Worker('./src/miner.js');
              const cleanupWorker = () => {
                if (this.worker) {
                  try {
                    this.worker.terminate();
                  } catch (error) {
                    console.error('Error terminating mining worker:', error);
                  }
                  this.worker = null;
                }
              };

              // Send the data to the worker
              this.worker.postMessage({
                blockData,
                difficulty: this.blockchain.difficulty,
                delayed: this.delayed
              });


              this.worker.on('message', (message) => {
                if (message.status === 'mined') {
                  console.log('Block mined successfully!');

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
                cleanupWorker();
                resolve();
              });

              this.worker.on('error', (error) => {
                console.error('Worker error:', error);
                cleanupWorker();

                reject(error);
              });

              this.worker.on('exit', (code) => {
                if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
                cleanupWorker();
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
      tx.timestamp = transaction.timestamp;
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
    const { pending } = calculations;
    for (const task of pending) {
      if (!this.blockchain.computationManager.isTaskPending(task.taskId)) {
        this.blockchain.computationManager.addTask(task);
      }
    }
  }

  handlePendingCalculationsSync(calculations) {
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
    const transactionData = {
      fromAddress: transaction.fromAddress,
      toAddress: transaction.toAddress,
      amount: transaction.amount,
      timestamp: transaction.timestamp,
      signature: transaction.signature
    };
    
    const messageId = `tx_${transaction.calculateHash()}_${transaction.timestamp}`;
    const message = JSON.stringify({
      type: 'transaction',
      transaction: transactionData,
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

  broadcastPendingCalculations() {
    const messageId = `calc_${Date.now()}`;  // Add messageId
    const message = JSON.stringify({
      type: 'pending_calculations',
      pendingCalculations: Array.from(this.blockchain.computationManager.pendingTasks.values()),
      messageId  // Include messageId in message
    });

    this.knownMessages.add(messageId);  // Add to known messages
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
              if (address === this.walletId) {
                console.log('Error: cannot send to own address.');
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
              break;
            case 'mempool':
              console.log(this.blockchain.mempool);
              break;

            case "address":
              console.log(this.walletId);
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
    try {
      let recipientPublicKey = toAddress;
      
      if (toAddress.length < 64 && !/^[0-9a-f]+$/i.test(toAddress)) {
        try {
          const WalletManager = require('./wallet-manager');
          const walletManager = new WalletManager();
          const recipientWallet = walletManager.loadWallet(toAddress);
          recipientPublicKey = recipientWallet.publicKey;
          console.log(`Resolved wallet name ${toAddress} to public key: ${recipientPublicKey}`);
        } catch (error) {
          console.error(`Could not resolve wallet name ${toAddress}: ${error.message}`);
          return;
        }
      }
      
      const tx = new Transaction(this.walletId, recipientPublicKey, amount);
      
      tx.sign(this.key);
      this.blockchain.addTransactionToMempool(tx);
      this.broadcastTransaction(tx);
    } catch (error) {
      console.error('Error sending transaction:', error.message);
    }
  }

  connectToPeer(port) {
    try {
      const socket = new WebSocket("ws://localhost:" + port);
      socket.on('open', () => {
        try {
          this.connectSocket(socket)
        } catch (error) {
          console.error('Error connecting to peer:', error);
        }
      });
      socket.on('error', (error) => { console.error('Error connecting to peer:', error); });
    } catch (error) {
      console.error('Error connecting to peer:', error);
    }
  }
}

module.exports = P2PServer;