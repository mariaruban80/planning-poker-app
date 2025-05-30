// === socket.js ===
import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

// Module state
let socket = null;
let selectedStoryIndex = null;
let roomId = null;
let userName = null;
let reconnectionEnabled = true;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectTimer = null;
let lastKnownRoomState = {
  votesPerStory: {},  // Initialize sub-objects
  votesRevealed: {},
  deletedStoryIds: [], // Using an array instead of a Set
  tickets: [],
  userVotes: {}      // Track user's own votes by storyId
};
let debugMode = false; // Added debug flag

/**
 * Enable or disable debug mode
 * @param {boolean} enable - Whether to enable debug logging
 */
export function setDebugMode(enable) {
  debugMode = enable;
  console.log(`[SOCKET] Debug mode ${enable ? 'enabled' : 'disabled'}`);
}

/**
 * Enhanced logging function with debug mode support
 * @param {string} message - The message to log
 * @param {*} data - Optional data to log
 */
function logDebug(message, data) {
  if (debugMode) {
    if (data !== undefined) {
      console.log(`[SOCKET DEBUG] ${message}`, data);
    } else {
      console.log(`[SOCKET DEBUG] ${message}`);
    }
  }
}

/**
 * Initialize WebSocket connection to server
 * @param {string} roomIdentifier - ID of the room to join
 * @param {string} userNameValue - Username for the current user
 * @param {Function} handleMessage - Callback to handle incoming messages
 * @returns {Object} - Socket instance for external reference
 */
