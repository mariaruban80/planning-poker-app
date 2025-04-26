const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Store votes per room
const roomVotes = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join room
  socket.on('joinRoom', (roomId, username) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    if (!roomVotes[roomId]) {
      roomVotes[roomId] = {};
    }

    console.log(`${username} joined room ${roomId}`);
    io.to(roomId).emit('userJoined', `${username} has joined the room.`);
  });

  // Handle user vote
  socket.on('vote', (vote) => {
    const roomId = socket.roomId;
    const username = socket.username;

    if (roomId && username) {
      roomVotes[roomId][username] = vote;

      // Broadcast updated votes to the room
      io.to(roomId).emit('updateVotes', roomVotes[roomId]);
    }
  });

  // Reset votes for a room
  socket.on('resetVotes', () => {
    const roomId = socket.roomId;

    if (roomId && roomVotes[roomId]) {
      roomVotes[roomId] = {};
      io.to(roomId).emit('updateVotes', {});
    }
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const username = socket.username;

    if (roomId && username && roomVotes[roomId]) {
      delete roomVotes[roomId][username];
      io.to(roomId).emit('userLeft', `${username} has left the room.`);
      io.to(roomId).emit('updateVotes', roomVotes[roomId]);
    }

    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
