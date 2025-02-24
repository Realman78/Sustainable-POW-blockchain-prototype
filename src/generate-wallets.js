const WalletManager = require('./wallet-manager');

const walletManager = new WalletManager();
const walletNames = ['wallet1', 'wallet2', 'wallet3'];

console.log('Generating wallets...');
walletNames.forEach(name => {
  const wallet = walletManager.generateWallet(name);
  console.log(`Generated wallet: ${name}`);
  console.log(`Address: ${wallet.publicKey}`);
  console.log('-----------------------------------');
});