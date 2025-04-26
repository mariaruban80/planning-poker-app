import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// Store rooms data
const rooms = {};

// Handle socket connections
io.on('connection', (socket) => {
  console.log('New client connected');

  let currentRoom = null;
  let currentUser = null;

  // When user joins a room
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

    // If there is already a selected story, send it to the new user
    if (rooms[currentRoom].story) {
      socket.emit('storyChange', { story: rooms[currentRoom].story });
    }
  });

  // When user selects a story
  socket.on('storyChange', ({ story }) => {
    if (currentRoom) {
      rooms[currentRoom].story = story;
      rooms[currentRoom].votes = {}; // reset previous votes
      rooms[currentRoom].revealed = false;

      io.to(currentRoom).emit('storyChange', { story });
    }
  });

  // When user votes
  socket.on('vote', ({ story, vote }) => {
    if (currentRoom) {
      if (!rooms[currentRoom].votes) {
        rooms[currentRoom].votes = {};
      }
      rooms[currentRoom].votes[currentUser] = vote;

      io.to(currentRoom).emit('voteUpdate', {
        story,
        votes: rooms[currentRoom].votes
      });
    }
  });

  // Reveal votes
  socket.on('revealVotes', () => {
    if (currentRoom) {
      rooms[currentRoom].revealed = true;
      io.to(currentRoom).emit('revealVotes', {});
    }
  });

  // Reset votes
  socket.on('resetVotes', () => {
    if (currentRoom) {
      rooms[currentRoom].votes = {};
      rooms[currentRoom].revealed = false;
      io.to(currentRoom).emit('resetVotes', {});
    }
  });

  // When a user disconnects
  socket.on('disconnect', () => {
    if (currentRoom && currentUser) {
      const room = rooms[currentRoom];
      if (room) {
        room.users = room.users.filter(user => user !== currentUser);

        // Broadcast updated users list
        io.to(currentRoom).emit('userList', { users: room.users });

        // Optionally: Delete empty room
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
