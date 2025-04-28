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
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// In-memory store for rooms
const rooms = {};

// Handle socket.io connections
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  const { roomId, userName } = socket.handshake.query;
  if (!roomId || !userName) {
    console.error('Missing roomId or userName');
    socket.disconnect();
    return;
  }

  let currentRoom = roomId;
  let currentUser = userName;

  // Ensure room exists
  if (!rooms[currentRoom]) {
    rooms[currentRoom] = createNewRoom();
  }

  const room = rooms[currentRoom];

  // Add user to room if not already present
  if (!room.users.includes(currentUser)) {
    room.users.push(currentUser);
  }

  socket.join(currentRoom);

  // Emit initial data to the user
  emitInitialData(socket, room);

  // Emit updated user list to everyone in the room
  io.to(currentRoom).emit('userList', { users: room.users });

  // Handle all socket events
  setupSocketHandlers(socket, room, currentRoom, currentUser);
});

// Create a new room structure
function createNewRoom() {
  return {
    users: [],
    votes: {},
    story: '',
    revealed: false,
    csvData: [],
    selectedStoryIndex: null,
  };
}

// Emit initial room data to newly connected user
function emitInitialData(socket, room) {
  if (room.story) {
    socket.emit('storyChange', { story: room.story });
  }
  socket.emit('initialCSVData', room.csvData);
  if (room.selectedStoryIndex !== null) {
    socket.emit('storySelected', { storyIndex: room.selectedStoryIndex });
  }
}

// Setup all event handlers for a socket
function setupSocketHandlers(socket, room, currentRoom, currentUser) {
  socket.on('syncCSVData', (data) => {
    if (!currentRoom) return;
    room.csvData = data;
    io.to(currentRoom).emit('syncCSVData', data);
  });

  socket.on('vote', ({ story, vote }) => {
    if (!currentRoom || !currentUser) return;
    if (!room.votes[story]) room.votes[story] = {};
    room.votes[story][currentUser] = vote;
    io.to(currentRoom).emit('voteUpdate', { story, votes: room.votes[story] });
  });

  socket.on('storyChange', ({ story }) => {
    if (!currentRoom) return;
    room.story = story;
    io.to(currentRoom).emit('storyChange', { story });
  });

  socket.on('storySelected', ({ storyIndex }) => {
    if (!currentRoom) return;
    room.selectedStoryIndex = storyIndex;
    io.to(currentRoom).emit('storySelected', { storyIndex });
  });

  socket.on('storyNavigation', ({ index }) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('storyNavigation', { index });
  });

  socket.on('revealVotes', () => {
    if (!currentRoom) return;
    room.revealed = true;
    io.to(currentRoom).emit('revealVotes', {});
  });

  socket.on('resetVotes', () => {
    if (!currentRoom) return;
    room.votes = {};
    room.revealed = false;
    io.to(currentRoom).emit('resetVotes', {});
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    handleDisconnect(currentRoom, currentUser);
  });
}

// Handle client disconnection
function handleDisconnect(currentRoom, currentUser) {
  const room = rooms[currentRoom];
  if (!room) return;

  room.users = room.users.filter((u) => u !== currentUser);

  io.to(currentRoom).emit('userList', { users: room.users });

  // Remove room if empty
  if (room.users.length === 0) {
    delete rooms[currentRoom];
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
