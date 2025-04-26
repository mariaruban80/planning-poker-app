// server.js

import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup
const app = express();
const PORT = process.env.PORT || 3000;

// Correct __dirname usage with ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from public
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for SPA routing (if needed)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

const rooms = {}; // { roomId: { users: [{user, userId}], votes: {}, selectedStory: '' } }

// Helper: broadcast to all in room
function broadcastToRoom(roomId, message) {
  const msgString = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN && client.roomId === roomId) {
      client.send(msgString);
    }
  });
}

// Helper: send only to one client
function sendToUser(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

// WebSocket connection handler
wss.on('connection', (socket) => {
  console.log('Client connected.');

  socket.on('message', (data) => {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'join': {
        const { roomId, user, userId } = msg;
        socket.roomId = roomId;
        socket.userName = user;
        socket.userId = userId;

        if (!rooms[roomId]) {
          rooms[roomId] = { users: [], votes: {}, selectedStory: null };
        }

        if (!rooms[roomId].users.find(u => u.userId === userId)) {
          rooms[roomId].users.push({ user, userId });
        }

        // Send updated user list to everyone
        broadcastToRoom(roomId, {
          type: 'userList',
          users: rooms[roomId].users.map(u => u.user)
        });

        // Send selected story if exists
        if (rooms[roomId].selectedStory) {
          sendToUser(socket, {
            type: 'storyChange',
            story: rooms[roomId].selectedStory
          });
        }

        // Send existing votes if any
        if (rooms[roomId].selectedStory && rooms[roomId].votes[rooms[roomId].selectedStory]) {
          sendToUser(socket, {
            type: 'voteUpdate',
            story: rooms[roomId].selectedStory,
            votes: rooms[roomId].votes[rooms[roomId].selectedStory]
          });
        }
        break;
      }

      case 'vote': {
        const { story, vote } = msg;
        const room = rooms[socket.roomId];
        if (room) {
          if (!room.votes[story]) {
            room.votes[story] = {};
          }
          room.votes[story][socket.userName] = vote;

          broadcastToRoom(socket.roomId, {
            type: 'voteUpdate',
            story: story,
            votes: room.votes[story]
          });
        }
        break;
      }

      case 'storyChange': {
        const { story } = msg;
        const room = rooms[socket.roomId];
        if (room) {
          room.selectedStory = story;
          room.votes[story] = {}; // Reset votes for new story

          broadcastToRoom(socket.roomId, {
            type: 'storyChange',
            story: story
          });
        }
        break;
      }

      case 'revealVotes':
        broadcastToRoom(socket.roomId, { type: 'revealVotes' });
        break;

      case 'resetVotes': {
        const room = rooms[socket.roomId];
        if (room && room.selectedStory) {
          room.votes[room.selectedStory] = {};

          broadcastToRoom(socket.roomId, {
            type: 'resetVotes'
          });
        }
        break;
      }

        case 'addUser':
  {
    const { user } = parsedMessage;
    const room = rooms.get(roomId);
    if (room && !room.users.includes(user)) {
      room.users.push(user);

      // Broadcast updated user list
      broadcast(roomId, {
        type: 'userList',
        users: room.users,
      });
    }
  }
  break;


      case 'ping':
        // Optional: Keep-alive ping
        break;

      default:
        console.warn('Unknown message type received:', msg.type);
    }
  });

  socket.on('close', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u.userId !== socket.userId);

      broadcastToRoom(roomId, {
        type: 'userList',
        users: rooms[roomId].users.map(u => u.user)
      });

      console.log(`Client disconnected from room ${roomId}.`);
    }
  });
});
