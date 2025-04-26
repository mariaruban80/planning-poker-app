import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Store rooms data
const rooms = {};

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket connection
io.on('connection', (socket) => {
  let currentRoomId = null;

  // Join room event
  socket.on('joinRoom', (roomId, user) => {
    currentRoomId = roomId;

    // Initialize room if not exists
    if (!rooms[roomId]) {
      rooms[roomId] = { users: [] };
    }

    // Add user to room
    rooms[roomId].users.push(user);

    // Broadcast updated user list
    io.to(roomId).emit('userList', rooms[roomId].users);

    // Join the room in socket.io
    socket.join(roomId);

    console.log(`${user} joined room ${roomId}`);
  });

  // Handle disconnect event
  socket.on('disconnect', () => {
    if (currentRoomId) {
      const room = rooms[currentRoomId];
      if (room) {
        room.users = room.users.filter(user => user !== socket.user);
        // Broadcast updated user list
        io.to(currentRoomId).emit('userList', room.users);
      }
    }
  });

  // Handle other events here (e.g., votes, story changes)
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
