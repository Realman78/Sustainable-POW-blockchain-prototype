// client.js
const { Blockchain } = require('./blockchain');
const P2PServer = require('./p2p-server');


const PREDEFINED_WALLETS = {
    'wallet1': '1000', // wallet id : initial balance
    'wallet2': '1000',
    'wallet3': '1000'
  };
  
  const blockchain = new Blockchain(PREDEFINED_WALLETS, process.argv[4]);
  const walletId = process.argv[2]; // node client.js wallet1
  const port = process.argv[3];
  const p2pServer = new P2PServer(blockchain, port, walletId);
  p2pServer.listen();