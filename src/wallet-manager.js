'use strict';
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const fs = require('fs');
const path = require('path');

class WalletManager {
  constructor(walletDir = './wallets') {
    this.walletDir = walletDir;

    if (!fs.existsSync(walletDir)) {
      fs.mkdirSync(walletDir, { recursive: true });
    }
  }

  generateWallet(walletName) {
    const keyPair = ec.genKeyPair();
    const publicKey = keyPair.getPublic('hex');
    const privateKey = keyPair.getPrivate('hex');

    const wallet = {
      name: walletName,
      publicKey,
      privateKey
    };

    const walletFile = path.join(this.walletDir, `${walletName}.json`);
    fs.writeFileSync(walletFile, JSON.stringify(wallet, null, 2));

    console.log(`Created new wallet: ${walletName}`);
    console.log(`Public key (address): ${publicKey}`);
    console.log(`Private key: ${privateKey}`);

    return wallet;
  }

  loadWallet(walletName) {
    const walletFile = path.join(this.walletDir, `${walletName}.json`);

    if (!fs.existsSync(walletFile)) {
      console.log(`Wallet ${walletName} doesn't exist. Creating new wallet.`);
      return this.generateWallet(walletName);
    }

    const walletData = fs.readFileSync(walletFile, 'utf8');
    return JSON.parse(walletData);
  }

  getKeyPair(privateKey) {
    return ec.keyFromPrivate(privateKey);
  }

  getAvailableWallets() {
    return fs.readdirSync(this.walletDir)
      .filter(file => file.endsWith('.json'))
      .map(file => path.basename(file, '.json'));
  }

  getAddressBook() {
    const wallets = this.getAvailableWallets();
    const addressBook = {};

    wallets.forEach(name => {
      try {
        const wallet = this.loadWallet(name);
        addressBook[name] = wallet.publicKey;
      } catch (error) {
        console.error(`Error loading wallet ${name}: ${error.message}`);
      }
    });

    return addressBook;
  }
}

module.exports = WalletManager;