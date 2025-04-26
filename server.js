const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const app = express();
const server = http.createServer(app);

// Allow CORS (important for Render hosting)
const io = new Server(server, {
  cors: {
    origin: '*', // Or set your frontend URL instead of '*'
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve your static frontend (if needed)
app.use(express.static('public'));

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);
  });

  socket.on('vote', (data) => {
    io.to(data.room).emit('vote', data); // only to users in the same room
  });

  socket.on('revealCards', (room) => {
    io.to(room).emit('revealCards');
  });

  socket.on('resetVotes', (room) => {
    io.to(room).emit('resetVotes');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
