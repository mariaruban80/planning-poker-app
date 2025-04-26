const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = createServer(app);
const io = new Server(server);

const rooms = {}; // { roomId: { users: [], votes: {}, story: "" } }

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for any GET request
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join', ({ roomId, user }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { users: [], votes: {}, story: '' };
    }
    rooms[roomId].users.push(user);

    io.to(roomId).emit('userList', { users: rooms[roomId].users });
    console.log(`User ${user} joined room ${roomId}`);
  });

  socket.on('vote', ({ story, vote }) => {
    const roomId = getUserRoom(socket);
    if (roomId && rooms[roomId]) {
      if (!rooms[roomId].votes[story]) {
        rooms[roomId].votes[story] = {};
      }
      rooms[roomId].votes[story][socket.id] = vote;
      io.to(roomId).emit('voteUpdate', { story, votes: rooms[roomId].votes[story] });
    }
  });

  socket.on('storyChange', ({ story }) => {
    const roomId = getUserRoom(socket);
    if (roomId && rooms[roomId]) {
      rooms[roomId].story = story;
      io.to(roomId).emit('storyChange', { story });
    }
  });

  socket.on('revealVotes', () => {
    const roomId = getUserRoom(socket);
    if (roomId) {
      io.to(roomId).emit('revealVotes');
    }
  });

  socket.on('resetVotes', () => {
    const roomId = getUserRoom(socket);
    if (roomId && rooms[roomId]) {
      rooms[roomId].votes = {};
      io.to(roomId).emit('resetVotes');
    }
  });

  socket.on('disconnect', () => {
    const roomId = getUserRoom(socket);
    if (roomId && rooms[roomId]) {
      // Remove user from room
      rooms[roomId].users = rooms[roomId].users.filter(u => u !== socket.userName);
      io.to(roomId).emit('userList', { users: rooms[roomId].users });
    }
    console.log('Client disconnected:', socket.id);
  });

  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// Helper function
function getUserRoom(socket) {
  const roomsJoined = Array.from(socket.rooms).filter(r => r !== socket.id);
  return roomsJoined[0];
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
