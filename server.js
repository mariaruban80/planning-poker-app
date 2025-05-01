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
const rooms = {}; // roomId: { users, votes, story, revealed, csvData, selectedIndex, votesPerStory }

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  socket.on('joinRoom', ({ roomId, userName }) => {
    currentRoom = roomId;
    currentUser = userName;

    if (!rooms[currentRoom]) {
      rooms[currentRoom] = {
        users: [],
        votes: {},
        story: [],
        revealed: false,
        csvData: [],
        selectedIndex: null,
        votesPerStory: {}
      };
    }

    rooms[currentRoom].users = rooms[currentRoom].users.filter(u => u.id !== socket.id);
    rooms[currentRoom].users.push({ id: socket.id, name: userName });
    socket.join(currentRoom);

    io.to(currentRoom).emit('userList', rooms[currentRoom].users);

    if (rooms[currentRoom].csvData?.length > 0) {
      socket.emit('syncCSVData', rooms[currentRoom].csvData);
    }

    if (typeof rooms[currentRoom].selectedIndex === 'number') {
      const storyIndex = rooms[currentRoom].selectedIndex;
      socket.emit('storySelected', { storyIndex });

      // ✅ Send existing votes for the current story to the joining user
      const existingVotes = rooms[currentRoom].votesPerStory?.[storyIndex];
      if (existingVotes) {
        for (const [userId, vote] of Object.entries(existingVotes)) {
          socket.emit('voteUpdate', { userId, vote, storyIndex });
        }
      }
    }
  });

  socket.on('storySelected', ({ storyIndex }) => {
    if (currentRoom) {
      rooms[currentRoom].selectedIndex = storyIndex;
      io.to(currentRoom).emit('storySelected', { storyIndex });
    }
  });

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
 console.log('[server] castVote:', vote, '->', targetUserId); 
      io.to(currentRoom).emit('voteUpdate', {
        userId: targetUserId,
        vote,
        storyIndex: currentStoryIndex
      });
    }
  });

  socket.on('revealVotes', () => {
    if (currentRoom) {
      const currentStoryIndex = rooms[currentRoom].selectedIndex;
      const votes = rooms[currentRoom].votesPerStory?.[currentStoryIndex] || {};
      io.to(currentRoom).emit('revealVotes', votes);
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
