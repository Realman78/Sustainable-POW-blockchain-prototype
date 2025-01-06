const WebSocket = require('ws');
const readline = require('readline');
const EC = require('elliptic').ec;
const { Blockchain, Transaction, Block } = require('./blockchain');

class P2PServer {
  constructor(blockchain, port, walletId, delayed=false) {
    this.blockchain = blockchain;
    this.sockets = [];
    this.port = port;
    this.walletId = walletId;
    this.key = walletId+'key';
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

  startMining() {
    this.mining = true;
    console.log("started mining")
    this.mineLoop();
  }

  async mineLoop() {
    while (this.mining) {
      if (this.blockchain.pendingTransactions.length > 0) {
        try {
          const block = await this.blockchain.minePendingTransactions(this.walletId);
          console.log("mined!!!")
          this.broadcastBlock(block);
        } catch (e) {
          if (e.message === 'Block already mined') {
            continue;
          }
          console.error('Mining error:', e);
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

  connectSocket(socket) {
    this.sockets.push(socket);
    this.messageHandler(socket);
    this.sendChain(socket);
  }

  messageHandler(socket) {
    socket.on('message', message => {
      const data = JSON.parse(message);
      
      switch(data.type) {
        case 'block':
          this.handleNewBlock(data.block);
          break;
        case 'transaction':
          this.handleNewTransaction(data.transaction);
          break;
        case 'chain':
          this.handleChainSync(data.chain);
          break;
      }
    });
  }

  handleNewBlock(block) {
    if (this.blockchain.addBlock(block)) {
      this.broadcastBlock(block);
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

  broadcastBlock(block) {
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

  initCLI() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const promptUser = () => {
      rl.question('Command (send <addr> <amount> | balance | peer <ws://...> | quit): ', (input) => {
        const [cmd, ...args] = input.split(' ');
        
        switch(cmd) {
          case 'send':
            this.handleSendCommand(args[0], parseFloat(args[1]));
            break;
          case 'balance':
            console.log(`Balance: ${this.blockchain.getBalanceOfAddress(this.walletId)}`);
            break;
          case 'peer':
            this.connectToPeer(args[0]);
            break;
          case 'chain':
            console.log(this.blockchain.chain);
            break;
          case 'quit':
            process.exit(0);
        }
        promptUser();
      });
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