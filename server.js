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
  res.sendFile(join(__dirname, 'public', 'About.html'));
});
app.use(express.static(join(__dirname, 'public')));

// Enhanced room structure with improved state management
const rooms = {}; // roomId: { users, votes, story, revealed, csvData, selectedIndex, votesPerStory, votesRevealed, tickets, deletedStoryIds, deletedStoriesTimestamp, userNameVotes }
const roomVotingSystems = {}; // roomId → voting system

// Persistent user vote mapping
const userNameToIdMap = {}; // userName → { socketIds: [Array of past socket IDs] }

// Added function to comprehensively clean up room votes by username

function cleanupRoomVotes(roomId) {
  if (!rooms[roomId]) return false;

  let changesDetected = false;
  
  // Build a map of username → currently active socketId
  const usernameActiveSocketMap = {};
  
  // Track the newest socket ID for each username
  rooms[roomId].users.forEach(user => {
    usernameActiveSocketMap[user.name] = user.id;
  });

  // Process each story's votes
  for (const storyId in rooms[roomId].votesPerStory || {}) {
    if (rooms[roomId].deletedStoryIds?.has(storyId)) continue;
    
    // Track which usernames have already been processed
    const processedUsernames = new Set();
    // Build up a clean votes object
    const cleanedVotes = {};
    
    // First pass: Add votes from active socket IDs
    for (const socketId in rooms[roomId].votesPerStory[storyId]) {
      const user = rooms[roomId].users.find(u => u.id === socketId);
      
      if (user) {
        // This socket belongs to an active user
        const username = user.name;
        // Only include the vote from the active socket ID for this user
        if (usernameActiveSocketMap[username] === socketId) {
          cleanedVotes[socketId] = rooms[roomId].votesPerStory[storyId][socketId];
          processedUsernames.add(username);
        } else {
          // This is an old socket ID for a user who's still active
          changesDetected = true;
          console.log(`[CLEANUP] Removing old socket vote for ${username} (${socketId})`);
        }
      }
    }
    
    // Replace the votes object with our cleaned version
    const oldCount = Object.keys(rooms[roomId].votesPerStory[storyId]).length;
    const newCount = Object.keys(cleanedVotes).length;
    
    if (oldCount !== newCount) {
      changesDetected = true;
      console.log(`[CLEANUP] Story ${storyId}: Reduced votes from ${oldCount} to ${newCount}`);
      rooms[roomId].votesPerStory[storyId] = cleanedVotes;
    }
  }
  
  return changesDetected;
}

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
      continue;
    }
    
    // Also periodically clean up votes in active rooms
    cleanupRoomVotes(roomId);
  }
}

// Run cleanup every hour
setInterval(cleanupRoomData, 60 * 60 * 1000);

