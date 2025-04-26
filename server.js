// server.js
const http = require('http');
const WebSocket = require('ws');

// Create an HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Planning Poker Server');
});

// Create WebSocket server using the HTTP server
const wss = new WebSocket.Server({ server });

const rooms = {}; // In-memory room data storage

// Handle WebSocket connections
wss.on('connection', (ws) => {
  let currentRoomId = null;
  let userName = null;

  ws.on('message', (message) => {
    const msg = JSON.parse(message);

    switch (msg.type) {
      case 'join':
        userName = msg.user;
        currentRoomId = msg.roomId;
        if (!rooms[currentRoomId]) {
          rooms[currentRoomId] = { users: [], votes: {} };
        }
        rooms[currentRoomId].users.push(userName);
        broadcastRoomData(currentRoomId);
        break;

      case 'vote':
        if (currentRoomId) {
          rooms[currentRoomId].votes[msg.user] = msg.vote;
          broadcastRoomData(currentRoomId);
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'ping' }));
        break;

      case 'resetVotes':
        if (currentRoomId) {
          rooms[currentRoomId].votes = {};
          broadcastRoomData(currentRoomId);
        }
        break;

      default:
        console.log('Unknown message type:', msg.type);
    }
  });

  ws.on('close', () => {
    if (currentRoomId && userName) {
      const room = rooms[currentRoomId];
      if (room) {
        room.users = room.users.filter(user => user !== userName);
        broadcastRoomData(currentRoomId);
      }
    }
  });
});

// Broadcast room data to all clients in the room
function broadcastRoomData(roomId) {
  const room = rooms[roomId];
  if (room) {
    const roomData = {
      type: 'userList',
      users: room.users,
      votes: room.votes,
    };
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(roomData));
      }
    });
  }
}

// Listen on port 8080
server.listen(8080, () => {
  console.log('Server listening on http://localhost:8080');
});
