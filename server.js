import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static(join(__dirname, 'public')));

// Extended room structure to include csvData
const rooms = {}; // { roomId: { users: [], votes: {}, story: [], revealed: false, csvData: [] } }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  let currentRoom = null;
  let currentUser = null;

  socket.on('joinRoom', ({ roomId, userName }) => {
    currentRoom = roomId;
    currentUser = userName;

    console.log(`User ${userName} joined room ${roomId}`);

    // Initialize room if it doesn't exist
    if (!rooms[currentRoom]) {
      rooms[currentRoom] = { users: [], votes: {}, story: [], revealed: false, csvData: [] };
      //rooms[currentRoom] = { users: [], votes: {}, story: [], revealed: false };
    }

    rooms[currentRoom].users.push({ id: socket.id, name: userName });

    socket.join(currentRoom);

    // Send current user list to the new user
    socket.emit('userList', rooms[currentRoom].users);

    // Broadcast updated user list to others
    io.to(currentRoom).emit('userList', rooms[currentRoom].users);

    // Send current CSV data to the new user if available
    //if (rooms[currentRoom].story && rooms[currentRoom].story.length > 0){
      if (rooms[currentRoom].csvData && rooms[currentRoom].csvData.length > 0) {
    //if (rooms[currentRoom].csvData.length > 0) {
      socket.emit('syncCSVData', rooms[currentRoom].csvData);
    }
  });

  socket.on('storySelected', ({ storyIndex }) => {
    if (currentRoom) {
      io.to(currentRoom).emit('storySelected', { storyIndex });
    }
  });

  socket.on('castVote', ({ vote }) => {
    if (currentRoom) {
      rooms[currentRoom].votes[socket.id] = vote;
      io.to(currentRoom).emit('voteUpdate', { userId: socket.id, vote: '✔️' });
    }
  });

  socket.on('revealVotes', () => {
    if (currentRoom) {
      io.to(currentRoom).emit('revealVotes', rooms[currentRoom].votes);
      rooms[currentRoom].revealed = true;
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
      io.to(currentRoom).emit('storyNavigation', { index });
    }
  });

  socket.on('syncCSVData', (csvData) => {
    if (currentRoom) {
      // Save and sync CSV data across users in the room
      rooms[currentRoom].csvData = csvData;
      io.to(currentRoom).emit('syncCSVData', csvData);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].users = rooms[currentRoom].users.filter(user => user.id !== socket.id);
      delete rooms[currentRoom].votes[socket.id];

      io.to(currentRoom).emit('userList', rooms[currentRoom].users);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