// Helper to find past votes for a specific user by name
function findExistingVotesForUser(roomId, userName) {
  if (!rooms[roomId] || !userName) return {};
  
  // First check for votes in the new username-based storage
  if (rooms[roomId].userNameVotes && rooms[roomId].userNameVotes[userName]) {
    return { ...rooms[roomId].userNameVotes[userName] };
  }
  
  // Legacy fallback to search by socket IDs
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

// Restore user votes to current socket, cleaning up old duplicates

function restoreUserVotesToCurrentSocket(roomId, socket) {
  const userName = socket.data.userName;
  if (!userName || !rooms[roomId]) return;

  const currentId = socket.id;
  
  // First, clear ALL votes from any old sockets with this username
  for (const storyId in rooms[roomId].votesPerStory) {
    if (rooms[roomId].deletedStoryIds?.has(storyId)) continue;
    
    const storyVotes = rooms[roomId].votesPerStory[storyId];
    for (const socketId in storyVotes) {
      const user = rooms[roomId].users.find(u => u.id === socketId);
      if (user && user.name === userName && socketId !== currentId) {
        delete storyVotes[socketId];
      }
    }
  }
  
  // Then restore votes properly
  const userVotes = rooms[roomId].userNameVotes?.[userName] || {};
  
  for (const [storyId, vote] of Object.entries(userVotes)) {
    if (rooms[roomId].deletedStoryIds?.has(storyId)) continue;
    
    if (!rooms[roomId].votesPerStory[storyId]) {
      rooms[roomId].votesPerStory[storyId] = {};
    }
    
    rooms[roomId].votesPerStory[storyId][currentId] = vote;
    socket.emit('restoreUserVote', { storyId, vote });
  }
  
  // Always run cleanup and broadcast changes
  cleanupRoomVotes(roomId);
  io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
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
  
  // New handler for username-based vote restoration
  socket.on('restoreUserVoteByUsername', ({ storyId, vote, userName }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || !storyId || !userName) return;
    
    if (rooms[roomId].deletedStoryIds?.has(storyId)) return;
    
    // Store in username-based system
    if (!rooms[roomId].userNameVotes) {
      rooms[roomId].userNameVotes = {};
    }
    if (!rooms[roomId].userNameVotes[userName]) {
      rooms[roomId].userNameVotes[userName] = {};
    }
    rooms[roomId].userNameVotes[userName][storyId] = vote;
    
    // Get all socket IDs associated with this user
    const userSocketIds = userNameToIdMap[userName]?.socketIds || [];
    
    // Flag to track if we removed any old votes (to avoid unnecessary broadcasts)
    let removedOldVotes = false;
    
    // Remove any previous votes by this user for this story
    if (!rooms[roomId].votesPerStory[storyId]) {
      rooms[roomId].votesPerStory[storyId] = {};
    }
    
    // IMPORTANT: Remove old socket ID votes for this user
    for (const oldSocketId of userSocketIds) {
      if (oldSocketId !== socket.id && rooms[roomId].votesPerStory[storyId][oldSocketId]) {
        delete rooms[roomId].votesPerStory[storyId][oldSocketId];
        removedOldVotes = true;
      }
    }
    
    // Add new vote with current socket ID
    rooms[roomId].votesPerStory[storyId][socket.id] = vote;
    
    // Send voteUpdate to everyone including sender
    io.to(roomId).emit('voteUpdate', { 
      userId: socket.id,
      vote, 
      storyId
    });
    
    // Only broadcast the full votesUpdate if we removed old votes
    if (removedOldVotes) {
      io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
    }
  });
  
  // Handler for requesting votes by username
  socket.on('requestVotesByUsername', ({ userName }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || !userName) return;
    
    console.log(`[SERVER] Client ${socket.id} requested votes for username ${userName}`);
    
    // Get all socket IDs associated with this user
    const userSocketIds = userNameToIdMap[userName]?.socketIds || [];
    
    // Flag to track if we removed any old votes (to avoid unnecessary broadcasts)
    let removedOldVotes = false;
    
    // First, clean up any old votes from this user's previous socket IDs
    // This is critical to prevent duplicate votes
    if (rooms[roomId].votesPerStory) {
      for (const storyId in rooms[roomId].votesPerStory) {
        for (const sid of userSocketIds) {
          if (sid !== socket.id && rooms[roomId].votesPerStory[storyId][sid]) {
            console.log(`[SERVER] Removing old vote from socket ${sid} for ${userName}`);
            delete rooms[roomId].votesPerStory[storyId][sid];
            removedOldVotes = true;
          }
        }
      }
    }
    
    // If we have username-tracked votes, restore them
    let userVotes = {};
    
    // First check the new username-based storage
    if (rooms[roomId].userNameVotes && rooms[roomId].userNameVotes[userName]) {
      userVotes = { ...rooms[roomId].userNameVotes[userName] };
      console.log(`[SERVER] Found ${Object.keys(userVotes).length} votes for username ${userName} in room ${roomId}`);
    } else {
      // Fallback to the legacy socket ID-based system
      userVotes = findExistingVotesForUser(roomId, userName);
      console.log(`[SERVER] Found ${Object.keys(userVotes).length} legacy votes for username ${userName} in room ${roomId}`);
      
      // Initialize the username votes storage if needed
      if (!rooms[roomId].userNameVotes) {
        rooms[roomId].userNameVotes = {};
      }
      if (!rooms[roomId].userNameVotes[userName]) {
        rooms[roomId].userNameVotes[userName] = {};
      }
      
      // Migrate the legacy votes to the username-based system
      for (const [storyId, vote] of Object.entries(userVotes)) {
        if (!rooms[roomId].deletedStoryIds.has(storyId)) {
          rooms[roomId].userNameVotes[userName][storyId] = vote;
        }
      }
    }
    
    // Restore the votes for all non-deleted stories
    for (const [storyId, vote] of Object.entries(userVotes)) {
      // Skip deleted stories
      if (rooms[roomId].deletedStoryIds.has(storyId)) continue;
      
      // First remove votes from any old socket IDs for this user
      if (!rooms[roomId].votesPerStory[storyId]) {
        rooms[roomId].votesPerStory[storyId] = {};
      }
      
const existingVote = rooms[roomId].votesPerStory[storyId]?.[socket.id];
if (existingVote !== vote) {
  rooms[roomId].votesPerStory[storyId][socket.id] = vote;
  socket.emit('restoreUserVote', { storyId, vote });
}
      
      // Broadcast to all other clients
      socket.broadcast.to(roomId).emit('voteUpdate', {
        userId: socket.id,
        vote,
        storyId
      });
      
      console.log(`[SERVER] Restored vote for ${userName} on story ${storyId}: ${vote}`);
    }
    
    // Clean up all votes to eliminate duplicates
    const changesDetected = cleanupRoomVotes(roomId);
    
    // Broadcast updated vote stats to ensure correct counting
    // But only if we removed old votes or restored new ones
    cleanupRoomVotes(roomId);
    io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);

    if (removedOldVotes || Object.keys(userVotes).length > 0 || changesDetected) {
      io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
    }
  });
  
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
      userNameVotes: {},
      lastActivity: Date.now()
    };
  }

  // Update room activity timestamp
  rooms[roomId].lastActivity = Date.now();

  // Track user name to socket ID mapping for vote persistence
  if (!userNameToIdMap[userName]) {
    userNameToIdMap[userName] = { socketIds: [] };
  }
  
  // STEP 1: REMOVE ALL PREVIOUS VOTES FOR THIS USER FIRST
  // This is critical to prevent duplicate votes
  let removedOldVotes = false;
  const previousSocketIds = [...userNameToIdMap[userName].socketIds];
  
  for (const storyId in rooms[roomId].votesPerStory) {
    if (rooms[roomId].deletedStoryIds.has(storyId)) continue;
    
    for (const oldSocketId of previousSocketIds) {
      if (oldSocketId !== socket.id && rooms[roomId].votesPerStory[storyId][oldSocketId]) {
        console.log(`[JOIN] Removing old vote for user ${userName} from socket ${oldSocketId} on story ${storyId}`);
        delete rooms[roomId].votesPerStory[storyId][oldSocketId];
        removedOldVotes = true;
      }
    }
  }

  // ADDITIONAL CLEANUP: Also ensure username votes are properly updated
  if (rooms[roomId].userNameVotes) {
    // For any story where we have username votes stored
    if (rooms[roomId].userNameVotes[userName]) {
      console.log(`[JOIN] Found ${Object.keys(rooms[roomId].userNameVotes[userName]).length} stored username votes for ${userName}`);
      
      // Synchronize these votes with the socket-based votes
      for (const storyId in rooms[roomId].userNameVotes[userName]) {
        if (rooms[roomId].deletedStoryIds.has(storyId)) {
          // Delete votes for deleted stories
          delete rooms[roomId].userNameVotes[userName][storyId];
          continue;
        }
        
        // Initialize the story vote object if needed
        if (!rooms[roomId].votesPerStory[storyId]) {
          rooms[roomId].votesPerStory[storyId] = {};
        }
        
        // Get the stored vote
        const vote = rooms[roomId].userNameVotes[userName][storyId];
        
        // Apply it to the current socket ID
        rooms[roomId].votesPerStory[storyId][socket.id] = vote;
        
        console.log(`[JOIN] Applied stored username vote for ${userName} on story ${storyId}: ${vote}`);
      }
    }
  }
  
  // Now add current socket ID to user's history (if not already present)
  if (!userNameToIdMap[userName].socketIds.includes(socket.id)) {
    userNameToIdMap[userName].socketIds.push(socket.id);
  }
  
  // Limit history to the last 5 IDs
  if (userNameToIdMap[userName].socketIds.length > 5) {
    userNameToIdMap[userName].socketIds = userNameToIdMap[userName].socketIds.slice(-5);
  }

  // STEP 2: UPDATE USER LIST - ENSURE ONLY ONE USER ENTRY PER USERNAME
  // Remove existing user with same ID if present
  rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
  
  // Also remove any users with the same name but different socket ID 
  // This ensures only one entry per user
  rooms[roomId].users = rooms[roomId].users.filter(u => u.name !== userName);
  
  // Add the current user
  rooms[roomId].users.push({ id: socket.id, name: userName });
  socket.join(roomId);

  // STEP 3: RESTORE USER VOTES FROM USERNAME-BASED STORAGE
  // This approach centralizes vote handling in one place
  if (rooms[roomId].userNameVotes && rooms[roomId].userNameVotes[userName]) {
    console.log(`[JOIN] Restoring ${Object.keys(rooms[roomId].userNameVotes[userName]).length} votes for user ${userName}`);
    
    for (const [storyId, vote] of Object.entries(rooms[roomId].userNameVotes[userName])) {
      if (rooms[roomId].deletedStoryIds.has(storyId)) continue;
      
      if (!rooms[roomId].votesPerStory[storyId]) {
        rooms[roomId].votesPerStory[storyId] = {};
      }
      
      // Set vote with current socket ID
      rooms[roomId].votesPerStory[storyId][socket.id] = vote;
      
      // Send to the client
      socket.emit('restoreUserVote', { storyId, vote });
    }
  }

  // STEP 4: PREPARE AND SEND DATA TO CLIENT
  // Filter active tickets and votes for non-deleted stories
  const activeTickets = rooms[roomId].tickets.filter(t => !rooms[roomId].deletedStoryIds.has(t.id));
  const activeVotes = {};
  const revealedVotes = {};

  for (const [storyId, votes] of Object.entries(rooms[roomId].votesPerStory)) {
    if (!rooms[roomId].deletedStoryIds.has(storyId)) {
      // Run a final duplicate check by username
      const uniqueUserVotes = {};
      const processedUsernames = new Set();
      
      // Only keep one vote per username (for the active socket)
      Object.keys(votes).forEach(socketId => {
        const userObj = rooms[roomId].users.find(u => u.id === socketId);
        if (userObj) {
          const username = userObj.name;
          if (!processedUsernames.has(username)) {
            uniqueUserVotes[socketId] = votes[socketId];
            processedUsernames.add(username);
          }
        }
      });
      
      activeVotes[storyId] = uniqueUserVotes;
      
      if (rooms[roomId].votesRevealed?.[storyId]) {
        revealedVotes[storyId] = true;
      }
    }
  }

  // Send state to newly connected client
  socket.emit('resyncState', {
    tickets: activeTickets,
    votesPerStory: activeVotes,
    votesRevealed: revealedVotes,
    deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds)
  });

  // Send voting system
  socket.emit('votingSystemUpdate', { votingSystem: roomVotingSystems[roomId] || 'fibonacci' });
  
  
  // Final deduplication and update broadcast after all joins and restores
  const changed = cleanupRoomVotes(roomId);
  if (removedOldVotes || changed) {
    console.log(`[JOIN] Broadcasting cleaned votes after join for ${userName}`);
    io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
  }

