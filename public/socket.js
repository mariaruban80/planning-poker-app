// === socket.js ===
import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

// Module state
let socket = null;
let selectedStoryIndex = null;
let roomId = null;
let userName = null;
let lastUploadedCSV = null; // Track last CSV upload to avoid duplicate processing

/**
 * Initialize WebSocket connection to server
 * @param {string} roomIdentifier - ID of the room to join
 * @param {string} userNameValue - Username for the current user
 * @param {Function} handleMessage - Callback to handle incoming messages
 * @returns {Object} - Socket instance for external reference
 */
export function initializeWebSocket(roomIdentifier, userNameValue, handleMessage) {
  if (!roomIdentifier || !userNameValue) {
    console.error('[SOCKET] Cannot initialize: missing roomId or userName');
    return null;
  }
  
  // Store params for potential reconnection
  roomId = roomIdentifier;
  userName = userNameValue;
  console.log(`[SOCKET] Initializing with roomId: ${roomId}, userName: ${userName}`);
  
  // Initialize socket connection
  socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    query: { roomId: roomIdentifier, userName: userNameValue }
  });

  // Setup socket event handlers
  setupSocketEventHandlers(handleMessage);
  
  // Return socket for external operations if needed
  return socket;
}

/**
 * Set up all socket event handlers
 * @param {Function} handleMessage - Callback for handling messages
 */
function setupSocketEventHandlers(handleMessage) {
  // Connection events
  socket.on('connect', () => {
    console.log('[SOCKET] Connected to server with ID:', socket.id);
    socket.emit('joinRoom', { roomId, userName });
    
    // Request all tickets after joining the room
    setTimeout(() => {
      console.log('[SOCKET] Requesting all tickets after connection');
      socket.emit('requestAllTickets');
    }, 1000);
    
    // Notify message handler about connection
    handleMessage({ type: 'connect' });
  });
  
  socket.on('disconnect', () => {
    console.log('[SOCKET] Disconnected from server');
    handleMessage({ type: 'disconnect' });
  });
  
  socket.on('connect_error', (error) => {
    console.error('[SOCKET] Connection error:', error);
    handleMessage({ type: 'error', error });
  });
  
  socket.on('reconnect', (attemptNumber) => {
    console.log(`[SOCKET] Reconnected after ${attemptNumber} attempts`);
    // Re-join the room after reconnection
    if (roomId && userName) {
      socket.emit('joinRoom', { roomId, userName });
    }
  });
  
  // User management events
  socket.on('userList', (users) => {
    handleMessage({ type: 'userList', users });
  });
  
  // Ticket management events
  socket.on('addTicket', ({ ticketData }) => {
    console.log('[SOCKET] Received new ticket from another user:', ticketData);
    handleMessage({ type: 'addTicket', ticketData });
  });
  
  socket.on('allTickets', ({ tickets }) => {
    console.log('[SOCKET] Received all tickets:', tickets?.length || 0);
    handleMessage({ type: 'allTickets', tickets });
  });
  
  // CSV data synchronization
  socket.on('syncCSVData', (csvData) => {
    console.log('[SOCKET] Received CSV data:', Array.isArray(csvData) ? csvData.length : 'invalid', 'rows');
    
    // Check if this is our own upload coming back
    if (lastUploadedCSV && JSON.stringify(csvData) === JSON.stringify(lastUploadedCSV)) {
      console.log('[SOCKET] Detected our own CSV upload coming back, skipping duplicate processing');
      return;
    }
    
    // Pass to the message handler
    handleMessage({ type: 'syncCSVData', csvData });
    
    // After receiving CSV data, wait before requesting all tickets to ensure proper sequence
    setTimeout(() => {
      console.log('[SOCKET] Requesting all tickets after CSV data');
      socket.emit('requestAllTickets');
    }, 300);
  });
  
  // Story selection and navigation
  socket.on('storySelected', ({ storyIndex }) => {
    console.log('[SOCKET] Story selected event received:', storyIndex);
    selectedStoryIndex = storyIndex;
    handleMessage({ type: 'storySelected', storyIndex });
  });
  
  socket.on('storyChange', ({ story }) => {
    handleMessage({ type: 'storyChange', story });
  });
  
  socket.on('storyNavigation', ({ index }) => {
    handleMessage({ type: 'storyNavigation', index });
  });
  
  // Voting events
  socket.on('voteUpdate', ({ userId, vote, storyIndex }) => {
    console.log('[SOCKET] Vote update received for user', userId, 'on story', storyIndex);
    handleMessage({ type: 'voteUpdate', userId, vote, storyIndex });
  });
  
  socket.on('storyVotes', ({ storyIndex, votes }) => {
    console.log('[SOCKET] Received votes for story', storyIndex, ':', Object.keys(votes || {}).length, 'votes');
    handleMessage({ type: 'storyVotes', storyIndex, votes });
  });
  
  socket.on('votesRevealed', ({ storyIndex }) => {
    console.log('[SOCKET] Votes revealed for story', storyIndex);
    handleMessage({ type: 'votesRevealed', storyIndex });
  });
  
  socket.on('votesReset', ({ storyIndex }) => {
    console.log('[SOCKET] Votes reset for story', storyIndex);
    handleMessage({ type: 'votesReset', storyIndex });
  });
  
  socket.on('revealVotes', (votes) => {
    console.log('[SOCKET] Reveal votes event received (legacy)');
    handleMessage({ type: 'revealVotes', votes });
  });
  
  // Export data
  socket.on('exportData', (data) => {
    console.log('[SOCKET] Received export data with', 
      data.stories ? data.stories.length : 0, 'stories and',
      data.votes ? Object.keys(data.votes).length : 0, 'vote sets');
    handleMessage({ type: 'exportData', data });
  });
}