export function initializeWebSocket(roomIdentifier, userNameValue, handleMessage) {
  // First verify that we have a valid username
  if (!userNameValue) {
    console.error('[SOCKET] Cannot initialize without a username');
    return null;
  }
  
  // Store params for potential reconnection
  roomId = roomIdentifier;
  userName = userNameValue;
  reconnectAttempts = 0;
  
  // Reset lastKnownRoomState to avoid carrying over state from previous sessions
  lastKnownRoomState = {
    votesPerStory: {},
    votesRevealed: {},
    deletedStoryIds: [], // Using an array instead of a Set
    tickets: [],
    userVotes: {}      // Track user's own votes by storyId
  };
  
  // Initialize socket connection with improved reconnection settings
  socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: maxReconnectAttempts,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    query: { roomId: roomIdentifier, userName: userNameValue }
  });

  // Try to load deleted stories from localStorage (these are shared across sessions)
  loadDeletedStoriesFromStorage(roomIdentifier);
  
  // ------------------------------
  // Socket Event Handlers
  // ------------------------------

  socket.on('addTicket', ({ ticketData }) => {
    console.log('[SOCKET] Received new ticket from another user:', ticketData);
    
    // Check if this ticket is in our deleted stories list
    if (lastKnownRoomState.deletedStoryIds.includes(ticketData.id)) {
      console.log('[SOCKET] Ignoring ticket that was previously deleted:', ticketData.id);
      return;
    }
    
    // Add to local state if we're tracking tickets
    if (!lastKnownRoomState.tickets.some(t => t.id === ticketData.id)) {
      lastKnownRoomState.tickets.push(ticketData);
    }
    
    handleMessage({ type: 'addTicket', ticketData });
  });

  socket.on('allTickets', ({ tickets }) => {
    console.log('[SOCKET] Received all tickets:', tickets.length);
    
    // Filter out any deleted tickets first
    const filteredTickets = tickets.filter(ticket => 
      !lastKnownRoomState.deletedStoryIds.includes(ticket.id)
    );
    
    // Store filtered tickets in last known state
    lastKnownRoomState.tickets = filteredTickets || [];
    
    handleMessage({ type: 'allTickets', tickets: filteredTickets });
  });

  // Connection established
  socket.on('connect', () => {
    console.log('[SOCKET] Connected to server with ID:', socket.id);
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    
    // When connecting, explicitly join the room
    socket.emit('joinRoom', { roomId: roomIdentifier, userName: userNameValue });
    
    // Request current selected story from server after join
    socket.emit('requestCurrentStory');
    
    socket.on('currentStory', ({ storyIndex, storyId }) => {
      console.log('[SOCKET] Received currentStory:', storyIndex, storyId);
      selectedStoryIndex = storyIndex;
      lastKnownRoomState.selectedIndex = storyIndex;
      
      handleMessage({ type: 'storySelected', storyIndex });
      
      if (storyId) {
        socket.emit('requestStoryVotes', { storyId });
      }
    });
    
    // Listen for votes updates from server
    socket.on('votesUpdate', (votesData) => {
      console.log('[SOCKET] votesUpdate received:', votesData);
      handleMessage({ type: 'votesUpdate', votesData });  // Forward to UI handler
    });
    
    // Notify UI of successful connection
    handleMessage({ type: 'connect' });
    
    // After connecting, we DO NOT want to auto-restore votes, as this could cause conflicts
    // We'll wait for the server to provide votes during sync
  });

  // Add reconnect event handlers
  socket.on('reconnect_attempt', (attempt) => {
    console.log(`[SOCKET] Reconnection attempt ${attempt}`);
    reconnectAttempts = attempt;
    
    // Notify UI of reconnection attempt
    handleMessage({ type: 'reconnect_attempt', attempt });
  });

  // Successful reconnection
  socket.on('reconnect', () => {
    console.log('[SOCKET] Reconnected to server after disconnect');
    clearTimeout(reconnectTimer);
    
    // Re-join room and request current state
    socket.emit('joinRoom', { roomId: roomIdentifier, userName: userNameValue });
    
    // Explicitly request a full state resync after a short delay
    setTimeout(() => {
      if (socket && socket.connected) {
        console.log('[SOCKET] Requesting full state resync after reconnection');
        socket.emit('requestFullStateResync');
        
        // We'll let the server provide the right votes rather than forcing restoration
        // from localStorage, which could be out of date or incorrect
      }
    }, 500);
    
    // Notify UI of successful reconnection
    handleMessage({ type: 'reconnect' });
    
    // Reset reconnection attempts counter
    reconnectAttempts = 0;
  });
  
  socket.on('reconnect_error', (error) => {
    console.error('[SOCKET] Reconnection error:', error);
    
    // Notify UI of reconnection error
    handleMessage({ type: 'error', error: error.toString() });
    
    // Try again if below the max attempts with a manual reconnect if needed
    if (reconnectAttempts < maxReconnectAttempts && reconnectionEnabled) {
      console.log(`[SOCKET] Will attempt reconnection again (${reconnectAttempts}/${maxReconnectAttempts})`);
      // Set a backup timer to try reconnect if the built-in mechanism fails
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (socket && !socket.connected && reconnectionEnabled) {
          console.log('[SOCKET] Attempting manual reconnection...');
          socket.connect();
        }
      }, 5000);
    } else {
      console.error('[SOCKET] Maximum reconnection attempts reached');
      // Notify UI that no further reconnection attempts will be made
      handleMessage({ type: 'reconnection_failed' });
    }
  });
  
  socket.on('disconnect', (reason) => {
    console.log('[SOCKET] Disconnected from server. Reason:', reason);
    
    // Auto-reconnect for these specific reasons
    if (reason === 'io server disconnect' && reconnectionEnabled) {
      // The server intentionally disconnected us
      console.log('[SOCKET] Server disconnected us, attempting reconnect');
      socket.connect();
    } else if (reconnectionEnabled) {
      // Set a backup timer for reconnection
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (!socket.connected) {
          console.log('[SOCKET] Attempting reconnect after disconnect...');
          socket.connect();
        }
      }, 3000);
    }
    
    // Notify UI of disconnect
    handleMessage({ type: 'disconnect', reason });
  });

  socket.on('userList', (users) => {
    handleMessage({ type: 'userList', users });
  });
  
  // Handle voting system updates from server
  socket.on('votingSystemUpdate', data => {
    console.log('[SOCKET DEBUG] votingSystemUpdate received:', data);
    
    // Store in last known state
    lastKnownRoomState.votingSystem = data.votingSystem;
    
    // Forward this to the handler
    handleMessage({ type: 'votingSystemUpdate', ...data });
  });

  socket.on('syncCSVData', (csvData) => {
    console.log('[SOCKET] Received CSV data:', Array.isArray(csvData) ? csvData.length : 'invalid', 'rows');
    
    // Store in last known state
    lastKnownRoomState.csvData = csvData;
    
    handleMessage({ type: 'syncCSVData', csvData });
    
    // Notify server that CSV data is loaded
    setTimeout(() => {
      console.log('[SOCKET] Notifying server that CSV data is loaded');
      if (socket && socket.connected) {
        socket.emit('csvDataLoaded');
      }
    }, 100);
  });

  socket.on('storySelected', ({ storyIndex }) => {
    console.log('[SOCKET] Story selected event received:', storyIndex);
    selectedStoryIndex = storyIndex;
    
    // Store in last known state
    lastKnownRoomState.selectedIndex = storyIndex;
    
    handleMessage({ type: 'storySelected', storyIndex });
    
    // When a story is selected, request votes for it to ensure we have the latest
    setTimeout(() => {
      const selectedCard = document.querySelector('.story-card.selected');
      if (selectedCard && socket && socket.connected) {
        const storyId = selectedCard.id; 
        if (storyId && !lastKnownRoomState.deletedStoryIds.includes(storyId)) {
          console.log(`[SOCKET] Requesting votes for newly selected story: ${storyId}`);
          socket.emit('requestStoryVotes', { storyId });
        }
      }
    }, 100);
  });

  socket.on('voteUpdate', ({ userId, vote, storyId }) => {
    // Check if we should ignore this because the story is deleted
    if (isStoryDeleted(storyId)) {
      logDebug(`Ignoring vote for deleted story: ${storyId}`);
      return;
    }
    
    console.log(`[SOCKET] Vote update received: ${userId} voted ${vote} for story ${storyId}`);
    
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesPerStory[storyId][userId] = vote;
    
    // If this is the current user's vote, store it separately for easier recovery
    if (socket && userId === socket.id) {
      if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
      lastKnownRoomState.userVotes[storyId] = vote;
      
      // Save to localStorage for persistence across page refreshes
      // This ONLY includes the current user's votes, not others
      saveUserVotesToStorage();
    }
    
    handleMessage({ type: 'voteUpdate', userId, vote, storyId });
  });

  socket.on('storyVotes', ({ storyId, votes }) => {
    // Check if we should ignore this because the story is deleted
    if (isStoryDeleted(storyId)) {
      logDebug(`Ignoring votes for deleted story: ${storyId}`);
      return;
    }
    
    console.log(`[SOCKET] Received votes for story ${storyId}:`, Object.keys(votes).length);
    
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    lastKnownRoomState.votesPerStory[storyId] = votes || {};
    
    // Also update our personal votes record if our vote is included
    if (socket && votes[socket.id]) {
      if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
      lastKnownRoomState.userVotes[storyId] = votes[socket.id];
      saveUserVotesToStorage();
    }
    
    handleMessage({ type: 'storyVotes', storyId, votes });
  });

  // Handler for restoring user votes - only applies to current user
  socket.on('restoreUserVote', ({ storyId, vote }) => {
    // Check if we should ignore this because the story is deleted
    if (isStoryDeleted(storyId)) {
      logDebug(`Ignoring vote restoration for deleted story: ${storyId}`);
      return;
    }
    
    console.log(`[SOCKET] Restoring user vote for story ${storyId}: ${vote}`);
    
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    
    // ONLY update our own vote, never others'
    if (socket) {
      lastKnownRoomState.votesPerStory[storyId][socket.id] = vote;
      
      // Also track in user's personal votes
      if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
      lastKnownRoomState.userVotes[storyId] = vote;
      
      // Save to localStorage for persistence across page refreshes
      saveUserVotesToStorage();
    }
    
    handleMessage({ type: 'restoreUserVote', storyId, vote });
  });

  socket.on('votesRevealed', ({ storyId }) => {
    // Check if we should ignore this because the story is deleted
    if (isStoryDeleted(storyId)) {
      logDebug(`Ignoring vote reveal for deleted story: ${storyId}`);
      return;
    }
    
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    lastKnownRoomState.votesRevealed[storyId] = true;
    
    saveRevealedStateToStorage();
    
    handleMessage({ type: 'votesRevealed', storyId });
  });

  socket.on('deleteStory', ({ storyId }) => {
    console.log('[SOCKET] Story deletion event received:', storyId);
    
    // Add to deleted story IDs
    addToDeletedStories(storyId);
    
    // Also remove the ticket from our local state
    lastKnownRoomState.tickets = lastKnownRoomState.tickets.filter(t => t.id !== storyId);
    
    // Remove any votes for this story from userVotes to avoid restoration
    if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
      delete lastKnownRoomState.userVotes[storyId];
      saveUserVotesToStorage();
    }
    
    // Remove votes for this story from votesPerStory
    if (lastKnownRoomState.votesPerStory && lastKnownRoomState.votesPerStory[storyId]) {
      delete lastKnownRoomState.votesPerStory[storyId];
    }
    
    // Remove reveal status for this story
    if (lastKnownRoomState.votesRevealed && lastKnownRoomState.votesRevealed[storyId]) {
      delete lastKnownRoomState.votesRevealed[storyId];
      saveRevealedStateToStorage();
    }
    
    handleMessage({ type: 'deleteStory', storyId });
  });

  socket.on('votesReset', ({ storyId }) => {
    // Clear from last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    
    lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesRevealed[storyId] = false;
    
    // Also clear from user's personal votes
    if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
      delete lastKnownRoomState.userVotes[storyId];
      saveUserVotesToStorage();
    }
    
    handleMessage({ type: 'votesReset', storyId });
  });

  socket.on('revealVotes', (votes) => {
    console.log('[SOCKET] Reveal votes event received (legacy)');
    handleMessage({ type: 'revealVotes', votes });
  });

  socket.on('storyChange', ({ story }) => {
    lastKnownRoomState.story = story;
    
    handleMessage({ type: 'storyChange', story });
  });

  socket.on('storyNavigation', ({ index }) => {
    handleMessage({ type: 'storyNavigation', index });
  });

  socket.on('exportData', (data) => {
    console.log('[SOCKET] Received export data with', 
      data.stories ? data.stories.length : 0, 'stories and',
      data.votes ? Object.keys(data.votes).length : 0, 'vote sets');
    handleMessage({ type: 'exportData', data });
  });

  socket.on('connect_error', (error) => {
    console.error('[SOCKET] Connection error:', error);
    handleMessage({ type: 'error', error: error.toString() });
    
    // Try to reconnect after a delay if enabled
    if (reconnectionEnabled && reconnectAttempts < maxReconnectAttempts) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (!socket.connected) {
          console.log('[SOCKET] Attempting reconnect after connection error...');
          socket.connect();
        }
      }, 3000);
    }
  });
  
  // Enhanced state sync handling
  socket.on('resyncState', (state) => {
    console.log('[SOCKET] Received full state resync from server');
    
    // Initialize the state objects if they don't exist
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    if (!lastKnownRoomState.deletedStoryIds) lastKnownRoomState.deletedStoryIds = [];
    if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
    
    // Update deleted story IDs first (so we can filter correctly)
    if (Array.isArray(state.deletedStoryIds)) {
      state.deletedStoryIds.forEach(id => {
        if (!lastKnownRoomState.deletedStoryIds.includes(id)) {
          lastKnownRoomState.deletedStoryIds.push(id);
        }
      });
      
      // Save to localStorage for persistence
      saveDeletedStoriesToStorage();
    }
    
    // Filter out any deleted tickets
    const filteredTickets = (state.tickets || []).filter(
      ticket => !isStoryDeleted(ticket.id)
    );
    
    // Store selected index for later use
    const selectedIndex = state.selectedIndex;
    
    // Now store the filtered state
    lastKnownRoomState.tickets = filteredTickets;
    lastKnownRoomState.selectedIndex = selectedIndex;
    
    // IMPORTANT: For votes, only copy them, don't merge with existing votes
    // This ensures we get a clean state from the server
    lastKnownRoomState.votesPerStory = state.votesPerStory || {};
    lastKnownRoomState.votesRevealed = state.votesRevealed || {};
    
    // Update our own vote records based on server data
    if (socket && state.votesPerStory) {
      lastKnownRoomState.userVotes = {};  // Reset user votes
      
      // For each story with votes
      for (const [storyId, votes] of Object.entries(state.votesPerStory)) {
        // If the story has our vote, record it
        if (votes[socket.id]) {
          lastKnownRoomState.userVotes[storyId] = votes[socket.id];
        }
      }
      
      // Save updated user votes
      saveUserVotesToStorage();
    }
    
    // Forward to message handler
    handleMessage({ 
      type: 'resyncState', 
      tickets: filteredTickets,  // Use filtered tickets
      votesPerStory: state.votesPerStory || {},
      votesRevealed: state.votesRevealed || {},
      deletedStoryIds: lastKnownRoomState.deletedStoryIds, // Use our complete list
      selectedIndex: selectedIndex
    });
    
    // Apply story selection after a delay to ensure DOM is ready
    setTimeout(() => {
      if (typeof selectedIndex === 'number') {
        handleMessage({
          type: 'storySelected',
          storyIndex: selectedIndex,
          forceSelection: true
        });
      }
    }, 500);
  });

  // Return socket for external operations if needed
  return socket;
}

