/* ==========================================================================
   Jigsaw Explorer - Express & WebSocket Real-Time Multiplayer Server
   ========================================================================== */

const http = require('http');
const path = require('path');
const express = require('express');
const { Server: WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

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
          const { roomId, playerName, puzzleState } = payload;
          clientRoomId = roomId;
          clientId = 'user_' + Math.random().toString(36).substring(2, 9);

          let room = rooms.get(roomId);
          const isFirstPlayer = !room;

          if (!room) {
            room = {
              id: roomId,
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
            // Only host can reset puzzle
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
          // If host left, promote the next player to host
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
