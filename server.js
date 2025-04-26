// server.js (CommonJS version)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Route handling for all paths to serve index.html (for room-based URLs)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket logic
io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('join', ({ roomId, user }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { users: [], votes: {}, story: null };
    }
    rooms[roomId].users.push(user);
    io.to(roomId).emit('userList', { users: rooms[roomId].users });
  });

  socket.on('vote', ({ story, vote }) => {
    const roomId = [...socket.rooms][1];
    if (rooms[roomId]) {
      rooms[roomId].votes[socket.id] = vote;
      io.to(roomId).emit('voteUpdate', { story, votes: rooms[roomId].votes });
    }
  });

  socket.on('storyChange', ({ story }) => {
    const roomId = [...socket.rooms][1];
    if (rooms[roomId]) {
      rooms[roomId].story = story;
      io.to(roomId).emit('storyChange', { story });
    }
  });

  socket.on('revealVotes', () => {
    const roomId = [...socket.rooms][1];
    if (rooms[roomId]) {
      io.to(roomId).emit('revealVotes');
    }
  });

  socket.on('resetVotes', () => {
    const roomId = [...socket.rooms][1];
    if (rooms[roomId]) {
      rooms[roomId].votes = {};
      io.to(roomId).emit('resetVotes');
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.users = room.users.filter(user => user !== socket.id);
      if (room.users.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('userList', { users: room.users });
      }
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