/**
 * Helper to check if a story is deleted
 * @param {string} storyId - ID of the story to check
 * @returns {boolean} - Whether the story is deleted
 */
function isStoryDeleted(storyId) {
  return lastKnownRoomState.deletedStoryIds && 
         lastKnownRoomState.deletedStoryIds.includes(storyId);
}

/**
 * Helper to add a story to the deleted list
 * @param {string} storyId - ID of the story to mark as deleted
 */
function addToDeletedStories(storyId) {
  // Ensure the array exists
  if (!lastKnownRoomState.deletedStoryIds) {
    lastKnownRoomState.deletedStoryIds = [];
  }
  
  // Only add if not already included
  if (!lastKnownRoomState.deletedStoryIds.includes(storyId)) {
    lastKnownRoomState.deletedStoryIds.push(storyId);
    saveDeletedStoriesToStorage();
  }
}

/**
 * Helper to save deleted stories to storage
 */
function saveDeletedStoriesToStorage() {
  try {
    const deletedData = JSON.stringify(lastKnownRoomState.deletedStoryIds);
    localStorage.setItem(`deleted_${roomId}`, deletedData);
    logDebug(`Saved ${lastKnownRoomState.deletedStoryIds.length} deleted story IDs to localStorage`);
  } catch (err) {
    console.warn('[SOCKET] Could not save deleted story IDs to localStorage:', err);
  }
}

