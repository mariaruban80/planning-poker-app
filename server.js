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

// Room structure: 1 object per room
const rooms = {}; 
// Structure: {
//   roomId: {
//     users: [],
//     votes: {},
//     story: [],
//     revealed: false,
//     csvData: [],
//     selectedStoryIndex: null
//   }
// }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  let currentRoom = null;
  let currentUser = null;

  socket.on('joinRoom', ({ roomId, userName }) => {
    currentRoom = roomId;
    currentUser = userName;

    console.log(`User ${userName} joined room ${roomId}`);

    // Initialize room if not exists
    if (!rooms[currentRoom]) {
      rooms[currentRoom] = {
        users: [],
        votes: {},
        story: [],
        revealed: false,
        csvData: [],
        selectedIndex: 0
      };
    }

    // Avoid duplicates on reconnect
    rooms[currentRoom].users = rooms[currentRoom].users.filter(u => u.id !== socket.id);
    rooms[currentRoom].users.push({ id: socket.id, name: userName });

    socket.join(currentRoom);

    // Broadcast updated user list
    io.to(currentRoom).emit('userList', rooms[currentRoom].users);

    // Send CSV data to the newly joined user
    if (rooms[currentRoom].csvData?.length > 0) {
    socket.emit('syncCSVData', rooms[currentRoom].csvData);
    socket.emit('storySelected', { storyIndex: rooms[currentRoom].selectedIndex }); // ✅ Broadcast selected
    }

    
//    if (rooms[currentRoom].csvData.length > 0) {
  //    socket.emit('syncCSVData', rooms[currentRoom].csvData);
   // }

    // Send selected story index to the new user
    if (rooms[currentRoom].selectedStoryIndex !== null) {
      socket.emit('storySelected', { storyIndex: rooms[currentRoom].selectedStoryIndex });
    }
  });

  socket.on('storySelected', ({ storyIndex }) => {
     if (currentRoom) {
    //if (currentRoom && rooms[currentRoom]) {
       rooms[currentRoom].selectedIndex = storyIndex; 
      //rooms[currentRoom].selectedStoryIndex = storyIndex;
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
  console.log(`✅ Server running on port ${PORT}`);
});
