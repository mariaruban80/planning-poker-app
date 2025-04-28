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
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dirname, 'public')));

// In-memory rooms
const rooms = {};

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  let currentRoom = null;
  let currentUserName = null;

  socket.on('joinRoom', ({ roomId, userName }) => {
    console.log(`User ${userName} joining room ${roomId}`);

    currentRoom = roomId;
    currentUserName = userName;

    if (!rooms[currentRoom]) {
      rooms[currentRoom] = { users: [], votes: {}, story: '', revealed: false };
    }

    rooms[currentRoom].users.push({ id: socket.id, name: userName });
    socket.join(currentRoom);

    io.to(currentRoom).emit('userList', rooms[currentRoom].users);

    if (rooms[currentRoom].story) {
      socket.emit('storyChange', { story: rooms[currentRoom].story });
    }
  });

  socket.on('castVote', ({ vote }) => {
    if (currentRoom && currentUserName) {
      rooms[currentRoom].votes[socket.id] = vote;
      io.to(currentRoom).emit('voteUpdate', { userId: socket.id, vote });
    }
  });

  socket.on('storySelected', ({ storyIndex }) => {
    if (currentRoom) {
      rooms[currentRoom].currentStoryIndex = storyIndex;
      io.to(currentRoom).emit('storySelected', { storyIndex });
    }
  });

  socket.on('storyChange', ({ story }) => {
    if (currentRoom) {
      rooms[currentRoom].story = story;
      io.to(currentRoom).emit('storyChange', { story });
    }
  });

  socket.on('storyNavigation', ({ index }) => {
    if (currentRoom) {
      rooms[currentRoom].currentStoryIndex = index;
      io.to(currentRoom).emit('storyNavigation', { index });
    }
  });

  socket.on('revealVotes', () => {
    if (currentRoom) {
      io.to(currentRoom).emit('revealVotes', rooms[currentRoom].votes);
    }
  });

  socket.on('syncCSVData', ({ csvData }) => {
    if (currentRoom) {
      io.to(currentRoom).emit('syncCSVData', { csvData });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (currentRoom) {
      const room = rooms[currentRoom];
      if (room) {
        room.users = room.users.filter(user => user.id !== socket.id);
        delete room.votes[socket.id];

        io.to(currentRoom).emit('userList', room.users);

        if (room.users.length === 0) {
          delete rooms[currentRoom];
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