/**
 * Helper to save user votes to storage
 * Only saves the current user's votes, not others'
 */
function saveUserVotesToStorage() {
  if (!socket) return;
  
  try {
    const votesData = JSON.stringify(lastKnownRoomState.userVotes || {});
    const userVotesKey = `votes_${roomId}_${socket.id}`;  // Include user ID to isolate votes
    localStorage.setItem(userVotesKey, votesData);
    logDebug(`Saved ${Object.keys(lastKnownRoomState.userVotes || {}).length} user votes to localStorage with key ${userVotesKey}`);
  } catch (err) {
    console.warn('[SOCKET] Could not save votes to localStorage:', err);
  }
}

/**
 * Helper to save revealed state to storage
 */
function saveRevealedStateToStorage() {
  try {
    const revealedData = JSON.stringify(lastKnownRoomState.votesRevealed || {});
    localStorage.setItem(`revealed_${roomId}`, revealedData);
    logDebug(`Saved revealed state to localStorage`);
  } catch (err) {
    console.warn('[SOCKET] Could not save revealed state to localStorage:', err);
  }
}

/**
 * Load deleted stories from localStorage
 */
function loadDeletedStoriesFromStorage(roomId) {
  try {
    const deletedData = localStorage.getItem(`deleted_${roomId}`);
    if (deletedData) {
      const parsedDeleted = JSON.parse(deletedData);
      if (Array.isArray(parsedDeleted)) {
        lastKnownRoomState.deletedStoryIds = parsedDeleted;
        console.log(`[SOCKET] Loaded ${parsedDeleted.length} deleted story IDs from localStorage`);
      }
    }
  } catch (err) {
    console.warn('[SOCKET] Error loading deleted stories from localStorage:', err);
  }
}

