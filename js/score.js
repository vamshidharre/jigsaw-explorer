/* ==========================================================================
   Jigsaw Explorer - Points System & High Score Leaderboard Module
   ========================================================================== */

class FloatingScoreText {
  constructor(x, y, text, color = '#6366f1') {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.alpha = 1.0;
    this.scale = 1.2;
    this.life = 60; // frames (~1 sec)
  }

  update() {
    this.y -= 1.2; // Float upwards
    this.life--;
    this.alpha = Math.max(0, this.life / 60);
    if (this.scale > 1.0) {
      this.scale -= 0.02;
    }
  }

  draw(ctx) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);

    ctx.font = '800 18px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';

    // Text Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillText(this.text, 2, 2);

    // Text Fill
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, 0, 0);

    ctx.restore();
  }
}

class ScoreEngine {
  constructor(app) {
    this.app = app;
    this.score = 0;
    this.comboCount = 0;
    this.comboTimer = null;
    this.floatingTexts = [];
    
    // Multipliers
    this.difficultyMultipliers = {
      6: 1.0,
      12: 1.2,
      24: 1.5,
      40: 1.8,
      60: 2.0,
      96: 2.5,
      150: 3.0
    };

    this.init();
  }

  init() {
    this.resetScore();
  }

  resetScore() {
    this.score = 0;
    this.comboCount = 0;
    clearTimeout(this.comboTimer);
    this.floatingTexts = [];
    this.updateScoreUI();
  }

  getMultiplier() {
    const pieceCount = this.app.cols * this.app.rows;
    const baseMult = this.difficultyMultipliers[pieceCount] || 1.5;
    
    // Combo multiplier: 1x, 1.5x, 2x, 2.5x, 3x
    const comboMult = 1 + Math.min(2.0, (this.comboCount - 1) * 0.5);
    return baseMult * comboMult;
  }

  addSnapPoints(snapType, worldX, worldY, pieceCount = 1) {
    // Increment combo streak
    this.comboCount++;
    clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => {
      this.comboCount = 0; // Reset combo if no snap for 4 seconds
    }, 4000);

    const mult = this.getMultiplier();
    let base = snapType === 'board' ? 100 : 50;
    base *= pieceCount;

    const earned = Math.round(base * mult);
    this.score += earned;

    // Trigger Floating Text on Canvas
    let textStr = `+${earned} PTS`;
    let color = snapType === 'board' ? '#10b981' : '#6366f1';

    if (this.comboCount > 1) {
      textStr = `+${earned} (${this.comboCount}x COMBO!)`;
      color = '#f59e0b';
    }

    this.floatingTexts.push(new FloatingScoreText(worldX, worldY, textStr, color));
    this.updateScoreUI();

    // Broadcast score to multiplayer
    if (window.multiplayerClient && window.multiplayerClient.isConnected) {
      window.multiplayerClient.send('score_update', {
        score: this.score
      });
    }
  }

  calculateFinalBonus(secondsElapsed) {
    const pieceCount = this.app.cols * this.app.rows;
    // Speed bonus: up to 1000 pts minus 2 pts per second
    const speedBonus = Math.max(0, 1000 - (secondsElapsed * 2));
    const difficultyBonus = pieceCount * 20;

    const totalFinalScore = this.score + speedBonus + difficultyBonus;
    return {
      baseScore: this.score,
      speedBonus: speedBonus,
      difficultyBonus: difficultyBonus,
      totalFinalScore: totalFinalScore
    };
  }

  updateScoreUI() {
    const el = document.getElementById('scoreDisplay');
    if (el) {
      el.textContent = `${this.score.toLocaleString()} PTS`;
    }
  }

  updateFloatingTexts(ctx) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.update();
      ft.draw(ctx);
      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  saveHighScore(playerName, title, pieceCount, secondsElapsed, finalScore) {
    const key = 'jigsaw_high_scores';
    let scores = [];
    try {
      scores = JSON.parse(localStorage.getItem(key)) || [];
    } catch (e) {
      scores = [];
    }

    const entry = {
      id: Date.now(),
      name: playerName || 'Player',
      title: title,
      pieces: pieceCount,
      time: secondsElapsed,
      score: finalScore,
      date: new Date().toLocaleDateString()
    };

    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 15); // Top 15

    localStorage.setItem(key, JSON.stringify(scores));
    return scores;
  }

  getHighScores() {
    try {
      return JSON.parse(localStorage.getItem('jigsaw_high_scores')) || [];
    } catch (e) {
      return [];
    }
  }
}
