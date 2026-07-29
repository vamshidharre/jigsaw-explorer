/* ==========================================================================
   Jigsaw Explorer - Core Jigsaw Cut & Physics Engine
   ========================================================================== */

class JigsawPiece {
  constructor(id, col, row, width, height, edges, targetX, targetY, tabMargin) {
    this.id = id;
    this.col = col;
    this.row = row;
    this.width = width;
    this.height = height;
    this.edges = edges; // { top, right, bottom, left } (1=tab, -1=hole, 0=flat)
    this.targetX = targetX;
    this.targetY = targetY;
    this.tabMargin = tabMargin; // Extra canvas padding for tabs

    // Current position in world space
    this.x = targetX;
    this.y = targetY;
    
    this.rotation = 0; // 0, 90, 180, 270
    this.isLocked = false;
    this.isEdge = (edges.top === 0 || edges.right === 0 || edges.bottom === 0 || edges.left === 0);
    this.visible = true;

    // Grouping
    this.group = [this]; // List of pieces connected together

    // Generated vector path
    this.path = null;
  }

  containsPoint(ctx, px, py) {
    if (!this.visible) return false;
    ctx.save();
    ctx.translate(this.x, this.y);
    const inPath = ctx.isPointInPath(this.path, px, py);
    ctx.restore();
    return inPath;
  }
}

class JigsawEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Puzzle State
    this.cols = 6;
    this.rows = 4;
    this.pieces = [];
    this.image = null;
    
    // Board Rect
    this.boardX = 0;
    this.boardY = 0;
    this.boardWidth = 0;
    this.boardHeight = 0;

    // Viewport & Pan/Zoom
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    // Settings & Display
    this.ghostOpacity = 0.25;
    this.showGhost = true;
    this.showEdgesOnly = false;
    this.rotationEnabled = false;
    this.snapTolerance = 18; // px

    // Active Selection / Dragging
    this.activeGroup = null;
    this.dragOffset = { x: 0, y: 0 };
    this.isDragging = false;
    this.isPanning = false;
    this.lastMousePos = { x: 0, y: 0 };

    // Offscreen Canvas Cache
    this.pieceCanvases = new Map();
  }

  loadPuzzle(image, cols = 6, rows = 4, rotationEnabled = false) {
    this.image = image;
    this.cols = cols;
    this.rows = rows;
    this.rotationEnabled = rotationEnabled;
    this.pieceCanvases.clear();

    this.calculateBoardDimensions();
    this.generatePieces();
    this.scatterPieces();
  }

  calculateBoardDimensions() {
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    
    const maxW = vw * 0.65;
    const maxH = vh * 0.65;

    const imgAspect = this.image.width / this.image.height;
    let bW = maxW;
    let bH = maxW / imgAspect;

    if (bH > maxH) {
      bH = maxH;
      bW = maxH * imgAspect;
    }

    this.boardWidth = Math.round(bW);
    this.boardHeight = Math.round(bH);

    this.boardX = Math.round((vw - this.boardWidth) / 2);
    this.boardY = Math.round((vh - this.boardHeight) / 2);
  }

  generatePieces() {
    this.pieces = [];
    const pw = this.boardWidth / this.cols;
    const ph = this.boardHeight / this.rows;
    const tabMargin = Math.max(pw, ph) * 0.35;

    const horizEdges = Array.from({ length: this.rows - 1 }, () => 
      Array.from({ length: this.cols }, () => Math.random() < 0.5 ? 1 : -1)
    );

    const vertEdges = Array.from({ length: this.rows }, () => 
      Array.from({ length: this.cols - 1 }, () => Math.random() < 0.5 ? 1 : -1)
    );

    let id = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const edges = {
          top: r === 0 ? 0 : -horizEdges[r - 1][c],
          right: c === this.cols - 1 ? 0 : vertEdges[r][c],
          bottom: r === this.rows - 1 ? 0 : horizEdges[r][c],
          left: c === 0 ? 0 : -vertEdges[r][c - 1]
        };

        const targetX = this.boardX + c * pw;
        const targetY = this.boardY + r * ph;

        const piece = new JigsawPiece(id++, c, r, pw, ph, edges, targetX, targetY, tabMargin);
        piece.path = this.createPiecePath(pw, ph, edges);
        
        this.cachePieceImage(piece);

        this.pieces.push(piece);
      }
    }
  }

  createPiecePath(w, h, edges) {
    const path = new Path2D();
    path.moveTo(0, 0);

    this.drawJigsawEdge(path, 0, 0, w, 0, edges.top);
    this.drawJigsawEdge(path, w, 0, w, h, edges.right);
    this.drawJigsawEdge(path, w, h, 0, h, edges.bottom);
    this.drawJigsawEdge(path, 0, h, 0, 0, edges.left);

    path.closePath();
    return path;
  }

  drawJigsawEdge(path, x1, y1, x2, y2, tabDir) {
    if (tabDir === 0) {
      path.lineTo(x2, y2);
      return;
    }

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);

    const ux = dx / len;
    const uy = dy / len;

    const nx = -uy * tabDir;
    const ny = ux * tabDir;

    const tabSize = len * 0.2;
    const neckW = len * 0.1;
    const headW = len * 0.18;

    const p1x = x1 + ux * (len * 0.38 - neckW);
    const p1y = y1 + uy * (len * 0.38 - neckW);

    const p2x = x1 + ux * (len * 0.38);
    const p2y = y1 + uy * (len * 0.38);

    const p3x = x1 + ux * (len * 0.5 - headW) + nx * tabSize;
    const p3y = y1 + uy * (len * 0.5 - headW) + ny * tabSize;

    const p4x = x1 + ux * (len * 0.5 + headW) + nx * tabSize;
    const p4y = y1 + uy * (len * 0.5 + headW) + ny * tabSize;

    const p5x = x1 + ux * (len * 0.62);
    const p5y = y1 + uy * (len * 0.62);

    const p6x = x1 + ux * (len * 0.62 + neckW);
    const p6y = y1 + uy * (len * 0.62 + neckW);

    path.lineTo(p1x, p1y);

    path.bezierCurveTo(
      p2x + nx * (tabSize * 0.2), p2y + ny * (tabSize * 0.2),
      p3x - ux * (headW * 0.5), p3y - ny * (tabSize * 0.2),
      p3x, p3y
    );

    path.bezierCurveTo(
      p3x + ux * (headW * 0.8) + nx * (tabSize * 0.4), p3y + ny * (tabSize * 0.4),
      p4x - ux * (headW * 0.8) + nx * (tabSize * 0.4), p4y + ny * (tabSize * 0.4),
      p4x, p4y
    );

    path.bezierCurveTo(
      p4x + ux * (headW * 0.5), p4y - ny * (tabSize * 0.2),
      p5x + nx * (tabSize * 0.2), p5y + ny * (tabSize * 0.2),
      p6x, p6y
    );

    path.lineTo(x2, y2);
  }

  cachePieceImage(piece) {
    const offscreen = document.createElement('canvas');
    const margin = piece.tabMargin;
    offscreen.width = Math.ceil(piece.width + margin * 2);
    offscreen.height = Math.ceil(piece.height + margin * 2);
    const octx = offscreen.getContext('2d');

    octx.translate(margin, margin);

    octx.save();
    octx.clip(piece.path);

    const imgScaleX = this.image.width / this.boardWidth;
    const imgScaleY = this.image.height / this.boardHeight;

    const srcX = (piece.targetX - this.boardX) * imgScaleX;
    const srcY = (piece.targetY - this.boardY) * imgScaleY;
    const srcW = piece.width * imgScaleX;
    const srcH = piece.height * imgScaleY;

    octx.drawImage(
      this.image,
      srcX, srcY, srcW, srcH,
      0, 0, piece.width, piece.height
    );

    octx.restore();

    octx.save();
    octx.lineWidth = 2.5;
    octx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    octx.stroke(piece.path);
    octx.lineWidth = 1.5;
    octx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    octx.stroke(piece.path);
    octx.restore();

    this.pieceCanvases.set(piece.id, offscreen);
  }

  scatterPieces() {
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    const padding = 40;

    this.pieces.forEach(p => {
      if (p.isLocked) return;

      let rx, ry;
      const marginSide = Math.random() < 0.5 ? 'left' : 'right';
      
      if (marginSide === 'left') {
        rx = padding + Math.random() * Math.max(50, this.boardX - p.width - padding * 2);
      } else {
        rx = (this.boardX + this.boardWidth + padding) + Math.random() * Math.max(50, vw - (this.boardX + this.boardWidth) - p.width - padding * 2);
      }

      ry = padding + Math.random() * (vh - p.height - padding * 2);

      p.x = Math.max(padding, Math.min(vw - p.width - padding, rx));
      p.y = Math.max(padding, Math.min(vh - p.height - padding, ry));

      if (this.rotationEnabled) {
        p.rotation = Math.floor(Math.random() * 4) * 90;
      } else {
        p.rotation = 0;
      }
    });
  }

  toggleEdgeFilter(showEdgesOnly) {
    this.showEdgesOnly = showEdgesOnly;
    this.pieces.forEach(p => {
      if (!p.isLocked) {
        p.visible = showEdgesOnly ? p.isEdge : true;
      }
    });
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // 1. Target Puzzle Board
    this.drawBoard(ctx);

    // 2. Locked Pieces
    const lockedPieces = this.pieces.filter(p => p.isLocked);
    lockedPieces.forEach(p => this.drawPiece(ctx, p, false));

    // 3. Unlocked Floating Pieces
    const unlockedPieces = this.pieces.filter(p => !p.isLocked && p.visible);
    unlockedPieces.sort((a, b) => {
      const aActive = this.activeGroup && this.activeGroup.includes(a);
      const bActive = this.activeGroup && this.activeGroup.includes(b);
      return aActive ? 1 : bActive ? -1 : 0;
    });

    unlockedPieces.forEach(p => {
      const isActive = this.activeGroup && this.activeGroup.includes(p);
      this.drawPiece(ctx, p, isActive);
    });

    // 4. Remote Player Live Cursors
    this.drawRemoteCursors(ctx);

    ctx.restore();
  }

  drawBoard(ctx) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 12;

    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(this.boardX, this.boardY, this.boardWidth, this.boardHeight);
    ctx.restore();

    ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(this.boardX, this.boardY, this.boardWidth, this.boardHeight);

    if (this.showGhost && this.image) {
      ctx.save();
      ctx.globalAlpha = this.ghostOpacity;
      ctx.drawImage(this.image, this.boardX, this.boardY, this.boardWidth, this.boardHeight);
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const pw = this.boardWidth / this.cols;
    const ph = this.boardHeight / this.rows;
    for (let c = 1; c < this.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(this.boardX + c * pw, this.boardY);
      ctx.lineTo(this.boardX + c * pw, this.boardY + this.boardHeight);
      ctx.stroke();
    }
    for (let r = 1; r < this.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(this.boardX, this.boardY + r * ph);
      ctx.lineTo(this.boardX + this.boardWidth, this.boardY + r * ph);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPiece(ctx, piece, isActive) {
    if (!piece.visible) return;

    const cached = this.pieceCanvases.get(piece.id);
    if (!cached) return;

    ctx.save();
    ctx.translate(piece.x, piece.y);

    if (piece.rotation !== 0) {
      ctx.translate(piece.width / 2, piece.height / 2);
      ctx.rotate((piece.rotation * Math.PI) / 180);
      ctx.translate(-piece.width / 2, -piece.height / 2);
    }

    if (!piece.isLocked) {
      ctx.shadowColor = isActive ? 'rgba(99, 102, 241, 0.6)' : 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = isActive ? 16 : 8;
      ctx.shadowOffsetY = isActive ? 8 : 4;
    }

    ctx.drawImage(cached, -piece.tabMargin, -piece.tabMargin);
    ctx.restore();
  }

  drawRemoteCursors(ctx) {
    if (!window.multiplayerClient || !window.multiplayerClient.isConnected) return;

    const selfId = window.multiplayerClient.selfId;
    window.multiplayerClient.players.forEach(p => {
      if (p.id === selfId || !p.cursorX || !p.cursorY) return;

      ctx.save();
      ctx.translate(p.cursorX, p.cursorY);

      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 16);
      ctx.lineTo(4, 12);
      ctx.lineTo(9, 21);
      ctx.lineTo(12, 19);
      ctx.lineTo(7, 10);
      ctx.lineTo(14, 10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
      const textMetrics = ctx.measureText(p.name);
      const textW = textMetrics.width;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.roundRect(12, 14, textW + 12, 20, 6);
      ctx.fill();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.name, 18, 28);

      ctx.restore();
    });
  }

  getScreenToWorld(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (screenX - rect.left - this.panX) / this.zoom;
    const y = (screenY - rect.top - this.panY) / this.zoom;
    return { x, y };
  }

  findPieceAt(worldX, worldY) {
    const unlocked = this.pieces.filter(p => !p.isLocked && p.visible);
    for (let i = unlocked.length - 1; i >= 0; i--) {
      const p = unlocked[i];
      if (p.containsPoint(this.ctx, worldX, worldY)) {
        return p;
      }
    }
    return null;
  }

  startDrag(screenX, screenY) {
    const worldPos = this.getScreenToWorld(screenX, screenY);
    const piece = this.findPieceAt(worldPos.x, worldPos.y);

    if (piece) {
      this.isDragging = true;
      this.activeGroup = piece.group;
      this.dragOffset = {
        x: worldPos.x - piece.x,
        y: worldPos.y - piece.y
      };
      return piece;
    } else {
      this.isPanning = true;
      this.lastMousePos = { x: screenX, y: screenY };
      return null;
    }
  }

  drag(screenX, screenY) {
    if (this.isDragging && this.activeGroup) {
      const worldPos = this.getScreenToWorld(screenX, screenY);
      const leadPiece = this.activeGroup[0];

      const newLeadX = worldPos.x - this.dragOffset.x;
      const newLeadY = worldPos.y - this.dragOffset.y;

      const dx = newLeadX - leadPiece.x;
      const dy = newLeadY - leadPiece.y;

      this.activeGroup.forEach(p => {
        p.x += dx;
        p.y += dy;
      });

      if (window.multiplayerClient) {
        window.multiplayerClient.sendPieceDrag(this.activeGroup.map(gp => gp.id), dx, dy);
      }

    } else if (this.isPanning) {
      const dx = screenX - this.lastMousePos.x;
      const dy = screenY - this.lastMousePos.y;
      this.panX += dx;
      this.panY += dy;
      this.lastMousePos = { x: screenX, y: screenY };
    }
  }

  endDrag() {
    let result = { type: null, pieceCount: 0 };

    if (this.isDragging && this.activeGroup) {
      result = this.checkSnapping(this.activeGroup);
      this.activeGroup = null;
    }

    this.isDragging = false;
    this.isPanning = false;
    return result;
  }

  checkSnapping(group) {
    let snappedToBoard = false;
    let snappedToPiece = false;

    for (const p of group) {
      if (p.rotation !== 0) continue;
      const distToTarget = Math.hypot(p.x - p.targetX, p.y - p.targetY);

      if (distToTarget < this.snapTolerance) {
        const alignDx = p.targetX - p.x;
        const alignDy = p.targetY - p.y;

        group.forEach(gp => {
          gp.x += alignDx;
          gp.y += alignDy;
          gp.isLocked = true;
        });

        snappedToBoard = true;
        break;
      }
    }

    if (!snappedToBoard) {
      const otherPieces = this.pieces.filter(other => !group.includes(other));

      for (const p of group) {
        for (const other of otherPieces) {
          const isNeighbor = (Math.abs(p.col - other.col) + Math.abs(p.row - other.row)) === 1;

          if (isNeighbor && p.rotation === other.rotation) {
            const expectedDx = p.targetX - other.targetX;
            const expectedDy = p.targetY - other.targetY;

            const actualDx = p.x - other.x;
            const actualDy = p.y - other.y;

            const err = Math.hypot(actualDx - expectedDx, actualDy - expectedDy);

            if (err < this.snapTolerance) {
              const snapDx = (other.x + expectedDx) - p.x;
              const snapDy = (other.y + expectedDy) - p.y;

              group.forEach(gp => {
                gp.x += snapDx;
                gp.y += snapDy;
              });

              const mergedGroup = [...new Set([...group, ...other.group])];
              mergedGroup.forEach(gp => {
                gp.group = mergedGroup;
                if (other.isLocked) gp.isLocked = true;
              });

              snappedToPiece = true;
              break;
            }
          }
        }
        if (snappedToPiece) break;
      }
    }

    if (snappedToBoard) return { type: 'board', pieceCount: group.length };
    if (snappedToPiece) return { type: 'piece', pieceCount: group.length };
    return { type: null, pieceCount: 0 };
  }

  rotatePiece(piece) {
    if (!this.rotationEnabled || piece.isLocked) return;
    piece.group.forEach(p => {
      p.rotation = (p.rotation + 90) % 360;
    });
  }

  isCompleted() {
    if (this.pieces.length === 0) return false;
    const allLocked = this.pieces.every(p => p.isLocked);
    const allInOneGroup = this.pieces.every(p => p.group && p.group.length === this.pieces.length);
    
    if (allInOneGroup && !allLocked) {
      const lead = this.pieces[0];
      const alignDx = lead.targetX - lead.x;
      const alignDy = lead.targetY - lead.y;
      this.pieces.forEach(p => {
        p.x += alignDx;
        p.y += alignDy;
        p.isLocked = true;
      });
      return true;
    }
    return allLocked;
  }

  // Connected count calculates pieces that are locked OR joined in a connected group (>1)
  getConnectedCount() {
    return this.pieces.filter(p => p.isLocked || (p.group && p.group.length > 1)).length;
  }
}
