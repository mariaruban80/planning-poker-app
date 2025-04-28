import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// Store rooms data
const rooms = {};

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  let currentRoom = null;
  let currentUser = null;

  // Get roomId and userName from handshake
  const { roomId, userName } = socket.handshake.query;

  if (!roomId || !userName) {
    console.error('Missing roomId or userName');
    socket.disconnect();
    return;
  }

  currentRoom = roomId.trim();
  currentUser = userName.trim();

  // Initialize room if it doesn't exist
  if (!rooms[currentRoom]) {
    rooms[currentRoom] = {
      users: {},      // { socket.id: { id, name, vote } }
      story: '',
      csvData: [],
      selectedStoryIndex: null,
      revealed: false
    };
  }

  const room = rooms[currentRoom];

  // Add user if not already present
  if (!room.users[socket.id]) {
    room.users[socket.id] = {
      id: socket.id,
      name: currentUser,
      vote: null
    };
  }

  socket.join(currentRoom);

  // Emit updated user list to everyone in room
  emitUserList(currentRoom);

  // Emit current story, CSV, and selected story index to the new user
  if (room.story) {
    socket.emit('storyChange', { story: room.story });
  }

  socket.emit('initialCSVData', room.csvData);

  if (room.selectedStoryIndex !== null) {
    socket.emit('storySelected', { storyIndex: room.selectedStoryIndex });
  }

  // User manually asks to join (can be optional)
  socket.on('joinRoom', ({ roomId, userName }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { users: {}, story: '', csvData: [], selectedStoryIndex: null, revealed: false };
    }
    rooms[roomId].users[socket.id] = {
      id: socket.id,
      name: userName,
      vote: null
    };
    socket.join(roomId);
    emitUserList(roomId);
  });

  // Handle voting
  socket.on('userVoted', (vote) => {
    const room = rooms[currentRoom];
    if (room && room.users[socket.id]) {
      room.users[socket.id].vote = vote;
      emitUserList(currentRoom); // Update everyone with new votes
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    const room = rooms[currentRoom];
    if (room) {
      delete room.users[socket.id];
      emitUserList(currentRoom);
    }
  });

  // Helper to emit users
  function emitUserList(roomId) {
    const room = rooms[roomId];
    if (room) {
      const userArray = Object.values(room.users); // [{ id, name, vote }]
      io.to(roomId).emit('userListUpdate', userArray); // 🔥 Important: emit user array directly
    }
  }

});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
