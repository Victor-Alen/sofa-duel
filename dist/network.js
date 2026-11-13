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
  // Query several STUN providers in parallel. Domestic endpoints avoid making
  // Google reachability a single point of failure for Chinese players.
  const ICE_SERVERS = [
    { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.qq.com:3478', 'stun:stun.chat.bilibili.com:3478'] },
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];

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
      this.conns = [];        // host side: { conn, playerNumber } for every joined guest
      this.roomSize = 2;      // host side: total seats including the host
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
          config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 }
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

    async createRoom(preferredCode, size) {
      await this.loadPeerJS();
      this.roomSize = Math.max(2, Math.min(4, Number(size) || 2));
      this.playerNumber = 0;
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = preferredCode || this.generateRoomCode();
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
        let conn = null;
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) {
            try { if (conn) conn.close(); } catch (_) {}
            reject(error);
          } else {
            resolve();
          }
        };
        const timer = setTimeout(() => {
          finish(new Error('连接超时，请确认房间号，或让双方切换网络后重试'));
        }, 15000);
        this.peer.on('error', err => {
          if (settled || !err) return;
          if (err.type === 'peer-unavailable') {
            finish(new Error('房间不存在或已关闭'));
            return;
          }
          const messages = {
            network: '联机服务器连接失败，请检查网络后重试',
            'server-error': '联机服务器暂时不可用，请稍后重试',
            'socket-error': '联机服务器连接异常，请检查网络后重试',
            'socket-closed': '联机服务器连接已关闭，请重试',
            webrtc: '浏览器无法建立联机连接，请切换网络后重试',
            'browser-incompatible': '当前浏览器不支持联机，请使用最新版浏览器'
          };
          if (messages[err.type]) finish(new Error(messages[err.type]));
        });
        conn = this.peer.connect(this.roomId, { reliable: true, metadata: { playerNumber: 1 } });
        this.handleConnection(
          conn,
          () => finish(),
          error => finish(error),
          () => finish(new Error('连接在建立前被关闭，请重试'))
        );
      });
      return { roomId: this.roomId, roomCode: code, playerNumber: 1 };
    }

    handleConnection(conn, onOpen, onError, onClose) {
      // Host side: every room has roomSize seats (host included). Each guest
      // dial gets the lowest free playerNumber; a full room still accepts the
      // socket just long enough to tell the caller it is full, then closes.
      if (this.playerNumber === 0) {
        if (this.conns.filter(entry => entry.playerNumber !== null).length >= this.roomSize - 1) {
          const pending = { conn, playerNumber: null };
          this.conns.push(pending);
          conn.on('open', () => {
            try { conn.send({ type: 'roomFull', timestamp: Date.now() }); } catch (_) {}
            setTimeout(() => { try { conn.close(); } catch (_) {} this.conns = this.conns.filter(item => item !== pending); }, 300);
          });
          conn.on('close', () => { this.conns = this.conns.filter(item => item !== pending); });
          return;
        }
        const used = new Set(this.conns.map(entry => entry.playerNumber));
        let seat = 1;
        while (used.has(seat) && seat < this.roomSize) seat++;
        const entry = { conn, playerNumber: seat };
        this.conns.push(entry);
        let opened = false;
        conn.on('open', () => {
          opened = true;
          if (onOpen) onOpen(seat);
          if (this.onPlayerJoin) this.onPlayerJoin(seat);
        });
        conn.on('data', data => { if (this.onData) this.onData(data, seat); });
        conn.on('close', () => {
          const wasOpen = opened;
          opened = false;
          this.conns = this.conns.filter(item => item !== entry);
          if (wasOpen && this.onPlayerLeave) this.onPlayerLeave(seat);
        });
        conn.on('error', err => {
          console.error('Connection error:', err);
          if (onError) {
            const error = new Error('连接失败，可能是双方网络限制，请切换网络后重试');
            error.type = 'connection-failed';
            onError(error);
          }
        });
        return;
      }
      this.conn = conn;
      let opened = false;
      conn.on('open', () => {
        opened = true;
        this.connected = true;
        if (onOpen) onOpen();
        if (this.onPlayerJoin) this.onPlayerJoin(this.playerNumber === 0 ? 1 : 0);
      });
      conn.on('data', data => { if (this.onData) this.onData(data, this.playerNumber); });
      conn.on('close', () => {
        const wasOpen = opened;
        opened = false;
        this.connected = false;
        if (onClose) onClose();
        if (wasOpen && this.onPlayerLeave) this.onPlayerLeave();
      });
      conn.on('error', err => {
        console.error('Connection error:', err);
        if (onError) {
          const error = new Error('连接失败，可能是双方网络限制，请切换网络后重试');
          error.type = 'connection-failed';
          onError(error);
        }
      });
    }

    send(type, payload = {}) {
      if (this.playerNumber === 0) {
        // Host broadcasts to every joined guest (the host never sends to itself).
        for (const entry of this.conns) {
          if (entry.playerNumber !== null && entry.conn.open) entry.conn.send({ type, ...payload, timestamp: Date.now() });
        }
        return;
      }
      if (!this.isConnected()) return;
      this.conn.send({ type, ...payload, timestamp: Date.now() });
    }

    sendTo(playerNumber, type, payload = {}) {
      if (this.playerNumber !== 0) return;
      const entry = this.conns.find(item => item.playerNumber === playerNumber);
      if (entry && entry.conn.open) entry.conn.send({ type, ...payload, timestamp: Date.now() });
    }

    async leaveRoom() {
      const conn = this.conn;
      const guests = this.conns;
      this.conns = [];
      const peer = this.peer;
      this.conn = null;
      this.peer = null;
      this.connected = false;
      this.roomId = null;
      this.roomCode = null;
      this.playerId = null;
      this.playerNumber = null;
      try { if (conn) conn.close(); } catch (_) {}
      for (const entry of guests) { try { entry.conn.close(); } catch (_) {} }
      try { if (peer) peer.destroy(); } catch (_) {}
    }

    isConnected() {
      if (this.playerNumber === 0) return this.conns.some(entry => entry.playerNumber !== null && entry.conn.open);
      return Boolean(this.connected && this.conn && this.conn.open);
    }
  }

  window.SofaNetwork = SofaNetwork;
})();
