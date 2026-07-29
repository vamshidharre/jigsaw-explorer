/* ==========================================================================
   Jigsaw Explorer - Real-Time Multiplayer Client Module
   ========================================================================== */

class MultiplayerClient {
  constructor(app) {
    this.app = app;
    this.ws = null;
    this.roomId = null;
    this.selfId = null;
    this.isHost = false;
    this.selfColor = '#6366f1';
    this.maxPlayers = 4;
    
    // Keep the auto-generated fallback in memory only. Persisting it here would
    // pre-fill the welcome prompt with a junk "Player 123" the user has to erase.
    const savedName = localStorage.getItem('jigsaw_player_name');
    this.playerName = savedName || ('Player ' + Math.floor(100 + Math.random() * 900));

    this.players = new Map();
    this.isConnected = false;
    this.lastCursorSend = 0;

    this.init();
  }

  setPlayerName(newName) {
    const name = newName.trim() || 'Player 1';
    this.playerName = name;
    localStorage.setItem('jigsaw_player_name', name);

    if (this.isConnected) {
      const self = this.players.get(this.selfId);
      if (self) self.name = name;
      this.updatePlayersUI();
      // Tell the room, otherwise everyone else keeps seeing the old name
      this.send('set_name', { playerName: name });
    }
  }

  init() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');

