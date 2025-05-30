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
  pingTimeout: 120000, // Increased to 2 minutes for better idle handling
  pingInterval: 25000, // Ping interval at 25s (default)
  connectTimeout: 30000 // Increased connection timeout for reliability
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// added to call the main.html file
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'main.html'));
});
app.use(express.static(join(__dirname, 'public')));

// Enhanced room structure with improved state management
const rooms = {}; // roomId: { users, votes, story, revealed, csvData, selectedIndex, votesPerStory, votesRevealed, tickets, deletedStoryIds, deletedStoriesTimestamp }
const roomVotingSystems = {}; // roomId → voting system

// Persistent user vote mapping
const userNameToIdMap = {}; // userName → { socketIds: [Array of past socket IDs] }

// Periodic cleanup function to prevent memory leaks
function cleanupRoomData() {
  console.log('[SERVER] Running room data cleanup');
  const now = Date.now();

  for (const roomId in rooms) {
    const room = rooms[roomId];
    
    // Clean up any vote data for deleted stories that's over 24 hours old
    if (room.deletedStoriesTimestamp) {
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      
      for (const [storyId, timestamp] of Object.entries(room.deletedStoriesTimestamp)) {
        if (timestamp < oneDayAgo) {
          // Story deletion is more than a day old, clean up vote data
          if (room.votesPerStory) delete room.votesPerStory[storyId];
          if (room.votesRevealed) delete room.votesRevealed[storyId];
          console.log(`[SERVER] Cleaned up old vote data for story ${storyId} in room ${roomId}`);
        }
      }
    }
    
    // If room has been inactive for more than 7 days, remove it
    const lastActivity = room.lastActivity || 0;
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    
    if (lastActivity < sevenDaysAgo && room.users.length === 0) {
      console.log(`[SERVER] Removing inactive room: ${roomId}`);
      delete rooms[roomId];
      delete roomVotingSystems[roomId];
    }
  }
}

// Run cleanup every hour
setInterval(cleanupRoomData, 60 * 60 * 1000);

// Helper to find past votes for a specific user by name
function findExistingVotesForUser(roomId, userName) {
  if (!rooms[roomId] || !userName) return {};
  
  const result = {};
  
  // Get all socket IDs associated with this username
  const userMapping = userNameToIdMap[userName] || { socketIds: [] };
  
  // Check each story's votes
  for (const [storyId, votes] of Object.entries(rooms[roomId].votesPerStory || {})) {
    // Skip deleted stories
    if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
      continue;
    }
    
    // Check if any of the user's past IDs have votes for this story
    for (const pastSocketId of userMapping.socketIds) {
      if (votes[pastSocketId]) {
        result[storyId] = votes[pastSocketId];
        break; // Found a vote for this story, no need to check more IDs
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
const existingVote = rooms[roomId].votesPerStory[storyId]?.[currentId];
if (existingVote !== vote) {
  rooms[roomId].votesPerStory[storyId][currentId] = vote;
  socket.broadcast.to(roomId).emit('voteUpdate', { userId: currentId, vote, storyId });
}
socket.emit('restoreUserVote', { storyId, vote }); 
    
    
  }
}


io.on('connection', (socket) => {
  socket.on('requestCurrentStory', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const selectedIndex = rooms[roomId].selectedIndex;
    if (typeof selectedIndex === 'number') {
      const storyId = getCurrentStoryId(roomId, selectedIndex);
      if (storyId) {
        socket.emit('currentStory', {
          storyIndex: selectedIndex,
          storyId
        });
      }
    }
  });

  console.log(`[SERVER] New client connected: ${socket.id}`);
  
  // Handle room joining with enhanced state management
  socket.on('joinRoom', ({ roomId, userName }) => {
    if (!userName) return socket.emit('error', { message: 'Username is required' });

    socket.data.roomId = roomId;
    socket.data.userName = userName;

    // Initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        votes: {},
        story: [],
        revealed: false,
        csvData: [],
        selectedIndex: 0,
        votesPerStory: {},
        votesRevealed: {},
        tickets: [],
        deletedStoryIds: new Set(),
        deletedStoriesTimestamp: {},
        lastActivity: Date.now()
      };
    }

    // Update room activity timestamp
    rooms[roomId].lastActivity = Date.now();

    // Track user name to socket ID mapping for vote persistence
    if (!userNameToIdMap[userName]) {
      userNameToIdMap[userName] = { socketIds: [] };
    }
    
    // Add current socket ID to this user's history (if not already present)
    if (!userNameToIdMap[userName].socketIds.includes(socket.id)) {
      userNameToIdMap[userName].socketIds.push(socket.id);
    }
    
    // Limit the history to the last 5 IDs to prevent unlimited growth
    if (userNameToIdMap[userName].socketIds.length > 5) {
      userNameToIdMap[userName].socketIds = userNameToIdMap[userName].socketIds.slice(-5);
    }

    // Remove existing user with same ID if present
    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name: userName });
    socket.join(roomId);

    // Prepare active tickets and votes for this user
    const activeTickets = rooms[roomId].tickets.filter(t => !rooms[roomId].deletedStoryIds.has(t.id));
    const activeVotes = {};
    const revealedVotes = {};

    // Process votes for non-deleted stories
    for (const [storyId, votes] of Object.entries(rooms[roomId].votesPerStory)) {
      if (!rooms[roomId].deletedStoryIds.has(storyId)) {
        activeVotes[storyId] = votes;
        if (rooms[roomId].votesRevealed?.[storyId]) {
          revealedVotes[storyId] = true;
        }
      }
    }

    // Send comprehensive state to newly connected client
    socket.emit('resyncState', {
      tickets: activeTickets,
      votesPerStory: activeVotes,
      votesRevealed: revealedVotes,
      deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds) // Include deleted IDs for client-side filtering
    });
