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
const rooms = {}; // roomId: { users, votes, story, revealed, csvData, selectedIndex, votesPerStory, votesRevealed, tickets, deletedStoryIds }
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
        votesRevealed: {}, // Track which stories have revealed votes
        tickets: [], // Initialize tickets array
        deletedStoryIds: new Set() // Track deleted story IDs
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
    
    // Send all tracked tickets filtered to exclude deleted stories
    if (rooms[roomId].tickets) {
      const filteredTickets = rooms[roomId].tickets.filter(ticket => 
        !rooms[roomId].deletedStoryIds || !rooms[roomId].deletedStoryIds.has(ticket.id)
      );
      
      if (filteredTickets.length > 0) {
        console.log(`[SERVER] Sending ${filteredTickets.length} active tickets to joining user ${socket.id}`);
        socket.emit('allTickets', { tickets: filteredTickets });
      }
    }
    
    // Send currently selected story
    if (typeof rooms[roomId].selectedIndex === 'number') {
      socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
    }
    
    // Send vote data and revealed state for all active stories
    const votesPerStory = rooms[roomId].votesPerStory || {};
    Object.keys(votesPerStory).forEach(storyId => {
      // Skip deleted stories
      if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
        return;
      }

      // Always send vote data first, then reveal state
      const votes = votesPerStory[storyId] || {};
      if (Object.keys(votes).length > 0) {
        console.log(`[SERVER] Sending votes for story ${storyId} to joining user:`, JSON.stringify(votes));
        socket.emit('storyVotes', { storyId, votes });
        
        // Then if revealed, send the reveal status
        if (rooms[roomId].votesRevealed?.[storyId]) {
          socket.emit('votesRevealed', { storyId });
        }
      }
    });
  });
  
  // Handle reconnection
  socket.on('reconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Client ${socket.id} reconnected to room ${roomId}`);
      
      // Re-send room state
      socket.emit('userList', rooms[roomId].users);
      
      // Resend CSV data first
      if (rooms[roomId].csvData?.length > 0) {
        socket.emit('syncCSVData', rooms[roomId].csvData);
      }
      
      // Send all tickets AFTER CSV data - filtered to exclude deleted stories
      if (rooms[roomId].tickets) {
        const filteredTickets = rooms[roomId].tickets.filter(ticket => 
          !rooms[roomId].deletedStoryIds || !rooms[roomId].deletedStoryIds.has(ticket.id)
        );
        
        console.log(`[SERVER] Sending ${filteredTickets.length} active tickets to reconnected user ${socket.id}`);
        socket.emit('allTickets', { tickets: filteredTickets });
      }
      
      // Send current story selection
      if (typeof rooms[roomId].selectedIndex === 'number') {
        socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
      }
      
      // Re-send votes and revealed state for all active stories
      const votesPerStory = rooms[roomId].votesPerStory || {};
      Object.keys(votesPerStory).forEach(storyId => {
        // Skip deleted stories
        if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
          return;
        }

        // Always send vote data first, then reveal state
        const votes = votesPerStory[storyId] || {};
        if (Object.keys(votes).length > 0) {
          console.log(`[SERVER] Resending votes for story ${storyId} to reconnected user:`, JSON.stringify(votes));
          socket.emit('storyVotes', { storyId, votes });
          
          // Then if revealed, send the reveal status
          if (rooms[roomId].votesRevealed?.[storyId]) {
            socket.emit('votesRevealed', { storyId });
          }
        }
      });
    }
  });
  
  // Handle ticket synchronization
  socket.on('addTicket', (ticketData) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] New ticket added to room ${roomId}:`, ticketData.id);
      
      // Make sure the ticket isn't in the deleted set
      if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(ticketData.id)) {
        rooms[roomId].deletedStoryIds.delete(ticketData.id);
      }
      
      // Broadcast the new ticket to everyone in the room EXCEPT sender
      socket.broadcast.to(roomId).emit('addTicket', { ticketData });
      
      // Keep track of tickets on the server
      if (!rooms[roomId].tickets) {
        rooms[roomId].tickets = [];
      }
      
      // Check for duplicate tickets before adding
      const existingIndex = rooms[roomId].tickets.findIndex(ticket => ticket.id === ticketData.id);
      if (existingIndex === -1) {
        rooms[roomId].tickets.push(ticketData);
        console.log(`[SERVER] Ticket added to server state. Total tickets: ${rooms[roomId].tickets.length}`);
      } else {
        console.log(`[SERVER] Ticket ${ticketData.id} already exists, not duplicating`);
      }
    }
  });
  
  socket.on('deleteCSVStory', ({ storyId, csvIndex }) => {
    const roomId = socket.data.roomId;
    
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] CSV story deleted in room ${roomId}: ${storyId}, csvIndex: ${csvIndex}`);
      
      // Track this story ID as deleted
      if (!rooms[roomId].deletedStoryIds) {
        rooms[roomId].deletedStoryIds = new Set();
      }
      rooms[roomId].deletedStoryIds.add(storyId);
      
      // Update the CSV data by removing the entry
      if (rooms[roomId].csvData && !isNaN(csvIndex) && csvIndex >= 0 && csvIndex < rooms[roomId].csvData.length) {
        rooms[roomId].csvData.splice(csvIndex, 1);
        
        // Re-sync the CSV data to all clients
        io.to(roomId).emit('syncCSVData', rooms[roomId].csvData);
        console.log(`[SERVER] Resynced CSV data after deletion, ${rooms[roomId].csvData.length} items remain`);
      }
      
      // Also remove from the tickets array but keep in deleted set
      if (rooms[roomId].tickets) {
        const previousCount = rooms[roomId].tickets.length;
        rooms[roomId].tickets = rooms[roomId].tickets.filter(ticket => ticket.id !== storyId);
        console.log(`[SERVER] Removed CSV story from tickets. Before: ${previousCount}, After: ${rooms[roomId].tickets.length}`);
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
      
      // Add this story ID to the set of deleted stories
      if (!rooms[roomId].deletedStoryIds) {
        rooms[roomId].deletedStoryIds = new Set();
      }
      rooms[roomId].deletedStoryIds.add(storyId);
      
      // Handle CSV story deletion
      if (isCsvStory && rooms[roomId].csvData) {
        if (!isNaN(csvIndex) && csvIndex >= 0 && csvIndex < rooms[roomId].csvData.length) {
          // Remove the item from csvData
          rooms[roomId].csvData.splice(csvIndex, 1);
          // Sync updated CSV data
          io.to(roomId).emit('syncCSVData', rooms[roomId].csvData);
        }
      }
      
      // Remove from tracked tickets but keep in deleted set
      if (rooms[roomId].tickets) {
        const previousCount = rooms[roomId].tickets.length;
        rooms[roomId].tickets = rooms[roomId].tickets.filter(ticket => ticket.id !== storyId);
        console.log(`[SERVER] Removed story from tickets array. Before: ${previousCount}, After: ${rooms[roomId].tickets.length}`);
      }
      
      // IMPORTANT: Keep votesPerStory and votesRevealed for the story to maintain consistency
      // This ensures votes remain accessible if other users refresh
      
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
      console.log(`[SERVER] Ticket request from client ${socket.id}`);
      
      // CRITICAL: Filter out deleted stories before sending
      const filteredTickets = rooms[roomId].tickets.filter(ticket => 
        !rooms[roomId].deletedStoryIds || !rooms[roomId].deletedStoryIds.has(ticket.id)
      );
      
      console.log(`[SERVER] Sending ${filteredTickets.length} active tickets (filtered from ${rooms[roomId].tickets.length} total)`);
      socket.emit('allTickets', { tickets: filteredTickets });
    } else {
      console.log(`[SERVER] No tickets available to send to client ${socket.id}`);
      socket.emit('allTickets', { tickets: [] });
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
        
        // Get the current storyId using the helper function
        const storyId = getCurrentStoryId(roomId, storyIndex);
        
        if (storyId) {
          // Send votes for the current story if any exist
          const existingVotes = rooms[roomId].votesPerStory[storyId] || {};
          if (Object.keys(existingVotes).length > 0) {
            socket.emit('storyVotes', { storyId, votes: existingVotes });
            
            // Also send vote reveal status
            if (rooms[roomId].votesRevealed[storyId]) {
              socket.emit('votesRevealed', { storyId });
            }
          }
        }
      }
    }
  });

  // Helper to get storyId from index
  function getCurrentStoryId(roomId, storyIndex) {
    if (!rooms[roomId] || !rooms[roomId].tickets) return null;
    
    // Get only active tickets (not deleted)
    const activeTickets = rooms[roomId].tickets.filter(ticket => 
      !rooms[roomId].deletedStoryIds || !rooms[roomId].deletedStoryIds.has(ticket.id)
    );
    
    // Try to find the storyId at the given index
    if (storyIndex >= 0 && storyIndex < activeTickets.length) {
      return activeTickets[storyIndex].id;
    }
    
    return null;
  }

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
      // Don't allow votes for deleted stories
      if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
        console.log(`[SERVER] Ignoring vote for deleted story: ${storyId}`);
        return;
      }
      
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
      // Don't send votes for deleted stories
      if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
        console.log(`[SERVER] Not sending votes for deleted story: ${storyId}`);
        return;
      }
      
      const votes = rooms[roomId].votesPerStory?.[storyId] || {};
      
      if (Object.keys(votes).length > 0) {
        console.log(`[SERVER] Sending requested votes for story ${storyId}:`, JSON.stringify(votes));
        socket.emit('storyVotes', { storyId, votes });
        
        // Send reveal state separately after votes
        if (rooms[roomId].votesRevealed?.[storyId]) {
          socket.emit('votesRevealed', { storyId });
        }
      } else {
        console.log(`[SERVER] No votes found for story ${storyId}`);
        socket.emit('storyVotes', { storyId, votes: {} });
      }
    }
  });

  // Handle vote revealing with improved persistence
  socket.on('revealVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Revealing votes for story: ${storyId} in room ${roomId}`);
      
      // Don't reveal votes for deleted stories
      if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
        console.log(`[SERVER] Cannot reveal votes for deleted story: ${storyId}`);
        return;
      }
      
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
      
      // Reset selection when new CSV data is loaded
      rooms[roomId].selectedIndex = 0;
      
      // Keep track of manually added tickets (not from CSV)
      let manualTickets = [];
      if (rooms[roomId].tickets) {
        // Identify and keep manual tickets (non-CSV)
        manualTickets = rooms[roomId].tickets.filter(ticket => 
          !ticket.id.startsWith('story_csv_')
        );
        console.log(`[SERVER] Preserved ${manualTickets.length} manual tickets during CSV sync`);
      }
      
      // Remove all old CSV tickets
      if (rooms[roomId].tickets) {
        rooms[roomId].tickets = rooms[roomId].tickets.filter(ticket => 
          !ticket.id.startsWith('story_csv_')
        );
      }
      
      // Reset the deleted story IDs for CSV stories only
      if (rooms[roomId].deletedStoryIds) {
        const newDeletedSet = new Set();
        rooms[roomId].deletedStoryIds.forEach(id => {
          // Keep only non-CSV story IDs in the deleted set
          if (!id.startsWith('story_csv_')) {
            newDeletedSet.add(id);
          }
        });
        rooms[roomId].deletedStoryIds = newDeletedSet;
      }
      
      // Preserve votes only for manual tickets that still exist
      const preservedVotes = {};
      const preservedRevealed = {};
      
      if (rooms[roomId].votesPerStory) {
        Object.keys(rooms[roomId].votesPerStory).forEach(storyId => {
          // Keep votes only for non-CSV stories
          if (!storyId.startsWith('story_csv_')) {
            preservedVotes[storyId] = rooms[roomId].votesPerStory[storyId];
          }
        });
      }
      
      if (rooms[roomId].votesRevealed) {
        Object.keys(rooms[roomId].votesRevealed).forEach(storyId => {
          // Keep revealed status only for non-CSV stories
          if (!storyId.startsWith('story_csv_')) {
            preservedRevealed[storyId] = rooms[roomId].votesRevealed[storyId];
          }
        });
      }
      
      // Reset with preserved manual votes
      rooms[roomId].votesPerStory = preservedVotes;
      rooms[roomId].votesRevealed = preservedRevealed;
      
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
        tickets: rooms[roomId].tickets,
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
