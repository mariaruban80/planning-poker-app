import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup Express
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for all unknown routes (important for /room/:id)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection handling
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

        // Send current users list to the new client
        ws.send(JSON.stringify({ type: 'userList', users: room.users }));

        break;

      case 'addUser':
        if (roomId && rooms.has(roomId)) {
          const room = rooms.get(roomId);
          if (!room.users.includes(parsed.user)) {
            room.users.push(parsed.user);
          }
          // Broadcast updated user list
          broadcast(roomId, { type: 'userList', users: room.users });
        }
        break;

      case 'vote':
      case 'revealVotes':
      case 'resetVotes':
      case 'storyChange':
        if (roomId) {
          broadcast(roomId, parsed);
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
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

function broadcast(roomId, data) {
  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    room.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify(data));
      }
    });
  }
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
