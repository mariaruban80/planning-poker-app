// === server.js ===
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 10000
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'main.html'));
});
app.use(express.static(join(__dirname, 'public')));

// Room structure
const rooms = {}; // roomId: { users, votesPerStory, votesRevealed, csvData, selectedIndex }
const roomVotingSystems = {};

io.on('connection', (socket) => {
  console.log(`[SERVER] Client connected: ${socket.id}`);

  socket.on('joinRoom', ({ roomId, userName }) => {
    if (!userName) return socket.emit('error', { message: 'Username is required' });

    socket.data.roomId = roomId;
    socket.data.userName = userName;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        votesPerStory: {},
        votesRevealed: {},
        csvData: [],
        selectedIndex: 0,
        tickets: []
      };
    }

    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name: userName });
    socket.join(roomId);

    socket.emit('votingSystemUpdate', { votingSystem: roomVotingSystems[roomId] || 'fibonacci' });
    io.to(roomId).emit('userList', rooms[roomId].users);

    if (rooms[roomId].csvData.length > 0) socket.emit('syncCSVData', rooms[roomId].csvData);
    socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });

    // Resend revealed votes
    for (const [storyId, revealed] of Object.entries(rooms[roomId].votesRevealed)) {
      if (revealed) {
        const votes = rooms[roomId].votesPerStory[storyId] || {};
        socket.emit('storyVotes', { storyId, votes });
        socket.emit('votesRevealed', { storyId });
      }
    }

    if (rooms[roomId].tickets.length > 0) {
      socket.emit('allTickets', { tickets: rooms[roomId].tickets });
    }
  });

  socket.on('castVote', ({ vote, targetUserId, storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId] && targetUserId === socket.id) {
      if (!rooms[roomId].votesPerStory[storyId]) rooms[roomId].votesPerStory[storyId] = {};
      rooms[roomId].votesPerStory[storyId][targetUserId] = vote;
      io.to(roomId).emit('voteUpdate', { userId: targetUserId, vote, storyId });
    }
  });

  socket.on('requestStoryVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const votes = rooms[roomId].votesPerStory?.[storyId] || {};
      socket.emit('storyVotes', { storyId, votes });
      if (rooms[roomId].votesRevealed?.[storyId]) {
        socket.emit('votesRevealed', { storyId });
      }
    }
  });

  socket.on('revealVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].votesRevealed[storyId] = true;
      io.to(roomId).emit('votesRevealed', { storyId });
    }
  });

  socket.on('resetVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].votesPerStory[storyId] = {};
      rooms[roomId].votesRevealed[storyId] = false;
      io.to(roomId).emit('votesReset', { storyId });
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
      io.to(roomId).emit('userList', rooms[roomId].users);
      if (rooms[roomId].users.length === 0) {
        delete rooms[roomId];
        delete roomVotingSystems[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
