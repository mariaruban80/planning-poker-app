// === Updated server.js with vote tracking, ticket handling, reveal, and sync ===
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
  connectTimeout: 30000,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'About.html'));
});
app.use(express.static(join(__dirname, 'public')));

const rooms = {}; // Holds room data

io.on('connection', (socket) => {
  console.log('[SERVER] Client connected:', socket.id);

  socket.on('joinRoom', ({ roomId, userName, isCreator }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userName = userName;
    socket.data.isCreator = isCreator;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        tickets: [],
        deletedStoryIds: new Set(),
        votesPerStory: {},
        lastActivity: Date.now(),
        selectedIndex: 0,
        users: [],
        votesRevealed: false,
      };
      console.log(`[SERVER] Created new room: ${roomId}`);
    }

    rooms[roomId].users.push({ id: socket.id, name: userName });
    console.log(`[SERVER] ${userName} joined room ${roomId}`);

    socket.emit('ownershipStatus', { isOwner: isCreator });

    // Sync current state to late joiners
    const room = rooms[roomId];
    socket.emit('allTickets', { tickets: room.tickets });
    const selectedIndex = room.selectedIndex ?? 0;
    const storyId = room.tickets[selectedIndex]?.id;
    if (storyId) {
      socket.emit('storySelected', { storyIndex: selectedIndex, storyId });
    }
    socket.emit('votingSystemUpdate', { votesRevealed: room.votesRevealed });
    if (storyId && room.votesPerStory[storyId]) {
      socket.emit('votesUpdate', room.votesPerStory[storyId]);
    }
  });

  socket.on('addTicket', (ticketData) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || !ticketData) return;

    if (rooms[roomId].deletedStoryIds?.has(ticketData.id)) {
      console.log(`[SERVER] Ignoring re-add of deleted ticket: ${ticketData.id}`);
      return;
    }

    rooms[roomId].tickets.push(ticketData);
    rooms[roomId].lastActivity = Date.now();

    console.log(`[SERVER] Added new ticket to room ${roomId}: ${ticketData.id}`);

    socket.broadcast.to(roomId).emit('addTicket', { ticketData });
  });

  socket.on('updateTicket', (ticketData) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || !ticketData) return;

    rooms[roomId].lastActivity = Date.now();

    if (rooms[roomId].deletedStoryIds?.has(ticketData.id)) {
      console.log(`[SERVER] Ignoring update for deleted ticket: ${ticketData.id}`);
      return;
    }

    const ticketIndex = rooms[roomId].tickets.findIndex(ticket => ticket.id === ticketData.id);
    if (ticketIndex !== -1) {
      rooms[roomId].tickets[ticketIndex] = ticketData;
      console.log(`[SERVER] Updated ticket in server state: ${ticketData.id}`);
    }

    socket.broadcast.to(roomId).emit('updateTicket', { ticketData });
    console.log(`[SERVER] Broadcasted ticket update to room ${roomId}`);
  });

  socket.on('deleteTicket', ({ ticketId }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].tickets = rooms[roomId].tickets.filter(ticket => ticket.id !== ticketId);
    rooms[roomId].deletedStoryIds.add(ticketId);
    rooms[roomId].lastActivity = Date.now();

    console.log(`[SERVER] Deleted ticket ${ticketId} from room ${roomId}`);

    io.to(roomId).emit('ticketDeleted', { ticketId });
  });

  socket.on('requestAllTickets', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const allTickets = rooms[roomId].tickets || [];
    console.log(`[SERVER] Sending all tickets to ${socket.id}: ${allTickets.length}`);

    socket.emit('allTickets', { tickets: allTickets });

    const selectedIndex = rooms[roomId].selectedIndex ?? 0;
    const storyId = allTickets[selectedIndex]?.id;
    if (storyId) {
      socket.emit('storySelected', { storyIndex: selectedIndex, storyId });
    }
  });

  socket.on('selectStory', ({ storyIndex, storyId }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].selectedIndex = storyIndex;
    rooms[roomId].votesRevealed = false;

    io.to(roomId).emit('storySelected', { storyIndex, storyId });
    console.log(`[SERVER] Story selected in room ${roomId}: ${storyId}`);
  });

  socket.on('revealVotes', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].votesRevealed = true;
    io.to(roomId).emit('votesRevealed');
    console.log(`[SERVER] Votes revealed in room ${roomId}`);
  });

  socket.on('castVote', ({ storyId, userName, voteValue }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    if (!rooms[roomId].votesPerStory[storyId]) {
      rooms[roomId].votesPerStory[storyId] = {};
    }

    rooms[roomId].votesPerStory[storyId][userName] = voteValue;
    io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory[storyId]);
    console.log(`[SERVER] ${userName} voted ${voteValue} on story ${storyId} in room ${roomId}`);
  });

  socket.on('resetVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || !storyId) return;

    rooms[roomId].votesPerStory[storyId] = {};
    rooms[roomId].votesRevealed = false;
    io.to(roomId).emit('votesReset', { storyId });
    console.log(`[SERVER] Votes reset for story ${storyId} in room ${roomId}`);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
      console.log(`[SERVER] Disconnected ${socket.id} from room ${roomId}`);
    } else {
      console.log(`[SERVER] Disconnected: ${socket.id}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
