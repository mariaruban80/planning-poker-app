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
  
  // Try to load any saved state from session storage
  loadStateFromSessionStorage(roomIdentifier);
  
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
  socket.on('connect', () => {
    console.log('[SOCKET] Connected to server with ID:', socket.id);
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);

    // When connecting, explicitly join the room
    socket.emit('joinRoom', { roomId: roomIdentifier, userName: userNameValue });

    // Listen for votes updates from server
    socket.on('votesUpdate', (votesData) => {
      console.log('[SOCKET] votesUpdate received:', votesData);
    //  updateVoteVisuals(votesData);  // Your function to update UI with new votes
    });

    // Request votes by username after initial connection
    setTimeout(() => {
      if (socket && socket.connected && userNameValue) {
        socket.emit('requestVotesByUsername', { userName: userNameValue });
      }
    }, 1000);

    // Notify UI of successful connection
    handleMessage({ type: 'connect' });

    // Apply any saved votes from session storage
    // console.log('[SOCKET] Skipped local vote restoration to prevent duplication.');
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
        
        // Request votes by username - IMPORTANT for login/logoff persistence
        socket.emit('requestVotesByUsername', { userName: userNameValue });
        
        // Apply any saved votes from session storage (with a delay to ensure proper timing)
        setTimeout(() => {
          // console.log('[SOCKET] Skipped local vote restoration to prevent duplication.');
        }, 500);
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
    window.userMap = {};
    users.forEach(u => window.userMap[u.id] = u.name);

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
    if (lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      console.log(`[SOCKET] Ignoring vote for deleted story: ${storyId}`);
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
      
      // Save to sessionStorage for persistence across page refreshes
      try {
        const votesData = JSON.stringify(lastKnownRoomState.userVotes);
        sessionStorage.setItem(`votes_${roomIdentifier}`, votesData);
        console.log(`[SOCKET] Saved user vote to session storage: ${storyId} = ${vote}`);
      } catch (err) {
        console.warn('[SOCKET] Could not save vote to sessionStorage:', err);
      }
    }
    
    handleMessage({ type: 'voteUpdate', userId, vote, storyId });
  });

  socket.on('storyVotes', ({ storyId, votes }) => {
    // Check if we should ignore this because the story is deleted
    if (lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      console.log(`[SOCKET] Ignoring votes for deleted story: ${storyId}`);
      return;
    }
    
    console.log(`[SOCKET] Received votes for story ${storyId}:`, Object.keys(votes).length);
    
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesPerStory[storyId] = { ...(lastKnownRoomState.votesPerStory[storyId] || {}), ...votes };
    
    handleMessage({ type: 'storyVotes', storyId, votes });
  });

  // New handler for restoring user votes
  socket.on('restoreUserVote', ({ storyId, vote }) => {
    // Check if we should ignore this because the story is deleted
    if (lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      console.log(`[SOCKET] Ignoring vote restoration for deleted story: ${storyId}`);
      return;
    }
    
    console.log(`[SOCKET] Restoring user vote for story ${storyId}: ${vote}`);
    
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesPerStory[storyId][socket.id] = vote;
    
    // Also track in user's personal votes
    if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
    lastKnownRoomState.userVotes[storyId] = vote;
    
    // Save to sessionStorage for persistence across page refreshes
    try {
      const votesData = JSON.stringify(lastKnownRoomState.userVotes);
      sessionStorage.setItem(`votes_${roomIdentifier}`, votesData);
      console.log(`[SOCKET] Saved restored vote to session storage: ${storyId} = ${vote}`);
    } catch (err) {
      console.warn('[SOCKET] Could not save restored vote to sessionStorage:', err);
    }
 
    
    handleMessage({ type: 'restoreUserVote', storyId, vote });
  });

  socket.on('votesRevealed', ({ storyId }) => {
    // Check if we should ignore this because the story is deleted
    if (lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      console.log(`[SOCKET] Ignoring vote reveal for deleted story: ${storyId}`);
      return;
    }
    
    // Store in last known state - ensure initialization
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    lastKnownRoomState.votesRevealed[storyId] = true;
    
    // Save revealed state to session storage
    try {
      const revealedData = JSON.stringify(lastKnownRoomState.votesRevealed);
      sessionStorage.setItem(`revealed_${roomIdentifier}`, revealedData);
    } catch (err) {
      console.warn('[SOCKET] Could not save revealed state to sessionStorage:', err);
    }
    
    handleMessage({ type: 'votesRevealed', storyId });
  });

  socket.on('deleteStory', ({ storyId }) => {
    console.log('[SOCKET] Story deletion event received:', storyId);
    
    // Store in last known state - using array.push instead of Set.add
    if (!lastKnownRoomState.deletedStoryIds) lastKnownRoomState.deletedStoryIds = [];
    
    // Only push if not already included
    if (!lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      lastKnownRoomState.deletedStoryIds.push(storyId);
      
      // Save deleted story IDs to session storage
      try {
        const deletedData = JSON.stringify(lastKnownRoomState.deletedStoryIds);
        sessionStorage.setItem(`deleted_${roomIdentifier}`, deletedData);
        console.log(`[SOCKET] Saved deleted story to session storage: ${storyId}`);
      } catch (err) {
        console.warn('[SOCKET] Could not save deleted story to sessionStorage:', err);
      }
    }
    
    // Also remove from the tickets array but keep in deleted set
    if (lastKnownRoomState.tickets) {
      const previousCount = lastKnownRoomState.tickets.length;
      lastKnownRoomState.tickets = lastKnownRoomState.tickets.filter(ticket => ticket.id !== storyId);
      console.log(`[SOCKET] Removed CSV story from tickets. Before: ${previousCount}, After: ${lastKnownRoomState.tickets.length}`);
    }
    
    // Also send the standard deleteStory event to ensure UI is updated everywhere
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
      
      // Update sessionStorage
      try {
        const votesData = JSON.stringify(lastKnownRoomState.userVotes);
        sessionStorage.setItem(`votes_${roomIdentifier}`, votesData);
      } catch (err) {
        console.warn('[SOCKET] Could not update session storage after vote reset:', err);
      }
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
    if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
    
    // Update deleted story IDs first (so we can filter correctly)
    if (Array.isArray(state.deletedStoryIds)) {
        state.deletedStoryIds.forEach(id => {
            if (!lastKnownRoomState.deletedStoryIds.includes(id)) {
                lastKnownRoomState.deletedStoryIds.push(id);
            }
        });
        
        // Save to session storage for persistence
        try {
            const deletedData = JSON.stringify(lastKnownRoomState.deletedStoryIds);
            sessionStorage.setItem(`deleted_${roomIdentifier}`, deletedData);
        } catch (err) {
            console.warn('[SOCKET] Could not save deleted story IDs to sessionStorage:', err);
        }
    }
    
    // Filter out any deleted tickets
    const filteredTickets = (state.tickets || []).filter(
        ticket => !lastKnownRoomState.deletedStoryIds.includes(ticket.id)
    );
    
    // Store selected index for later use after tickets are processed
    const selectedIndex = state.selectedIndex;
    
    // Now store the filtered state
    lastKnownRoomState = { 
        ...lastKnownRoomState,
        tickets: filteredTickets,
        votesPerStory: state.votesPerStory || {},
        votesRevealed: state.votesRevealed || {},
        selectedIndex: selectedIndex
    };
    
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
    
    // Also restore any additional user votes after a short delay
    // to ensure the UI is ready
    setTimeout(() => {
        // console.log('[SOCKET] Skipped local vote restoration to prevent duplication.');
    }, 600);
  });

  // Try to load saved state from session storage
  loadStateFromSessionStorage(roomIdentifier);

  // Return socket for external operations if needed
  return socket;
}

