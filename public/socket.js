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

  socket.on('addTicket', ({ ticketData }) => {
    console.log('[SOCKET] Received new ticket from another user:', ticketData);
    handleMessage({ type: 'addTicket', ticketData });
  });

  socket.on('allTickets', ({ tickets }) => {
    console.log('[SOCKET] Received all tickets:', tickets.length);
    handleMessage({ type: 'allTickets', tickets });
  });

  // Socket event handlers
  socket.on('connect', () => {
    console.log('[SOCKET] Connected to server with ID:', socket.id);
    reconnectAttempts = 0;
    
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

  socket.on('reconnect', () => {
    console.log('[SOCKET] Reconnected to server after disconnect');
    
    // Re-join room and request current state
    socket.emit('joinRoom', { roomId: roomIdentifier, userName: userNameValue });
    
    // Notify UI of successful reconnection
    handleMessage({ type: 'reconnect' });
    
    // Reset reconnection attempts counter
    reconnectAttempts = 0;
  });
  
  socket.on('reconnect_error', (error) => {
    console.error('[SOCKET] Reconnection error:', error);
    
    // Notify UI of reconnection error
    handleMessage({ type: 'error', error });
    
    // Try again if below the max attempts
    if (reconnectAttempts < maxReconnectAttempts && reconnectionEnabled) {
      console.log(`[SOCKET] Will attempt reconnection again (${reconnectAttempts}/${maxReconnectAttempts})`);
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
    // Forward this to the handler
    handleMessage({ type: 'votingSystemUpdate', ...data });
  });

  socket.on('syncCSVData', (csvData) => {
    console.log('[SOCKET] Received CSV data:', Array.isArray(csvData) ? csvData.length : 'invalid', 'rows');
    handleMessage({ type: 'syncCSVData', csvData });
    
    // Notify server that CSV data is loaded
    setTimeout(() => {
      console.log('[SOCKET] Notifying server that CSV data is loaded');
      socket.emit('csvDataLoaded');
    }, 100);
  });

  socket.on('storySelected', ({ storyIndex }) => {
    console.log('[SOCKET] Story selected event received:', storyIndex);
    selectedStoryIndex = storyIndex;
    handleMessage({ type: 'storySelected', storyIndex });
  });

 socket.on('voteUpdate', ({ userId, vote, storyId }) => {
  handleMessage({ type: 'voteUpdate', userId, vote, storyId });
});


socket.on('storyVotes', ({ storyId, votes }) => {
  handleMessage({ type: 'storyVotes', storyId, votes });
});

socket.on('votesRevealed', ({ storyId }) => {
  handleMessage({ type: 'votesRevealed', storyId });
});

  socket.on('deleteStory', ({ storyId }) => {
    console.log('[SOCKET] Story deletion event received:', storyId);
    handleMessage({ type: 'deleteStory', storyId });
  });

 socket.on('votesReset', ({ storyId }) => {
  handleMessage({ type: 'votesReset', storyId });
});

  socket.on('revealVotes', (votes) => {
    console.log('[SOCKET] Reveal votes event received (legacy)');
    handleMessage({ type: 'revealVotes', votes });
  });

  socket.on('storyChange', ({ story }) => {
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
  }
}

/**
 * Cast a vote for a story
 * @param {string} vote - The vote value
 * @param {string} targetUserId - The user ID receiving the vote
 */
export function emitVote(vote, targetUserId, storyId) {
  if (socket) {
    socket.emit('castVote', { vote, targetUserId, storyId });
  }
}

/**
 * Request votes for a specific story
 * @param {number} storyIndex - Index of the story
 */
export function requestStoryVotes(storyId) {
  if (socket) {
    socket.emit('requestStoryVotes', { storyId });
  }
}

/**
 * Reveal votes for the current story
 * Triggers server to broadcast vote values to all clients
 */
export function revealVotes(storyId) {
  if (socket) {
    socket.emit('revealVotes', { storyId });
  }
}

/**
 * Reset votes for the current story
 * Clears all votes and resets the reveal state
 */
export function resetVotes(storyId) {
  if (socket) {
    socket.emit('resetVotes', { storyId });
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
