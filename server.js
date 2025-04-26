import express from 'express';
import http from 'http';
import https from 'https';  // Import https module
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';  // Import fs for SSL files

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Check if Render automatically handles SSL (likely yes) 
// If so, use `http` here for WebSocket compatibility
const server = process.env.NODE_ENV === 'production' 
  ? http.createServer(app)  // Assuming Render does the SSL
  : https.createServer({
      key: fs.readFileSync('/path/to/private.key'),
      cert: fs.readFileSync('/path/to/certificate.crt'),
      ca: fs.readFileSync('/path/to/ca.crt')
    }, app);  // Local development: configure SSL manually

const io = new Server(server);

// Handle Socket.IO connections
const PORT = process.env.PORT || 3000;
app.use(express.static(join(__dirname, 'public')));

const rooms = {};

// Handle socket connections
io.on('connection', (socket) => {
  console.log('New client connected');

  let currentRoom = null;
  let currentUser = null;

  socket.on('join', ({ roomId, user }) => {
    currentRoom = roomId;
    currentUser = user;

    if (!rooms[currentRoom]) {
      rooms[currentRoom] = { users: [], votes: {}, story: '', revealed: false };
    }

    rooms[currentRoom].users.push(currentUser);
    socket.join(currentRoom);

    // Send updated users list to everyone
    io.to(currentRoom).emit('userList', { users: rooms[currentRoom].users });

    // Send the current story if exists
    if (rooms[currentRoom].story) {
      socket.emit('storyChange', { story: rooms[currentRoom].story });
    }
  });

  socket.on('storyChange', ({ story }) => {
    if (currentRoom) {
      rooms[currentRoom].story = story;
      rooms[currentRoom].votes = {}; // reset previous votes
      rooms[currentRoom].revealed = false;

      io.to(currentRoom).emit('storyChange', { story });
    }
  });

  socket.on('vote', ({ story, vote }) => {
    if (currentRoom) {
      rooms[currentRoom].votes[currentUser] = vote;

      io.to(currentRoom).emit('voteUpdate', {
        story,
        votes: rooms[currentRoom].votes
      });
    }
  });

  socket.on('revealVotes', () => {
    if (currentRoom) {
      rooms[currentRoom].revealed = true;
      io.to(currentRoom).emit('revealVotes', {});
    }
  });

  socket.on('resetVotes', () => {
    if (currentRoom) {
      rooms[currentRoom].votes = {};
      rooms[currentRoom].revealed = false;
      io.to(currentRoom).emit('resetVotes', {});
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && currentUser) {
      const room = rooms[currentRoom];
      if (room) {
        room.users = room.users.filter(user => user !== currentUser);

        io.to(currentRoom).emit('userList', { users: room.users });

        if (room.users.length === 0) {
          delete rooms[currentRoom];
        }
      }
    }
    console.log('Client disconnected');
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