    if (roomParam) {
      this.connectToRoom(roomParam);
    }
  }

  getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  connectToRoom(roomId) {
    this.roomId = roomId;

    const newUrl = `${window.location.pathname}?room=${roomId}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    try {
      this.ws = new WebSocket(this.getWebSocketUrl());
    } catch (err) {
      console.error('WebSocket connection failed:', err);
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;

      const puzzleState = {
        imageUrl: this.app.currentImageUrl,
        title: this.app.currentTitle,
        cols: this.app.cols,
        rows: this.app.rows,
        rotationEnabled: this.app.rotationEnabled,
        pieces: this.serializePieces()
      };

      const selectEl = document.getElementById('maxPlayersSelect');
      const maxVal = selectEl ? parseInt(selectEl.value, 10) : 4;

      this.send('join_room', {
        roomId: this.roomId,
        playerName: this.playerName,
        maxPlayers: maxVal,
        puzzleState: puzzleState
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.isHost = false;
      this.app.showToast('Disconnected from multiplayer room.');
      this.updatePlayersUI();
      this.updatePermissionsUI();
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  createAndJoinRoom() {
    const newRoomId = 'room-' + Math.random().toString(36).substring(2, 8);
    this.connectToRoom(newRoomId);
  }

  send(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  handleMessage(message) {
    const { type, payload } = message;

    switch (type) {
      case 'room_full': {
        alert(`Sorry, this room is full! (Max ${payload.maxPlayers} players allowed). Returning to single player mode.`);
        window.history.pushState({}, '', window.location.pathname);
        if (this.ws) this.ws.close();
        break;
      }

      case 'room_init': {
        this.selfId = payload.selfId;
        this.isHost = payload.isHost;
        this.selfColor = payload.color;
        this.maxPlayers = payload.maxPlayers || 0;

        const selectEl = document.getElementById('maxPlayersSelect');
        if (selectEl) selectEl.value = String(this.maxPlayers);

        this.players.clear();
        payload.players.forEach(p => this.players.set(p.id, p));

        this.updatePlayersUI();
        this.updatePermissionsUI();
        this.app.showToast(this.isHost ? 'Multiplayer Room Created (You are Host 👑)!' : 'Joined Multiplayer Room (Guest Mode)!');

        if (!this.isHost && payload.imageUrl) {
          this.applyRemotePuzzleState(payload);
        }
        break;
      }

      case 'capacity_updated': {
        this.maxPlayers = payload.maxPlayers;
        const selectEl = document.getElementById('maxPlayersSelect');
        if (selectEl) selectEl.value = String(this.maxPlayers);
        const limitStr = this.maxPlayers > 0 ? `${this.maxPlayers} players` : 'unlimited players';
        this.app.showToast(`Room capacity set to ${limitStr}`);
        break;
      }

      case 'players_updated': {
        this.players.clear();
        payload.players.forEach(p => this.players.set(p.id, p));
        this.updatePlayersUI();
        break;
      }

      case 'player_joined': {
        const { player, players } = payload;
        this.players.clear();
        players.forEach(p => this.players.set(p.id, p));

        const self = this.players.get(this.selfId);
        if (self && self.isHost !== this.isHost) {
          this.isHost = self.isHost;
          this.updatePermissionsUI();
        }

        this.updatePlayersUI();
        audioEngine.playClick();
        this.app.showToast(`${player.name} joined the room!`);
        break;
      }

      case 'player_left': {
        const { playerId, players } = payload;
        const leftPlayer = this.players.get(playerId);
        this.players.clear();
        players.forEach(p => this.players.set(p.id, p));

        const self = this.players.get(this.selfId);
        const promotedToHost = self && self.isHost && !this.isHost;
        if (promotedToHost) {
          this.isHost = true;
          this.updatePermissionsUI();
        }

        this.updatePlayersUI();

        // Announce the promotion last, otherwise the "left the room" toast
        // immediately overwrites it and the new host never sees it.
        if (leftPlayer) {
          this.app.showToast(`${leftPlayer.name} left the room.`);
        }
        if (promotedToHost) {
          setTimeout(() => this.app.showToast('You are now the Room Host 👑!'), 2400);
        }
        break;
      }

      case 'cursor_update': {
        const { playerId, x, y } = payload;
        const player = this.players.get(playerId);
        if (player) {
          player.cursorX = x;
          player.cursorY = y;
        }
        break;
      }

      case 'piece_drag_update': {
        const { playerId, pieceIds, dx, dy } = payload;
        if (playerId !== this.selfId) {
          this.applyRemotePieceDrag(pieceIds, dx, dy);
        }
        break;
      }

      case 'piece_snap_update': {
        const { playerId, piecesState, snapType } = payload;
        if (playerId !== this.selfId) {
          this.applyRemotePieceSnap(piecesState);
          if (snapType === 'board') audioEngine.playLock();
          else audioEngine.playSnap();
        }

        const connected = this.app.engine.getConnectedCount();
        const total = this.app.engine.pieces.length;
        this.app.updateProgressUI(connected, total);

        if (this.app.engine.isCompleted()) {
          this.app.onPuzzleCompleted();
        }
        break;
      }

      case 'puzzle_reset': {
        this.applyRemotePuzzleState(payload);
        this.app.showToast('Host reset the puzzle!');
        break;
      }
    }
  }

  updatePermissionsUI() {
    const btnGallery = this.app.dom.btnGallery;
    const btnUpload = this.app.dom.btnUpload;
    const btnDifficulty = this.app.dom.btnDifficulty;
    const maxPlayersSelect = document.getElementById('maxPlayersSelect');

    const isGuest = this.isConnected && !this.isHost;

    if (btnGallery) btnGallery.classList.toggle('hidden', isGuest);
    if (btnUpload) btnUpload.classList.toggle('hidden', isGuest);
    if (btnDifficulty) btnDifficulty.classList.toggle('hidden', isGuest);
    if (maxPlayersSelect) maxPlayersSelect.disabled = isGuest;
  }

  sendCursorPosition(worldX, worldY) {
    if (!this.isConnected) return;
    const now = Date.now();
    if (now - this.lastCursorSend > 40) {
      this.send('cursor_move', { x: worldX, y: worldY });
      this.lastCursorSend = now;
    }
  }

  sendPieceDrag(pieceIds, dx, dy) {
    if (!this.isConnected) return;
    this.send('piece_drag', { pieceIds, dx, dy });
  }

  sendPieceSnap(snapType) {
    if (!this.isConnected) return;
    this.send('piece_snap', {
      snapType: snapType,
      piecesState: this.serializePieces()
    });
  }

  sendNewPuzzle(imageUrl, title, cols, rows, rotationEnabled) {
    if (!this.isConnected || !this.isHost) return;
    this.send('new_puzzle', {
      imageUrl,
      title,
      cols,
      rows,
      rotationEnabled,
      pieces: this.serializePieces()
    });
  }

  serializePieces() {
    if (!this.app.engine || !this.app.engine.pieces) return [];
    return this.app.engine.pieces.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      isLocked: p.isLocked,
      groupIds: p.group.map(gp => gp.id)
    }));
  }

  applyRemotePieceDrag(pieceIds, dx, dy) {
    if (!this.app.engine) return;
    pieceIds.forEach(id => {
      const p = this.app.engine.pieces.find(item => item.id === id);
      if (p) {
        p.x += dx;
        p.y += dy;
      }
    });
  }

  applyRemotePieceSnap(piecesState) {
    if (!this.app.engine || !piecesState) return;

    piecesState.forEach(state => {
      const p = this.app.engine.pieces.find(item => item.id === state.id);
      if (p) {
        p.x = state.x;
        p.y = state.y;
        p.rotation = state.rotation;
        p.isLocked = state.isLocked;
      }
    });

    piecesState.forEach(state => {
      const p = this.app.engine.pieces.find(item => item.id === state.id);
      if (p && state.groupIds) {
        p.group = state.groupIds.map(gid => this.app.engine.pieces.find(item => item.id === gid)).filter(Boolean);
      }
    });
  }

  applyRemotePuzzleState(state) {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = state.imageUrl;
    img.onload = () => {
      this.app.currentImageUrl = state.imageUrl;
      this.app.currentTitle = state.title;
      this.app.cols = state.cols;
      this.app.rows = state.rows;
      this.app.rotationEnabled = state.rotationEnabled;

      this.app.engine.loadPuzzle(img, state.cols, state.rows, state.rotationEnabled);

      if (state.pieces) {
        this.applyRemotePieceSnap(state.pieces);
      }

      this.app.dom.puzzleTitle.textContent = state.title;
      this.app.dom.pieceCountBadge.textContent = `${state.cols * state.rows} Pieces`;
      this.app.dom.difficultyBadge.textContent =
        this.app.getDifficultyLabel(state.cols, state.rows);

      // Progress, score and clock all belong to the previous puzzle - reset them
      this.app.scoreEngine.resetScore();
      this.app.updateProgressUI(
        this.app.engine.getConnectedCount(),
        this.app.engine.pieces.length
      );
      this.app.resetTimer();
      this.app.startTimer();
    };
  }

  updatePlayersUI() {
    const bar = document.getElementById('multiplayerBar');
    const playerListEl = document.getElementById('playerList');
    if (!bar || !playerListEl) return;

    if (!this.isConnected) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');
    playerListEl.innerHTML = '';

    this.players.forEach(p => {
      const badge = document.createElement('div');
      badge.className = 'player-badge';
      badge.style.borderColor = p.color;

      const dot = document.createElement('span');
      dot.className = 'player-dot';
      dot.style.backgroundColor = p.color;

      // Names come from other clients, so build this as text rather than markup
      const nameEl = document.createElement('span');
      nameEl.className = 'player-name';
      nameEl.textContent =
        (p.isHost ? '👑 ' : '') + p.name + (p.id === this.selfId ? ' (You)' : '');

      badge.appendChild(dot);
      badge.appendChild(nameEl);
      playerListEl.appendChild(badge);
    });
  }
}
