const WebSocket = require('ws');
const readline = require('readline');
const EC = require('elliptic').ec;
const { Worker } = require('worker_threads');
const { Blockchain, Transaction, Block } = require('./blockchain');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class P2PServer {
  constructor(blockchain, port, walletId, delayed = false) {
    this.blockchain = blockchain;
    this.sockets = [];
    this.port = port;
    this.walletId = walletId;
    this.key = walletId + 'key';
    this.mining = false;
    this.worker = null; // Worker thread for mining
    this.delayed = delayed;
    this.initCLI();
  }

  listen() {
    const server = new WebSocket.Server({ port: this.port });
    server.on('connection', socket => this.connectSocket(socket));
    console.log(`Listening on port: ${this.port}`);
    this.startMining();
  }

  async startMining() {
    this.mining = true;
    console.log("Started mining");
    await this.mineLoop();
  }

  async mineLoop() {
    while (this.mining) {
      if (this.blockchain.pendingTransactions.length > 0 || this.blockchain.pendingCalculations.length > 0) {
        try {
          const blockData = this.blockchain.defineBlock(this.walletId, [], []);
          this.blockchain.pendingTransactions = [];

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
                  console.log('Calculated LARINPARIN!', {output: message.output, ...this.blockchain.pendingCalculations.find(c => c.taskId === message.taskId)});

                  blockData.computationResults.push({output: message.output, ...this.blockchain.pendingCalculations.find(c => c.taskId === message.taskId)});
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

          // Wrap worker logic in a promise to synchronize the loop
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
              console.log("ALOOOOOO")
              if (message.status === 'mined') {
                console.log('Block mined successfully!', message.block);

                if (message.block.previousHash !== this.blockchain.getLatestBlock().hash) {
                  return reject(new Error('Block already mined'));
                }

                // Add the mined block to the blockchain
                if (this.blockchain.addBlock(message.block)) {
                  this.broadcastBlock(message.block);
                  this.blockchain.pendingTransactions = [];
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
              console.log("ALOOOOOO222")

              if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
              this.worker = null;
              resolve();
            });
          });
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
        pending: this.blockchain.pendingCalculations,
        completed: this.blockchain.completedCalculations,
        temporary: this.blockchain.temporaryResults
      },
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
      }
    });
  }

  handleNewBlock(block) {
    console.log("Received new block", block);
    if (this.blockchain.addBlock(block)) {
      console.log("Received new block, stopping current mining operation", this.mining, this.worker);
      if (this.mining && this.worker) {
        this.mining = false;  // Stop the mining loop
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
      this.blockchain.addTransactionToMempool(tx);
    } catch (e) {
      console.error('Invalid transaction:', e);
    }
  }

  handleChainSync(chain) {
    console.log('Received chain');
    if (chain.length > this.blockchain.chain.length && this.blockchain.isValidChain(chain)) {
      this.blockchain.chain = chain;
    }
  }

  handleCalculationsSync(calculations) {
    console.log('Received calculations');
    const { pending, completed, temporary } = calculations;
    if (pending.length > this.blockchain.pendingCalculations.length) {
      this.blockchain.pendingCalculations = pending;
    }
    if (completed.length > this.blockchain.completedCalculations.length) {
      this.blockchain.completedCalculations = completed;
    }
    if (temporary.length > this.blockchain.temporaryResults.length) {
      this.blockchain.temporaryResults = temporary;
    }
  }
  handlePendingCalculationsSync(calculations) {
    console.log('Received pending calculations');
    if (calculations.length > this.blockchain.pendingCalculations.length) {
      this.blockchain.pendingCalculations = calculations;
    }
  }

  broadcastBlock(block) {
    console.log("Broadcasting block", block);
    const message = JSON.stringify({
      type: 'block',
      block
    });
    this.broadcast(message);
  }

  broadcastTransaction(transaction) {
    const message = JSON.stringify({
      type: 'transaction',
      transaction
    });
    this.broadcast(message);
  }

  broadcast(message) {
    this.sockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    });
  }

  broadcastCalculations() {
    const message = JSON.stringify({
      type: 'calculations',
      calculations: {
        pending: this.blockchain.pendingCalculations,
        completed: this.blockchain.completedCalculations
      }
    });
    this.broadcast(message);
  }

  broadcastPendingCalculations() {
    const message = JSON.stringify({
      type: 'pending_calculations',
      pendingCalculations: this.blockchain.pendingCalculations,
    });
    this.broadcast(message);
  }

  addToPendingCalculations(calculation) {
    this.blockchain.pendingCalculations.push(calculation);
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
              console.log(JSON.stringify(this.blockchain.pendingCalculations, null, 2));
              console.log(JSON.stringify(this.blockchain.completedCalculations, null, 2));
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