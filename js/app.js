/* ==========================================================================
   Jigsaw Explorer - Main Application Controller & UI Handler
   ========================================================================== */

class JigsawApp {
  constructor() {
    this.canvas = document.getElementById('jigsawCanvas');
    this.confettiCanvas = document.getElementById('confettiCanvas');
    this.engine = new JigsawEngine(this.canvas);
    this.scoreEngine = new ScoreEngine(this);
    this.gallery = null;

    // Game Config State
    this.currentImageUrl = PUZZLE_GALLERY[0].url;
    this.currentTitle = PUZZLE_GALLERY[0].title;
    this.cols = 6;
    this.rows = 4;
    this.rotationEnabled = false;

    // Timer & Progress
    this.timerInterval = null;
    this.secondsElapsed = 0;
    this.totalMoves = 0;

    // UI Elements
    this.dom = {
      puzzleTitle: document.getElementById('puzzleTitle'),
      pieceCountBadge: document.getElementById('pieceCountBadge'),
      difficultyBadge: document.getElementById('difficultyBadge'),
      timerDisplay: document.getElementById('timerDisplay'),
      progressText: document.getElementById('progressText'),
      progressBar: document.getElementById('progressBar'),
      scoreDisplay: document.getElementById('scoreDisplay'),
      btnAudioToggle: document.getElementById('btnAudioToggle'),
      iconSoundOn: document.getElementById('iconSoundOn'),
      iconSoundOff: document.getElementById('iconSoundOff'),
      btnGallery: document.getElementById('btnGallery'),
      btnUpload: document.getElementById('btnUpload'),
      btnDifficulty: document.getElementById('btnDifficulty'),
      btnLeaderboard: document.getElementById('btnLeaderboard'),
      btnClearLeaderboard: document.getElementById('btnClearLeaderboard'),
      btnShareRoom: document.getElementById('btnShareRoom'),
      modalRoomShare: document.getElementById('modalRoomShare'),
      roomLinkInput: document.getElementById('roomLinkInput'),
      btnCopyRoomLink: document.getElementById('btnCopyRoomLink'),
      playerNameInput: document.getElementById('playerNameInput'),
      btnSavePlayerName: document.getElementById('btnSavePlayerName'),
      modalLeaderboard: document.getElementById('modalLeaderboard'),
      leaderboardTbody: document.getElementById('leaderboardTbody'),
      victoryLeaderboardTbody: document.getElementById('victoryLeaderboardTbody'),
      modalGallery: document.getElementById('modalGallery'),
      modalUpload: document.getElementById('modalUpload'),
      modalDifficulty: document.getElementById('modalDifficulty'),
      modalVictory: document.getElementById('modalVictory'),
      toast: document.getElementById('toast'),
      toastMessage: document.getElementById('toastMessage'),

      // Welcome Name Modal
      modalWelcomeName: document.getElementById('modalWelcomeName'),
      welcomeNameInput: document.getElementById('welcomeNameInput'),
      btnSubmitWelcomeName: document.getElementById('btnSubmitWelcomeName'),

      // Feedback Widget
      btnFeedbackToggle: document.getElementById('btnFeedbackToggle'),
      btnFeedbackClose: document.getElementById('btnFeedbackClose'),
      btnSendFeedback: document.getElementById('btnSendFeedback'),
      feedbackBox: document.getElementById('feedbackBox'),
      feedbackText: document.getElementById('feedbackText')
    };

    this.init();
  }

