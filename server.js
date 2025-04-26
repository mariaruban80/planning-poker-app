// server.js
const WebSocket = require('ws'); // Import WebSocket package

const wss = new WebSocket.Server({ port: 8080 }); // Create a WebSocket server on port 8080

const rooms = {}; // In-memory room data storage

// Handle WebSocket connections
wss.on('connection', (ws) => {
  let currentRoomId = null;
  let userName = null;

  // Send a message to the client when connected
  ws.send(JSON.stringify({ message: 'Welcome to the planning poker app!' }));

  // Handle incoming messages from clients
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
        // Update vote in the current room
        if (currentRoomId) {
          rooms[currentRoomId].votes[msg.user] = msg.vote;
          broadcastRoomData(currentRoomId);
        }
        break;

      case 'ping':
        // Respond to ping to keep connection alive
        ws.send(JSON.stringify({ type: 'ping' }));
        break;

      case 'resetVotes':
        if (currentRoomId) {
          rooms[currentRoomId].votes = {}; // Reset all votes
          broadcastRoomData(currentRoomId);
        }
        break;

      default:
        console.log('Unknown message type:', msg.type);
    }
  });

  // Handle WebSocket close event
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
    // Send room data to all users in the room
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(roomData));
      }
    });
  }
}

console.log('WebSocket server started on ws://localhost:8080');
