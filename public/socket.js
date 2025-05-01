// === socket.js ===
import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

// Module state
let socket = null;
let selectedStoryIndex = null;
let roomId = null;
let userName = null;

/**
 * Initialize WebSocket connection to server
 * @param {string} roomIdentifier - ID of the room to join
 * @param {string} userNameValue - Username for the current user
 * @param {Function} handleMessage - Callback to handle incoming messages
 * @returns {Object} - Socket instance for external reference
 */
export function initializeWebSocket(roomIdentifier, userNameValue, handleMessage) {
  // Store params for potential reconnection
  roomId = roomIdentifier;
  userName = userNameValue;
  
  // Initialize socket connection
  socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    query: { roomId: roomIdentifier, userName: userNameValue }
  });

  // Socket event handlers
  socket.on('connect', () => {
    console.log('[SOCKET] Connected to server with ID:', socket.id);
    socket.emit('joinRoom', { roomId: roomIdentifier, userName: userNameValue });
  });

  socket.on('connect_error', (error) => {
    console.error('[SOCKET] Connection error:', error);
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log('[SOCKET] Reconnected after', attemptNumber, 'attempts');
    socket.emit('joinRoom', { roomId: roomIdentifier, userName: userNameValue });
  });

  socket.on('userList', (users) => {
    console.log('[SOCKET] User list updated:', users.length, 'users');
    handleMessage({ type: 'userList', users });
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

  socket.on('voteUpdate', ({ userId, vote, storyIndex }) => {
    console.log('[SOCKET] Vote update received:', userId, vote, 'for story', storyIndex);
    
    // Only process votes for the current story
    if (storyIndex === selectedStoryIndex || storyIndex === null) {
      // Update UI elements directly for immediate feedback
      const badge = document.querySelector(`#user-${userId} .vote-badge`) ||
                    document.querySelector(`#user-circle-${userId} .vote-badge`);
      if (badge) badge.textContent = vote;

      const avatar = document.querySelector(`#user-circle-${userId} img.avatar`);
      if (avatar) avatar.style.backgroundColor = '#c1e1c1';

      // Also forward to general handler
      handleMessage({ type: 'voteUpdate', userId, vote, storyIndex });
    }
  });

  socket.on('revealVotes', (votes) => {
    console.log('[SOCKET] Revealing votes');
    handleMessage({ type: 'revealVotes', votes });
  });

  socket.on('storyChange', ({ story }) => {
    console.log('[SOCKET] Story content changed');
    handleMessage({ type: 'storyChange', story });
  });

  socket.on('storyNavigation', ({ index }) => {
    console.log('[SOCKET] Story navigation event received:', index);
    handleMessage({ type: 'storyNavigation', index });
  });

  socket.on('disconnect', () => {
    console.log('[SOCKET] Disconnected from server');
  });

  // Return socket for external operations if needed
  return socket;
}

/**
 * Send CSV data to server for synchronization
 * @param {Array} data - CSV data to synchronize
 * @returns {boolean} - Success status
 */
export function emitCSVData(data) {
  if (!socket || !socket.connected) {
    console.warn('[SOCKET] Cannot emit CSV data: not connected');
    return false;
  }
  
  console.log('[SOCKET] Sending CSV data:', data.length, 'rows');
  socket.emit('syncCSVData', data);
  return true;
}

/**
 * Emit story selection to server
 * @param {number} index - Index of the selected story
 * @returns {boolean} - Success status
 */
export function emitStorySelected(index) {
  if (!socket || !socket.connected) {
    console.warn('[SOCKET] Cannot emit story selection: not connected');
    return false;
  }
  
  console.log('[SOCKET] Emitting storySelected:', index);
  socket.emit('storySelected', { storyIndex: index });
  selectedStoryIndex = index;
  return true;
}

/**
 * Cast a vote for a story
 * @param {string} vote - The vote value
 * @param {string} targetUserId - The user ID receiving the vote
 * @returns {boolean} - Success status
 */
export function emitVote(vote, targetUserId) {
  if (!socket || !socket.connected) {
    console.warn('[SOCKET] Cannot emit vote: not connected');
    return false;
  }
  
  socket.emit('castVote', { vote, targetUserId });
  return true;
}

/**
 * Notify server to reveal all votes
 * @returns {boolean} - Success status
 */
export function revealVotes() {
  if (!socket || !socket.connected) {
    console.warn('[SOCKET] Cannot reveal votes: not connected');
    return false;
  }
  
  socket.emit('revealVotes');
  return true;
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
    socket.connect();
    return true;
  }
  
  return false;
}