/**
 * Load previously saved state from session storage
 */
function loadStateFromSessionStorage(roomIdentifier) {
  try {
    // Load deleted story IDs
    const deletedData = sessionStorage.getItem(`deleted_${roomIdentifier}`);
    if (deletedData) {
      const parsedDeleted = JSON.parse(deletedData);
      if (Array.isArray(parsedDeleted)) {
        lastKnownRoomState.deletedStoryIds = parsedDeleted;
        console.log(`[SOCKET] Loaded ${parsedDeleted.length} deleted story IDs from session storage`);
      }
    }
    
    // Load user votes
    const votesData = sessionStorage.getItem(`votes_${roomIdentifier}`);
    if (votesData) {
      const parsedVotes = JSON.parse(votesData);
      lastKnownRoomState.userVotes = parsedVotes;
      console.log(`[SOCKET] Loaded ${Object.keys(parsedVotes).length} user votes from session storage`);
    }
    
    // Load revealed state
    const revealedData = sessionStorage.getItem(`revealed_${roomIdentifier}`);
    if (revealedData) {
      const parsedRevealed = JSON.parse(revealedData);
      lastKnownRoomState.votesRevealed = parsedRevealed;
      console.log(`[SOCKET] Loaded vote reveal state from session storage`);
    }
  } catch (err) {
    console.warn('[SOCKET] Error loading state from session storage:', err);
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
    
    // Update local state tracking - using array.push instead of Set.add
    if (!lastKnownRoomState.deletedStoryIds) {
      lastKnownRoomState.deletedStoryIds = [];
    }
    
    // Only add if not already included
    if (!lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      lastKnownRoomState.deletedStoryIds.push(storyId);
      
      // Save to session storage
      try {
        const deletedData = JSON.stringify(lastKnownRoomState.deletedStoryIds);
        sessionStorage.setItem(`deleted_${roomId}`, deletedData);
      } catch (err) {
        console.warn('[SOCKET] Could not save deleted story ID to sessionStorage:', err);
      }
    }
    
    // Also remove this story from userVotes to prevent restoration
    if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
      delete lastKnownRoomState.userVotes[storyId];
      
      try {
        const votesData = JSON.stringify(lastKnownRoomState.userVotes);
        sessionStorage.setItem(`votes_${roomId}`, votesData);
      } catch (err) {
        console.warn('[SOCKET] Could not update userVotes in session storage:', err);
      }
    }
    
    // Remove from votesPerStory and votesRevealed
    if (lastKnownRoomState.votesPerStory && lastKnownRoomState.votesPerStory[storyId]) {
      delete lastKnownRoomState.votesPerStory[storyId];
    }
    
    if (lastKnownRoomState.votesRevealed && lastKnownRoomState.votesRevealed[storyId]) {
      delete lastKnownRoomState.votesRevealed[storyId];
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
    
    // Request votes for the selected story after a short delay
    setTimeout(() => {
      const selectedCard = document.querySelector('.story-card.selected');
      if (selectedCard && socket && socket.connected) {
        const storyId = selectedCard.id;
        if (storyId && !lastKnownRoomState.deletedStoryIds.includes(storyId)) {
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
  if (socket) {
    // Check if this story is deleted
    if (lastKnownRoomState.deletedStoryIds && lastKnownRoomState.deletedStoryIds.includes(storyId)) {
      console.log(`[SOCKET] Cannot vote for deleted story: ${storyId}`);
      return;
    }
    
    // Include username with the vote
    socket.emit('castVote', { vote, targetUserId, storyId, userName });
    
    // Update local state tracking - ensure initialization
    if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
    if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesPerStory[storyId][targetUserId] = vote;
    
    // Also store in user's personal votes
    if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
    lastKnownRoomState.userVotes[storyId] = vote;
    
    // Save to sessionStorage for persistence
    try {
      const votesData = JSON.stringify(lastKnownRoomState.userVotes);
      sessionStorage.setItem(`votes_${roomId}`, votesData);
    } catch (err) {
      console.warn('[SOCKET] Could not save vote to sessionStorage:', err);
    }
  }
}

/**
 * Request votes for a specific story
 * @param {string} storyId - ID of the story
 */
export function requestStoryVotes(storyId) {
  if (socket && !lastKnownRoomState.deletedStoryIds.includes(storyId)) {
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
  if (socket && !lastKnownRoomState.deletedStoryIds.includes(storyId)) {
    socket.emit('revealVotes', { storyId });
    
    // Update local state tracking - ensure initialization
    if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
    lastKnownRoomState.votesRevealed[storyId] = true;
    
    // Save to sessionStorage
    try {
      const revealedData = JSON.stringify(lastKnownRoomState.votesRevealed);
      sessionStorage.setItem(`revealed_${roomId}`, revealedData);
    } catch (err) {
      console.warn('[SOCKET] Could not save revealed state to sessionStorage:', err);
    }
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
    if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
    
    lastKnownRoomState.votesPerStory[storyId] = {};
    lastKnownRoomState.votesRevealed[storyId] = false;
    
    // Remove from user votes
    if (lastKnownRoomState.userVotes[storyId]) {
      delete lastKnownRoomState.userVotes[storyId];
      
      // Update sessionStorage
      try {
        const votesData = JSON.stringify(lastKnownRoomState.userVotes);
        sessionStorage.setItem(`votes_${roomId}`, votesData);
      } catch (err) {
        console.warn('[SOCKET] Could not update session storage after vote reset:', err);
      }
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
    if (lastKnownRoomState.deletedStoryIds && 
        lastKnownRoomState.deletedStoryIds.includes(ticketData.id)) {
      console.log(`[SOCKET] Cannot add previously deleted ticket: ${ticketData.id}`);
      return;
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
        
        // Restore votes
        setTimeout(() => {
          // console.log('[SOCKET] Skipped local vote restoration to prevent duplication.');
        }, 500);
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
    
    // Also restore votes after a delay
    setTimeout(() => {
      // console.log('[SOCKET] Skipped local vote restoration to prevent duplication.');
    }, 500);
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
 * Request vote restoration by username instead of socket ID
 * This is critical for login/logoff persistence
 */
export function requestVotesByUsername() {
  if (socket && socket.connected && userName) {
    console.log(`[SOCKET] Requesting votes for username: ${userName}`);
    socket.emit('requestVotesByUsername', { userName });
  }
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
    tickets: [],
    userVotes: {}
  };
  reconnectAttempts = 0;
  roomId = null;
  userName = null;
  selectedStoryIndex = null;
  console.log('[SOCKET] Socket connection cleaned up');
  
  // Also clear session storage for this room if we have roomId
  if (roomId) {
    try {
      sessionStorage.removeItem(`votes_${roomId}`);
      sessionStorage.removeItem(`revealed_${roomId}`);
      sessionStorage.removeItem(`deleted_${roomId}`);
    } catch (err) {
      console.warn('[SOCKET] Error clearing session storage during cleanup:', err);
    }
  }
}