// Emit each vote explicitly for story-specific visibility
for (const storyId in rooms[roomId].votesPerStory) {
  if (!rooms[roomId].deletedStoryIds.has(storyId)) {
    const votes = rooms[roomId].votesPerStory[storyId];

    // ✅ Always send storyVotes
    socket.emit('storyVotes', { storyId, votes });

    // ✅ Re-send reveal status if already revealed
    if (rooms[roomId].votesRevealed?.[storyId]) {
      socket.emit('votesRevealed', { storyId });
    }
  }
}



    
 restoreUserVotesToCurrentSocket(roomId, socket);

    // Restore user's previous votes based on username
    const existingUserVotes = findExistingVotesForUser(roomId, userName);
    
    // Send user-specific votes that were found and broadcast them to all users
for (const [storyId, vote] of Object.entries(existingUserVotes)) {
  if (rooms[roomId].deletedStoryIds.has(storyId)) continue;

  if (!rooms[roomId].votesPerStory[storyId]) {
    rooms[roomId].votesPerStory[storyId] = {};
  }

  // Remove votes from previous socket IDs for this user
  for (const sid of Object.keys(rooms[roomId].votesPerStory[storyId])) {
    if (userNameToIdMap[userName]?.socketIds.includes(sid)) {
      delete rooms[roomId].votesPerStory[storyId][sid];
    }
  }

  // ✅ Re-assign vote to current socket
  const currentId = socket.id;
  const existingVote = rooms[roomId].votesPerStory[storyId]?.[currentId];
  if (existingVote !== vote) {
    rooms[roomId].votesPerStory[storyId][currentId] = vote;

    // ✅ Broadcast the vote to other users
    socket.broadcast.to(roomId).emit('voteUpdate', {
      userId: currentId,
      vote,
      storyId
    });
  }

  // ✅ Send it to the current user
  socket.emit('restoreUserVote', { storyId, vote });
}


    

    // Send voting system to client
    socket.emit('votingSystemUpdate', { votingSystem: roomVotingSystems[roomId] || 'fibonacci' });
    
    // Broadcast updated user list to all clients in room
    io.to(roomId).emit('userList', rooms[roomId].users);
    
    // Send CSV data if available
    if (rooms[roomId].csvData.length > 0) {
      socket.emit('syncCSVData', rooms[roomId].csvData);
    }

    // Send selected story index if available
    if (typeof rooms[roomId].selectedIndex === 'number') {
      socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
    }

    // Emit each vote explicitly for story-specific visibility
    for (const storyId in rooms[roomId].votesPerStory) {
      if (!rooms[roomId].deletedStoryIds.has(storyId)) {
        const votes = rooms[roomId].votesPerStory[storyId];
        socket.emit('storyVotes', { storyId, votes });
        if (rooms[roomId].votesRevealed?.[storyId]) {
          socket.emit('votesRevealed', { storyId });
        }
      }
    }
  });
  
  // Handle explicit vote restoration requests
