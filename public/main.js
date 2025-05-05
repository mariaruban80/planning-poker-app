// Get username from sessionStorage (already set from main.html or by index.html prompt)
let userName = sessionStorage.getItem('userName');

// Import socket functionality
import { initializeWebSocket, emitCSVData, requestStoryVotes } from './socket.js'; 

// Global state variables
let pendingStoryIndex = null;
let csvData = [];
let currentStoryIndex = 0;
let userVotes = {};
let socket = null;
let csvDataLoaded = false;
let votesPerStory = {};     // Track votes for each story { storyIndex: { userId: vote, ... }, ... }
let votesRevealed = {};     // Track which stories have revealed votes { storyIndex: boolean }

/**
 * Extract room ID from URL parameters
 */
function getRoomIdFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId');
  
  if (roomId) {
    return roomId;
  } else {
    // If no roomId in URL, generate a new one (fallback behavior)
    return 'room-' + Math.floor(Math.random() * 10000);
  }
}

/**
 * Append room ID to URL if not already present
 */
function appendRoomIdToURL(roomId) {
  // Only modify URL if roomId isn't already in the URL
  if (!window.location.href.includes('roomId=')) {
    const newUrl = window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'roomId=' + roomId;
    window.history.pushState({ path: newUrl }, '', newUrl);
  }
}

/**
 * Initialize the application
 */
function initializeApp(roomId) {
  // Initialize socket with userName from sessionStorage
  socket = initializeWebSocket(roomId, userName, handleSocketMessage);
  
  setupCSVUploader();
  setupInviteButton();
  setupStoryNavigation();
  setupVoteCardsDrag();
  setupRevealResetButtons();
  
  // Add CSS for new layout
  addNewLayoutStyles();
  
  // Request current state from server when joining
  if (socket) {
    setTimeout(() => {
      console.log('[INIT] Requesting current session state');
      socket.emit('requestSessionState');
    }, 500); // Small delay to ensure connection is established
  }
}

/**
 * Add CSS styles for the new layout
 */
function addNewLayoutStyles() {
  // CSS styles implementation (unchanged)
}

/**
 * Setup reveal and reset buttons
 */
function setupRevealResetButtons() {
  // Set up reveal votes button
  const revealVotesBtn = document.getElementById('revealVotesBtn');
  if (revealVotesBtn) {
    revealVotesBtn.addEventListener('click', () => {
      if (socket) {
        console.log('[UI] Requesting reveal votes for story:', currentStoryIndex);
        // Emit reveal votes with the current story index
        socket.emit('revealVotes', { storyIndex: currentStoryIndex });
        
        // Update local state
        votesRevealed[currentStoryIndex] = true;
        
        // Update UI if we have votes for this story
        if (votesPerStory[currentStoryIndex]) {
          applyVotesToUI(votesPerStory[currentStoryIndex], false);
        }
      }
    });
  }
  
  // Set up reset votes button
  const resetVotesBtn = document.getElementById('resetVotesBtn');
  if (resetVotesBtn) {
    resetVotesBtn.addEventListener('click', () => {
      if (socket) {
        console.log('[UI] Requesting reset votes for story:', currentStoryIndex);
        // Emit reset votes with the current story index
        socket.emit('resetVotes', { storyIndex: currentStoryIndex });
        
        // Reset local state
        if (votesPerStory[currentStoryIndex]) {
          votesPerStory[currentStoryIndex] = {};
        }
        votesRevealed[currentStoryIndex] = false;
        
        // Update UI
        resetAllVoteVisuals();
      }
    });
  }
}

/**
 * Setup CSV file uploader
 */
function setupCSVUploader() {
  // CSV uploader implementation (unchanged)
}

/**
 * Parse CSV text into array structure
 */
function parseCSV(data) {
  // CSV parsing implementation (unchanged)
}

/**
 * Display CSV data in the story list
 */
function displayCSVData(data) {
  // CSV display implementation (unchanged)
}

/**
 * Select a story by index
 * @param {number} index - Story index to select
 * @param {boolean} emitToServer - Whether to emit the selection to the server (default: true)
 */
function selectStory(index, emitToServer = true) {
  console.log('[UI] Story selected by user:', index);
  
  // Update UI first for responsiveness
  document.querySelectorAll('.story-card').forEach(card => {
    card.classList.remove('selected', 'active');
  });
  
  const storyCard = document.querySelector(`.story-card[data-index="${index}"]`);
  if (storyCard) {
    storyCard.classList.add('selected', 'active');
  }
  
  // Update local state
  currentStoryIndex = index;
  renderCurrentStory();
  
  // Reset or restore vote badges for the current story
  resetOrRestoreVotes(index);
  
  // Notify server about selection if requested
  if (emitToServer && socket) {
    console.log('[EMIT] Broadcasting story selection:', index);
    socket.emit('storySelected', { storyIndex: index });
    
    // Request votes for this story
    if (typeof requestStoryVotes === 'function') {
      requestStoryVotes(index);
    } else {
      socket.emit('requestStoryVotes', { storyIndex: index });
    }
  }
}

/**
 * Reset or restore votes for a story
 */
function resetOrRestoreVotes(index) {
  // Implementation unchanged
}

/**
 * Apply votes to UI
 */
function applyVotesToUI(votes, hideValues) {
  // Implementation unchanged
}

/**
 * Reset all vote visuals
 */
function resetAllVoteVisuals() {
  // Implementation unchanged
}

/**
 * Render the current story
 */
function renderCurrentStory() {
  // Implementation unchanged
}

