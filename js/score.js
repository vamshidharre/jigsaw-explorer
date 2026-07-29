/* ==========================================================================
   Jigsaw Explorer - Scoring Engine & High Score Storage
   ========================================================================== */

class ScoreEngine {
  constructor(app) {
    this.app = app;
    this.score = 0;
    this.comboCount = 0;
    this.lastSnapTime = 0;
    this.floatingTexts = [];
    this.highScoresKey = 'jigsaw_high_scores';

    this.highScores = this.loadHighScores();
  }

  resetScore() {
    this.score = 0;
    this.comboCount = 0;
    this.lastSnapTime = 0;
    this.floatingTexts = [];
    this.updateScoreUI();
  }

  addSnapPoints(snapType, x, y, pieceCount = 1) {
    const now = Date.now();
    if (now - this.lastSnapTime < 4000) {
      this.comboCount++;
    } else {
      this.comboCount = 1;
    }
    this.lastSnapTime = now;

    let base = snapType === 'board' ? 100 : 50;
    let multiplier = Math.min(4, 1 + (this.comboCount - 1) * 0.5);

    const totalDiffMultiplier = this.getDifficultyMultiplier();
    const pointsAdded = Math.round(base * pieceCount * multiplier * totalDiffMultiplier);

    this.score += pointsAdded;
    this.updateScoreUI();

    let comboLabel = this.comboCount > 1 ? ` (${this.comboCount}x COMBO!)` : '';
    this.addFloatingText(`+${pointsAdded} PTS${comboLabel}`, x, y);

    return pointsAdded;
  }

  getDifficultyMultiplier() {
    const totalPieces = this.app.cols * this.app.rows;
    if (totalPieces >= 150) return 3.0;
    if (totalPieces >= 96) return 2.5;
    if (totalPieces >= 60) return 2.0;
    if (totalPieces >= 40) return 1.5;
    if (totalPieces >= 24) return 1.2;
    return 1.0;
  }

  updateScoreUI() {
    if (this.app.dom.scoreDisplay) {
      this.app.dom.scoreDisplay.textContent = `${this.score.toLocaleString()} PTS`;
    }
  }

  addFloatingText(text, x, y) {
    this.floatingTexts.push({
      text: text,
      x: x,
      y: y,
      alpha: 1.0,
      scale: 1.0,
      vy: -1.2,
      life: 0
    });
  }

  updateFloatingTexts(ctx) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const item = this.floatingTexts[i];
      item.life += 1;
      item.y += item.vy;
      item.alpha -= 0.015;
      item.scale += 0.005;

      if (item.alpha <= 0 || item.life > 60) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, item.alpha);
      ctx.font = 'bold 18px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#f59e0b';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillText(item.text, item.x - 20, item.y);
      ctx.restore();
    }
  }

  calculateFinalBonus(secondsElapsed) {
    const baseScore = this.score;
    const pieceCount = this.app.cols * this.app.rows;
    
    const parTime = pieceCount * 12;
    let speedBonus = 0;
    if (secondsElapsed < parTime) {
      speedBonus = Math.round((parTime - secondsElapsed) * 10 * this.getDifficultyMultiplier());
    }

    const difficultyBonus = Math.round(pieceCount * 25 * this.getDifficultyMultiplier());
    const totalFinalScore = baseScore + speedBonus + difficultyBonus;

    return {
      baseScore,
      speedBonus,
      difficultyBonus,
      totalFinalScore
    };
  }

  loadHighScores() {
    try {
      const raw = localStorage.getItem(this.highScoresKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  saveHighScore(playerName, title, pieces, time, score) {
    const newEntry = {
      id: Date.now(),
      name: playerName || 'Player 1',
      title: title,
      pieces: pieces,
      time: time,
      score: score,
      date: new Date().toLocaleDateString()
    };

    this.highScores.push(newEntry);
    this.highScores.sort((a, b) => b.score - a.score);
    this.highScores = this.highScores.slice(0, 15);

    try {
      localStorage.setItem(this.highScoresKey, JSON.stringify(this.highScores));
    } catch (e) {}

    return this.highScores;
  }

  clearHighScores() {
    this.highScores = [];
    try {
      localStorage.removeItem(this.highScoresKey);
    } catch (e) {}
    return [];
  }

  getHighScores() {
    return this.highScores;
  }
}
