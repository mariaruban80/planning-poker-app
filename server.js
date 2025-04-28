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

  // Wait for client to send roomId and userName
  socket.on('joinRoom', ({ roomId, userName }) => {
    console.log(`User ${userName} joined room ${roomId}`);

    currentRoom = roomId;
    currentUser = userName;

    // Initialize room if not already existing
    if (!rooms[currentRoom]) {
      rooms[currentRoom] = { users: {}, votes: {}, story: '', revealed: false };
    }

    // Save user to the room with their socket ID
    rooms[currentRoom].users[socket.id] = currentUser;

    socket.join(currentRoom);

    // Send updated users list to everyone in the room
    sendUserList(currentRoom);

    // If a story is already selected, send it to the new user
    if (rooms[currentRoom].story) {
      socket.emit('storyChange', { story: rooms[currentRoom].story });
    }
  });

  // Handle voting
  socket.on('vote', ({ story, vote }) => {
    if (currentRoom && currentUser) {
      const room = rooms[currentRoom];
      if (!room.votes[story]) {
        room.votes[story] = {};
      }
      room.votes[story][currentUser] = vote;

      io.to(currentRoom).emit('voteUpdate', { story, votes: room.votes[story] });
    }
  });

  // Handle story change
  socket.on('storyChange', ({ story }) => {
    if (currentRoom) {
      rooms[currentRoom].story = story;
      io.to(currentRoom).emit('storyChange', { story });
    }
  });

  // Handle reveal votes
  socket.on('revealVotes', () => {
    if (currentRoom) {
      rooms[currentRoom].revealed = true;
      io.to(currentRoom).emit('revealVotes', {});
    }
  });

  // Handle reset votes
  socket.on('resetVotes', () => {
    if (currentRoom) {
      const room = rooms[currentRoom];
      room.votes = {};
      room.revealed = false;
      io.to(currentRoom).emit('resetVotes', {});
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    if (currentRoom && currentUser) {
      const room = rooms[currentRoom];
      if (room && room.users[socket.id]) {
        delete room.users[socket.id];

        sendUserList(currentRoom);

        // Optionally: Delete empty rooms
        if (Object.keys(room.users).length === 0) {
          delete rooms[currentRoom];
        }
      }
    }
  });

  // Helper function to send updated user list
  function sendUserList(roomId) {
    const room = rooms[roomId];
    if (room) {
      const userList = Object.values(room.users); // Get array of usernames
      io.to(roomId).emit('userList', { users: userList });
    }
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
