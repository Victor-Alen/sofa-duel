(() => {
  'use strict';

  // Firebase configuration - using a free Firebase project
  const firebaseConfig = {
    apiKey: "AIzaSyBxKQ8vJ9mZ5nF3pL7wR2tY6uI8oP0qA",
    authDomain: "sofa-duel-online.firebaseapp.com",
    databaseURL: "https://sofa-duel-online-default-rtdb.firebaseio.com",
    projectId: "sofa-duel-online",
    storageBucket: "sofa-duel-online.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
  };

  // Simple Firebase REST API client (no SDK needed)
  class SofaNetwork {
    constructor() {
      this.roomId = null;
      this.playerId = null;
      this.playerNumber = null; // 0 or 1
      this.db = null;
      this.roomRef = null;
      this.listeners = [];
      this.connected = false;
      this.onStateChange = null;
      this.onPlayerJoin = null;
      this.onPlayerLeave = null;
      this.onGameStart = null;
      this.onGameEnd = null;
      this.onChat = null;
      this.reconnectTimer = null;
      this.heartbeatTimer = null;
      this.lastHeartbeat = Date.now();
    }

    // Generate a short room code (6 characters)
    generateRoomCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    }

    // Generate a unique player ID
    generatePlayerId() {
      return 'p_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    // Firebase REST API helpers
    async firebaseGet(path) {
      try {
        const response = await fetch(`${firebaseConfig.databaseURL}${path}.json`);
        if (!response.ok) throw new Error('Firebase GET failed');
        return await response.json();
      } catch (error) {
        console.error('Firebase GET error:', error);
        return null;
      }
    }

    async firebaseSet(path, data) {
      try {
        const response = await fetch(`${firebaseConfig.databaseURL}${path}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Firebase SET failed');
        return await response.json();
      } catch (error) {
        console.error('Firebase SET error:', error);
        return null;
      }
    }

    async firebaseUpdate(path, data) {
      try {
        const response = await fetch(`${firebaseConfig.databaseURL}${path}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Firebase UPDATE failed');
        return await response.json();
      } catch (error) {
        console.error('Firebase UPDATE error:', error);
        return null;
      }
    }

    async firebasePush(path, data) {
      try {
        const response = await fetch(`${firebaseConfig.databaseURL}${path}.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Firebase PUSH failed');
        return await response.json();
      } catch (error) {
        console.error('Firebase PUSH error:', error);
        return null;
      }
    }

    async firebaseDelete(path) {
      try {
        const response = await fetch(`${firebaseConfig.databaseURL}${path}.json`, {
          method: 'DELETE'
        });
        if (!response.ok) throw new Error('Firebase DELETE failed');
        return true;
      } catch (error) {
        console.error('Firebase DELETE error:', error);
        return false;
      }
    }

    // Create a new room
    async createRoom() {
      this.roomId = this.generateRoomCode();
      this.playerId = this.generatePlayerId();
      this.playerNumber = 0;

      const roomData = {
        code: this.roomId,
        host: this.playerId,
        created: Date.now(),
        status: 'waiting', // waiting, playing, finished
        players: {
          [this.playerId]: {
            id: this.playerId,
            number: 0,
            character: null,
            name: 'Player 1',
            joined: Date.now(),
            lastSeen: Date.now()
          }
        },
        game: {
          phase: 'waiting',
          scores: [0, 0],
          time: 18,
          rule: null,
          seat: { x: 480, y: 312 },
          players: [
            { x: 220, y: 360, vx: 0, vy: 0, character: null, skillCooldown: 0, stunned: 0 },
            { x: 740, y: 360, vx: 0, vy: 0, character: null, skillCooldown: 0, stunned: 0 }
          ]
        },
        chat: []
      };

      await this.firebaseSet(`/rooms/${this.roomId}`, roomData);
      this.connected = true;
      this.startHeartbeat();
      this.startListening();

      return { roomId: this.roomId, playerId: this.playerId, playerNumber: 0 };
    }

    // Join an existing room
    async joinRoom(roomCode) {
      roomCode = roomCode.toUpperCase().trim();

      // Check if room exists
      const room = await this.firebaseGet(`/rooms/${roomCode}`);
      if (!room) {
        return { error: '房间不存在' };
      }

      if (room.status !== 'waiting') {
        return { error: '房间已开始游戏' };
      }

      const playerCount = Object.keys(room.players || {}).length;
      if (playerCount >= 2) {
        return { error: '房间已满' };
      }

      this.roomId = roomCode;
      this.playerId = this.generatePlayerId();
      this.playerNumber = 1;

      // Add player to room
      await this.firebaseUpdate(`/rooms/${roomCode}/players/${this.playerId}`, {
        id: this.playerId,
        number: 1,
        character: null,
        name: 'Player 2',
        joined: Date.now(),
        lastSeen: Date.now()
      });

      // Update room status if both players are present
      const updatedRoom = await this.firebaseGet(`/rooms/${roomCode}`);
      if (updatedRoom && Object.keys(updatedRoom.players || {}).length >= 2) {
        await this.firebaseUpdate(`/rooms/${roomCode}`, { status: 'ready' });
      }

      this.connected = true;
      this.startHeartbeat();
      this.startListening();

      return { roomId: roomCode, playerId: this.playerId, playerNumber: 1 };
    }

    // Leave the current room
    async leaveRoom() {
      if (!this.roomId || !this.playerId) return;

      await this.firebaseDelete(`/rooms/${this.roomId}/players/${this.playerId}`);

      // Check if room is now empty
      const room = await this.firebaseGet(`/rooms/${this.roomId}`);
      if (room && Object.keys(room.players || {}).length === 0) {
        await this.firebaseDelete(`/rooms/${this.roomId}`);
      }

      this.stopHeartbeat();
      this.stopListening();
      this.connected = false;
      this.roomId = null;
      this.playerId = null;
      this.playerNumber = null;
    }

    // Update player character selection
    async selectCharacter(characterId) {
      if (!this.roomId || !this.playerId) return;

      await this.firebaseUpdate(`/rooms/${this.roomId}/players/${this.playerId}`, {
        character: characterId,
        lastSeen: Date.now()
      });

      // Check if both players have selected characters
      const room = await this.firebaseGet(`/rooms/${this.roomId}`);
      if (room) {
        const players = Object.values(room.players || {});
        const allReady = players.length >= 2 && players.every(p => p.character);
        if (allReady && room.status === 'ready') {
          await this.firebaseUpdate(`/rooms/${this.roomId}`, { status: 'playing' });
          if (this.onGameStart) this.onGameStart();
        }
      }
    }

    // Send game state update (from host)
    async sendGameState(gameState) {
      if (!this.roomId || this.playerNumber !== 0) return;

      await this.firebaseUpdate(`/rooms/${this.roomId}/game`, {
        phase: gameState.phase,
        scores: gameState.scores,
        time: gameState.time,
        rule: gameState.rule,
        seat: gameState.seat,
        players: gameState.players.map(p => ({
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy,
          character: p.characterId,
          skillCooldown: p.skillCooldown,
          stunned: p.stunned,
          emotion: p.emotion,
          dashLeft: p.dashLeft,
          shieldLeft: p.shieldLeft,
          pulseLeft: p.pulseLeft,
          pullLeft: p.pullLeft,
          warpLeft: p.warpLeft,
          reboundLeft: p.reboundLeft,
          trap: p.trap
        })),
        lastUpdate: Date.now()
      });
    }

    // Send input (from client)
    async sendInput(input) {
      if (!this.roomId || !this.playerId) return;

      await this.firebaseUpdate(`/rooms/${this.roomId}/players/${this.playerId}/input`, {
        keys: Array.from(input.keys || []),
        mobile: input.mobile || { x: 0, y: 0 },
        skill: input.skill || false,
        timestamp: Date.now()
      });
    }

    // Send chat message
    async sendChat(message) {
      if (!this.roomId || !this.playerId) return;

      await this.firebasePush(`/rooms/${this.roomId}/chat`, {
        player: this.playerNumber,
        message: message,
        timestamp: Date.now()
      });
    }

    // Start listening for room updates
    startListening() {
      this.stopListening();

      // Poll for updates every 100ms (Firebase REST doesn't support real-time without SDK)
      this.pollTimer = setInterval(async () => {
        if (!this.roomId) return;

        const room = await this.firebaseGet(`/rooms/${this.roomId}`);
        if (!room) {
          // Room was deleted
          if (this.onPlayerLeave) this.onPlayerLeave();
          this.leaveRoom();
          return;
        }

        // Check if other player is still connected
        const players = Object.values(room.players || {});
        const otherPlayer = players.find(p => p.number !== this.playerNumber);

        if (otherPlayer) {
          const timeSinceLastSeen = Date.now() - (otherPlayer.lastSeen || 0);
          if (timeSinceLastSeen > 10000) {
            // Other player disconnected
            if (this.onPlayerLeave) this.onPlayerLeave(otherPlayer.number);
          }
        }

        if (this.onStateChange) {
          this.onStateChange(room);
        }
      }, 100);
    }

    stopListening() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }

    // Start heartbeat to show we're alive
    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(async () => {
        if (!this.roomId || !this.playerId) return;

        await this.firebaseUpdate(`/rooms/${this.roomId}/players/${this.playerId}`, {
          lastSeen: Date.now()
        });
      }, 3000);
    }

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }

    // Clean up old rooms (older than 1 hour)
    async cleanupOldRooms() {
      const rooms = await this.firebaseGet('/rooms');
      if (!rooms) return;

      const oneHourAgo = Date.now() - 3600000;
      for (const [code, room] of Object.entries(rooms)) {
        if (room.created && room.created < oneHourAgo) {
          await this.firebaseDelete(`/rooms/${code}`);
        }
      }
    }
  }

  // Export to global scope
  window.SofaNetwork = SofaNetwork;
})();
