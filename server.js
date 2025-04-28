const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let rooms = {}; // Store rooms and users

// Serve static files for the frontend
app.use(express.static('public'));

// Handle new socket connections
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  // When a user joins a room
  socket.on('joinRoom', ({ roomId, userName }) => {
    currentRoom = roomId;
    currentUser = userName;

    console.log(`User ${userName} joined room ${roomId}`);

    if (!rooms[currentRoom]) {
      rooms[currentRoom] = { users: [], votes: {}, story: '', revealed: false };
    }

    rooms[currentRoom].users.push({ id: socket.id, name: userName });

    // Emit the updated user list to all clients in the room
    io.to(currentRoom).emit('userList', { users: rooms[currentRoom].users });
  });

  // Handle story selection
  socket.on('storySelected', ({ storyIndex }) => {
    const story = rooms[currentRoom].story[storyIndex];
    io.to(currentRoom).emit('storySelected', { storyIndex });
  });

  // Handle vote updates
  socket.on('castVote', ({ vote }) => {
    rooms[currentRoom].votes[socket.id] = vote;
    io.to(currentRoom).emit('voteUpdate', { userId: socket.id, vote });
  });

  // Handle votes reveal
  socket.on('revealVotes', () => {
    io.to(currentRoom).emit('revealVotes', rooms[currentRoom].votes);
  });

  // Handle CSV data sync
  socket.on('syncCSVData', (csvData) => {
    rooms[currentRoom].story = csvData;
    io.to(currentRoom).emit('syncCSVData', csvData);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].users = rooms[currentRoom].users.filter(user => user.id !== socket.id);
      io.to(currentRoom).emit('userList', { users: rooms[currentRoom].users });
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
