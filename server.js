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

  // Handle CSV sync
  socket.on('syncCSVData', (data) => {
    if (currentRoom) {
      room.csvData = data;
      io.to(currentRoom).emit('syncCSVData', data);
    }
  });

  // Handle vote submission
  socket.on('vote', ({ story, vote }) => {
    if (currentRoom && currentUser) {
      if (!room.votes[story]) {
        room.votes[story] = {};
      }
      room.votes[story][currentUser] = vote;
      io.to(currentRoom).emit('voteUpdate', { story, votes: room.votes[story] });
    }
  });

  // Handle story text change
  socket.on('storyChange', ({ story }) => {
    if (currentRoom) {
      room.story = story;
      io.to(currentRoom).emit('storyChange', { story });
    }
  });

  // Handle selecting a story (index-based)
  socket.on('storySelected', ({ storyIndex }) => {
    if (currentRoom) {
      room.selectedStoryIndex = storyIndex;
      io.to(currentRoom).emit('storySelected', { storyIndex });
    }
  });

  // Handle story navigation (next/previous story)
  socket.on('storyNavigation', ({ index }) => {
    if (currentRoom) {
      io.to(currentRoom).emit('storyNavigation', { index });
    }
  });

  // Reveal votes
  socket.on('revealVotes', () => {
    if (currentRoom) {
      room.revealed = true;
      io.to(currentRoom).emit('revealVotes', {});
    }
  });

  // Reset votes
  socket.on('resetVotes', () => {
    if (currentRoom) {
      room.votes = {};
      room.revealed = false;
      io.to(currentRoom).emit('resetVotes', {});
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    if (currentRoom && room) {
      delete room.users[socket.id];

      emitUserList(currentRoom);

      // Clean up room if no users are left
      if (Object.keys(room.users).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });

  function emitUserList(roomId) {
    const room = rooms[roomId];
    if (room) {
      const userNames = Object.values(room.users);
      io.to(roomId).emit('userList', { users: userNames });
    }
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