// STEP 5: BROADCAST UPDATES TO ALL CLIENTS
  // Broadcast updated user list
  io.to(roomId).emit('userList', rooms[roomId].users);
  
  // Clean up votes one more time to ensure consistency
  const cleanedVotes = cleanupRoomVotes(roomId);
  
  // Only broadcast if votes actually changed
  if (removedOldVotes || cleanedVotes) {
    // Create a final cleansed vote object to broadcast
    const cleanVotesPerStory = {};
    
    for (const storyId in rooms[roomId].votesPerStory) {
      if (rooms[roomId].deletedStoryIds.has(storyId)) continue;
      
      // Initialize the cleansed vote object for this story
      cleanVotesPerStory[storyId] = {};
      
      // Track which usernames we've already processed
      const processedUsernames = new Set();
      
      // Process the votes for this story
      for (const socketId in rooms[roomId].votesPerStory[storyId]) {
        // Find the user this socket belongs to
        const user = rooms[roomId].users.find(u => u.id === socketId);
        
        if (user) {
          // If we haven't processed this username yet, include this vote
          if (!processedUsernames.has(user.name)) {
            cleanVotesPerStory[storyId][socketId] = rooms[roomId].votesPerStory[storyId][socketId];
            processedUsernames.add(user.name);
          }
        }
      }
    }
    
    // Broadcast the cleansed votes
    io.to(roomId).emit('votesUpdate', cleanVotesPerStory);
  }
  
  // Send CSV data if available
  if (rooms[roomId].csvData.length > 0) {
    socket.emit('syncCSVData', rooms[roomId].csvData);
  }

  // Send selected story index
  if (typeof rooms[roomId].selectedIndex === 'number') {
    socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
  }
  
  // STEP 6: VERIFY VOTE STATUS AFTER A SHORT DELAY
  // This catches any remaining inconsistencies
  setTimeout(() => {
    if (!socket.connected) return; // Skip if socket disconnected
    
    // Verify each story vote
    for (const storyId in rooms[roomId].votesPerStory) {
      if (rooms[roomId].deletedStoryIds.has(storyId)) continue;
      
      // Find all votes by this user
      let userVoteCount = 0;
      let userVoteValue = null;
      
      for (const socketId in rooms[roomId].votesPerStory[storyId]) {
        const user = rooms[roomId].users.find(u => u.id === socketId && u.name === userName);
        if (user) {
          userVoteCount++;
          userVoteValue = rooms[roomId].votesPerStory[storyId][socketId];
        }
      }
      
      // If user has exactly one vote, ensure it's with the current socket ID
      if (userVoteCount === 1 && userVoteValue) {
        if (!rooms[roomId].votesPerStory[storyId][socket.id]) {
          console.log(`[JOIN] Fixing vote for user ${userName} on story ${storyId}`);
          rooms[roomId].votesPerStory[storyId][socket.id] = userVoteValue;
          socket.emit('restoreUserVote', { storyId, vote: userVoteValue });
        }
      } 
      // If user has multiple votes, clean them up
      else if (userVoteCount > 1) {
        console.log(`[JOIN] User ${userName} has ${userVoteCount} votes for story ${storyId}, cleaning up`);
        
        // Keep only the current socket ID vote
        for (const socketId in rooms[roomId].votesPerStory[storyId]) {
          const user = rooms[roomId].users.find(u => u.id === socketId && u.name === userName);
          if (user && socketId !== socket.id) {
            delete rooms[roomId].votesPerStory[storyId][socketId];
          }
        }
        
        // If we don't have a vote for the current socket, set one
        if (!rooms[roomId].votesPerStory[storyId][socket.id] && userVoteValue) {
          rooms[roomId].votesPerStory[storyId][socket.id] = userVoteValue;
          socket.emit('restoreUserVote', { storyId, vote: userVoteValue });
        }
        
        // Signal that changes were made
        io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
      }
    }
  }, 2000);
});
  

  
  
  // Handle explicit vote restoration requests
