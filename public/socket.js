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
  tickets: []
};

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
    tickets: []
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

  // ------------------------------
  // Socket Event Handlers
  // ------------------------------

  socket.on('addTicket', ({ ticketData }) => {
    console.log('[SOCKET] Received new ticket from another user:', ticketData);
    handleMessage({ type: 'addTicket', ticketData });
  });

  socket.on('allTickets', ({ tickets }) => {
    console.log('[SOCKET] Received all tickets:', tickets.length);
    
    // Store tickets in last known state
    lastKnownRoomState.tickets = tickets || [];
    
    handleMessage({ type: 'allTickets', tickets });
  });

  // Connection established
  socket.on('connect', () => {
    console.log('[SOCKET] Connected to server with ID:', socket.id);
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    
    // When connecting, explicitly join the room
    socket.emit('joinRoom', { roomId: roomIdentifier, userName: userNameValue });
    
    // Notify UI of successful connection
    handleMessage({ type: 'connect' });
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
    handleMessage({ type: 'error', error });
    
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
  });

  socket.on('voteUpdate', ({ userId, vote, storyId }) => {
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesPerStory[storyId][userId] = vote;
    
    handleMessage({ type: 'voteUpdate', userId, vote, storyId });
  });

  socket.on('storyVotes', ({ storyId, votes }) => {
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesPerStory[storyId] = { ...(lastKnownRoomState.votesPerStory[storyId] || {}), ...votes };
    
    handleMessage({ type: 'storyVotes', storyId, votes });
  });

  // New handler for restoring user votes
  socket.on('restoreUserVote', ({ storyId, vote }) => {
    console.log(`[SOCKET] Restoring user vote for story ${storyId}: ${vote}`);
    
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesPerStory[storyId][socket.id] = vote;
    
    handleMessage({ type: 'restoreUserVote', storyId, vote });
  });

  socket.on('votesRevealed', ({ storyId }) => {
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    lastKnownRoomState.votesRevealed[storyId] = true;
    
    handleMessage({ type: 'votesRevealed', storyId });
  });

  socket.on('deleteStory', ({ storyId }) => {
    console.log('[SOCKET] Story deletion event received:', storyId);
    
    // Store in last known state - using array.push instead of Set.add
    if (!lastKnownRoomState.deletedStoryIds) lastKnownRoomState.deletedStoryIds = [];
    
    // Only push if not already included
    if (!lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      lastKnownRoomState.deletedStoryIds.push(storyId);
    }
    
    handleMessage({ type: 'deleteStory', storyId });
  });

  socket.on('votesReset', ({ storyId }) => {
    // Clear from last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    
    lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesRevealed[storyId] = false;
    
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
    handleMessage({ type: 'error', error });
    
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
    
    // Store complete state locally - use spread for deep copy safety
    lastKnownRoomState = { 
      ...lastKnownRoomState,
      tickets: state.tickets || [],
      votesPerStory: state.votesPerStory || {},
      votesRevealed: state.votesRevealed || {}
    };
    
    // Add deleted story IDs to our array
    if (Array.isArray(state.deletedStoryIds)) {
      // Use filter to add only ids not already in the array
      state.deletedStoryIds.forEach(id => {
        if (!lastKnownRoomState.deletedStoryIds.includes(id)) {
          lastKnownRoomState.deletedStoryIds.push(id);
        }
      });
    }
    
    // Forward to message handler
    handleMessage({ type: 'resyncState', ...state });
  });

  // Return socket for external operations if needed
  return socket;
}

/**
 * Delete a story and sync with other users
 * @param {string} storyId - ID of the story to delete
 */
export function emitDeleteStory(storyId) {
  if (socket) {
    console.log('[SOCKET] Deleting story:', storyId);
    socket.emit('deleteStory', { storyId });
    
    // Update local state tracking - using array.push instead of Set.add
    if (!lastKnownRoomState.deletedStoryIds) {
      lastKnownRoomState.deletedStoryIds = [];
    }
    
    // Only add if not already included
    if (!lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      lastKnownRoomState.deletedStoryIds.push(storyId);
    }
  }
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
  }
}

/**
 * Cast a vote for a story
 * @param {string} vote - The vote value
 * @param {string} targetUserId - The user ID receiving the vote
 * @param {string} storyId - ID of the story being voted on
 */
export function emitVote(vote, targetUserId, storyId) {
  if (socket) {
    socket.emit('castVote', { vote, targetUserId, storyId });
    
    // Update local state tracking - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesPerStory[storyId][targetUserId] = vote;
  }
}

/**
 * Request votes for a specific story
 * @param {string} storyId - ID of the story
 */
export function requestStoryVotes(storyId) {
  if (socket) {
    socket.emit('requestStoryVotes', { storyId });
  }
}

/**
 * Reveal votes for the current story
 * Triggers server to broadcast vote values to all clients
 * @param {string} storyId - ID of the story
 */
export function revealVotes(storyId) {
  if (socket) {
    socket.emit('revealVotes', { storyId });
    
    // Update local state tracking - ensure initialization
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    lastKnownRoomState.votesRevealed[storyId] = true;
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
    console.log('[SOCKET] Adding new ticket:', ticketData);
    socket.emit('addTicket', ticketData);
    
    // Update local state tracking - ensure initialization
    if (!lastKnownRoomState.tickets) lastKnownRoomState.tickets = [];
    
    // Avoid duplicates
    const existingIndex = lastKnownRoomState.tickets.findIndex(t => t.id === ticketData.id);
    if (existingIndex === -1) {
      lastKnownRoomState.tickets.push(ticketData);
    }
  }
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
 * Clean up socket connection
 * Call this when the user manually logs out
 */
export function cleanup() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  clearTimeout(reconnectTimer);
  lastKnownRoomState = {
    votesPerStory: {},
    votesRevealed: {},
    deletedStoryIds: [],
    tickets: []
  };
  reconnectAttempts = 0;
  roomId = null;
  userName = null;
  selectedStoryIndex = null;
  console.log('[SOCKET] Socket connection cleaned up');
}
