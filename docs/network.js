(() => {
  'use strict';

  // PeerJS (WebRTC) transport. The host is authoritative for the match;
  // this class only carries messages between the two browsers.
  const PEER_SOURCES = [
    'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.2/dist/peerjs.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.2/peerjs.min.js'
  ];
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  // Players only ever see/type the 6-character code; the peer id adds the prefix.
  function normalizeRoomCode(input) {
    return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error('load timeout'));
      }, 8000);
      script.src = src;
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('load failed')); };
      document.head.appendChild(script);
    });
  }

  class SofaNetwork {
    constructor() {
      this.peer = null;
      this.conn = null;
      this.roomId = null;      // full peer id of the room, e.g. sofa-ABC123
      this.roomCode = null;    // the 6 characters players share
      this.playerId = null;
      this.playerNumber = null; // 0 = host, 1 = guest
      this.connected = false;
      this.onPlayerJoin = null;
      this.onPlayerLeave = null;
      this.onData = null;
    }

    generateRoomCode() {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
      return code;
    }

    generatePlayerId() {
      return 'player_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
    }

    async loadPeerJS() {
      if (window.Peer) return;
      for (const src of PEER_SOURCES) {
        try {
          await loadScript(src);
          if (window.Peer) return;
        } catch (_) { /* try the next CDN */ }
      }
      throw new Error('联机组件加载失败，请检查网络后重试');
    }

    openPeer(id) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const peer = new Peer(id, {
          debug: 1,
          config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
        });
        this.peer = peer;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { peer.destroy(); } catch (_) {}
          reject(new Error('连接联机服务器超时，请重试'));
        }, 15000);
        peer.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        });
        peer.on('error', err => {
          console.error('Peer error:', err);
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { peer.destroy(); } catch (_) {}
          reject(err);
        });
        peer.on('connection', conn => this.handleConnection(conn));
      });
    }

    async createRoom() {
      await this.loadPeerJS();
      this.playerNumber = 0;
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = this.generateRoomCode();
        try {
          await this.openPeer('sofa-' + code);
          this.roomCode = code;
          this.roomId = 'sofa-' + code;
          this.playerId = this.roomId;
          return { roomId: this.roomId, roomCode: code, playerNumber: 0 };
        } catch (error) {
          lastError = error;
          if (!error || error.type !== 'unavailable-id') break;
        }
      }
      throw lastError || new Error('创建房间失败，请重试');
    }

    async joinRoom(input) {
      const code = normalizeRoomCode(input);
      if (code.length !== 6) throw new Error('房间号是 6 位字母或数字');
      await this.loadPeerJS();
      this.roomCode = code;
      this.roomId = 'sofa-' + code;
      this.playerNumber = 1;
      this.playerId = this.generatePlayerId();
      await this.openPeer(this.playerId);
      await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('连接超时，请确认房间号是否正确'));
        }, 15000);
        this.peer.on('error', err => {
          if (settled || !err || err.type !== 'peer-unavailable') return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('房间不存在或已关闭'));
        });
        const conn = this.peer.connect(this.roomId, { reliable: true, metadata: { playerNumber: 1 } });
        this.handleConnection(conn, () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        });
      });
      return { roomId: this.roomId, roomCode: code, playerNumber: 1 };
    }

    handleConnection(conn, onOpen) {
      this.conn = conn;
      conn.on('open', () => {
        this.connected = true;
        if (onOpen) onOpen();
        if (this.onPlayerJoin) this.onPlayerJoin(this.playerNumber === 0 ? 1 : 0);
      });
      conn.on('data', data => { if (this.onData) this.onData(data); });
      conn.on('close', () => {
        this.connected = false;
        if (this.onPlayerLeave) this.onPlayerLeave();
      });
      conn.on('error', err => console.error('Connection error:', err));
    }

    send(type, payload = {}) {
      if (!this.isConnected()) return;
      this.conn.send({ type, ...payload, timestamp: Date.now() });
    }

    async leaveRoom() {
      const conn = this.conn;
      const peer = this.peer;
      this.conn = null;
      this.peer = null;
      this.connected = false;
      this.roomId = null;
      this.roomCode = null;
      this.playerId = null;
      this.playerNumber = null;
      try { if (conn) conn.close(); } catch (_) {}
      try { if (peer) peer.destroy(); } catch (_) {}
    }

    isConnected() {
      return Boolean(this.connected && this.conn && this.conn.open);
    }
  }

  window.SofaNetwork = SofaNetwork;
})();