  init() {
    this.setupWindowResize();
    this.setupAudioControls();
    this.setupLogoRestart();
    this.setupGalleryAndUpload();
    this.setupDifficultyModal();
    this.setupLeaderboardModal();
    this.setupDockControls();
    this.setupCanvasInteractions();
    this.setupVictoryModal();
    this.setupFeedbackWidget();

    // Start with default puzzle
    this.startNewGame(this.currentImageUrl, this.currentTitle, 6, 4);

    // Initialize Multiplayer Engine
    window.multiplayerClient = new MultiplayerClient(this);
    this.setupMultiplayerControls();
    this.setupWelcomeNameModal();

    // Main animation render loop
    const animate = () => {
      this.engine.render();
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  setupWindowResize() {
    const resize = () => {
      const container = document.getElementById('gameViewport');
      this.canvas.width = container.clientWidth;
      this.canvas.height = container.clientHeight;
      this.confettiCanvas.width = container.clientWidth;
      this.confettiCanvas.height = container.clientHeight;
      
      if (this.engine.image) {
        this.engine.calculateBoardDimensions();
      }
    };
    window.addEventListener('resize', resize);
    resize();
  }

  setupAudioControls() {
    if (this.dom.btnAudioToggle) {
      this.dom.btnAudioToggle.addEventListener('click', () => {
        const isMuted = audioEngine.toggleMute();
        this.dom.iconSoundOn.classList.toggle('hidden', isMuted);
        this.dom.iconSoundOff.classList.toggle('hidden', !isMuted);
        audioEngine.playClick();
      });
    }
  }

  setupLogoRestart() {
    const brandLogo = document.getElementById('brandLogo');
    if (brandLogo) {
      brandLogo.addEventListener('click', () => {
        audioEngine.playClick();
        if (confirm('Restart current puzzle from the beginning?')) {
          this.startNewGame(this.currentImageUrl, this.currentTitle, this.cols, this.rows);
        }
      });
    }
  }

  setupWelcomeNameModal() {
    const savedName = localStorage.getItem('jigsaw_player_name');
    if (this.dom.welcomeNameInput) {
      this.dom.welcomeNameInput.value = savedName || '';
    }

    // Always show prompt on initial visit / join room
    if (this.dom.modalWelcomeName) {
      this.dom.modalWelcomeName.classList.remove('hidden');
      setTimeout(() => {
        this.dom.welcomeNameInput?.focus();
      }, 300);
    }

    const submitName = () => {
      audioEngine.playClick();
      const enteredName = this.dom.welcomeNameInput.value.trim() || 'Player 1';
      if (window.multiplayerClient) {
        window.multiplayerClient.setPlayerName(enteredName);
      }
      this.dom.modalWelcomeName.classList.add('hidden');
      this.showToast(`Welcome, ${enteredName}! Have fun 🧩`);
    };

    if (this.dom.btnSubmitWelcomeName) {
      this.dom.btnSubmitWelcomeName.addEventListener('click', submitName);
    }

    if (this.dom.welcomeNameInput) {
      this.dom.welcomeNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          submitName();
        }
      });
    }
  }

  promptPlayerNameForNewGame(callback) {
    if (this.dom.modalWelcomeName) {
      const savedName = localStorage.getItem('jigsaw_player_name');
      if (this.dom.welcomeNameInput) {
        this.dom.welcomeNameInput.value = savedName || '';
      }
      this.dom.modalWelcomeName.classList.remove('hidden');
      setTimeout(() => {
        this.dom.welcomeNameInput?.focus();
      }, 300);
    }
  }

  getDifficultyLabel(cols, rows) {
    const total = cols * rows;
    if (total >= 150) return 'Master';
    if (total >= 96) return 'Expert';
    if (total >= 60) return 'Hard';
    if (total >= 40) return 'Challenging';
    if (total >= 24) return 'Medium';
    if (total >= 12) return 'Casual';
    return 'Easy';
  }

  startNewGame(imageUrl, title, cols, rows) {
    if (window.multiplayerClient && window.multiplayerClient.isConnected && !window.multiplayerClient.isHost) {
      this.showToast('Only the Room Host 👑 can change the puzzle image!');
      return;
    }

    // Prompt for player name if starting a new session or room
    const savedName = localStorage.getItem('jigsaw_player_name');
    if (!savedName && this.dom.modalWelcomeName) {
      this.dom.modalWelcomeName.classList.remove('hidden');
    }

    // Erase old leaderboard when a new game starts
    this.scoreEngine.clearHighScores();

    this.currentImageUrl = imageUrl;
    this.currentTitle = title;
    this.cols = cols;
    this.rows = rows;

    this.dom.puzzleTitle.textContent = title;
    const pieceCount = cols * rows;
    this.dom.pieceCountBadge.textContent = `${pieceCount} Pieces`;
    this.dom.difficultyBadge.textContent = this.getDifficultyLabel(cols, rows);

    this.resetTimer();
    this.totalMoves = 0;
    this.scoreEngine.resetScore();
    this.updateProgressUI(0, pieceCount);

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;
    img.onload = () => {
      this.engine.loadPuzzle(img, cols, rows, this.rotationEnabled);
      this.startTimer();

      if (window.multiplayerClient && window.multiplayerClient.isConnected && window.multiplayerClient.isHost) {
        window.multiplayerClient.sendNewPuzzle(imageUrl, title, cols, rows, this.rotationEnabled);
      }

      this.showToast(`New ${pieceCount}-piece (${this.getDifficultyLabel(cols, rows)}) puzzle started!`);
    };
    img.onerror = () => {
      alert('Failed to load puzzle image. Please try another image.');
    };
  }

  setupFeedbackWidget() {
    if (this.dom.feedbackText) {
      this.dom.feedbackText.value = '';
    }

    if (this.dom.btnFeedbackToggle) {
      this.dom.btnFeedbackToggle.addEventListener('click', () => {
        audioEngine.playClick();
        const isHidden = this.dom.feedbackBox.classList.contains('hidden');
        if (isHidden && this.dom.feedbackText) {
          this.dom.feedbackText.value = '';
        }
        this.dom.feedbackBox.classList.toggle('hidden');
      });
    }

    if (this.dom.btnFeedbackClose) {
      this.dom.btnFeedbackClose.addEventListener('click', () => {
        if (this.dom.feedbackText) this.dom.feedbackText.value = '';
        this.dom.feedbackBox.classList.add('hidden');
      });
    }

    if (this.dom.btnSendFeedback) {
      this.dom.btnSendFeedback.addEventListener('click', () => {
        const text = this.dom.feedbackText.value.trim();
        if (!text) {
          alert('Please enter your feedback message.');
          return;
        }

        audioEngine.playClick();
        const playerName = window.multiplayerClient ? window.multiplayerClient.playerName : 'Player 1';

        fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName, message: text })
        }).then(res => res.json()).then(data => {
          if (data && data.success) {
            console.log('Feedback saved successfully:', data.entry);
          }
        }).catch(err => {
          console.error('Feedback submit error:', err);
        });

        this.dom.feedbackText.value = '';
        this.dom.feedbackBox.classList.add('hidden');
        this.showToast('Thank you! Your feedback has been sent 💬');
      });
    }
  }

  setupMultiplayerControls() {
    if (this.dom.playerNameInput && window.multiplayerClient) {
      this.dom.playerNameInput.value = window.multiplayerClient.playerName;
    }

    this.dom.btnShareRoom.addEventListener('click', () => {
      audioEngine.playClick();

      if (!window.multiplayerClient.isConnected) {
        window.multiplayerClient.createAndJoinRoom();
      }

      const roomUrl = window.location.href;
      this.dom.roomLinkInput.value = roomUrl;
      if (this.dom.playerNameInput) {
        this.dom.playerNameInput.value = window.multiplayerClient.playerName;
      }
      this.dom.modalRoomShare.classList.remove('hidden');
    });

    this.dom.btnCopyRoomLink.addEventListener('click', () => {
      audioEngine.playClick();
      this.dom.roomLinkInput.select();
      navigator.clipboard.writeText(this.dom.roomLinkInput.value).then(() => {
        this.showToast('Room invite link copied to clipboard!');
      }).catch(() => {
        document.execCommand('copy');
        this.showToast('Room invite link copied!');
      });
    });

    const maxPlayersSelect = document.getElementById('maxPlayersSelect');
    if (maxPlayersSelect) {
      maxPlayersSelect.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (window.multiplayerClient && window.multiplayerClient.isConnected && window.multiplayerClient.isHost) {
          window.multiplayerClient.send('update_room_capacity', { maxPlayers: val });
        }
      });
    }

    const saveNameAction = () => {
      audioEngine.playClick();
      const newName = this.dom.playerNameInput.value.trim();
      if (window.multiplayerClient && newName) {
        window.multiplayerClient.setPlayerName(newName);
        this.showToast(`Player name saved as "${newName}"!`);

        if (this.dom.btnSavePlayerName) {
          this.dom.btnSavePlayerName.textContent = '✓ Done';
          setTimeout(() => {
            if (this.dom.btnSavePlayerName) this.dom.btnSavePlayerName.textContent = 'Save';
          }, 1800);
        }
      }
    };

    if (this.dom.btnSavePlayerName) {
      this.dom.btnSavePlayerName.addEventListener('click', saveNameAction);
    }

    this.dom.playerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveNameAction();
      }
    });
  }

  setupLeaderboardModal() {
    this.dom.btnLeaderboard.addEventListener('click', () => {
      audioEngine.playClick();
      this.renderLeaderboard(this.dom.leaderboardTbody);
      this.dom.modalLeaderboard.classList.remove('hidden');
    });

    if (this.dom.btnClearLeaderboard) {
      this.dom.btnClearLeaderboard.addEventListener('click', () => {
        audioEngine.playClick();
        this.scoreEngine.clearHighScores();
        this.renderLeaderboard(this.dom.leaderboardTbody);
        this.showToast('Leaderboard scores cleared.');
      });
    }
  }

  renderLeaderboard(tbodyTarget, activeEntryId = null) {
    if (!tbodyTarget) return;

    const scores = this.scoreEngine.getHighScores();
    tbodyTarget.innerHTML = '';

    if (scores.length === 0) {
      tbodyTarget.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No high scores recorded for this session. Complete a puzzle to claim your rank!</td></tr>`;
      return;
    }

    scores.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      if (activeEntryId && entry.id === activeEntryId) {
        tr.className = 'new-score-row';
      }

      let rankStr = `${idx + 1}`;
      if (idx === 0) rankStr = '🥇 1st';
      else if (idx === 1) rankStr = '🥈 2nd';
      else if (idx === 2) rankStr = '🥉 3rd';

      const mins = String(Math.floor(entry.time / 60)).padStart(2, '0');
      const secs = String(entry.time % 60).padStart(2, '0');

      tr.innerHTML = `
        <td class="rank-pill">${rankStr}</td>
        <td><strong>${entry.name}</strong></td>
        <td>${entry.title}</td>
        <td>${entry.pieces}</td>
        <td>${mins}:${secs}</td>
        <td style="color: var(--warning-color); font-weight: 800;">${entry.score.toLocaleString()} PTS</td>
      `;
      tbodyTarget.appendChild(tr);
    });
  }

  setupGalleryAndUpload() {
    this.gallery = new GalleryManager((url, title) => {
      this.closeAllModals();
      this.startNewGame(url, title, this.cols, this.rows);
    });

    this.dom.btnGallery.addEventListener('click', () => {
      audioEngine.playClick();
      this.dom.modalGallery.classList.remove('hidden');
    });

    this.dom.btnUpload.addEventListener('click', () => {
      audioEngine.playClick();
      this.dom.modalUpload.classList.remove('hidden');
    });

    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', (e) => {
        const modalId = el.dataset.close || el.closest('.modal')?.id;
        if (modalId) {
          document.getElementById(modalId)?.classList.add('hidden');
        }
      });
    });
  }

  setupDifficultyModal() {
    this.dom.btnDifficulty.addEventListener('click', () => {
      audioEngine.playClick();
      
      const diffCards = document.querySelectorAll('.diff-card');
      diffCards.forEach(card => {
        const c = parseInt(card.dataset.cols, 10);
        const r = parseInt(card.dataset.rows, 10);
        card.classList.toggle('active', c === this.cols && r === this.rows);
      });

      this.dom.modalDifficulty.classList.remove('hidden');
    });

    const diffCards = document.querySelectorAll('.diff-card');
    diffCards.forEach(card => {
      card.addEventListener('click', () => {
        diffCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.cols = parseInt(card.dataset.cols, 10);
        this.rows = parseInt(card.dataset.rows, 10);
      });
    });

    const toggleRotation = document.getElementById('toggleRotation');
    if (toggleRotation) {
      toggleRotation.addEventListener('change', (e) => {
        this.rotationEnabled = e.target.checked;
      });
    }

    const btnApply = document.getElementById('btnApplyDifficulty');
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        this.closeAllModals();
        this.startNewGame(this.currentImageUrl, this.currentTitle, this.cols, this.rows);
      });
    }
  }

  setupDockControls() {
    document.getElementById('btnZoomIn')?.addEventListener('click', () => {
      this.engine.zoom = Math.min(2.5, this.engine.zoom * 1.2);
    });

    document.getElementById('btnZoomOut')?.addEventListener('click', () => {
      this.engine.zoom = Math.max(0.5, this.engine.zoom / 1.2);
    });

    document.getElementById('btnZoomReset')?.addEventListener('click', () => {
      this.engine.zoom = 1;
      this.engine.panX = 0;
      this.engine.panY = 0;
    });

    document.getElementById('btnScatter')?.addEventListener('click', () => {
      audioEngine.playClick();
      this.engine.scatterPieces();
      this.showToast('Loose pieces scattered');
      if (window.multiplayerClient && window.multiplayerClient.isConnected) {
        window.multiplayerClient.sendPieceSnap('scatter');
      }
    });

    const btnEdgeFilter = document.getElementById('btnEdgeFilter');
    btnEdgeFilter?.addEventListener('click', () => {
      audioEngine.playClick();
      const isActive = btnEdgeFilter.classList.toggle('active');
      this.engine.toggleEdgeFilter(isActive);
      this.showToast(isActive ? 'Showing edge pieces only' : 'Showing all pieces');
    });

    const btnToggleGhost = document.getElementById('btnToggleGhost');
    const ghostOpacityInput = document.getElementById('ghostOpacity');

    btnToggleGhost?.addEventListener('click', () => {
      audioEngine.playClick();
      const isActive = btnToggleGhost.classList.toggle('active');
      this.engine.showGhost = isActive;
    });

    ghostOpacityInput?.addEventListener('input', (e) => {
      this.engine.ghostOpacity = parseFloat(e.target.value);
    });

    const btnSolvePreview = document.getElementById('btnSolvePreview');
    if (btnSolvePreview) {
      const startPreview = () => {
        this.engine.ghostOpacity = 1;
        this.engine.showGhost = true;
      };
      const endPreview = () => {
        this.engine.ghostOpacity = parseFloat(ghostOpacityInput.value);
        this.engine.showGhost = btnToggleGhost.classList.contains('active');
      };

      btnSolvePreview.addEventListener('mousedown', startPreview);
      btnSolvePreview.addEventListener('mouseup', endPreview);
      btnSolvePreview.addEventListener('mouseleave', endPreview);
      btnSolvePreview.addEventListener('touchstart', startPreview);
      btnSolvePreview.addEventListener('touchend', endPreview);
    }

    document.getElementById('btnFullscreen')?.addEventListener('click', () => {
      audioEngine.playClick();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  setupCanvasInteractions() {
    this.canvas.addEventListener('mousedown', (e) => {
      const piece = this.engine.startDrag(e.clientX, e.clientY);
      if (piece) {
        audioEngine.playClick();
      }
    });

    window.addEventListener('mousemove', (e) => {
      this.engine.drag(e.clientX, e.clientY);

      if (window.multiplayerClient && window.multiplayerClient.isConnected) {
        const worldPos = this.engine.getScreenToWorld(e.clientX, e.clientY);
        window.multiplayerClient.sendCursorPosition(worldPos.x, worldPos.y);
      }
    });

    window.addEventListener('mouseup', () => {
      const snapResult = this.engine.endDrag();
      if (snapResult.type) {
        this.totalMoves++;
        if (snapResult.type === 'board') {
          audioEngine.playLock();
          this.showToast('Piece locked to board!');
        } else {
          audioEngine.playSnap();
          this.showToast('Pieces snapped together!');
        }

        this.scoreEngine.addSnapPoints(
          snapResult.type,
          snapResult.lastX,
          snapResult.lastY,
          snapResult.pieceCount
        );

        const connected = this.engine.getConnectedCount();
        const total = this.engine.pieces.length;
        this.updateProgressUI(connected, total);

        if (window.multiplayerClient && window.multiplayerClient.isConnected) {
          window.multiplayerClient.sendPieceSnap(snapResult.type);
        }

        if (this.engine.isCompleted()) {
          this.onPuzzleCompleted();
        }
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const pos = this.engine.getScreenToWorld(e.clientX, e.clientY);
      const piece = this.engine.findPieceAt(pos.x, pos.y);
      if (piece) {
        this.engine.rotatePiece(piece);
        audioEngine.playClick();
        if (window.multiplayerClient && window.multiplayerClient.isConnected) {
          window.multiplayerClient.sendPieceSnap('rotate');
        }
      }
    });

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        this.engine.startDrag(touch.clientX, touch.clientY);
      }
    });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        this.engine.drag(touch.clientX, touch.clientY);
        if (window.multiplayerClient && window.multiplayerClient.isConnected) {
          const worldPos = this.engine.getScreenToWorld(touch.clientX, touch.clientY);
          window.multiplayerClient.sendCursorPosition(worldPos.x, worldPos.y);
        }
      }
    });

    window.addEventListener('touchend', () => {
      const snapResult = this.engine.endDrag();
      if (snapResult.type) {
        this.totalMoves++;
        if (snapResult.type === 'board') audioEngine.playLock();
        else audioEngine.playSnap();

        this.scoreEngine.addSnapPoints(
          snapResult.type,
          snapResult.lastX,
          snapResult.lastY,
          snapResult.pieceCount
        );

        const connected = this.engine.getConnectedCount();
        const total = this.engine.pieces.length;
        this.updateProgressUI(connected, total);

        if (window.multiplayerClient && window.multiplayerClient.isConnected) {
          window.multiplayerClient.sendPieceSnap(snapResult.type);
        }

        if (this.engine.isCompleted()) {
          this.onPuzzleCompleted();
        }
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.engine.zoom = Math.max(0.5, Math.min(2.5, this.engine.zoom * zoomFactor));
    }, { passive: false });
  }

  startTimer() {
    this.stopTimer();
    this.secondsElapsed = 0;
    this.timerInterval = setInterval(() => {
      this.secondsElapsed++;
      const mins = String(Math.floor(this.secondsElapsed / 60)).padStart(2, '0');
      const secs = String(this.secondsElapsed % 60).padStart(2, '0');
      this.dom.timerDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  resetTimer() {
    this.stopTimer();
    this.dom.timerDisplay.textContent = '00:00';
  }

  updateProgressUI(connected, total) {
    this.dom.progressText.textContent = `${connected} / ${total}`;
    const pct = Math.round((connected / total) * 100);
    this.dom.progressBar.style.width = `${pct}%`;
  }

  showToast(msg) {
    this.dom.toastMessage.textContent = msg;
    this.dom.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.dom.toast.classList.add('hidden');
    }, 2200);
  }

  closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  }

  onPuzzleCompleted() {
    this.stopTimer();
    audioEngine.playVictory();

    this.launchConfetti();

    const finalCalc = this.scoreEngine.calculateFinalBonus(this.secondsElapsed);
    
    document.getElementById('vTime').textContent = this.dom.timerDisplay.textContent;
    document.getElementById('vPieces').textContent = this.engine.pieces.length;
    document.getElementById('vTotalScore').textContent = finalCalc.totalFinalScore.toLocaleString();

    document.getElementById('sbBase').textContent = finalCalc.baseScore.toLocaleString();
    document.getElementById('sbSpeed').textContent = `+${finalCalc.speedBonus.toLocaleString()}`;
    document.getElementById('sbDiff').textContent = `+${finalCalc.difficultyBonus.toLocaleString()}`;

    const playerName = window.multiplayerClient ? window.multiplayerClient.playerName : 'Player 1';
    const updatedScores = this.scoreEngine.saveHighScore(
      playerName,
      this.currentTitle,
      this.engine.pieces.length,
      this.secondsElapsed,
      finalCalc.totalFinalScore
    );

    const lastSaved = updatedScores.find(s => s.score === finalCalc.totalFinalScore && s.name === playerName);
    const newEntryId = lastSaved ? lastSaved.id : null;

    this.renderLeaderboard(this.dom.victoryLeaderboardTbody, newEntryId);

    setTimeout(() => {
      this.dom.modalVictory.classList.remove('hidden');
    }, 600);
  }

  setupVictoryModal() {
    document.getElementById('btnPlayAgain')?.addEventListener('click', () => {
      this.closeAllModals();
      this.startNewGame(this.currentImageUrl, this.currentTitle, this.cols, this.rows);
    });

    document.getElementById('btnNextGallery')?.addEventListener('click', () => {
      this.closeAllModals();
      const nextImg = this.gallery.getRandomNextImage(this.currentImageUrl);
      this.startNewGame(nextImg.url, nextImg.title, this.cols, this.rows);
    });
  }

  launchConfetti() {
    const canvas = this.confettiCanvas;
    const ctx = canvas.getContext('2d');
    const particles = [];
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b'];

    for (let i = 0; i < 120; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.7) * 16,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rSpeed: (Math.random() - 0.5) * 10
      });
    }

    let frame = 0;
    const renderConfetti = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35;
        p.rotation += p.rSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });

      frame++;
      if (frame < 180) {
        requestAnimationFrame(renderConfetti);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    renderConfetti();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new JigsawApp();
});