/**
 * Load user votes from localStorage
 * Only called when explicitly needed - not during normal initialization
 * @returns {Object|null} The loaded votes, or null if not found
 */
function loadUserVotesFromStorage() {
  if (!socket || !roomId) return null;
  
  try {
    const userVotesKey = `votes_${roomId}_${socket.id}`;  // Use user-specific key
    const votesData = localStorage.getItem(userVotesKey);
    
    if (votesData) {
      const savedVotes = JSON.parse(votesData);
      if (typeof savedVotes === 'object') {
        console.log(`[SOCKET] Loaded ${Object.keys(savedVotes).length} user votes from localStorage with key ${userVotesKey}`);
        return savedVotes;
      }
    }
  } catch (err) {
    console.warn('[SOCKET] Error loading user votes from localStorage:', err);
  }
  
  return null;
}

/**
 * Store votes to help with the current user vote restoration
 */
function restoreVotesFromStorage(roomIdentifier) {
  if (!socket || !socket.connected) return;

  try {
    const savedVotes = loadUserVotesFromStorage();
    if (!savedVotes) return;

    let restoredCount = 0;
    
    // Only process non-deleted stories
    for (const [storyId, vote] of Object.entries(savedVotes)) {
      // Skip deleted stories
      if (isStoryDeleted(storyId)) continue;
      
      // Skip empty votes
      if (!vote) continue;

      // Check if this vote is already in the server's state
      // If so, we don't need to restore it
      if (lastKnownRoomState.votesPerStory[storyId] && 
          lastKnownRoomState.votesPerStory[storyId][socket.id] === vote) {
        console.log(`[SOCKET] Vote for story ${storyId} already matches server (${vote}), skipping restoration`);
        continue;
      }

      console.log(`[SOCKET] Requesting vote restoration for story ${storyId}: ${vote}`);
      
      // Send a special event to restore just this user's vote
      socket.emit('restoreUserVote', { storyId, vote });
      
      restoredCount++;
    }

    if (restoredCount > 0) {
      console.log(`[SOCKET] Sent ${restoredCount} vote restoration requests to server`);
    }
  } catch (err) {
    console.warn('[SOCKET] Error restoring votes from localStorage:', err);
  }
}

