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

  // Validate roomId and userName
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
      users: {},
      votes: {},
      story: '',
      revealed: false,
      csvData: [],
      selectedStoryIndex: null
    };
  }

  const room = rooms[currentRoom];

  // Add user to room if not already present
  if (!room.users[socket.id]) {
    room.users[socket.id] = currentUser;
  }

  socket.join(currentRoom);

  // Emit updated user list to room
  emitUserList(currentRoom);

  // Emit current story, initial CSV data, and selected story index to new user
  if (room.story) {
    socket.emit('storyChange', { story: room.story });
  }

  socket.emit('initialCSVData', room.csvData);

  if (room.selectedStoryIndex !== null) {
    socket.emit('storySelected', { storyIndex: room.selectedStoryIndex });
  }

  // Emit user list when a new user joins
  socket.on('joinRoom', ({ roomId, userName }) => {
    rooms[roomId].users[socket.id] = userName;
    emitUserList(roomId);
  });

  // Emit updated user list
  socket.on('getUserList', ({ roomId }) => {
    emitUserList(roomId);
  });

  // Emit user list to room
  function emitUserList(roomId) {
    const room = rooms[roomId];
    if (room) {
      const userNames = Object.values(room.users);
      io.to(roomId).emit('userList', { users: userNames });
    }
  }

  // Handle other events...
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
