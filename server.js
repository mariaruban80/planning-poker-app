import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Needed because __dirname is not available in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let rooms = {}; // Store rooms and users

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  // When a user joins a room
  socket.on('joinRoom', ({ roomId, userName }) => {
    currentRoom = roomId;
    currentUser = userName;

    console.log(`User ${userName} joined room ${roomId}`);

    if (!rooms[currentRoom]) {
      rooms[currentRoom] = { users: [], votes: {}, story: [], revealed: false };
    }

    rooms[currentRoom].users.push({ id: socket.id, name: userName });

    // Emit the updated user list to all clients
    io.to(currentRoom).emit('userList', rooms[currentRoom].users);
    socket.join(currentRoom);
  });

  // When a story is selected
  socket.on('storySelected', ({ storyIndex }) => {
    if (rooms[currentRoom] && rooms[currentRoom].story) {
      io.to(currentRoom).emit('storySelected', { storyIndex });
    }
  });

  // When a vote is cast
  socket.on('castVote', ({ vote }) => {
    if (rooms[currentRoom]) {
      rooms[currentRoom].votes[socket.id] = vote;
      io.to(currentRoom).emit('voteUpdate', { userId: socket.id, vote });
    }
  });

  // Reveal all votes
  socket.on('revealVotes', () => {
    if (rooms[currentRoom]) {
      io.to(currentRoom).emit('revealVotes', rooms[currentRoom].votes);
    }
  });

  // Sync CSV Data
  socket.on('syncCSVData', (csvData) => {
    if (rooms[currentRoom]) {
      rooms[currentRoom].story = csvData;
      io.to(currentRoom).emit('syncCSVData', csvData);
    }
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].users = rooms[currentRoom].users.filter(user => user.id !== socket.id);
      io.to(currentRoom).emit('userList', rooms[currentRoom].users);
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