/**
 * Delete a story and sync with other users
 * @param {string} storyId - ID of the story to delete
 */
export function emitDeleteStory(storyId) {
  if (socket) {
    console.log('[SOCKET] Deleting story:', storyId);
    socket.emit('deleteStory', { storyId });

    // Update local tracking
    addToDeletedStories(storyId);

    // Remove from user votes
    if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
      delete lastKnownRoomState.userVotes[storyId];
      saveUserVotesToStorage();
    }

    // Remove from votesPerStory and votesRevealed
    if (lastKnownRoomState.votesPerStory && lastKnownRoomState.votesPerStory[storyId]) {
      delete lastKnownRoomState.votesPerStory[storyId];
    }

    if (lastKnownRoomState.votesRevealed && lastKnownRoomState.votesRevealed[storyId]) {
      delete lastKnownRoomState.votesRevealed[storyId];
      saveRevealedStateToStorage();
    }
  }
}

/**
 * Remove a story from the deleted list
 * @param {string} storyId - ID of the story to undelete 
 */
export function undeleteStory(storyId) {
  if (!lastKnownRoomState.deletedStoryIds) return;
  
  const index = lastKnownRoomState.deletedStoryIds.indexOf(storyId);
  if (index > -1) {
    lastKnownRoomState.deletedStoryIds.splice(index, 1);
    saveDeletedStoriesToStorage();
    console.log(`[SOCKET] Removed story ${storyId} from deleted list`);
    
    // Notify server if connected
    if (socket && socket.connected) {
      socket.emit('undeleteStory', { storyId });
    }
    
    return true;
  }
  
  return false;
}

/**
 * Clear the entire deleted stories list
 */
export function clearDeletedStoryList() {
  lastKnownRoomState.deletedStoryIds = [];
  saveDeletedStoriesToStorage();
  console.log('[SOCKET] Cleared deleted stories list');
  
  // Notify server if connected
  if (socket && socket.connected) {
    socket.emit('clearDeletedStories');
  }
  
  return true;
}

/**
 * Send CSV data to server for synchronization
 * @param {Array} data - CSV data to synchronize
 */
export function emitCSVData(data) {
  if (socket) {
    console.log('[SOCKET] Sending CSV data:', data.length, 'rows');
    socket.emit('syncCSVData', data);
  }
}

/**
 * Emit story selection to server
 * @param {number} index - Index of the selected story
 */
export function emitStorySelected(index) {
  if (socket) {
    console.log('[SOCKET] Emitting storySelected:', index);
    socket.emit('storySelected', { storyIndex: index });
    selectedStoryIndex = index;
    
    // Update local state tracking
    lastKnownRoomState.selectedIndex = index;
    
    // Request votes for the selected story after a short delay
    setTimeout(() => {
      const selectedCard = document.querySelector('.story-card.selected');
      if (selectedCard && socket && socket.connected) {
        const storyId = selectedCard.id;
        if (storyId && !isStoryDeleted(storyId)) {
          console.log(`[SOCKET] Requesting votes for selected story: ${storyId}`);
          socket.emit('requestStoryVotes', { storyId });
        }
      }
    }, 100);
  }
}

/**
 * Cast a vote for a story
 * @param {string} vote - The vote value
 * @param {string} targetUserId - The user ID receiving the vote
 * @param {string} storyId - ID of the story being voted on
 */
export function emitVote(vote, targetUserId, storyId) {
  if (!socket || !socket.connected) {
    console.warn('[SOCKET] Cannot emit vote - socket disconnected');
    
    // Only store for resending if this is our own vote
    if (socket && targetUserId === socket.id) {
      if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
      lastKnownRoomState.userVotes[storyId] = vote;
      saveUserVotesToStorage();
      
      logDebug('Vote saved for resend when reconnected', { vote, storyId });
    }
    
    // Try to reconnect
    reconnect();
    return false;
  }

  // Check if this story is deleted
  if (isStoryDeleted(storyId)) {
    console.log(`[SOCKET] Cannot vote for deleted story: ${storyId}`);
    return false;
  }

  if (!vote || !storyId) {
    console.warn('[SOCKET] Cannot emit vote - missing vote or storyId', { vote, storyId });
    return false;
  }

  // Log complete vote details for debugging
  logDebug('Emitting vote', { 
    vote, 
    targetUserId, 
    storyId, 
    socketConnected: socket.connected, 
    socketId: socket.id
  });

  // Send the vote to the server
  socket.emit('castVote', { vote, targetUserId, storyId });

  // Update local state tracking - ensure initialization
  if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
  if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
  lastKnownRoomState.votesPerStory[storyId][targetUserId] = vote;

  // Only store in userVotes if this is our own vote
  if (targetUserId === socket.id) {
    if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
    lastKnownRoomState.userVotes[storyId] = vote;
    saveUserVotesToStorage();
  }
  
  return true;
}

