import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins, or restrict it for production
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// Store rooms data
const rooms = {};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  let currentRoom = null;
  let currentUser = null;

  // Retrieve roomId and userName from the query parameters
  const { roomId, userName } = socket.handshake.query;

  // Validate roomId and userName
  if (!roomId || !userName) {
    console.error('Room ID or User Name missing in the connection request.');
    socket.disconnect();
    return;
  }

  // When a client joins a room
  socket.on('joinRoom', () => {
    console.log(`User ${userName} joined room ${roomId}`);

    currentRoom = roomId;
    currentUser = userName;

    // Initialize room if not already existing
    if (!rooms[currentRoom]) {
      rooms[currentRoom] = { users: [], votes: {}, story: '', revealed: false };
    }

    // Add user to the room's user list
    rooms[currentRoom].users.push({ id: socket.id, name: userName });

    // Emit user list to the room
    io.to(currentRoom).emit('userList', { users: rooms[currentRoom].users });

    // Emit CSV data to the user
    socket.emit('syncCSVData', { csvData: rooms[currentRoom].csvData || [] });
  });

  // Handling vote updates from client
  socket.on('castVote', ({ vote }) => {
    if (currentRoom && currentUser) {
      rooms[currentRoom].votes[socket.id] = vote;
      io.to(currentRoom).emit('voteUpdate', { userId: socket.id, vote });
    }
  });

  // Emit votes reveal to the room
  socket.on('revealVotes', () => {
    if (currentRoom) {
      io.to(currentRoom).emit('revealVotes', rooms[currentRoom].votes);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (currentRoom && currentUser) {
      rooms[currentRoom].users = rooms[currentRoom].users.filter(user => user.id !== socket.id);
      io.to(currentRoom).emit('userList', { users: rooms[currentRoom].users });
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