/**
 * Send CSV data to server for synchronization
 * @param {Array} data - CSV data to synchronize
 */
export function emitCSVData(data) {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot emit CSV data - socket not connected');
    return;
  }
  
  if (!Array.isArray(data)) {
    console.error('[SOCKET] Cannot emit CSV data - invalid data format');
    return;
  }
  
  // Store a copy of what we're uploading to avoid duplicate processing
  lastUploadedCSV = JSON.parse(JSON.stringify(data));
  
  console.log('[SOCKET] Sending CSV data to server:', data.length, 'rows');
  socket.emit('syncCSVData', data);
  
  // For debugging - check connection state after sending
  setTimeout(() => {
    console.log('[SOCKET] CSV data sent - connection state:', 
                socket.connected ? 'Connected' : 'Disconnected');
    
    // Request existing tickets after a delay to ensure everything is synced
    if (socket && socket.connected) {
      console.log('[SOCKET] Requesting tickets after CSV sync');
      socket.emit('requestAllTickets');
    }
  }, 500);
}

/**
 * Emit story selection to server
 * @param {number} index - Index of the selected story
 */
export function emitStorySelected(index) {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot emit story selection - socket not connected');
    return;
  }
  
  console.log('[SOCKET] Emitting storySelected:', index);
  socket.emit('storySelected', { storyIndex: index });
  selectedStoryIndex = index;
}

/**
 * Cast a vote for a story
 * @param {string} vote - The vote value
 * @param {string} targetUserId - The user ID receiving the vote
 */
export function emitVote(vote, targetUserId) {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot emit vote - socket not connected');
    return;
  }
  
  console.log('[SOCKET] Casting vote for user', targetUserId);
  socket.emit('castVote', { vote, targetUserId });
}

/**
 * Request votes for a specific story
 * @param {number} storyIndex - Index of the story
 */
export function requestStoryVotes(storyIndex) {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot request story votes - socket not connected');
    return;
  }
  
  console.log('[SOCKET] Requesting votes for story:', storyIndex);
  socket.emit('requestStoryVotes', { storyIndex });
}

/**
 * Reveal votes for the current story
 * Triggers server to broadcast vote values to all clients
 */
export function revealVotes() {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot reveal votes - socket not connected');
    return;
  }
  
  console.log('[SOCKET] Requesting to reveal votes');
  socket.emit('revealVotes');
}

/**
 * Reset votes for the current story
 * Clears all votes and resets the reveal state
 */
export function resetVotes() {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot reset votes - socket not connected');
    return;
  }
  
  console.log('[SOCKET] Requesting to reset votes');
  socket.emit('resetVotes');
}

/**
 * Request export of all votes data
 */
export function requestExport() {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot request export - socket not connected');
    return;
  }
  
  console.log('[SOCKET] Requesting vote data export');
  socket.emit('exportVotes');
}

/**
 * Add a new ticket and sync with other users
 * @param {Object} ticketData - The ticket data {id, text}
 */
export function emitAddTicket(ticketData) {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot add ticket - socket not connected');
    return;
  }
  
  if (!ticketData || !ticketData.id || !ticketData.text) {
    console.error('[SOCKET] Cannot add ticket - invalid ticket data');
    return;
  }
  
  console.log('[SOCKET] Adding new ticket:', ticketData);
  socket.emit('addTicket', ticketData);
}

/**
 * Request all tickets from the server
 */
export function requestAllTickets() {
  if (!socket || !socket.connected) {
    console.error('[SOCKET] Cannot request tickets - socket not connected');
    return;
  }
  
  console.log('[SOCKET] Requesting all tickets');
  socket.emit('requestAllTickets');
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
 * Clear stored CSV data (useful when uploading new data)
 */
export function clearLastUploadedCSV() {
  lastUploadedCSV = null;
  console.log('[SOCKET] Cleared last uploaded CSV data');
}

/**
 * Get socket ID (useful for debugging)
 * @returns {string|null} - Socket ID or null if not connected
 */
export function getSocketId() {
  return socket ? socket.id : null;
}
