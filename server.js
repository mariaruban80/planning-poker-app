// server.js

import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// For any unknown route, serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start HTTP server
const server = app.listen(process.env.PORT || 3000, () => {
  console.log(`Server listening`);
});

// Setup WebSocket
const wss = new WebSocketServer({ server });
const rooms = new Map();

function broadcast(roomId, data) {
  if (!rooms.has(roomId)) return;
  const room = rooms.get(roomId);
  room.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws) => {
  let roomId = null;

  ws.on('message', (message) => {
    const parsed = JSON.parse(message);

    switch (parsed.type) {
      case 'join':
        roomId = parsed.roomId;
        if (!rooms.has(roomId)) {
          rooms.set(roomId, { clients: [], users: [] });
        }
        const room = rooms.get(roomId);
        room.clients.push(ws);
        if (!room.users.includes(parsed.user)) {
          room.users.push(parsed.user);
        }
        broadcast(roomId, { type: 'userList', users: room.users });
        break;

      case 'addUser':
        if (roomId && rooms.has(roomId)) {
          const room = rooms.get(roomId);
          if (!room.users.includes(parsed.user)) {
            room.users.push(parsed.user);
            broadcast(roomId, { type: 'userList', users: room.users });
          }
        }
        break;

      case 'vote':
        broadcast(roomId, { type: 'voteUpdate', story: parsed.story, votes: { [parsed.user]: parsed.vote } });
        break;

      case 'revealVotes':
        broadcast(roomId, { type: 'revealVotes' });
        break;

      case 'resetVotes':
        broadcast(roomId, { type: 'resetVotes' });
        break;

      default:
        console.warn('Unknown message type:', parsed.type);
    }
  });

  ws.on('close', () => {
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.clients = room.clients.filter(client => client !== ws);
      if (room.clients.length === 0) {
        rooms.delete(roomId);
      }
    }
  });
});
