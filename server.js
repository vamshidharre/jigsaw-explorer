/* ==========================================================================
   Jigsaw Explorer - Express & WebSocket Real-Time Multiplayer Server
   ========================================================================== */

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Server: WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const FEEDBACK_FILE = path.join(__dirname, 'feedback.json');
const FEEDBACK_TXT = path.join(__dirname, 'feedback.txt');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS for API requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(path.join(__dirname)));

function getFeedbacksFromFile() {
  if (fs.existsSync(FEEDBACK_FILE)) {
    try {
      const data = fs.readFileSync(FEEDBACK_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveFeedback(playerName, text) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const name = playerName || 'Anonymous';
  const cleanMessage = text.replace(/[\r\n]+/g, ' ');

  const logLine = `[${timestamp}] [${name}]: ${cleanMessage}\n`;
  fs.appendFileSync(FEEDBACK_TXT, logLine);

  const feedbackList = getFeedbacksFromFile();
  const entry = {
    id: Date.now(),
    timestamp,
    name,
    message: cleanMessage
  };
  feedbackList.push(entry);
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedbackList, null, 2));

  console.log(`[FEEDBACK LOGGED] ${logLine.trim()}`);
  return entry;
}

// GET API Endpoint to read all submitted user feedback line-by-line
app.get('/api/feedback', (req, res) => {
  if (req.query.format === 'json') {
    return res.json(getFeedbacksFromFile());
  }

  if (fs.existsSync(FEEDBACK_TXT)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(fs.readFileSync(FEEDBACK_TXT, 'utf8'));
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('No feedback recorded yet.\n');
});

// GET /api/feedback/clear to wipe the feedback log
app.get('/api/feedback/clear', (req, res) => {
  try {
    fs.writeFileSync(FEEDBACK_FILE, '[]');
    fs.writeFileSync(FEEDBACK_TXT, '# Jigsaw Explorer Player Feedback Log\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('Feedback log cleared successfully! Future player submissions will appear line-by-line.\n');
  } catch (e) {
    res.status(500).send('Error clearing feedback log.\n');
  }
});

// POST API Endpoint to submit user feedback
app.post('/api/feedback', (req, res) => {
  const { playerName, message } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Feedback message cannot be empty' });
  }

  const entry = saveFeedback(playerName, message.trim());
  res.json({ success: true, entry });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

const CURSOR_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#f97316'
];

function getRandomColor() {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
}

function broadcastToRoom(roomId, message, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const jsonStr = JSON.stringify(message);
  room.players.forEach((player) => {
    if (player.ws !== excludeWs && player.ws.readyState === 1) {
      player.ws.send(jsonStr);
    }
  });
}

function getSanitizedPlayers(room) {
  const result = [];
  room.players.forEach((p) => {
    result.push({
      id: p.id,
      name: p.name,
      color: p.color,
      cursorX: p.cursorX,
      cursorY: p.cursorY,
      isHost: p.isHost
    });
  });
  return result;
}

wss.on('connection', (ws) => {
  let clientRoomId = null;
  let clientId = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      const { type, payload } = data;

      switch (type) {
        case 'join_room': {
          const { roomId, playerName, puzzleState, maxPlayers } = payload;

          let room = rooms.get(roomId);
          const isFirstPlayer = !room;

          // Check if room is full
          if (room && room.maxPlayers > 0 && room.players.size >= room.maxPlayers) {
            ws.send(JSON.stringify({
              type: 'room_full',
              payload: { maxPlayers: room.maxPlayers }
            }));
            return;
          }

          clientRoomId = roomId;
          clientId = 'user_' + Math.random().toString(36).substring(2, 9);

          if (!room) {
            room = {
              id: roomId,
              maxPlayers: maxPlayers || 0,
              imageUrl: puzzleState ? puzzleState.imageUrl : '',
              title: puzzleState ? puzzleState.title : 'Shared Puzzle',
              cols: puzzleState ? puzzleState.cols : 6,
              rows: puzzleState ? puzzleState.rows : 4,
              rotationEnabled: puzzleState ? puzzleState.rotationEnabled : false,
              pieces: puzzleState ? puzzleState.pieces : [],
              players: new Map(),
              secondsElapsed: 0
            };
            rooms.set(roomId, room);
          } else if (maxPlayers && isFirstPlayer) {
            room.maxPlayers = maxPlayers;
          }

          const player = {
            id: clientId,
            name: playerName || `Player ${room.players.size + 1}`,
            color: getRandomColor(),
            cursorX: 0,
            cursorY: 0,
            isHost: isFirstPlayer,
            ws: ws
          };

          room.players.set(clientId, player);

          ws.send(JSON.stringify({
            type: 'room_init',
            payload: {
              selfId: clientId,
              isHost: player.isHost,
              color: player.color,
              maxPlayers: room.maxPlayers,
              imageUrl: room.imageUrl,
              title: room.title,
              cols: room.cols,
              rows: room.rows,
              rotationEnabled: room.rotationEnabled,
              pieces: room.pieces,
              players: getSanitizedPlayers(room)
            }
          }));

          broadcastToRoom(roomId, {
            type: 'player_joined',
            payload: {
              player: {
                id: player.id,
                name: player.name,
                color: player.color,
                cursorX: player.cursorX,
                cursorY: player.cursorY,
                isHost: player.isHost
              },
              players: getSanitizedPlayers(room)
            }
          }, ws);

          break;
        }

        case 'update_room_capacity': {
          if (!clientRoomId || !clientId) return;
          const room = rooms.get(clientRoomId);
          if (room) {
            const player = room.players.get(clientId);
            if (!player || !player.isHost) return;

            room.maxPlayers = payload.maxPlayers || 0;
            broadcastToRoom(clientRoomId, {
              type: 'capacity_updated',
              payload: { maxPlayers: room.maxPlayers }
            });
          }
          break;
        }

        case 'cursor_move': {
          if (!clientRoomId || !clientId) return;
          const room = rooms.get(clientRoomId);
          if (!room) return;

          const player = room.players.get(clientId);
          if (player) {
            player.cursorX = payload.x;
            player.cursorY = payload.y;

            broadcastToRoom(clientRoomId, {
              type: 'cursor_update',
              payload: {
                playerId: clientId,
                x: payload.x,
                y: payload.y
              }
            }, ws);
          }
          break;
        }

        case 'piece_drag': {
          if (!clientRoomId) return;
          broadcastToRoom(clientRoomId, {
            type: 'piece_drag_update',
            payload: {
              playerId: clientId,
              pieceIds: payload.pieceIds,
              dx: payload.dx,
              dy: payload.dy
            }
          }, ws);
          break;
        }

        case 'piece_snap': {
          if (!clientRoomId) return;
          const room = rooms.get(clientRoomId);
          if (room) {
            if (payload.piecesState) {
              room.pieces = payload.piecesState;
            }

            broadcastToRoom(clientRoomId, {
              type: 'piece_snap_update',
              payload: {
                playerId: clientId,
                piecesState: payload.piecesState,
                snapType: payload.snapType
              }
            }, ws);
          }
          break;
        }

        case 'new_puzzle': {
          if (!clientRoomId) return;
          const room = rooms.get(clientRoomId);
          if (room) {
            const player = room.players.get(clientId);
            if (!player || !player.isHost) return;

            room.imageUrl = payload.imageUrl;
            room.title = payload.title;
            room.cols = payload.cols;
            room.rows = payload.rows;
            room.rotationEnabled = payload.rotationEnabled;
            room.pieces = payload.pieces;

            broadcastToRoom(clientRoomId, {
              type: 'puzzle_reset',
              payload: {
                imageUrl: room.imageUrl,
                title: room.title,
                cols: room.cols,
                rows: room.rows,
                rotationEnabled: room.rotationEnabled,
                pieces: room.pieces
              }
            });
          }
          break;
        }

        case 'submit_feedback': {
          const { playerName, text } = payload;
          if (text && text.trim()) {
            const entry = saveFeedback(playerName, text.trim());
            ws.send(JSON.stringify({
              type: 'feedback_response',
              payload: { success: true, entry }
            }));
          }
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (clientRoomId && clientId) {
      const room = rooms.get(clientRoomId);
      if (room) {
        const leavingPlayer = room.players.get(clientId);
        const wasHost = leavingPlayer ? leavingPlayer.isHost : false;
        
        room.players.delete(clientId);

        if (room.players.size === 0) {
          rooms.delete(clientRoomId);
        } else {
          if (wasHost) {
            const nextHostKey = room.players.keys().next().value;
            const newHost = room.players.get(nextHostKey);
            if (newHost) {
              newHost.isHost = true;
            }
          }

          broadcastToRoom(clientRoomId, {
            type: 'player_left',
            payload: {
              playerId: clientId,
              players: getSanitizedPlayers(room)
            }
          });
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Jigsaw Explorer Server running at http://localhost:${PORT}`);
});