/**
 * Request votes for a specific story
 * @param {string} storyId - ID of the story
 */
export function requestStoryVotes(storyId) {
  if (socket && !isStoryDeleted(storyId)) {
    console.log(`[SOCKET] Requesting votes for story: ${storyId}`);
    socket.emit('requestStoryVotes', { storyId });
  }
}

/**
 * Reveal votes for the current story
 * Triggers server to broadcast vote values to all clients
 * @param {string} storyId - ID of the story
 */
export function revealVotes(storyId) {
  if (socket && !isStoryDeleted(storyId)) {
    socket.emit('revealVotes', { storyId });
    
    // Update local state tracking - ensure initialization
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    lastKnownRoomState.votesRevealed[storyId] = true;
    saveRevealedStateToStorage();
  }
}

/**
 * Reset votes for the current story
 * Clears all votes and resets the reveal state
 * @param {string} storyId - ID of the story
 */
export function resetVotes(storyId) {
  if (socket) {
    socket.emit('resetVotes', { storyId });

    // Update local state tracking - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    
    lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesRevealed[storyId] = false;

    // Remove from user votes if it exists
    if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
      delete lastKnownRoomState.userVotes[storyId];
      saveUserVotesToStorage();
    }
  }
}

/**
 * Request export of all votes data
 */
export function requestExport() {
  if (socket) {
    console.log('[SOCKET] Requesting vote data export');
    socket.emit('exportVotes');
  }
}

/**
 * Get the currently selected story index
 * @returns {number|null} - Selected story index or null if none selected
 */
export function getCurrentStoryIndex() {
  return selectedStoryIndex;
}

/**
 * Check if socket is connected
 * @returns {boolean} - Connection status
 */
export function isConnected() {
  return socket && socket.connected;
}

/**
 * Add a new ticket and sync with other users
 * @param {Object} ticketData - The ticket data {id, text}
 */
export function emitAddTicket(ticketData) {
  if (socket) {
    // Check if this ticket is in our deleted list
    if (isStoryDeleted(ticketData.id)) {
      console.log(`[SOCKET] Cannot add previously deleted ticket: ${ticketData.id}`);
      return false;
    }
    
    console.log('[SOCKET] Adding new ticket:', ticketData);
    socket.emit('addTicket', ticketData);
    
    // Update local state tracking - ensure initialization
    if (!lastKnownRoomState.tickets) lastKnownRoomState.tickets = [];
    
    // Avoid duplicates
    const existingIndex = lastKnownRoomState.tickets.findIndex(t => t.id === ticketData.id);
    if (existingIndex === -1) {
      lastKnownRoomState.tickets.push(ticketData);
    }
    
    return true;
  }
  
  return false;
}

/**
 * Force reconnection if disconnected
 * @returns {boolean} - Whether reconnection was attempted
 */
export function reconnect() {
  if (!socket) {
    console.warn('[SOCKET] Cannot reconnect: no socket instance');
    return false;
  }
  
  if (!socket.connected && roomId && userName) {
    console.log('[SOCKET] Attempting to reconnect...');
    socket.connect();
    
    // Set a timer to request full state sync after connection
    setTimeout(() => {
      if (socket && socket.connected) {
        console.log('[SOCKET] Requesting full state resync after manual reconnection');
        socket.emit('requestFullStateResync');
      }
    }, 1000);
    
    return true;
  }
  
  return false;
}

/**
 * Enable or disable automatic reconnection
 * @param {boolean} enable - Whether to enable reconnection
 */
export function setReconnectionEnabled(enable) {
  reconnectionEnabled = enable;
  console.log(`[SOCKET] Reconnection ${enable ? 'enabled' : 'disabled'}`);
  
  if (!enable) {
    // Clear any pending reconnection timers
    clearTimeout(reconnectTimer);
  }
}

