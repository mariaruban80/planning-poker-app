const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const app = express();

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Create an HTTP server
const server = app.listen(8080, () => {
  console.log('Server running on http://localhost:8080');
});

// WebSocket server setup
const wss = new WebSocket.Server({ server });

const rooms = {}; // In-memory room data storage

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
          rooms[currentRoomId] = { tasks: [], users: [], votes: {} };
        }
        rooms[currentRoomId].users.push(userName);
        broadcastRoomData(currentRoomId);
        break;

      case 'vote':
        if (currentRoomId) {
          const taskId = msg.taskId;
          if (!rooms[currentRoomId].votes[taskId]) {
            rooms[currentRoomId].votes[taskId] = {};
          }
          rooms[currentRoomId].votes[taskId][msg.user] = msg.vote;
          broadcastRoomData(currentRoomId);
        }
        break;

      case 'addTask':
        if (currentRoomId) {
          rooms[currentRoomId].tasks.push(msg.task);
          broadcastRoomData(currentRoomId);
        }
        break;

      case 'selectTask':
        if (currentRoomId) {
          rooms[currentRoomId].selectedTask = msg.taskId;
          broadcastRoomData(currentRoomId);
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'ping' }));
        break;

      case 'resetVotes':
        if (currentRoomId) {
          rooms[currentRoomId].votes = {}; // Reset all votes for the room
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
      type: 'roomData',
      users: room.users,
      tasks: room.tasks,
      votes: room.votes,
      selectedTask: room.selectedTask,
    };
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(roomData));
      }
    });
  }
}

