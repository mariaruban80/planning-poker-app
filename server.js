const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

// Store rooms and their connected clients
const rooms = {};

// Create an Express app
const app = express();

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Create an HTTP server
const server = http.createServer(app);

// Attach WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    try {
      const msg = JSON.parse(message);
      const { type, user, roomId, ...rest } = msg;

      if (type === 'join') {
        ws.user = user;
        ws.roomId = roomId;

        if (!rooms[roomId]) rooms[roomId] = [];
        rooms[roomId] = rooms[roomId].filter(client => client.user !== user);
        rooms[roomId].push(ws);

        broadcastToRoom(roomId, {
          type: 'userList',
          users: rooms[roomId].map(client => client.user),
        });

        broadcastToRoom(roomId, {
          type: 'userJoined',
          user
        });
      }

      if (['voteUpdate', 'storyChange'].includes(type)) {
        broadcastToRoom(roomId, { type, user, ...rest });
      }

      if (type === 'revealVotes') {
        broadcastToRoom(roomId, { type });
      }

      if (type === 'resetVotes') {
        broadcastToRoom(roomId, { type, story: rest.story });
      }

    } catch (e) {
      console.error('Invalid message:', message);
    }
  });

  ws.on('close', () => {
    const roomId = ws.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(client => client !== ws);
      broadcastToRoom(roomId, {
        type: 'userList',
        users: rooms[roomId].map(client => client.user),
      });
    }
  });
});

// Function to broadcast to all clients in a room
function broadcastToRoom(roomId, message) {
  if (!rooms[roomId]) return;
  const data = JSON.stringify(message);
  rooms[roomId].forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// ✅ Required for Render deployment
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
