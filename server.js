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

// Static file serving setup
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'main.html'));
});
app.use(express.static(join(__dirname, 'public')));

// Enhanced room structure with improved state tracking
const rooms = {}; // roomId: { users, votes, story, revealed, csvData, selectedIndex, votesPerStory, votesRevealed, tickets }

// Debug logging helper
function logInfo(roomId, message) {
  console.log(`[ROOM ${roomId}] ${message}`);
}

io.on('connection', (socket) => {
  console.log(`[SERVER] New client connected: ${socket.id}`);
  
  // Handle room joining
  socket.on('joinRoom', ({ roomId, userName }) => {
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        votes: {},
        story: [],
        revealed: false,
        csvData: [], // For storing uploaded CSV data
        selectedIndex: 0,
        votesPerStory: {},
        votesRevealed: {},
        tickets: [] // For manually added tickets
      };
      logInfo(roomId, `New room created by ${userName} (${socket.id})`);
    }

    // Update user list
    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name: userName });
    socket.join(roomId);

    logInfo(roomId, `User ${userName} (${socket.id}) joined, total users: ${rooms[roomId].users.length}`);
    
    // Send user list to everyone in the room
    io.to(roomId).emit('userList', rooms[roomId].users);

    // Always send both CSV data and tickets in sequence
    // First send CSV data if available
    if (rooms[roomId].csvData && rooms[roomId].csvData.length > 0) {
      logInfo(roomId, `Sending CSV data (${rooms[roomId].csvData.length} rows) to new user ${socket.id}`);
      socket.emit('syncCSVData', rooms[roomId].csvData);
    }
    
    // Then send tickets with a slight delay to ensure proper sequence
    if (rooms[roomId].tickets && rooms[roomId].tickets.length > 0) {
      setTimeout(() => {
        logInfo(roomId, `Sending tickets (${rooms[roomId].tickets.length}) to new user ${socket.id}`);
        socket.emit('allTickets', { tickets: rooms[roomId].tickets });
      }, 200);
    }
    
    // Send current story selection
    setTimeout(() => {
      if (typeof rooms[roomId].selectedIndex === 'number') {
        const storyIndex = rooms[roomId].selectedIndex;
        logInfo(roomId, `Sending current story selection (${storyIndex}) to new user ${socket.id}`);
        socket.emit('storySelected', { storyIndex });
      }
    }, 400);
    
    // Send vote status for current story if available
    setTimeout(() => {
      const currentIndex = rooms[roomId].selectedIndex;
      if (rooms[roomId].votesPerStory && rooms[roomId].votesPerStory[currentIndex]) {
        const votes = rooms[roomId].votesPerStory[currentIndex];
        logInfo(roomId, `Sending ${Object.keys(votes).length} votes for current story to new user`);
        socket.emit('storyVotes', { storyIndex: currentIndex, votes });
        
        // Also send vote reveal status
        if (rooms[roomId].votesRevealed[currentIndex]) {
          socket.emit('votesRevealed', { storyIndex: currentIndex });
        }
      }
    }, 600);
  });

  // Handle ticket synchronization
  socket.on('addTicket', (ticketData) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    // Validate ticket data
    if (!ticketData || !ticketData.id || !ticketData.text) {
      console.error(`[SERVER] Invalid ticket data from client ${socket.id}`);
      return;
    }
    
    logInfo(roomId, `New ticket added: ${ticketData.id}`);
    
    // Check for duplicate tickets (avoid duplicates with same ID)
    const isDuplicate = rooms[roomId].tickets.some(ticket => ticket.id === ticketData.id);
    if (isDuplicate) {
      logInfo(roomId, `Duplicate ticket ${ticketData.id} - ignoring`);
      return;
    }
    
    // Store the ticket in room state
    rooms[roomId].tickets.push(ticketData);
    
    // Broadcast the new ticket to everyone in the room EXCEPT sender
    socket.broadcast.to(roomId).emit('addTicket', { ticketData });
    
    logInfo(roomId, `Ticket ${ticketData.id} broadcast to other users, total tickets: ${rooms[roomId].tickets.length}`);
  });

  // Handle request for all tickets
  socket.on('requestAllTickets', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    if (rooms[roomId].tickets && rooms[roomId].tickets.length > 0) {
      logInfo(roomId, `Sending ${rooms[roomId].tickets.length} tickets to client ${socket.id} on request`);
      socket.emit('allTickets', { tickets: rooms[roomId].tickets });
    } else {
      logInfo(roomId, `No tickets to send on client ${socket.id} request`);
    }
  });

  // Handle CSV data loaded confirmation
  socket.on('csvDataLoaded', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    // Send current story selection
    if (typeof rooms[roomId].selectedIndex === 'number') {
      const storyIndex = rooms[roomId].selectedIndex;
      logInfo(roomId, `Client ${socket.id} confirmed CSV loaded, sending current story: ${storyIndex}`);
      socket.emit('storySelected', { storyIndex });
      
      // Send votes for the current story if any exist
      const existingVotes = rooms[roomId].votesPerStory[storyIndex] || {};
      if (Object.keys(existingVotes).length > 0) {
        socket.emit('storyVotes', { storyIndex, votes: existingVotes });
        
        // Also send vote reveal status
        if (rooms[roomId].votesRevealed[storyIndex]) {
          socket.emit('votesRevealed', { storyIndex });
        }
      }
    }
  });

  // Handle story selection
  socket.on('storySelected', ({ storyIndex }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
  //  logInfo(roomId, `Story ${storyIndex} selected by user ${socket.id}`);
    
    // Store the selected index in room state
    rooms[roomId].selectedIndex = storyIndex;
    
    // Broadcast to ALL clients in the room (including sender for confirmation)
    io.to(roomId).emit('storySelected', { storyIndex });
  });

  // Handle user votes
  socket.on('castVote', ({ vote, targetUserId }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || targetUserId == null) return;
    
    const currentStoryIndex = rooms[roomId].selectedIndex;

    // Initialize vote storage for this story if needed
    if (!rooms[roomId].votesPerStory[currentStoryIndex]) {
      rooms[roomId].votesPerStory[currentStoryIndex] = {};
    }

    // Store the vote
    rooms[roomId].votesPerStory[currentStoryIndex][targetUserId] = vote;
    
    logInfo(roomId, `Vote ${vote} cast for user ${targetUserId} on story ${currentStoryIndex}`);

    // Broadcast vote to all clients in the room
    io.to(roomId).emit('voteUpdate', {
      userId: targetUserId,
      vote,
      storyIndex: currentStoryIndex
    });
  });

  // Handle requests for votes for a specific story
  socket.on('requestStoryVotes', ({ storyIndex }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const votes = rooms[roomId].votesPerStory[storyIndex] || {};
    logInfo(roomId, `Sending ${Object.keys(votes).length} votes for story ${storyIndex} to client ${socket.id}`);
    socket.emit('storyVotes', { storyIndex, votes });
    
    // If votes have been revealed for this story, also send that info
    if (rooms[roomId].votesRevealed[storyIndex]) {
      socket.emit('votesRevealed', { storyIndex });
    }
  });

  // Handle vote revealing
  socket.on('revealVotes', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const currentStoryIndex = rooms[roomId].selectedIndex;
    
    // Mark this story as having revealed votes
    rooms[roomId].votesRevealed[currentStoryIndex] = true;
    
    logInfo(roomId, `Votes revealed for story ${currentStoryIndex} by user ${socket.id}`);
    
    // Send the reveal signal to all clients
    io.to(roomId).emit('votesRevealed', { storyIndex: currentStoryIndex });
  });

  // Handle vote reset for current story
  socket.on('resetVotes', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const currentStoryIndex = rooms[roomId].selectedIndex;
    
    // Clear votes for the current story
    if (rooms[roomId].votesPerStory[currentStoryIndex]) {
      rooms[roomId].votesPerStory[currentStoryIndex] = {};
      // Reset revealed status
      rooms[roomId].votesRevealed[currentStoryIndex] = false;
      
      logInfo(roomId, `Votes reset for story ${currentStoryIndex} by user ${socket.id}`);
      io.to(roomId).emit('votesReset', { storyIndex: currentStoryIndex });
    }
  });

  // Handle story changes
  socket.on('storyChange', ({ story }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    rooms[roomId].story = story;
    logInfo(roomId, `Story content changed by user ${socket.id}`);
    io.to(roomId).emit('storyChange', { story });
  });

  // Handle story navigation
  socket.on('storyNavigation', ({ index }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    logInfo(roomId, `Story navigation to index ${index} by user ${socket.id}`);
    io.to(roomId).emit('storyNavigation', { index });
  });

  // Handle CSV data synchronization - improved to maintain tickets
  socket.on('syncCSVData', (csvData) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || !Array.isArray(csvData)) return;
    
    logInfo(roomId, `CSV data received from client ${socket.id}: ${csvData.length} rows`);
    
    // Store CSV data at room level
    rooms[roomId].csvData = csvData;
    
    // Broadcast to ALL clients in the room (including sender)
    io.to(roomId).emit('syncCSVData', csvData);
    
    logInfo(roomId, `CSV data broadcast to all users in room ${roomId}`);
  });

  // Export votes data 
  socket.on('exportVotes', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const exportData = {
      room: roomId,
      stories: rooms[roomId].csvData,
      tickets: rooms[roomId].tickets,
      votes: rooms[roomId].votesPerStory,
      revealed: rooms[roomId].votesRevealed,
      timestamp: new Date().toISOString()
    };
    
    logInfo(roomId, `Vote export requested by user ${socket.id}`);
    socket.emit('exportData', exportData);
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const userName = socket.data.userName || 'Unknown user';
    logInfo(roomId, `Client disconnected: ${userName} (${socket.id})`);
    
    // Remove user from room
    rooms[roomId].users = rooms[roomId].users.filter(user => user.id !== socket.id);
    
    // Notify remaining users
    io.to(roomId).emit('userList', rooms[roomId].users);
    
    // Clean up empty rooms after a delay (to handle temporary disconnects)
    if (rooms[roomId].users.length === 0) {
      setTimeout(() => {
        // Double-check that the room is still empty before deleting
        if (rooms[roomId] && rooms[roomId].users.length === 0) {
          logInfo(roomId, `Removing empty room`);
          delete rooms[roomId];
        }
      }, 60000); // 1 minute delay
    }
  });
});

// Room cleanup interval (every 6 hours)
setInterval(() => {
  const now = Date.now();
  let roomsRemoved = 0;
  
  for (const roomId in rooms) {
    // If room has no users and hasn't been accessed in 6 hours, remove it
    if (rooms[roomId].users.length === 0 && rooms[roomId].lastAccess && (now - rooms[roomId].lastAccess > 6 * 60 * 60 * 1000)) {
      delete rooms[roomId];
      roomsRemoved++;
    }
  }
  
  if (roomsRemoved > 0) {
    console.log(`[SERVER] Cleaned up ${roomsRemoved} inactive rooms`);
  }
}, 6 * 60 * 60 * 1000);

// Start the server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