socket.on('restoreUserVote', ({ storyId, vote }) => {
  const roomId = socket.data.roomId;
  const userName = socket.data.userName; // ✅ Add this

  if (!roomId || !rooms[roomId] || !storyId) return;

  if (rooms[roomId].deletedStoryIds?.has(storyId)) return;

  if (!rooms[roomId].votesPerStory[storyId]) {
    rooms[roomId].votesPerStory[storyId] = {};
  }

//  const userSocketIds = userNameToIdMap[userName]?.socketIds || [];
  const userSocketIds = userNameToIdMap[socket.data.userName]?.socketIds || [];


for (const sid of Object.keys(rooms[roomId].votesPerStory[storyId] || {})) {
  if (userSocketIds.includes(sid)) {
    delete rooms[roomId].votesPerStory[storyId][sid];
  }
}
const existingVote = rooms[roomId].votesPerStory[storyId]?.[socket.id];

if (existingVote !== vote) {
  rooms[roomId].votesPerStory[storyId][socket.id] = vote;

  // Broadcast only if it's a new vote
  socket.broadcast.to(roomId).emit('voteUpdate', {
    userId: socket.id,
    vote,
    storyId
  });
}

// Always inform the user (in case their UI needs restoring)
socket.emit('restoreUserVote', { storyId, vote });

  
});

  
  
  // Handle reconnection with full state resync
  
