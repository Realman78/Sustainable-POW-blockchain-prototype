const WebSocket = require('ws');
const { EventEmitter } = require('events');

class PeerDiscovery extends EventEmitter {
    constructor(myPort, initialPeers = []) {
      super();
      this.myPort = myPort;
      this.knownPeers = new Set(initialPeers);
      this.connectedPeers = new Map(); // Port -> { socket, connectedAt }
      this.maxPeers = 10;
      this.reconnectInterval = 30000;
      this.heartbeatInterval = 10000;
      this.connectionRotationInterval = 5 * 60 * 1000; // 5 minutes
      this.minConnectionTime = 2 * 60 * 1000; // 2 minutes - minimum time to keep a connection
    }
  
    start() {
      this.connectToInitialPeers();
      setInterval(() => this.maintainConnections(), this.reconnectInterval);
      setInterval(() => this.checkPeerHealth(), this.heartbeatInterval);
      setInterval(() => this.rotateConnections(), this.connectionRotationInterval);
    }

    connectToInitialPeers() {
        for (const port of this.knownPeers) {
          if (port !== this.myPort) {
            this.connectToPeer(port);
          }
        }
      }
  
    connectToPeer(port) {
      if (this.connectedPeers.size >= this.maxPeers) {
        // Try to rotate out an old connection before rejecting
        if (!this.tryRotateConnection()) {
          console.log('Maximum peer connections reached, and no suitable connections to rotate');
          return;
        }
      }
  
      if (this.connectedPeers.has(port)) {
        return;
      }
  
      try {
        const ws = new WebSocket(`ws://localhost:${port}`);
  
        ws.on('open', () => {
          console.log(`Connected to peer on port ${port}`);
          this.connectedPeers.set(port, {
            socket: ws,
            connectedAt: Date.now(),
            isInitialPeer: this.isInitialPeer(port)
          });
          ws.port = port;
  
          ws.send(JSON.stringify({
            type: 'peer_exchange',
            peers: Array.from(this.knownPeers)
          }));
  
          this.emit('peer_connected', ws);
        });
  
        ws.on('close', () => {
          console.log(`Disconnected from peer on port ${port}`);
          this.connectedPeers.delete(port);
        });
  
        ws.on('error', (error) => {
          console.log(`Failed to connect to peer on port ${port}:`, error.message);
          this.connectedPeers.delete(port);
        });
  
      } catch (error) {
        console.error(`Error connecting to peer on port ${port}:`, error);
      }
    }
  
    isInitialPeer(port) {
      // Check if this peer was in the initial peer list
      return Array.from(this.knownPeers).slice(0, 2).includes(port);
    }
  
    tryRotateConnection() {
      const now = Date.now();
      let oldestInitialPeer = null;
      let oldestRegularPeer = null;
  
      // Find the oldest connections
      for (const [port, data] of this.connectedPeers) {
        if (now - data.connectedAt < this.minConnectionTime) {
          continue; // Skip recently connected peers
        }
  
        if (data.isInitialPeer) {
          if (!oldestInitialPeer || data.connectedAt < oldestInitialPeer.connectedAt) {
            oldestInitialPeer = { port, ...data };
          }
        } else {
          if (!oldestRegularPeer || data.connectedAt < oldestRegularPeer.connectedAt) {
            oldestRegularPeer = { port, ...data };
          }
        }
      }
  
      // Prefer disconnecting from initial peers if we have other connections
      const peerToDisconnect = this.connectedPeers.size > 5 ? oldestInitialPeer : oldestRegularPeer;
  
      if (peerToDisconnect) {
        console.log(`Rotating out connection to peer ${peerToDisconnect.port}`);
        peerToDisconnect.socket.close();
        this.connectedPeers.delete(peerToDisconnect.port);
        return true;
      }
  
      return false;
    }
  
    rotateConnections() {
      const now = Date.now();
      
      // Get all known peers we're not connected to
      const availablePeers = Array.from(this.knownPeers)
        .filter(peer => !this.connectedPeers.has(peer) && peer !== this.myPort);
  
      if (availablePeers.length === 0) return;
  
      // Try to rotate some connections
      for (const [port, data] of this.connectedPeers) {
        // Skip recent connections
        if (now - data.connectedAt < this.minConnectionTime) continue;
  
        // Higher chance of rotating out initial peers once we have a stable network
        const shouldRotate = data.isInitialPeer ? 
          (this.connectedPeers.size > 5 && Math.random() < 0.7) : 
          (Math.random() < 0.3);
  
        if (shouldRotate) {
          // Pick a random new peer to connect to
          const newPeerIndex = Math.floor(Math.random() * availablePeers.length);
          const newPeer = availablePeers[newPeerIndex];
          
          // Disconnect from old peer
          data.socket.close();
          this.connectedPeers.delete(port);
          
          // Connect to new peer
          this.connectToPeer(newPeer);
          
          // Remove the chosen peer from available peers
          availablePeers.splice(newPeerIndex, 1);
          
          if (availablePeers.length === 0) break;
        }
      }
    }
  
    maintainConnections() {
      // If we're below max peers, connect to random known peers
      if (this.connectedPeers.size < this.maxPeers) {
        const availablePeers = Array.from(this.knownPeers)
          .filter(peer => !this.connectedPeers.has(peer) && peer !== this.myPort);
        
        // Shuffle available peers
        for (let i = availablePeers.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [availablePeers[i], availablePeers[j]] = [availablePeers[j], availablePeers[i]];
        }
  
        // Try to connect to enough peers to reach maxPeers
        for (const peer of availablePeers) {
          if (this.connectedPeers.size >= this.maxPeers) break;
          this.connectToPeer(peer);
        }
      }
    }
  
    checkPeerHealth() {
      for (const [port, data] of this.connectedPeers) {
        if (data.socket.readyState !== WebSocket.OPEN) {
          this.connectedPeers.delete(port);
        }
      }
    }
  }

module.exports = PeerDiscovery;