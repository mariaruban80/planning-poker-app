import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 120000,
  pingInterval: 25000,
  connectTimeout: 30000
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'main.html')));
app.use(express.static(join(__dirname, 'public')));

// State
const rooms = {};
const roomVotingSystems = {};
const userNameToIdMap = {};

function cleanupRoomData() {
  const now = Date.now();
  for (const roomId in rooms) {
    const room = rooms[roomId];
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    if (room.deletedStoriesTimestamp) {
      for (const [storyId, timestamp] of Object.entries(room.deletedStoriesTimestamp)) {
        if (timestamp < oneDayAgo) {
          delete room.votesPerStory[storyId];
          delete room.votesRevealed[storyId];
        }
      }
    }

    if (room.lastActivity < sevenDaysAgo && room.users.length === 0) {
      delete rooms[roomId];
      delete roomVotingSystems[roomId];
    }
  }
}
setInterval(cleanupRoomData, 60 * 60 * 1000);

function findExistingVotesForUser(roomId, userName) {
  if (!rooms[roomId] || !userName) return {};
  const result = {};
  const ids = userNameToIdMap[userName]?.socketIds || [];
  for (const [storyId, votes] of Object.entries(rooms[roomId].votesPerStory || {})) {
    if (rooms[roomId].deletedStoryIds?.has(storyId)) continue;
    for (const sid of ids) {
      if (votes[sid]) {
        result[storyId] = votes[sid];
        break;
      }
    }
  }
  return result;
}

function restoreUserVotesToCurrentSocket(roomId, socket) {
  const userName = socket.data.userName;
  const currentId = socket.id;
  const ids = userNameToIdMap[userName]?.socketIds || [];
  const userVotes = findExistingVotesForUser(roomId, userName);

  for (const [storyId, vote] of Object.entries(userVotes)) {
    if (rooms[roomId].deletedStoryIds.has(storyId)) continue;
    if (!rooms[roomId].votesPerStory[storyId]) {
      rooms[roomId].votesPerStory[storyId] = {};
    }

    // Remove old votes from same user
    for (const sid of Object.keys(rooms[roomId].votesPerStory[storyId])) {
      if (ids.includes(sid)) delete rooms[roomId].votesPerStory[storyId][sid];
    }

    rooms[roomId].votesPerStory[storyId][currentId] = vote;
    socket.emit('restoreUserVote', { storyId, vote });
    socket.broadcast.to(roomId).emit('voteUpdate', { userId: currentId, vote, storyId });
  }
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, userName }) => {
    if (!userName) return;

    socket.data.roomId = roomId;
    socket.data.userName = userName;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        csvData: [],
        tickets: [],
        deletedStoryIds: new Set(),
        deletedStoriesTimestamp: {},
        votesPerStory: {},
        votesRevealed: {},
        selectedIndex: 0,
        lastActivity: Date.now()
      };
    }

    if (!userNameToIdMap[userName]) {
      userNameToIdMap[userName] = { socketIds: [] };
    }
    if (!userNameToIdMap[userName].socketIds.includes(socket.id)) {
      userNameToIdMap[userName].socketIds.push(socket.id);
      userNameToIdMap[userName].socketIds = userNameToIdMap[userName].socketIds.slice(-5);
    }

    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name: userName });
    socket.join(roomId);

    // Sync full state
    const activeTickets = rooms[roomId].tickets.filter(t => !rooms[roomId].deletedStoryIds.has(t.id));
    const activeVotes = {};
    const revealed = {};

    for (const [storyId, votes] of Object.entries(rooms[roomId].votesPerStory)) {
      if (!rooms[roomId].deletedStoryIds.has(storyId)) {
        activeVotes[storyId] = votes;
        if (rooms[roomId].votesRevealed?.[storyId]) revealed[storyId] = true;
      }
    }

    socket.emit('resyncState', {
      tickets: activeTickets,
      votesPerStory: activeVotes,
      votesRevealed: revealed,
      deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds)
    });

    restoreUserVotesToCurrentSocket(roomId, socket);

    socket.emit('votingSystemUpdate', { votingSystem: roomVotingSystems[roomId] || 'fibonacci' });
    io.to(roomId).emit('userList', rooms[roomId].users);

    if (rooms[roomId].csvData?.length > 0) {
      socket.emit('syncCSVData', rooms[roomId].csvData);
    }

    if (typeof rooms[roomId].selectedIndex === 'number') {
      socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
    }

    for (const storyId in rooms[roomId].votesPerStory) {
      if (!rooms[roomId].deletedStoryIds.has(storyId)) {
        socket.emit('storyVotes', {
          storyId,
          votes: rooms[roomId].votesPerStory[storyId]
        });
        if (rooms[roomId].votesRevealed?.[storyId]) {
          socket.emit('votesRevealed', { storyId });
        }
      }
    }
  });

  socket.on('addTicket', (ticketData) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const exists = rooms[roomId].tickets.find(t => t.id === ticketData.id);
    if (!exists) {
      rooms[roomId].tickets.push(ticketData);
    }

    if (rooms[roomId].deletedStoryIds.has(ticketData.id)) {
      rooms[roomId].deletedStoryIds.delete(ticketData.id);
    }

    socket.broadcast.to(roomId).emit('addTicket', { ticketData });
  });

  socket.on('requestAllTickets', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const filtered = rooms[roomId].tickets.filter(t => !rooms[roomId].deletedStoryIds.has(t.id));
    socket.emit('allTickets', { tickets: filtered });
  });

  socket.on('storySelected', ({ storyIndex }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].selectedIndex = storyIndex;
    socket.broadcast.to(roomId).emit('storySelected', { storyIndex });
  });

  socket.on('deleteStory', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].deletedStoryIds.add(storyId);
    rooms[roomId].deletedStoriesTimestamp[storyId] = Date.now();

    delete rooms[roomId].votesPerStory[storyId];
    delete rooms[roomId].votesRevealed[storyId];

    io.to(roomId).emit('deleteStory', { storyId });
  });

  socket.on('restoreUserVote', ({ storyId, vote }) => {
    const roomId = socket.data.roomId;
    const userName = socket.data.userName;
    if (!roomId || !rooms[roomId] || !storyId || rooms[roomId].deletedStoryIds.has(storyId)) return;

    if (!rooms[roomId].votesPerStory[storyId]) {
      rooms[roomId].votesPerStory[storyId] = {};
    }

    const ids = userNameToIdMap[userName]?.socketIds || [];
    for (const sid of Object.keys(rooms[roomId].votesPerStory[storyId])) {
      if (ids.includes(sid)) delete rooms[roomId].votesPerStory[storyId][sid];
    }

    rooms[roomId].votesPerStory[storyId][socket.id] = vote;

    socket.emit('restoreUserVote', { storyId, vote });
    socket.broadcast.to(roomId).emit('voteUpdate', { userId: socket.id, vote, storyId });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const userName = socket.data.userName;

    if (userName && userNameToIdMap[userName]) {
      userNameToIdMap[userName].socketIds = userNameToIdMap[userName].socketIds.filter(id => id !== socket.id);
    }

    if (rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
      io.to(roomId).emit('userList', rooms[roomId].users);
    }
  });
});

httpServer.listen(3000, () => {
  console.log('Server listening on http://localhost:3000');
});