socket.on('requestFullStateResync', () => {
  const roomId = socket.data.roomId;
  const userName = socket.data.userName;
  if (!roomId || !rooms[roomId]) return;

  console.log(`[SERVER] Full state resync requested by ${socket.id} for room ${roomId}`);

  // Update room activity timestamp
  rooms[roomId].lastActivity = Date.now();

  // Filter out deleted stories
  const filteredTickets = rooms[roomId].tickets.filter(ticket =>
    !rooms[roomId].deletedStoryIds.has(ticket.id)
  );

  // Prepare active votes and revealed states
  const activeVotes = {};
  const activeRevealed = {};

  for (const [storyId, votes] of Object.entries(rooms[roomId].votesPerStory)) {
  if (!rooms[roomId].deletedStoryIds.has(storyId)) {
    const cleanedVotes = {};

    for (const [socketId, vote] of Object.entries(votes)) {
      const belongsToSameUser = userNameToIdMap[userName]?.socketIds.includes(socketId);
      const isCurrentSocket = socketId === socket.id;

      // Keep vote if it's from this user’s current connection or from other users
      if (!belongsToSameUser || isCurrentSocket) {
        cleanedVotes[socketId] = vote;
      }
    }

    activeVotes[storyId] = cleanedVotes;

    if (rooms[roomId].votesRevealed?.[storyId]) {
      activeRevealed[storyId] = true;
    }
  }
}

  // Send comprehensive state to client
  socket.emit('resyncState', {
    tickets: filteredTickets,
    votesPerStory: activeVotes,
    votesRevealed: activeRevealed,
    deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds)
  });

  // ✅ Send selected story index
  if (typeof rooms[roomId].selectedIndex === 'number') {
    socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
  }

  // Re-send user-specific votes
  if (userName) {
    const existingUserVotes = findExistingVotesForUser(roomId, userName);

    // Process each vote separately
    for (const [storyId, vote] of Object.entries(existingUserVotes)) {
      if (rooms[roomId].deletedStoryIds.has(storyId)) continue;

      if (!rooms[roomId].votesPerStory[storyId]) {
        rooms[roomId].votesPerStory[storyId] = {};
      }

      // ✅ Clean up old votes from other socket IDs for this user
      for (const sid of Object.keys(rooms[roomId].votesPerStory[storyId])) {
        if (userNameToIdMap[userName]?.socketIds.includes(sid)) {
          delete rooms[roomId].votesPerStory[storyId][sid];
        }
      }
const existingVote = rooms[roomId].votesPerStory[storyId]?.[socket.id];
if (existingVote !== vote) {
  rooms[roomId].votesPerStory[storyId][socket.id] = vote;
  socket.broadcast.to(roomId).emit('voteUpdate', {
    userId: socket.id,
    vote,
    storyId
  });
}
socket.emit('restoreUserVote', { storyId, vote });  

    
    }
  }
});



  
  
  // Handle reconnection
  socket.on('reconnect', () => {
    const roomId = socket.data.roomId;
    const userName = socket.data.userName;
    if (!roomId || !rooms[roomId]) return;
    
    console.log(`[SERVER] Client ${socket.id} reconnected to room ${roomId}`);
    
    // Update room activity timestamp
    rooms[roomId].lastActivity = Date.now();
    
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
      
    // Get this user's votes by username
    if (userName) {
      const userVotes = findExistingVotesForUser(roomId, userName);
      
      // Process each vote separately
      for (const [storyId, vote] of Object.entries(userVotes)) {
        // Skip deleted stories
        if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
          continue;
        }
        
        // Restore the vote in the server's state
        if (!rooms[roomId].votesPerStory[storyId]) {
          rooms[roomId].votesPerStory[storyId] = {};
        }
        rooms[roomId].votesPerStory[storyId][socket.id] = vote;
        
        // Send the restored vote to the user
        socket.emit('restoreUserVote', { storyId, vote });
        
        // IMPORTANT: Also broadcast to all other users in the room
        socket.broadcast.to(roomId).emit('voteUpdate', {
          userId: socket.id,
          vote,
          storyId
        });
      }
    }
  });
  
  // Handle ticket synchronization
  socket.on('addTicket', (ticketData) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] New ticket added to room ${roomId}:`, ticketData.id);
      
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
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
      
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
      // Track this story ID as deleted
      if (!rooms[roomId].deletedStoryIds) {
        rooms[roomId].deletedStoryIds = new Set();
      }
      rooms[roomId].deletedStoryIds.add(storyId);
      
      // Track deletion timestamp
      if (!rooms[roomId].deletedStoriesTimestamp) {
        rooms[roomId].deletedStoriesTimestamp = {};
      }
      rooms[roomId].deletedStoriesTimestamp[storyId] = Date.now();
      
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
      
      // Update room activity timestamp
      if (rooms[roomId]) {
        rooms[roomId].lastActivity = Date.now();
      }
      
      roomVotingSystems[roomId] = votingSystem;
      
      // Broadcast to all clients in the room
      io.to(roomId).emit('votingSystemUpdate', { votingSystem });
    }
  });
  
  // Handle story deletion with improved error handling and vote preservation
  socket.on('deleteStory', ({ storyId, isCsvStory, csvIndex }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    console.log(`[SERVER] Deleting story ${storyId} in room ${roomId}`);
    
    // Update room activity timestamp
    rooms[roomId].lastActivity = Date.now();
    
    // Ensure we have a deletedStoryIds set
    if (!rooms[roomId].deletedStoryIds) {
      rooms[roomId].deletedStoryIds = new Set();
    }
    
    // Mark as deleted
    rooms[roomId].deletedStoryIds.add(storyId);
    
    // Track deletion timestamp for cleanup
    if (!rooms[roomId].deletedStoriesTimestamp) {
      rooms[roomId].deletedStoriesTimestamp = {};
    }
    rooms[roomId].deletedStoriesTimestamp[storyId] = Date.now();
    
    // Remove from tickets array
    if (rooms[roomId].tickets) {
      rooms[roomId].tickets = rooms[roomId].tickets.filter(t => t.id !== storyId);
    }
    
    // Handle CSV data updates if it's a CSV story
    if (isCsvStory && !isNaN(csvIndex)) {
      if (rooms[roomId].csvData && csvIndex >= 0 && csvIndex < rooms[roomId].csvData.length) {
        rooms[roomId].csvData.splice(csvIndex, 1);
        io.to(roomId).emit('syncCSVData', rooms[roomId].csvData);
      }
    }
    
    // CRITICAL: Votes are not deleted — preserved for reference and reconnection
    // This allows users to see past votes even after refresh
    
    // Notify all clients about deletion
    io.to(roomId).emit('deleteStory', { storyId });
  });
  
  // Handle getting all tickets
  socket.on('requestAllTickets', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Ticket request from client ${socket.id}`);
      
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
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
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
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
          
          // Check for user's previous vote on this story
          if (socket.data.userName) {
            const userVotes = findExistingVotesForUser(roomId, socket.data.userName);
            if (userVotes[storyId]) {
              // If there's a previous vote, restore it
              if (!rooms[roomId].votesPerStory[storyId]) {
                rooms[roomId].votesPerStory[storyId] = {};
              }
              rooms[roomId].votesPerStory[storyId][socket.id] = userVotes[storyId];
              socket.emit('restoreUserVote', { storyId, vote: userVotes[storyId] });
              
              // Also broadcast this vote to everyone else
              socket.broadcast.to(roomId).emit('voteUpdate', {
                userId: socket.id,
                vote: userVotes[storyId],
                storyId
              });
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
      
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
      // Store the selected index in room state
      rooms[roomId].selectedIndex = storyIndex;
      
      // Broadcast to ALL clients in the room (including sender for confirmation)
      io.to(roomId).emit('storySelected', { storyIndex });
    }
  });

  // Handle user votes with improved story tracking and persistence
  socket.on('castVote', ({ vote, targetUserId, storyId }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || targetUserId !== socket.id) return;
    
    // Update room activity timestamp
    rooms[roomId].lastActivity = Date.now();
    
    // Don't accept votes for deleted stories
    if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
      console.log(`[SERVER] Ignoring vote for deleted story: ${storyId}`);
      return;
    }
    
    // Initialize vote tracking for this story if needed
    if (!rooms[roomId].votesPerStory[storyId]) {
      rooms[roomId].votesPerStory[storyId] = {};
    }
    
    // Store the vote
    rooms[roomId].votesPerStory[storyId][targetUserId] = vote;
    
    // Broadcast to all clients
    io.to(roomId).emit('voteUpdate', { userId: targetUserId, vote, storyId });
  });
  
  // Handle requests for votes for a specific story
  socket.on('requestStoryVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    // Update room activity timestamp
    rooms[roomId].lastActivity = Date.now();
    
    // Don't send votes for deleted stories
    if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
      console.log(`[SERVER] Ignoring vote request for deleted story: ${storyId}`);
      return;
    }
    
    // Initialize if needed
    if (!rooms[roomId].votesPerStory[storyId]) {
      rooms[roomId].votesPerStory[storyId] = {};
    }
    
    // Send story votes to the requesting client
    socket.emit('storyVotes', { 
      storyId, 
      votes: rooms[roomId].votesPerStory[storyId] || {} 
    });
    
    // Also send reveal status if applicable
    if (rooms[roomId].votesRevealed && rooms[roomId].votesRevealed[storyId]) {
      socket.emit('votesRevealed', { storyId });
    }
    
    // Check for user's previous vote on this story
    if (socket.data.userName) {
      const userVotes = findExistingVotesForUser(roomId, socket.data.userName);
      if (userVotes[storyId]) {
        // If there's a previous vote, restore it
        rooms[roomId].votesPerStory[storyId][socket.id] = userVotes[storyId];
        
        // Tell the user about their vote
        socket.emit('restoreUserVote', { storyId, vote: userVotes[storyId] });
        
        // IMPORTANT: Also broadcast to all other users
        socket.broadcast.to(roomId).emit('voteUpdate', {
          userId: socket.id,
          vote: userVotes[storyId],
          storyId
        });
      }
    }
  });

  // Handle vote revealing with improved persistence
  socket.on('revealVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Revealing votes for story: ${storyId} in room ${roomId}`);
      
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
      // Don't reveal votes for deleted stories
      if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
        console.log(`[SERVER] Cannot reveal votes for deleted story: ${storyId}`);
        return;
      }
      
      // Initialize revealed state tracking if needed
      if (!rooms[roomId].votesRevealed) {
        rooms[roomId].votesRevealed = {};
      }
      
      // Store the revealed state
      rooms[roomId].votesRevealed[storyId] = true;
      
      // Broadcast to all clients
      io.to(roomId).emit('votesRevealed', { storyId });
    }
  });

  // Handle vote reset for current story
  socket.on('resetVotes', ({ storyId }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
      // Reset votes for this story
      if (rooms[roomId].votesPerStory?.[storyId]) {
        rooms[roomId].votesPerStory[storyId] = {};
        
        // Also reset revealed state
        if (rooms[roomId].votesRevealed) {
          rooms[roomId].votesRevealed[storyId] = false;
        }
        
        // Broadcast reset to all clients
        io.to(roomId).emit('votesReset', { storyId });
      }
    }
  });

  // Handle story changes
  socket.on('storyChange', ({ story }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
      // Store story change
      rooms[roomId].story = story;
      
      // Broadcast to all clients
      io.to(roomId).emit('storyChange', { story });
    }
  });

  // Handle story navigation
  socket.on('storyNavigation', ({ index }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
      // Broadcast navigation to all clients
      io.to(roomId).emit('storyNavigation', { index });
    }
  });

  // Handle CSV data synchronization with improved state management
  socket.on('syncCSVData', (csvData) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Received CSV data for room ${roomId}, ${csvData.length} rows`);
      
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
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
      // Update room activity timestamp
      rooms[roomId].lastActivity = Date.now();
      
      // Prepare export data
      const exportData = {
        room: roomId,
        stories: rooms[roomId].csvData,
        votes: rooms[roomId].votesPerStory,
        revealed: rooms[roomId].votesRevealed,
        tickets: rooms[roomId].tickets.filter(t => !rooms[roomId].deletedStoryIds.has(t.id)),
        deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds),
        timestamp: new Date().toISOString()
      };
      
      // Send export data to client
      socket.emit('exportData', exportData);
    }
  });

  // Handle disconnections

socket.on('disconnect', () => {
  const roomId = socket.data.roomId;
  const userName = socket.data.userName;

  if (!roomId || !rooms[roomId]) return;

  // Remove this socket from users list
  rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);

  // Remove socket id from userNameToIdMap
  if (userName && userNameToIdMap[userName]) {
    userNameToIdMap[userName].socketIds = userNameToIdMap[userName].socketIds.filter(id => id !== socket.id);
    if (userNameToIdMap[userName].socketIds.length === 0) {
      delete userNameToIdMap[userName];
    }
  }

  // Remove votes for disconnected socket
  for (const storyId in rooms[roomId].votesPerStory) {
    if (rooms[roomId].votesPerStory[storyId][socket.id]) {
      delete rooms[roomId].votesPerStory[storyId][socket.id];
    }
  }

  // Broadcast updated user list
  io.to(roomId).emit('userList', rooms[roomId].users);

  // **Broadcast full updated votesPerStory object** (not just incremental)
  io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);

  console.log(`[SERVER] Socket ${socket.id} disconnected and cleaned up from room ${roomId}`);
});

  
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
