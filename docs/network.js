(() => {
  'use strict';

  // PeerJS for WebRTC peer-to-peer connections (free signaling server)
  // No backend configuration needed!

  class SofaNetwork {
    constructor() {
      this.peer = null;
      this.conn = null;
      this.roomId = null;
      this.playerId = null;
      this.playerNumber = null; // 0 = host, 1 = client
      this.connected = false;
      this.onStateChange = null;
      this.onPlayerJoin = null;
      this.onPlayerLeave = null;
      this.onGameStart = null;
      this.onGameEnd = null;
      this.onChat = null;
      this.onData = null;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 3;
    }

    // Generate a short room code (6 characters)
    generateRoomCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = 'sofa-';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    }

    // Generate a unique player ID
    generatePlayerId() {
      return 'player_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    // Load PeerJS library dynamically
    async loadPeerJS() {
      if (window.Peer) return;
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    // Create a new room (host)
    async createRoom() {
      try {
        await this.loadPeerJS();

        this.roomId = this.generateRoomCode();
        this.playerId = this.roomId; // Host uses room ID as peer ID
        this.playerNumber = 0;

        return new Promise((resolve, reject) => {
          this.peer = new Peer(this.playerId, {
            debug: 1,
            config: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
              ]
            }
          });

          this.peer.on('open', (id) => {
            console.log('Room created with ID:', id);
            this.connected = true;
            resolve({ roomId: this.roomId, playerId: this.playerId, playerNumber: 0 });
          });

          this.peer.on('connection', (conn) => {
            this.handleConnection(conn);
          });

          this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            if (err.type === 'unavailable-id') {
              reject({ error: '房间号已存在，请重试' });
            } else {
              reject({ error: '创建房间失败：' + err.type });
            }
          });

          // Timeout after 30 seconds
          setTimeout(() => {
            if (!this.connected) {
              reject({ error: '创建房间超时' });
            }
          }, 30000);
        });
      } catch (error) {
        return { error: '加载网络库失败：' + error.message };
      }
    }

    // Join an existing room (client)
    async joinRoom(roomCode) {
      try {
        await this.loadPeerJS();

        roomCode = roomCode.toUpperCase().trim();
        this.roomId = roomCode;
        this.playerId = this.generatePlayerId();
        this.playerNumber = 1;

        return new Promise((resolve, reject) => {
          this.peer = new Peer(this.playerId, {
            debug: 1,
            config: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
              ]
            }
          });

          this.peer.on('open', () => {
            console.log('Connecting to room:', roomCode);
            const conn = this.peer.connect(roomCode, {
              reliable: true,
              metadata: { playerNumber: 1 }
            });

            this.handleConnection(conn);

            // Timeout after 15 seconds
            setTimeout(() => {
              if (!this.connected) {
                reject({ error: '连接超时，请检查房间号' });
              }
            }, 15000);
          });

          this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            if (err.type === 'peer-unavailable') {
              reject({ error: '房间不存在或已关闭' });
            } else {
              reject({ error: '连接失败：' + err.type });
            }
          });

          // Wait for connection to be established
          const checkConnection = setInterval(() => {
            if (this.connected) {
              clearInterval(checkConnection);
              resolve({ roomId: roomCode, playerId: this.playerId, playerNumber: 1 });
            }
          }, 100);

          setTimeout(() => clearInterval(checkConnection), 15000);
        });
      } catch (error) {
        return { error: '加载网络库失败：' + error.message };
      }
    }

    // Handle incoming connection
    handleConnection(conn) {
      this.conn = conn;

      conn.on('open', () => {
        console.log('Connection established!');
        this.connected = true;
        this.reconnectAttempts = 0;

        if (this.onPlayerJoin) {
          this.onPlayerJoin(this.playerNumber === 0 ? 1 : 0);
        }
      });

      conn.on('data', (data) => {
        this.handleData(data);
      });

      conn.on('close', () => {
        console.log('Connection closed');
        this.connected = false;
        if (this.onPlayerLeave) {
          this.onPlayerLeave();
        }
      });

      conn.on('error', (err) => {
        console.error('Connection error:', err);
      });
    }

    // Handle received data
    handleData(data) {
      if (!data || !data.type) return;

      switch (data.type) {
        case 'gameState':
          if (this.onStateChange) this.onStateChange(data.state);
          break;
        case 'input':
          if (this.onData) this.onData(data);
          break;
        case 'characterSelect':
          if (this.onStateChange) this.onStateChange({ type: 'characterSelect', character: data.character, playerNumber: data.playerNumber });
          break;
        case 'gameStart':
          if (this.onGameStart) this.onGameStart();
          break;
        case 'gameEnd':
          if (this.onGameEnd) this.onGameEnd(data.result);
          break;
        case 'chat':
          if (this.onChat) this.onChat(data.message);
          break;
      }
    }

    // Leave the current room
    async leaveRoom() {
      if (this.conn) {
        this.conn.close();
        this.conn = null;
      }
      if (this.peer) {
        this.peer.destroy();
        this.peer = null;
      }
      this.connected = false;
      this.roomId = null;
      this.playerId = null;
      this.playerNumber = null;
    }

    // Send game state (from host)
    sendGameState(gameState) {
      if (!this.conn || !this.connected || this.playerNumber !== 0) return;

      this.conn.send({
        type: 'gameState',
        state: gameState,
        timestamp: Date.now()
      });
    }

    // Send input (from client)
    sendInput(input) {
      if (!this.conn || !this.connected) return;

      this.conn.send({
        type: 'input',
        input: input,
        timestamp: Date.now()
      });
    }

    // Send character selection
    sendCharacterSelect(characterId) {
      if (!this.conn || !this.connected) return;

      this.conn.send({
        type: 'characterSelect',
        character: characterId,
        playerNumber: this.playerNumber,
        timestamp: Date.now()
      });
    }

    // Send game start signal
    sendGameStart() {
      if (!this.conn || !this.connected) return;

      this.conn.send({
        type: 'gameStart',
        timestamp: Date.now()
      });

      if (this.onGameStart) this.onGameStart();
    }

    // Send game end signal
    sendGameEnd(result) {
      if (!this.conn || !this.connected) return;

      this.conn.send({
        type: 'gameEnd',
        result: result,
        timestamp: Date.now()
      });
    }

    // Send chat message
    sendChat(message) {
      if (!this.conn || !this.connected) return;

      this.conn.send({
        type: 'chat',
        message: message,
        playerNumber: this.playerNumber,
        timestamp: Date.now()
      });
    }

    // Check connection status
    isConnected() {
      return this.connected && this.conn && this.conn.open;
    }
  }

  // Export to global scope
  window.SofaNetwork = SofaNetwork;
})();