/**
 * Request all tickets from the server
 * Useful after reconnection to ensure all tickets are loaded
 */
export function requestAllTickets() {
  if (socket) {
    console.log('[SOCKET] Requesting all tickets');
    socket.emit('requestAllTickets');
  }
}

/**
 * Explicitly request full state resync from server
 * Useful after reconnection or when state seems inconsistent
 */
export function requestFullStateResync() {
  if (socket && socket.connected) {
    console.log('[SOCKET] Manually requesting full state resync');
    socket.emit('requestFullStateResync');
  }
}

/**
 * Set maximum reconnection attempts
 * @param {number} max - Max number of reconnection attempts
 */
export function setMaxReconnectAttempts(max) {
  if (typeof max === 'number' && max > 0) {
    maxReconnectAttempts = max;
    console.log(`[SOCKET] Max reconnection attempts set to ${max}`);
  }
}

/**
 * Get current reconnection status
 * @returns {Object} - Reconnection status information
 */
export function getReconnectionStatus() {
  return {
    enabled: reconnectionEnabled,
    attempts: reconnectAttempts,
    maxAttempts: maxReconnectAttempts,
    connected: socket ? socket.connected : false
  };
}

/**
 * Get last known room state
 * This can be used for UI recovery if socket disconnects
 * @returns {Object|null} - Last known room state
 */
export function getLastKnownRoomState() {
  return lastKnownRoomState;
}

/**
 * Get user's personal votes
 * @returns {Object} - Map of storyId → vote values
 */
export function getUserVotes() {
  return lastKnownRoomState.userVotes || {};
}

/**
 * Check if a story is in the deleted list
 * @param {string} storyId - ID of the story to check
 * @returns {boolean} - Whether the story is deleted
 */
export function isStoryInDeletedList(storyId) {
  return isStoryDeleted(storyId);
}

/**
 * Clean up socket connection
 * Call this when the user manually logs out
 */
export function cleanup() {
  const currentRoomId = roomId;
  const currentSocketId = socket?.id;
  
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  clearTimeout(reconnectTimer);
  lastKnownRoomState = {
    votesPerStory: {},
    votesRevealed: {},
    deletedStoryIds: [],
    tickets: [],
    userVotes: {}
  };
  reconnectAttempts = 0;
  
  roomId = null;
  userName = null;
  selectedStoryIndex = null;
  console.log('[SOCKET] Socket connection cleaned up');
  
  // Also clear user-specific storage
  if (currentRoomId && currentSocketId) {
    try {
      localStorage.removeItem(`votes_${currentRoomId}_${currentSocketId}`);
    } catch (err) {
      console.warn('[SOCKET] Error clearing localStorage during cleanup:', err);
    }
  }
}

/**
 * Force a vote reset if the UI seems stuck
 * @param {string} storyId - ID of the story to reset votes for
 */
export function forceVoteReset(storyId) {
  if (!storyId) {
    // Try to get the current story ID from the UI
    const selectedCard = document.querySelector('.story-card.selected');
    if (selectedCard) {
      storyId = selectedCard.id;
    }
  }
  
  if (!storyId) {
    console.error('[SOCKET] Cannot force vote reset: no story ID provided or found');
    return false;
  }
  
  console.log(`[SOCKET] Force resetting votes for story: ${storyId}`);
  
  // Clear local state
  if (lastKnownRoomState.votesPerStory && lastKnownRoomState.votesPerStory[storyId]) {
    lastKnownRoomState.votesPerStory[storyId] = {};
  }
  
  if (lastKnownRoomState.votesRevealed && lastKnownRoomState.votesRevealed[storyId]) {
    lastKnownRoomState.votesRevealed[storyId] = false;
  }
  
  if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
    delete lastKnownRoomState.userVotes[storyId];
    saveUserVotesToStorage();
  }
  
  // If connected, notify server
  if (socket && socket.connected) {
    socket.emit('resetVotes', { storyId });
  }
  
  return true;
}

/**
 * Get current socket ID
 * @returns {string|null} - Current socket ID or null if not connected
 */
export function getSocketId() {
  return socket ? socket.id : null;
}

/**
 * Manually refresh vote data for all stories
 * Useful when data seems out of sync
 */
export function refreshAllVoteData() {
  if (socket && socket.connected) {
    console.log('[SOCKET] Manually refreshing all vote data');
    
    // Request a full state resync
    socket.emit('requestFullStateResync');
    
    // Clear any local user votes that might be out of sync
    lastKnownRoomState.userVotes = {};
    saveUserVotesToStorage();
    
    return true;
  }
  return false;
}
