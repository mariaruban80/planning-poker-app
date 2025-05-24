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
  pingTimeout: 60000, // Increase ping timeout to 60s (default is 20s)
  pingInterval: 25000, // Ping interval at 25s (default is 25s)
  connectTimeout: 10000 // Connection timeout
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// added to call the main.html file
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'main.html'));
});
app.use(express.static(join(__dirname, 'public')));


// Enhanced room structure with vote revealing state
const rooms = {}; // roomId: { users, votes, story, revealed, csvData, selectedIndex, votesPerStory, votesRevealed }
const roomVotingSystems = {}; // roomId → voting system


io.on('connection', (socket) => {
  console.log(`[SERVER] New client connected: ${socket.id}`);
  
  // Handle room joining
  socket.on('joinRoom', ({ roomId, userName }) => {
    // Validate username - reject if missing
    if (!userName) {
      console.log(`[SERVER] Rejected connection without username for socket ${socket.id}`);
      socket.emit('error', { message: 'Username is required to join a room' });
      return;
    }
    
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        votes: {},
        story: [],
        revealed: false,
        csvData: [],
        selectedIndex: 0, // Default to first story
        votesPerStory: {},
        votesRevealed: {} // Track which stories have revealed votes
      };
    }

    // Update user list (remove if exists, then add)
    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name: userName });
    socket.join(roomId);
    
    // Send the current voting system to the joining user
    const votingSystem = roomVotingSystems[roomId] || 'fibonacci';
    socket.emit('votingSystemUpdate', { votingSystem });

    console.log(`[SERVER] User ${userName} (${socket.id}) joined room ${roomId}`);
    
    // Send user list to everyone in the room
    io.to(roomId).emit('userList', rooms[roomId].users);

    // Send CSV data if available
    if (rooms[roomId].csvData?.length > 0) {
      socket.emit('syncCSVData', rooms[roomId].csvData);
    }
    
    // Send currently selected story
    if (typeof rooms[roomId].selectedIndex === 'number') {
      socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
    }
    
    // Send revealed votes state for all stories
    const votesRevealed = rooms[roomId].votesRevealed || {};
    Object.keys(votesRevealed).forEach(storyIndex => {
      if (votesRevealed[storyIndex]) {
        const votes = rooms[roomId].votesPerStory[storyIndex] || {};
        socket.emit('storyVotes', { 
          storyIndex: parseInt(storyIndex), 
          votes 
        });
        socket.emit('votesRevealed', { 
          storyIndex: parseInt(storyIndex) 
        });
      }
    });
    
    // Send all tracked tickets
    if (rooms[roomId].tickets && rooms[roomId].tickets.length > 0) {
      socket.emit('allTickets', { tickets: rooms[roomId].tickets });
    }
  });
  
  // Handle reconnection
  socket.on('reconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Client ${socket.id} reconnected to room ${roomId}`);
      
      // Re-send room state
      socket.emit('userList', rooms[roomId].users);
      
      if (rooms[roomId].csvData?.length > 0) {
        socket.emit('syncCSVData', rooms[roomId].csvData);
      }
      
      // Send current story selection
      if (typeof rooms[roomId].selectedIndex === 'number') {
        socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
      }
      
      // Re-send revealed votes state
      const votesRevealed = rooms[roomId].votesRevealed || {};
      Object.keys(votesRevealed).forEach(storyIndex => {
        if (votesRevealed[storyIndex]) {
          const votes = rooms[roomId].votesPerStory[storyIndex] || {};
          socket.emit('storyVotes', { 
            storyIndex: parseInt(storyIndex), 
            votes 
          });
          socket.emit('votesRevealed', { 
            storyIndex: parseInt(storyIndex) 
          });
        }
      });
    }
  });
  
  // Handle ticket synchronization
  socket.on('addTicket', (ticketData) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] New ticket added to room ${roomId}`);
      
      // Broadcast the new ticket to everyone in the room EXCEPT sender
      socket.broadcast.to(roomId).emit('addTicket', { ticketData });
      
      // Keep track of tickets on the server
      if (!rooms[roomId].tickets) {
        rooms[roomId].tickets = [];
      }
      rooms[roomId].tickets.push(ticketData);
    }
  });
  
  socket.on('deleteCSVStory', ({ storyId, csvIndex }) => {
    const roomId = socket.data.roomId;
    
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] CSV story deleted in room ${roomId}: ${storyId}, csvIndex: ${csvIndex}`);
      
      // Update the CSV data by removing the entry
      if (rooms[roomId].csvData && !isNaN(csvIndex) && csvIndex >= 0 && csvIndex < rooms[roomId].csvData.length) {
        rooms[roomId].csvData.splice(csvIndex, 1);
        
        // Re-sync the CSV data to all clients
        io.to(roomId).emit('syncCSVData', rooms[roomId].csvData);
        console.log(`[SERVER] Resynced CSV data after deletion, ${rooms[roomId].csvData.length} items remain`);
      }
      
      // Also send the standard deleteStory event to ensure UI is updated everywhere
      io.to(roomId).emit('deleteStory', { storyId });
    }
  });
  
  // Store the selected voting system for the room
  socket.on('votingSystemSelected', ({ roomId, votingSystem }) => {
    if (roomId && votingSystem) {
      console.log(`[SERVER] Host selected voting system '${votingSystem}' for room ${roomId}`);
      roomVotingSystems[roomId] = votingSystem;
      
      // Broadcast to all clients in the room
      io.to(roomId).emit('votingSystemUpdate', { votingSystem });
    }
  });
  
  // Handle story deletion with improved error handling
  socket.on('deleteStory', ({ storyId, isCsvStory, csvIndex }) => {
    try {
      const roomId = socket.data.roomId;
      
      if (!roomId || !rooms[roomId]) {
        console.error(`[SERVER] Invalid room for delete operation: ${roomId}`);
        socket.emit('error', { message: 'Invalid room ID', operation: 'deleteStory' });
        return;
      }
      
      console.log(`[SERVER] Processing story deletion in room ${roomId}: ${storyId}`);
      
      // Handle CSV story deletion
      if (isCsvStory && rooms[roomId].csvData) {
        if (!isNaN(csvIndex) && csvIndex >= 0 && csvIndex < rooms[roomId].csvData.length) {
          // Remove the item from csvData
          rooms[roomId].csvData.splice(csvIndex, 1);
          // Optionally sync updated CSV data
          io.to(roomId).emit('syncCSVData', rooms[roomId].csvData);
        }
      }
      
      // Remove from tracked tickets if present
      if (rooms[roomId].tickets) {
        rooms[roomId].tickets = rooms[roomId].tickets.filter(ticket => ticket.id !== storyId);
      }
      
      // Clean up votes for this story if they exist
      if (rooms[roomId].votesPerStory && rooms[roomId].votesPerStory[storyId]) {
        delete rooms[roomId].votesPerStory[storyId];
      }
      
      if (rooms[roomId].votesRevealed && rooms[roomId].votesRevealed[storyId]) {
        delete rooms[roomId].votesRevealed[storyId];
      }
      
      // Broadcast deletion to ALL clients in the room, including the sender
      io.to(roomId).emit('deleteStory', { storyId });
      
      // Confirm to the sender that deletion was successful
      socket.emit('deleteConfirmed', { storyId });
      
    } catch (error) {
      console.error(`[SERVER] Error deleting story ${storyId}:`, error);
      socket.emit('error', { message: 'Error deleting story', operation: 'deleteStory' });
    }
  });
  
  // Handle getting all tickets
  socket.on('requestAllTickets', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId] && rooms[roomId].tickets) {
      console.log(`[SERVER] Sending all tickets to client ${socket.id}`);
      socket.emit('allTickets', { tickets: rooms[roomId].tickets });
    }
  });

  // Handle CSV data loaded confirmation
  socket.on('csvDataLoaded', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      // Now that CSV is loaded, send the current story selection
      if (typeof rooms[roomId].selectedIndex === 'number') {
        const storyIndex = rooms[roomId].selectedIndex;
        console.log(`[SERVER] Client ${socket.id} confirmed CSV loaded, sending current story: ${storyIndex}`);
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
    }
  });

  // Handle story selection
  socket.on('storySelected', ({ storyIndex }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] storySelected received from ${socket.id} in room ${roomId}, storyIndex: ${storyIndex}`);
      
      // Store the selected index in room state
      rooms[roomId].selectedIndex = storyIndex;
      
      // Broadcast to ALL clients in the room (including sender for confirmation)
      io.to(roomId).emit('storySelected', { storyIndex });
    }
  });

  // Handle user votes
  socket.on('castVote', ({ vote, targetUserId, storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId] && targetUserId === socket.id) {
      if (!rooms[roomId].votesPerStory) rooms[roomId].votesPerStory = {};
      if (!rooms[roomId].votesPerStory[storyId]) {
        rooms[roomId].votesPerStory[storyId] = {};
      }
      rooms[roomId].votesPerStory[storyId][targetUserId] = vote;
      io.to(roomId).emit('voteUpdate', { userId: targetUserId, vote, storyId });
    }
  });
  
  // Handle requests for votes for a specific story
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

  // Handle vote revealing with improved persistence
  socket.on('revealVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Revealing votes for story: ${storyId} in room ${roomId}`);
      if (!rooms[roomId].votesRevealed) rooms[roomId].votesRevealed = {};
      rooms[roomId].votesRevealed[storyId] = true;
      io.to(roomId).emit('votesRevealed', { storyId });
    }
  });

  // Handle vote reset for current story
  socket.on('resetVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      if (rooms[roomId].votesPerStory?.[storyId]) {
        rooms[roomId].votesPerStory[storyId] = {};
        rooms[roomId].votesRevealed[storyId] = false;
        io.to(roomId).emit('votesReset', { storyId });
      }
    }
  });

  // Handle story changes
  socket.on('storyChange', ({ story }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].story = story;
      io.to(roomId).emit('storyChange', { story });
    }
  });

  // Handle story navigation
  socket.on('storyNavigation', ({ index }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      io.to(roomId).emit('storyNavigation', { index });
    }
  });

  // Handle CSV data synchronization with improved state management
  socket.on('syncCSVData', (csvData) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Received CSV data for room ${roomId}, ${csvData.length} rows`);
      
      // Store the CSV data
      rooms[roomId].csvData = csvData;
      
      // Reset states when new CSV data is loaded
      rooms[roomId].selectedIndex = 0;
      rooms[roomId].votesPerStory = {}; 
      rooms[roomId].votesRevealed = {}; 
      
      // Broadcast to ALL clients in the room
      io.to(roomId).emit('syncCSVData', csvData);
    }
  });

  // Export votes data
  socket.on('exportVotes', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const exportData = {
        room: roomId,
        stories: rooms[roomId].csvData,
        votes: rooms[roomId].votesPerStory,
        revealed: rooms[roomId].votesRevealed,
        timestamp: new Date().toISOString()
      };
      
      socket.emit('exportData', exportData);
    }
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Client disconnected: ${socket.id} from room ${roomId}`);
      
      // Remove user from room
      rooms[roomId].users = rooms[roomId].users.filter(user => user.id !== socket.id);
      
      // Notify remaining users
      io.to(roomId).emit('userList', rooms[roomId].users);
      
      // Clean up empty rooms
      if (rooms[roomId].users.length === 0) {
        console.log(`[SERVER] Removing empty room: ${roomId}`);
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