/**
 * Update the user list display with the new layout
 */
function updateUserList(users) {
  // Implementation unchanged
}

/**
 * Create avatar container for a user
 */
function createAvatarContainer(user) {
  // Implementation unchanged
}

/**
 * Create vote card space for a user
 */
function createVoteCardSpace(user) {
  // Implementation unchanged
}

/**
 * Update vote visuals for a user
 */
function updateVoteVisuals(userId, vote, hasVoted = false) {
  // Implementation unchanged
}

/**
 * Update story title
 */
function updateStory(story) {
  // Implementation unchanged
}

/**
 * Setup story navigation
 */
function setupStoryNavigation() {
  // Implementation unchanged
}

/**
 * Generate avatar URL
 */
function generateAvatarUrl(name) {
  // Implementation unchanged
}

/**
 * Setup invite button
 */
function setupInviteButton() {
  // Implementation unchanged
}

/**
 * Setup vote cards drag functionality
 */
function setupVoteCardsDrag() {
  // Implementation unchanged
}

/**
 * Handle socket messages
 */
function handleSocketMessage(message) {
  // Extract type from the message object
  const eventType = message.type;
  
  console.log(`[SOCKET] Received ${eventType}:`, message);
  
  switch(eventType) {
    case 'userList':
      // Update the user list when server sends an updated list
      if (Array.isArray(message.users)) {
        updateUserList(message.users);
      }
      break;
      
    case 'userJoined':
      // Individual user joined - could update existing list
      break;
      
    case 'userLeft':
      // Handle user leaving
      break;
      
    case 'voteReceived':
    case 'voteUpdate':
      // Handle vote received
      if (message.userId && message.vote) {
        if (!votesPerStory[currentStoryIndex]) {
          votesPerStory[currentStoryIndex] = {};
        }
        votesPerStory[currentStoryIndex][message.userId] = message.vote;
        updateVoteVisuals(message.userId, votesRevealed[currentStoryIndex] ? message.vote : '✓', true);
      }
      break;
      
    case 'votesRevealed':
      // Handle votes revealed event
      if (message.storyIndex !== undefined) {
        console.log('[SOCKET] Votes revealed for story:', message.storyIndex);
        
        // Mark this story's votes as revealed
        votesRevealed[message.storyIndex] = true;
        
        // Update UI if this is the current story and we have votes
        if (message.storyIndex === currentStoryIndex && votesPerStory[currentStoryIndex]) {
          applyVotesToUI(votesPerStory[currentStoryIndex], false);
        }
      } else {
        // Legacy support for old format
        votesRevealed[currentStoryIndex] = true;
        if (votesPerStory[currentStoryIndex]) {
          applyVotesToUI(votesPerStory[currentStoryIndex], false);
        }
      }
      break;
      
    case 'votesReset':
      // Handle votes reset
      if (message.storyIndex !== undefined) {
        // Reset votes for specific story
        if (votesPerStory[message.storyIndex]) {
          votesPerStory[message.storyIndex] = {};
        }
        votesRevealed[message.storyIndex] = false;
        
        // Update UI if this is the current story
        if (message.storyIndex === currentStoryIndex) {
          resetAllVoteVisuals();
        }
      } else {
        // Legacy support for old format
        if (votesPerStory[currentStoryIndex]) {
          votesPerStory[currentStoryIndex] = {};
        }
        votesRevealed[currentStoryIndex] = false;
        resetAllVoteVisuals();
      }
      break;
      
    case 'storyVotes':
      // Handle received votes for a specific story
      if (message.storyIndex !== undefined && message.votes) {
        votesPerStory[message.storyIndex] = message.votes;
        // Update UI if this is the current story and votes are revealed
        if (message.storyIndex === currentStoryIndex && votesRevealed[currentStoryIndex]) {
          applyVotesToUI(message.votes, false);
        }
      }
      break;
      
    case 'syncCSVData':
      // Handle CSV data sync
      if (Array.isArray(message.csvData)) {
        csvData = message.csvData;
        displayCSVData(csvData);
        
        // Keep current story index if it exists in new data
        if (currentStoryIndex >= csvData.length) {
          currentStoryIndex = 0;
        }
        
        renderCurrentStory();
      }
      break;
      
    case 'storySelected':
      // Handle story selection from another user
      if (message.storyIndex !== undefined) {
        console.log('[SOCKET] Another user selected story:', message.storyIndex);
        // Update UI without emitting back to server
        selectStory(message.storyIndex, false);
      }
      break;
      
    case 'sessionState':
      // Handle session state update
      if (message.currentStoryIndex !== undefined) {
        console.log('[SESSION] Received current story index:', message.currentStoryIndex);
        // Update current story index and UI
        currentStoryIndex = message.currentStoryIndex;
        selectStory(currentStoryIndex, false); // Pass false to avoid emitting back to server
      }
      
      // Handle votes reveal state
      if (message.votesRevealed) {
        console.log('[SESSION] Received votes revealed state:', message.votesRevealed);
        // Update votes revealed state
        Object.assign(votesRevealed, message.votesRevealed);
        
        // Apply revealed votes for current story if applicable
        if (votesRevealed[currentStoryIndex] && votesPerStory[currentStoryIndex]) {
          applyVotesToUI(votesPerStory[currentStoryIndex], false);
        }
      }
      break;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  let roomId = getRoomIdFromURL();
  if (!roomId) {
    roomId = 'room-' + Math.floor(Math.random() * 10000);
  }
  appendRoomIdToURL(roomId);
  initializeApp(roomId);
});
