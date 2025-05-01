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
  console.log(`[SERVER] Re-sending storySelected to joining user: ${storyIndex}`);

  // Delay emit to ensure client has time to render stories
  setTimeout(() => {
      console.log(`[SERVER] Emitting storySelected to socket ${socket.id} for room ${roomId}`);
    //socket.emit('storySelected', { storyIndex });
    socket.emit('storySelected', { storyIndex: currentStoryIndex });
  }, 500);

  const existingVotes = rooms[roomId].votesPerStory?.[storyIndex];
  if (existingVotes) {
    for (const [userId, vote] of Object.entries(existingVotes)) {
      socket.emit('voteUpdate', { userId, vote, storyIndex });
    }
  }
}

  });

  socket.on('storySelected', ({ storyIndex }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] storySelected received from ${socket.id} in room ${roomId}, storyIndex: ${storyIndex}`);
      rooms[roomId].selectedIndex = storyIndex;
      io.to(roomId).emit('storySelected', { storyIndex });
    }
  });

  socket.on('castVote', ({ vote, targetUserId }) => {
    const roomId = socket.data.roomId;
    if (roomId && targetUserId != null && rooms[roomId]) {
      const currentStoryIndex = rooms[roomId].selectedIndex;

      if (!rooms[roomId].votesPerStory[currentStoryIndex]) {
        rooms[roomId].votesPerStory[currentStoryIndex] = {};
      }

      rooms[roomId].votesPerStory[currentStoryIndex][targetUserId] = vote;

      io.to(roomId).emit('voteUpdate', {
        userId: targetUserId,
        vote,
        storyIndex: currentStoryIndex
      });
    }
  });

  socket.on('revealVotes', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      io.to(roomId).emit('revealVotes', rooms[roomId].votes);
      rooms[roomId].revealed = true;
    }
  });

  socket.on('storyChange', ({ story }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].story = story;
      io.to(roomId).emit('storyChange', { story });
    }
  });

  socket.on('storyNavigation', ({ index }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      io.to(roomId).emit('storyNavigation', { index });
    }
  });

  socket.on('syncCSVData', (csvData) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].csvData = csvData;
      io.to(roomId).emit('syncCSVData', csvData);
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter(user => user.id !== socket.id);
      delete rooms[roomId].votes[socket.id];
      io.to(roomId).emit('userList', rooms[roomId].users);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
