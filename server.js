const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // You can specify allowed origins if needed
  }
});

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room state
const roomData = {};

// Handle socket connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Handle user joining a room
  socket.on('join', ({ user, roomId }) => {
    if (!user || !roomId) return;

    socket.join(roomId);
    socket.user = user;
    socket.roomId = roomId;

    // Initialize room data if it doesn't exist
    if (!roomData[roomId]) {
      roomData[roomId] = {
        users: [],
        votesByStory: {},
        selectedStory: null,
      };
    }

    // Add user to room if not already present
    const users = roomData[roomId].users;
    if (!users.includes(user)) {
      users.push(user);
    }

    // Notify all users in room of updated user list
    io.to(roomId).emit('userList', { users });

    // If a story is already selected, sync state with the new user
    const currentStory = roomData[roomId].selectedStory;
    if (currentStory) {
      socket.emit('storyChange', { story: currentStory });
      socket.emit('voteUpdate', {
        story: currentStory,
        votes: roomData[roomId].votesByStory[currentStory] || {},
      });
    }
  });

  // Handle story change event
  socket.on('storyChange', ({ story }) => {
    const roomId = socket.roomId;
    if (!roomId || !story || !roomData[roomId]) return;

    roomData[roomId].selectedStory = story;

    // Broadcast story change to all users in room
    io.to(roomId).emit('storyChange', { story });
  });

  // Handle vote updates
  socket.on('voteUpdate', ({ story, votes }) => {
    const roomId = socket.roomId;
    if (!roomId || !story || !votes || !roomData[roomId]) return;

    const prevVotes = roomData[roomId].votesByStory[story] || {};
    roomData[roomId].votesByStory[story] = { ...prevVotes, ...votes };

    // Broadcast the updated votes to the room
    io.to(roomId).emit('voteUpdate', {
      story,
      votes: roomData[roomId].votesByStory[story],
    });
  });

  // Handle reveal votes event
  socket.on('revealVotes', () => {
    const roomId = socket.roomId;
    const story = roomData[roomId]?.selectedStory;
    if (!roomId || !story) return;

    io.to(roomId).emit('revealVotes', {
      story,
      votes: roomData[roomId].votesByStory[story] || {},
    });
  });

  // Handle reset votes event
  socket.on('resetVotes', ({ story }) => {
    const roomId = socket.roomId;
    if (!roomId || !story || !roomData[roomId]) return;

    roomData[roomId].votesByStory[story] = {};
    io.to(roomId).emit('voteUpdate', { story, votes: {} });
  });

  // Handle file upload event (new)
  socket.on('fileUploaded', ({ file }) => {
    const roomId = socket.roomId;
    if (!roomId || !file || !roomData[roomId]) return;

    // Broadcast the file upload notification to the room
    io.to(roomId).emit('fileUploaded', { file });
  });

  // Handle user disconnecting
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const user = socket.user;
    if (!roomId || !roomData[roomId] || !user) return;

    // Remove the user from the room list
    const users = roomData[roomId].users.filter(u => u !== user);
    roomData[roomId].users = users;

    io.to(roomId).emit('userList', { users });

    // Optional: cleanup if room is empty
    if (users.length === 0) {
      delete roomData[roomId];
    }

    console.log('A user disconnected:', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
