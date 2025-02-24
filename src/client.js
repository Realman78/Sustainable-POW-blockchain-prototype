const { Blockchain } = require('./blockchain');
const P2PServer = require('./p2p-server');
const WalletManager = require('./wallet-manager');

const walletManager = new WalletManager();

const walletName = process.argv[2];
const port = process.argv[3];
const delayed = process.argv[4] === 'true';

if (!walletName || !port) {
  console.log('Usage: node client.js <wallet-name> <port> [delayed]');
  console.log('Example: node client.js wallet1 6001');
  console.log('Available wallets:', walletManager.getAvailableWallets().join(', ') || 'None');
  process.exit(1);
}

const wallet = walletManager.loadWallet(walletName);
console.log(`Using wallet: ${walletName}`);
console.log(`Wallet address: ${wallet.publicKey}`);

const blockchain = new Blockchain({}, delayed);

const p2pServer = new P2PServer(blockchain, port, wallet.privateKey, delayed);

if (port !== '5999' && port !== '6000') {
  setTimeout(() => {
    console.log('Connecting to genesis nodes...');
    try {
      p2pServer.connectToPeer('5999');
    }
    catch (e) {
      console.log('Error connecting to 5999:', e.message);
    }
    try {
      p2pServer.connectToPeer('6000');
    }
    catch (e) {
      console.log('Error connecting to 6000', e.message);
    }

    // Request latest chain after establishing connections
    setTimeout(() => {
      p2pServer.requestLatestChain();
    }, 1000);
  }, 2222);
}

p2pServer.listen();