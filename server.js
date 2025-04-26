import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app); // Change to HTTP (not HTTPS)

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

  // Other event handlers...

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
