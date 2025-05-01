// === server.js ===
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static(join(__dirname, 'public')));

// Room structure
const rooms = {}; // roomId: { users, votes, story, revealed, csvData, selectedIndex }

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

socket.on('joinRoom', ({ roomId, userName }) => {
  socket.data.roomId = roomId;
  socket.data.userName = userName;

  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: [],
      votes: {},
      story: [],
      revealed: false,
      csvData: [],
      selectedIndex: null,
      votesPerStory: {}
    };
  }

  rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
  rooms[roomId].users.push({ id: socket.id, name: userName });
  socket.join(roomId);

  io.to(roomId).emit('userList', rooms[roomId].users);

  if (rooms[roomId].csvData?.length > 0) {
    socket.emit('syncCSVData', rooms[roomId].csvData);
  }

  if (typeof rooms[roomId].selectedIndex === 'number') {
    const storyIndex = rooms[roomId].selectedIndex;
    socket.emit('storySelected', { storyIndex });

    const existingVotes = rooms[roomId].votesPerStory?.[storyIndex];
    if (existingVotes) {
      for (const [userId, vote] of Object.entries(existingVotes)) {
        socket.emit('voteUpdate', { userId, vote, storyIndex });
      }
    }
  }
});


    //if (rooms[currentRoom].csvData?.length > 0) {
    //  socket.emit('syncCSVData', rooms[currentRoom].csvData);
  //  }

//    if (typeof rooms[currentRoom].selectedIndex === 'number') {
  //    socket.emit('storySelected', { storyIndex: rooms[currentRoom].selectedIndex });
   // }
  //});
socket.on('storySelected', ({ storyIndex }) => {
  const roomId = socket.data.roomId;
  if (roomId && rooms[roomId]) {
    console.log(`[SERVER] storySelected received from ${socket.id} in room ${roomId}, storyIndex: ${storyIndex}`);
    rooms[roomId].selectedIndex = storyIndex;
    io.to(roomId).emit('storySelected', { storyIndex });
  } else {
    console.warn(`[SERVER] storySelected ignored — no room found for socket ${socket.id}`);
  }
});


//  socket.on('castVote', ({ vote }) => {
  //  if (currentRoom) {
    //  rooms[currentRoom].votes[socket.id] = vote;
     // io.to(currentRoom).emit('voteUpdate', { userId: socket.id, vote: '✔️' });
   // }
  //});

  //socket.on('castVote', ({ vote, targetUserId }) => {
  //if (currentRoom && targetUserId) {
   // rooms[currentRoom].votes[targetUserId] = vote;
   // io.to(currentRoom).emit('voteUpdate', { userId: targetUserId, vote: '✔️' });
 // }
//});
  socket.on('castVote', ({ vote, targetUserId }) => {
    if (currentRoom && targetUserId != null) {
      const currentStoryIndex = rooms[currentRoom].selectedIndex;

      if (!rooms[currentRoom].votesPerStory) {
        rooms[currentRoom].votesPerStory = {};
      }
      if (!rooms[currentRoom].votesPerStory[currentStoryIndex]) {
        rooms[currentRoom].votesPerStory[currentStoryIndex] = {};
      }

      rooms[currentRoom].votesPerStory[currentStoryIndex][targetUserId] = vote;

      io.to(currentRoom).emit('voteUpdate', {
        userId: targetUserId,
        vote,
        storyIndex: currentStoryIndex
      });
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