socket.on('restoreUserVote', ({ storyId, vote }) => {
  const roomId = socket.data.roomId;
  const userName = socket.data.userName;

  if (!roomId || !rooms[roomId] || !storyId) return;
  if (rooms[roomId].deletedStoryIds?.has(storyId)) return;

  // Initialize votesPerStory if needed
  if (!rooms[roomId].votesPerStory[storyId]) {
    rooms[roomId].votesPerStory[storyId] = {};
  }

  // 🧹 Step 1: Remove old socket votes for this user
  const userSocketIds = userNameToIdMap[userName]?.socketIds || [];
  let removedOldVotes = false;

  for (const sid of Object.keys(rooms[roomId].votesPerStory[storyId])) {
    if (sid !== socket.id && userSocketIds.includes(sid)) {
      delete rooms[roomId].votesPerStory[storyId][sid];
      removedOldVotes = true;
    }
  }

  // 🛡️ Step 2: Avoid re-adding same vote
  const currentVote = rooms[roomId].votesPerStory[storyId][socket.id];
  const voteChanged = currentVote !== vote;

  if (voteChanged) {
    rooms[roomId].votesPerStory[storyId][socket.id] = vote;

    // ✅ Only broadcast if vote changed
    socket.broadcast.to(roomId).emit('voteUpdate', {
      userId: socket.id,
      vote,
      storyId
    });
  }

  // ✅ Always tell the current user their vote, for UI restoration
  socket.emit('restoreUserVote', { storyId, vote });

  // ✅ Store in username-based map for persistence
  if (userName) {
    if (!rooms[roomId].userNameVotes) rooms[roomId].userNameVotes = {};
    if (!rooms[roomId].userNameVotes[userName]) rooms[roomId].userNameVotes[userName] = {};
    rooms[roomId].userNameVotes[userName][storyId] = vote;
  }

  // 🧼 Clean and re-check votes
  const cleaned = cleanupRoomVotes(roomId);

  // ✅ Re-broadcast full vote stats only if cleanup or vote changed
  if (removedOldVotes || voteChanged || cleaned) {
    io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
  }
});


  
  
  // Handle reconnection with full state resync
  socket.on('requestFullStateResync', () => {
    const roomId = socket.data.roomId;
    const userName = socket.data.userName;
    if (!roomId || !rooms[roomId]) return;

    console.log(`[SERVER] Full state resync requested by ${socket.id} for room ${roomId}`);

    // Update room activity timestamp
    rooms[roomId].lastActivity = Date.now();

    // Clean up votes based on username first
    cleanupRoomVotes(roomId);

    // Filter out deleted stories
    const filteredTickets = rooms[roomId].tickets.filter(ticket =>
      !rooms[roomId].deletedStoryIds.has(ticket.id)
    );

    // Prepare active votes and revealed states
    const activeVotes = {};
    const activeRevealed = {};

    // Flag to track if we need to broadcast updated vote stats
    let votesChanged = false;

    for (const [storyId, votes] of Object.entries(rooms[roomId].votesPerStory)) {
      if (!rooms[roomId].deletedStoryIds.has(storyId)) {
        const cleanedVotes = {};

        for (const [socketId, vote] of Object.entries(votes)) {
          // Exclude old socket IDs from the same user to avoid duplicates
          const belongsToSameUser = userName && 
                                   userNameToIdMap[userName]?.socketIds.includes(socketId) && 
                                   socketId !== socket.id;
          
          // Keep vote if it's not from the same user or is the current socket
          if (!belongsToSameUser) {
            cleanedVotes[socketId] = vote;
          } else {
            votesChanged = true; // Track that we removed a vote
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

    // Send selected story index
    if (typeof rooms[roomId].selectedIndex === 'number') {
      socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
    }

    // Re-send user-specific votes from username-based storage
    if (userName && rooms[roomId].userNameVotes && rooms[roomId].userNameVotes[userName]) {
      const userVotes = rooms[roomId].userNameVotes[userName];
      console.log(`[SERVER] Found ${Object.keys(userVotes).length} username-based votes to restore for ${userName}`);

      // Process each vote separately
      for (const [storyId, vote] of Object.entries(userVotes)) {
        if (rooms[roomId].deletedStoryIds.has(storyId)) continue;

        if (!rooms[roomId].votesPerStory[storyId]) {
          rooms[roomId].votesPerStory[storyId] = {};
        }

        // Clean up old votes from other socket IDs for this user
        const userSocketIds = userNameToIdMap[userName]?.socketIds || [];
        for (const sid of userSocketIds) {
          if (sid !== socket.id && rooms[roomId].votesPerStory[storyId][sid]) {
            delete rooms[roomId].votesPerStory[storyId][sid];
            votesChanged = true;
          }
        }
        
        // Apply new vote with current socket ID
        const prevVote = rooms[roomId].votesPerStory[storyId][socket.id];
        if (prevVote !== vote) {
          rooms[roomId].votesPerStory[storyId][socket.id] = vote;
          votesChanged = true;
        }
        
        // Tell the user about their vote
        socket.emit('restoreUserVote', { storyId, vote });
        
        // Tell everyone else
        socket.broadcast.to(roomId).emit('voteUpdate', {
          userId: socket.id,
          vote,
          storyId
        });
      }
      
      // Clean up all votes one more time
      if (cleanupRoomVotes(roomId)) {
        votesChanged = true;
      }
      
      // Broadcast updated vote stats if changes were made
      if (votesChanged) {
        io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
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
    
    // Clean up any duplicate votes first
    cleanupRoomVotes(roomId);
    
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
    
    // Flag to track if vote stats need to be broadcast
    let votesChanged = false;

    // First clean up any old votes from this user's previous socket IDs
    if (userName && userNameToIdMap[userName]) {
      const userSocketIds = userNameToIdMap[userName].socketIds;
      
      // For each story, remove votes from old socket IDs
      for (const storyId in rooms[roomId].votesPerStory) {
        for (const oldSocketId of userSocketIds) {
          if (oldSocketId !== socket.id && rooms[roomId].votesPerStory[storyId][oldSocketId]) {
            delete rooms[roomId].votesPerStory[storyId][oldSocketId];
            votesChanged = true;
          }
        }
      }
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
      
    // Restore user votes by username
    if (userName) {
      // Now restore votes
      let userVotes = {};
      if (rooms[roomId].userNameVotes && rooms[roomId].userNameVotes[userName]) {
        userVotes = rooms[roomId].userNameVotes[userName];
      } else {
        // Fallback to legacy socket ID-based votes
        userVotes = findExistingVotesForUser(roomId, userName);
      }
      
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
        
        // Only update if vote has changed
        const prevVote = rooms[roomId].votesPerStory[storyId][socket.id];
        if (prevVote !== vote) {
          rooms[roomId].votesPerStory[storyId][socket.id] = vote;
          votesChanged = true;
        }
        
        // Ensure this is stored in username-based system
        if (!rooms[roomId].userNameVotes) {
          rooms[roomId].userNameVotes = {};
        }
        if (!rooms[roomId].userNameVotes[userName]) {
          rooms[roomId].userNameVotes[userName] = {};
        }
        rooms[roomId].userNameVotes[userName][storyId] = vote;
        
        // Send the restored vote to the user
        socket.emit('restoreUserVote', { storyId, vote });
        
        // IMPORTANT: Also broadcast to all other users in the room
        socket.broadcast.to(roomId).emit('voteUpdate', {
          userId: socket.id,
          vote,
          storyId
        });
      }
      
      // Clean up any duplicate votes one more time
      if (cleanupRoomVotes(roomId)) {
        votesChanged = true;
      }
      
      // Once all votes are restored, broadcast updated vote stats
      if (votesChanged) {
        io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
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
    
    // CRITICAL: Also clean up username-based votes for this story
    if (rooms[roomId].userNameVotes) {
      for (const userName in rooms[roomId].userNameVotes) {
        if (rooms[roomId].userNameVotes[userName][storyId]) {
          delete rooms[roomId].userNameVotes[userName][storyId];
        }
      }
    }
    
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
          
          const userName = socket.data.userName;
          
          // First check username-based votes
          if (userName && rooms[roomId].userNameVotes && rooms[roomId].userNameVotes[userName] && rooms[roomId].userNameVotes[userName][storyId]) {
            const vote = rooms[roomId].userNameVotes[userName][storyId];
            
            // Store in socket ID-based system
            if (!rooms[roomId].votesPerStory[storyId]) {
              rooms[roomId].votesPerStory[storyId] = {};
            }
            rooms[roomId].votesPerStory[storyId][socket.id] = vote;
            
            // Send to client
            socket.emit('restoreUserVote', { storyId, vote });
            
            // Broadcast to others
            socket.broadcast.to(roomId).emit('voteUpdate', {
              userId: socket.id,
              vote,
              storyId
            });
            
            console.log(`[SERVER] Restored username-based vote for ${userName} on story ${storyId}: ${vote}`);
          }
          // Fallback to legacy check for user's previous vote
          else if (socket.data.userName) {
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
  socket.on('castVote', ({ vote, targetUserId, storyId, userName }) => {
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
    
    // Get the actual username to use
    const userNameToUse = userName || socket.data.userName;
    
    // Flag to track if we removed any old votes
    let removedOldVotes = false;
    
    // Remove any old votes from this user to prevent duplicates
    if (userNameToUse && userNameToIdMap[userNameToUse]) {
      const userSocketIds = userNameToIdMap[userNameToUse].socketIds;
      
      for (const oldSocketId of userSocketIds) {
        if (oldSocketId !== socket.id && rooms[roomId].votesPerStory[storyId][oldSocketId]) {
          delete rooms[roomId].votesPerStory[storyId][oldSocketId];
          removedOldVotes = true;
        }
      }
    }
    
    // Check if this is a new or changed vote
    const prevVote = rooms[roomId].votesPerStory[storyId][targetUserId];
    const isNewVote = prevVote !== vote;
    
    // Store the vote
    rooms[roomId].votesPerStory[storyId][targetUserId] = vote;
    
    // Also store in username-based system if we have a username
    if (userNameToUse) {
      if (!rooms[roomId].userNameVotes) {
        rooms[roomId].userNameVotes = {};
      }
      if (!rooms[roomId].userNameVotes[userNameToUse]) {
        rooms[roomId].userNameVotes[userNameToUse] = {};
      }
      rooms[roomId].userNameVotes[userNameToUse][storyId] = vote;
      console.log(`[SERVER] Stored vote for username ${userNameToUse} on story ${storyId}: ${vote}`);
    }
    
    // Broadcast to all clients about the specific vote
    io.to(roomId).emit('voteUpdate', { userId: targetUserId, vote, storyId });
    
    // Clean up all votes to ensure they're username-based deduplicated
    const votesChanged = cleanupRoomVotes(roomId);
    
    // Broadcast updated vote stats to ensure correct counting, but only if needed
    if (removedOldVotes || isNewVote || votesChanged) {
      io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
    }
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
    
    // Clean up votes before sending to ensure they're deduplicated
    cleanupRoomVotes(roomId);
    
    // Send story votes to the requesting client
    socket.emit('storyVotes', { 
      storyId, 
      votes: rooms[roomId].votesPerStory[storyId] || {} 
    });
    
    // Also send reveal status if applicable
    if (rooms[roomId].votesRevealed && rooms[roomId].votesRevealed[storyId]) {
      socket.emit('votesRevealed', { storyId });
    }
    
    // Check for user's previous vote by username first
    const userName = socket.data.userName;
    if (userName) {
      let foundVote = null;
      
      // First check in username-based store
      if (rooms[roomId].userNameVotes && 
          rooms[roomId].userNameVotes[userName] && 
          rooms[roomId].userNameVotes[userName][storyId]) {
        foundVote = rooms[roomId].userNameVotes[userName][storyId];
      }
      // Fallback to legacy method
      else {
        const userVotes = findExistingVotesForUser(roomId, userName);
        if (userVotes[storyId]) {
          foundVote = userVotes[storyId];
        }
      }
      
      // If a vote was found, restore it
      if (foundVote) {
        // Flag to track if we removed any old votes
        let removedOldVotes = false;
        
        // First clean up any old socket IDs
        if (userNameToIdMap[userName]) {
          const userSocketIds = userNameToIdMap[userName].socketIds;
          
          for (const oldSocketId of userSocketIds) {
            if (oldSocketId !== socket.id && rooms[roomId].votesPerStory[storyId][oldSocketId]) {
              delete rooms[roomId].votesPerStory[storyId][oldSocketId];
              removedOldVotes = true;
            }
          }
        }
        
        // Check if this is a new or changed vote
        const prevVote = rooms[roomId].votesPerStory[storyId][socket.id];
        const isNewVote = prevVote !== foundVote;
        
        rooms[roomId].votesPerStory[storyId][socket.id] = foundVote;
        
        // Tell the user about their vote
        socket.emit('restoreUserVote', { storyId, vote: foundVote });
        
        // IMPORTANT: Also broadcast to all other users
        socket.broadcast.to(roomId).emit('voteUpdate', {
          userId: socket.id,
          vote: foundVote,
          storyId
        });
        
        // Ensure it's stored in the username-based system
        if (!rooms[roomId].userNameVotes) {
          rooms[roomId].userNameVotes = {};
        }
        if (!rooms[roomId].userNameVotes[userName]) {
          rooms[roomId].userNameVotes[userName] = {};
        }
        rooms[roomId].userNameVotes[userName][storyId] = foundVote;
        
        // Broadcast updated vote stats if changes were made
        if (removedOldVotes || isNewVote) {
          // Clean up all votes to ensure they're username-based deduplicated
          cleanupRoomVotes(roomId);
          io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
        }
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
      
      // Clean up all votes to ensure they're deduplicated for accurate stats
      cleanupRoomVotes(roomId);
      
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
        
        // Also clear votes in username-based storage
        if (rooms[roomId].userNameVotes) {
          for (const userName in rooms[roomId].userNameVotes) {
            if (rooms[roomId].userNameVotes[userName][storyId]) {
              delete rooms[roomId].userNameVotes[userName][storyId];
            }
          }
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
      const preservedUsernameVotes = {};
      
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
      
      // Also preserve username-based votes for non-CSV stories
      if (rooms[roomId].userNameVotes) {
        for (const userName in rooms[roomId].userNameVotes) {
          preservedUsernameVotes[userName] = {};
          
          for (const storyId in rooms[roomId].userNameVotes[userName]) {
            if (!storyId.startsWith('story_csv_')) {
              preservedUsernameVotes[userName][storyId] = rooms[roomId].userNameVotes[userName][storyId];
            }
          }
        }
      }
      
      // Reset with preserved manual votes
      rooms[roomId].votesPerStory = preservedVotes;
      rooms[roomId].votesRevealed = preservedRevealed;
      rooms[roomId].userNameVotes = preservedUsernameVotes;
      
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
      
      // Clean up all votes to ensure data is deduplicated
      cleanupRoomVotes(roomId);
      
      // Prepare export data
      const exportData = {
        room: roomId,
        stories: rooms[roomId].csvData,
        votes: rooms[roomId].votesPerStory,
        revealed: rooms[roomId].votesRevealed,
        tickets: rooms[roomId].tickets.filter(t => !rooms[roomId].deletedStoryIds.has(t.id)),
        deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds),
        userNameVotes: rooms[roomId].userNameVotes,
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

    // IMPORTANT: Don't remove socket id from userNameToIdMap completely
    // Just limit the list size to prevent unlimited growth
    if (userName && userNameToIdMap[userName]) {
      if (userNameToIdMap[userName].socketIds.length > 5) {
        userNameToIdMap[userName].socketIds = userNameToIdMap[userName].socketIds.slice(-5);
      }
    }

    // Clean up any duplicate votes by username following disconnect
    let votesChanged = cleanupRoomVotes(roomId);

    // Broadcast updated user list
    io.to(roomId).emit('userList', rooms[roomId].users);

    // Broadcast updated vote stats to ensure correct counting
    if (votesChanged) {
      io.to(roomId).emit('votesUpdate', rooms[roomId].votesPerStory);
    }

    console.log(`[SERVER] Socket ${socket.id} disconnected from room ${roomId}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
      
