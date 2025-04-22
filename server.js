const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  }
});

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Room state
const roomData = {};

io.on('connection', (socket) => {
  socket.on('join', ({ user, roomId }) => {
    socket.join(roomId);
    socket.user = user;
    socket.roomId = roomId;

    if (!roomData[roomId]) {
      roomData[roomId] = {
        users: [],
        votesByStory: {},
        selectedStory: null
      };
    }

    if (!roomData[roomId].users.includes(user)) {
      roomData[roomId].users.push(user);
    }

    io.to(roomId).emit('userList', { users: roomData[roomId].users });

    // Send story state if any
    const story = roomData[roomId].selectedStory;
    if (story) {
      socket.emit('storyChange', { story });
      socket.emit('voteUpdate', {
        story,
        votes: roomData[roomId].votesByStory[story] || {}
      });
    }
  });

  socket.on('storyChange', ({ story }) => {
    const roomId = socket.roomId;
    roomData[roomId].selectedStory = story;
    io.to(roomId).emit('storyChange', { story });
  });

  socket.on('voteUpdate', ({ story, votes }) => {
    const roomId = socket.roomId;
    const prevVotes = roomData[roomId].votesByStory[story] || {};
    roomData[roomId].votesByStory[story] = { ...prevVotes, ...votes };
    io.to(roomId).emit('voteUpdate', {
      story,
      votes: roomData[roomId].votesByStory[story]
    });
  });

  socket.on('revealVotes', () => {
    const roomId = socket.roomId;
    const story = roomData[roomId].selectedStory;
    io.to(roomId).emit('revealVotes', {
      story,
      votes: roomData[roomId].votesByStory[story] || {}
    });
  });

  socket.on('resetVotes', ({ story }) => {
    const roomId = socket.roomId;
    roomData[roomId].votesByStory[story] = {};
    io.to(roomId).emit('voteUpdate', { story, votes: {} });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const user = socket.user;
    if (roomId && roomData[roomId]) {
      roomData[roomId].users = roomData[roomId].users.filter(u => u !== user);
      io.to(roomId).emit('userList', { users: roomData[roomId].users });
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
