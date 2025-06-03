function clearAllVoteVisuals() {
  const voteSpaces = document.querySelectorAll('.vote-card-space');
  voteSpaces.forEach(space => {
    space.classList.remove('has-vote');
    const badge = space.querySelector('.vote-badge');
    if (badge) badge.textContent = '';
  });
}

// Get username from sessionStorage (already set from main.html or by index.html prompt)
let userName = sessionStorage.getItem('userName');
let processingCSVData = false;
// Import socket functionality
import { initializeWebSocket, emitCSVData, requestStoryVotes, emitAddTicket, getUserVotes } from './socket.js'; 

// New functions for persisting reveal state
function persistRevealState(storyId, isRevealed) {
  try {
    const roomId = getRoomIdFromURL();
    const key = `reveal_state_${roomId}_${storyId}`;
    localStorage.setItem(key, isRevealed ? 'true' : 'false');
    console.log(`[STORAGE] Saved reveal state for story ${storyId}: ${isRevealed}`);
  } catch (err) {
    console.warn('[STORAGE] Error saving reveal state:', err);
  }
}

function getPersistedRevealState(storyId) {
  try {
    const roomId = getRoomIdFromURL();
    const key = `reveal_state_${roomId}_${storyId}`;
    const state = localStorage.getItem(key);
    return state === 'true';
  } catch (err) {
    return false;
  }
}
/**
 * Centralized function to manage UI visibility states of planning cards and statistics
 * This ensures a consistent approach without flickering
 */
function updateUIVisibilityState(storyId, forceState = null) {
  // Get necessary elements
  const planningCardsSection = document.querySelector('.planning-cards-section');
  let statsContainer = document.querySelector('.vote-statistics-container');
  
  // Create stats container if it doesn't exist
  if (!statsContainer) {
    statsContainer = document.createElement('div');
    statsContainer.className = 'vote-statistics-container';
    
    // Find the best place to add it - look for planning cards section first
    if (planningCardsSection && planningCardsSection.parentNode) {
      planningCardsSection.parentNode.insertBefore(statsContainer, planningCardsSection.nextSibling);
    } else {
      // Fallback locations
      const cardsContainer = document.querySelector('.cards-container');
      if (cardsContainer) {
        cardsContainer.appendChild(statsContainer);
      } else {
        document.body.appendChild(statsContainer);
      }
    }
  }
  
  if (!planningCardsSection) return;
  
  // Determine what should be visible based on story state or forced state
  let shouldShowStats = false;
  
  if (forceState !== null) {
    // If a state is forced (like during transitions), use that
    shouldShowStats = forceState === 'stats';
  } else if (storyId) {
    // Otherwise check the reveal state
    shouldShowStats = votesRevealed[storyId] === true && 
                      votesPerStory[storyId] && 
                      Object.keys(votesPerStory[storyId]).length > 0;
  }
  
  console.log(`[UI] Updating visibility state: stats=${shouldShowStats ? 'visible' : 'hidden'}, storyId=${storyId}`);
  
  // Temporarily disable transitions to avoid flicker
  statsContainer.style.transition = 'none';
  planningCardsSection.style.transition = 'none';
  
  // Always make sure one is visible and one is hidden, never both
  if (shouldShowStats) {
    // Ensure both aren't visible at the same time
    planningCardsSection.style.display = 'none';
    
    // Make sure we have content and prepare it before showing
    if (storyId && votesPerStory[storyId]) {
      statsContainer.innerHTML = '';
      addFixedVoteStatisticsStyles();
      statsContainer.appendChild(createFixedVoteDisplay(votesPerStory[storyId]));
    }
    
    // Only show after content is ready
    setTimeout(() => {
      statsContainer.style.display = 'block';
      setTimeout(fixRevealedVoteFontSizes, 50);
    }, 0);
  } else {
    // Hide stats first
    statsContainer.style.display = 'none';
    
    // Setup planning cards if needed
    if (isGuestUser()) {
      setupPlanningCards();
    }
    
    // Show planning cards after stats are hidden
    setTimeout(() => {
      planningCardsSection.style.display = 'block';
    }, 0);
  }
  
  // Re-enable transitions after a delay
  setTimeout(() => {
    if (statsContainer) statsContainer.style.transition = '';
    if (planningCardsSection) planningCardsSection.style.transition = '';
  }, 500);
}




/**
 * Ensure planning cards are visible for guests when stories are added
 */
function ensurePlanningCardsVisibleForGuests() {
  if (!isGuestUser()) return;
  
  const storyList = document.getElementById('storyList');
  if (storyList && storyList.children.length > 0) {
    const currentStoryId = getCurrentStoryId();
    
    // Check if votes are revealed for current story
    const isRevealed = currentStoryId && votesRevealed[currentStoryId] === true;
    
    // Use the centralized function with appropriate state
    updateUIVisibilityState(currentStoryId, isRevealed ? 'stats' : 'cards');
  }
}

// Track deleted stories client-side
let deletedStoryIds = new Set();
// Flag to track manually added tickets that need to be preserved
let preservedManualTickets = [];
// Flag to prevent duplicate delete confirmation dialogs
let deleteConfirmationInProgress = false;
let hasReceivedStorySelection = false;
window.currentVotesPerStory = {}; // Ensure global reference for UI
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// Create a debounced version of refreshVoteDisplay
const debouncedRefreshVoteDisplay = debounce(refreshVoteDisplay, 200);

// Add a window function for index.html to call
window.notifyStoriesUpdated = function() {
  const storyList = document.getElementById('storyList');
  if (!storyList) return;
  
  // Collect current stories from DOM
  const allTickets = [];
  const storyCards = storyList.querySelectorAll('.story-card');
  
  storyCards.forEach((card, index) => {
    const titleElement = card.querySelector('.story-title');
    if (titleElement) {
      allTickets.push({
        id: card.id,
        text: titleElement.textContent
      });
    }
  });
  
  // Update our manually added tickets tracker
  preservedManualTickets = allTickets.filter(ticket => 
    ticket.id && !ticket.id.includes('story_csv_')
  );
  
  console.log(`Preserved ${preservedManualTickets.length} manual tickets`);
};
/**
 * Handle adding a ticket from the modal
 * @param {Object} ticketData - Ticket data {id, text}
 */
window.addTicketFromModal = function(ticketData) {
  if (!ticketData || !ticketData.id || !ticketData.text) return;
  
  // Don't add if this story is in our deleted set
  if (deletedStoryIds.has(ticketData.id)) {
    console.log('[MODAL] Cannot add previously deleted ticket:', ticketData.id);
    return;
  }
  
  console.log('[MODAL] Adding ticket from modal:', ticketData);
  
  // Emit to server for synchronization
  if (typeof emitAddTicket === 'function') {
    emitAddTicket(ticketData);
  } else if (socket) {
    socket.emit('addTicket', ticketData);
  }
  
  // Add ticket locally
  addTicketToUI(ticketData, true);
  
  // Store in manually added tickets
  manuallyAddedTickets.push(ticketData);
  
  // Ensure planning cards are visible for guests
  ensurePlanningCardsVisibleForGuests();
};

/**
 * Initialize socket with a specific name (used when joining via invite)
 * @param {string} roomId - Room ID to join 
 * @param {string} name - Username to use
 */
window.initializeSocketWithName = function(roomId, name) {
  if (!roomId || !name) return;
  
  console.log(`[APP] Initializing socket with name: ${name} for room: ${roomId}`);
  
  // Set username in the module scope
  userName = name;
  
  // Load deleted stories from sessionStorage first
  loadDeletedStoriesFromStorage(roomId);
  
  // Initialize socket with the name
  socket = initializeWebSocket(roomId, name, handleSocketMessage);
  
  // Continue with other initialization steps
  setupCSVUploader();
  setupInviteButton();
  setupStoryNavigation();
  setupVoteCardsDrag();
  setupRevealResetButtons();
  setupAddTicketButton();
  setupGuestModeRestrictions();
  cleanupDeleteButtonHandlers();
  setupCSVDeleteButtons();
  
  // Add CSS for new layout
  addNewLayoutStyles();
  addFixedVoteStatisticsStyles(); // Add this explicitly for guests
  
  // Create stats container if it doesn't exist yet
  const statsContainer = document.querySelector('.vote-statistics-container') || document.createElement('div');
  statsContainer.className = 'vote-statistics-container';
  statsContainer.style.display = 'none';
  
  const planningCardsSection = document.querySelector('.planning-cards-section');
  if (planningCardsSection && planningCardsSection.parentNode && !document.querySelector('.vote-statistics-container')) {
    planningCardsSection.parentNode.insertBefore(statsContainer, planningCardsSection.nextSibling);
  }
  
  // Explicitly set up planning cards for guests
  setupPlanningCards();
  
  // Give time for DOM to be ready, then check if we need stats or cards
  setTimeout(() => {
    const currentId = getCurrentStoryId();
    
    if (currentId) {
      // Check if votes are revealed for this story
      const isRevealed = getPersistedRevealState(currentId) || votesRevealed[currentId];
      
      // Update state and UI
      votesRevealed[currentId] = isRevealed;
      updateUIVisibilityState(currentId);
      
      // Request votes for this story
      if (socket && socket.connected) {
        socket.emit('requestStoryVotes', { storyId: currentId });
        socket.emit('requestCurrentStory');
      }
    } else {
      // No current story, just ensure planning cards
      updateUIVisibilityState(null, 'cards');
    }
  }, 800); // Slightly longer delay to ensure DOM stability
};


/**
 * Load deleted story IDs from sessionStorage
 */
function loadDeletedStoriesFromStorage(roomId) {
  try {
    const storedDeletedStories = sessionStorage.getItem(`deleted_${roomId}`);
    if (storedDeletedStories) {
      const parsedDeleted = JSON.parse(storedDeletedStories);
      if (Array.isArray(parsedDeleted)) {
        // Initialize our Set with the stored array
        deletedStoryIds = new Set(parsedDeleted);
        console.log(`[STORAGE] Loaded ${parsedDeleted.length} deleted story IDs from storage`);
      }
    }
  } catch (err) {
    console.warn('[STORAGE] Error loading deleted stories:', err);
  }
}

function refreshVoteDisplay() {
  // Clear existing vote visuals, e.g. clear vote counts, badges, etc.
  clearAllVoteVisuals();

  // Loop over all stories and their votes
  for (const [storyId, votes] of Object.entries(window.currentVotesPerStory || {})) {
    for (const [userId, vote] of Object.entries(votes)) {
      // Update UI for each user vote on each story
      updateVoteVisuals(userId, vote, storyId);
          
    }
    updateVoteBadges(storyId, votes);
  }
}

function updateVoteBadges(storyId, votes) {
  // Count how many unique users have voted for this story
  const voteCount = Object.keys(votes).length;

  console.log(`Story ${storyId} has ${voteCount} votes`);

  // Find the vote badge element for the story (adjust selector as per your HTML)
  const voteBadge = document.querySelector(`#vote-badge-${storyId}`);

  if (voteBadge) {
    // Update the badge text to show number of votes
    voteBadge.textContent = voteCount;

    // Optionally update a tooltip or aria-label for accessibility
    voteBadge.setAttribute('title', `${voteCount} vote${voteCount !== 1 ? 's' : ''}`);
  }
}

/**
 * Save deleted story IDs to sessionStorage
 */
function saveDeletedStoriesToStorage(roomId) {
  try {
    const deletedArray = Array.from(deletedStoryIds);
    sessionStorage.setItem(`deleted_${roomId}`, JSON.stringify(deletedArray));
    console.log(`[STORAGE] Saved ${deletedArray.length} deleted story IDs to storage`);
  } catch (err) {
    console.warn('[STORAGE] Error saving deleted stories:', err);
  }
}

// Modify the existing DOMContentLoaded event handler to check if username is ready
document.addEventListener('DOMContentLoaded', () => {
  let planningCardsSection = document.querySelector('.planning-cards-section');
  const statsContainer = document.querySelector('.vote-statistics-container');
  if (planningCardsSection) planningCardsSection.style.display = 'none';
  if (statsContainer) statsContainer.style.display = 'none';

  // Check if we're waiting for a username (joining via invite)
  if (window.userNameReady === false) {
    console.log('[APP] Waiting for username before initializing app');
    return; // Exit early, we'll initialize after username is provided
  }
  
  // Normal initialization for users who already have a name
  let roomId = getRoomIdFromURL();
  if (!roomId) {
    roomId = 'room-' + Math.floor(Math.random() * 10000);
  }
  appendRoomIdToURL(roomId);
  
  // Load deleted stories from sessionStorage first
  loadDeletedStoriesFromStorage(roomId);
  
  initializeApp(roomId);
});

// Global state variables
let pendingStoryIndex = null;
let csvData = [];
let currentStoryIndex = 0;
let userVotes = {};
let socket = null;
let csvDataLoaded = false;
let votesPerStory = {};     // Track votes for each story { storyIndex: { userId: vote, ... }, ... }
let votesRevealed = {};     // Track which stories have revealed votes { storyIndex: boolean }
let manuallyAddedTickets = []; // Track tickets added manually
let hasRequestedTickets = false; // Flag to track if we've already requested tickets
let reconnectingInProgress = false; // Flag for reconnection logic

// Adding this function to main.js to be called whenever votes are revealed
function fixRevealedVoteFontSizes() {
  console.log('[DEBUG] Fixing revealed vote font sizes');
  // Target all vote badges in revealed state
  const voteCards = document.querySelectorAll('.vote-card-space.has-vote .vote-badge');
  
  voteCards.forEach(badge => {
    // Get the text content
    const text = badge.textContent || '';
    
    // Set base size
    let fontSize = '18px';
    
    // Use smaller font for longer text
    if (text.length >= 2) {
      fontSize = '16px';
    }
    
    // Even smaller for special cases
    if (text.includes('XX')) {
      fontSize = '14px';
    }
    
    // Apply the styles directly
    badge.style.fontSize = fontSize;
    badge.style.fontWeight = '600';
    badge.style.maxWidth = '80%';
    badge.style.textAlign = 'center';
    badge.style.display = 'block';
    
    console.log(`[DEBUG] Applied font size ${fontSize} to vote badge with text "${text}"`);
  });
}

function addFixedVoteStatisticsStyles() {
  // Remove any existing vote statistics styles to avoid conflicts
  const existingStyle = document.getElementById('fixed-vote-statistics-styles');
  if (existingStyle) {
    existingStyle.remove();
  }
  
  const style = document.createElement('style');
  style.id = 'fixed-vote-statistics-styles'; // Use a different ID
  
  style.textContent = `
    .fixed-vote-display {
      background-color: white;
      border-radius: 8px;
      max-width: 300px;
      margin: 20px auto;
      padding: 20px;
      display: flex;
      align-items: flex-start;
    }
    
    .fixed-vote-card {
      border: 2px solid #000;
      border-radius: 8px;
      width: 60px;
      height: 90px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: bold;
      margin-right: 40px;
      position: relative;
    }
    
    .fixed-vote-count {
      position: absolute;
      bottom: -25px;
      left: 0;
      width: 100%;
      text-align: center;
      font-size: 14px;
      color: #666;
    }
    
    .fixed-vote-stats {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    
    .fixed-stat-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    
    .fixed-stat-label {
      font-size: 16px;
      color: #666;
    }
    
    .fixed-stat-value {
      font-size: 26px;
      font-weight: bold;
    }
    
    .fixed-agreement-circle {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background-color: #ffeb3b;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .fixed-agreement-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: white;
    }
  `;
  
  document.head.appendChild(style);
}

// Create a new function to generate the stats layout
function getUserIdToNameMap() {
  const map = {};
  (window.latestUserList || []).forEach(u => {
    map[u.id] = u.name;  });
  return map;
}
function createFixedVoteDisplay(votes) {
  addFixedVoteStatisticsStyles(); // Always ensure styles are added
  
  const container = document.createElement('div');
  container.className = 'fixed-vote-display';

  const userIdToNameMap = getUserIdToNameMap();
  const userNameVoteMap = new Map();

  for (const [socketId, vote] of Object.entries(votes)) {
    const userName = userIdToNameMap[socketId] || socketId;
    if (!userNameVoteMap.has(userName)) {
      userNameVoteMap.set(userName, vote);
    }
  }

  const voteValues = Array.from(userNameVoteMap.values());

  const numericVotes = voteValues
    .map(v => parseFloat(v))
    .filter(v => !isNaN(v));

  let average = numericVotes.length
    ? Math.round((numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length) * 10) / 10
    : 0;

  let mostCommonVote = voteValues[0] || '0';
  const freq = {};
  voteValues.forEach(v => {
    freq[v] = (freq[v] || 0) + 1;
    if (freq[v] > (freq[mostCommonVote] || 0)) {
      mostCommonVote = v;
    }
  });

  container.innerHTML = `
    <div class="fixed-vote-card">
      ${mostCommonVote}
      <div class="fixed-vote-count">${voteValues.length} Vote${voteValues.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="fixed-vote-stats">
      <div class="fixed-stat-group">
        <div class="fixed-stat-label">Average:</div>
        <div class="fixed-stat-value">${average}</div>
      </div>
      <div class="fixed-stat-group">
        <div class="fixed-stat-label">Agreement:</div>
        <div class="fixed-agreement-circle">
          <div class="agreement-icon">👍</div>
        </div>
      </div>
    </div>
  `;

  return container;
}


/**
 * Determines if current user is a guest
 */
function isGuestUser() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.has('roomId') && (!urlParams.has('host') || urlParams.get('host') !== 'true');
}

/**
 * Determines if current user is the host
 */
function isCurrentUserHost() {
  return sessionStorage.getItem('isHost') === 'true';
}

function setupPlanningCards() {
  const container = document.getElementById('planningCards');
  if (!container) return;

  const votingSystem = sessionStorage.getItem('votingSystem') || 'fibonacci';

  const scales = {
    fibonacci: ['0', '1', '2', '3', '5', '8', '13', '21'],
    shortFib: ['0', '½', '1', '2', '3'],
    tshirt: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'],
    tshirtNum: ['XS (1)', 'S (2)', 'M (3)', 'L (5)', 'XL (8)', 'XXL (13)'],
    custom: ['?', '☕', '∞']
  };

  const values = scales[votingSystem] || scales.fibonacci;

  container.innerHTML = ''; // Clear any existing cards

  values.forEach(value => {
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-value', value);
    card.setAttribute('draggable', 'true');
    card.textContent = value;
    container.appendChild(card);
  });

  // ✅ Enable drag after cards are added
  setupVoteCardsDrag();
}

/**
 * Set up guest mode restrictions
 */
function setupGuestModeRestrictions() {
  if (isGuestUser()) {
    // Hide sidebar control buttons
    const revealVotesBtn = document.getElementById('revealVotesBtn');
    const resetVotesBtn = document.getElementById('resetVotesBtn');
    if (revealVotesBtn) revealVotesBtn.classList.add('hide-for-guests');
    if (resetVotesBtn) resetVotesBtn.classList.add('hide-for-guests');
    
    // Hide upload ticket button
    const fileInputContainer = document.getElementById('fileInputContainer');
    if (fileInputContainer) fileInputContainer.classList.add('hide-for-guests');
    
    // Hide add ticket button
    const addTicketBtn = document.getElementById('addTicketBtn');
    if (addTicketBtn) addTicketBtn.classList.add('hide-for-guests');
    
    console.log('Guest mode activated - voting controls restricted');
  }
}

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
  socket.on('userList', users => {
    window.latestUserList = users;
  });

  socket.on('voteUpdate', ({ userId, vote, storyId }) => {
    // ✅ Skip if vote already exists and is identical
    if (
      votesPerStory[storyId] &&
      votesPerStory[storyId][userId] === vote
    ) {
      console.log(`[SKIP] Duplicate vote update ignored for ${userId} on story ${storyId}`);
      return;
    }

    // Proceed to merge the vote
    if (!votesPerStory[storyId]) votesPerStory[storyId] = {};
    votesPerStory[storyId][userId] = vote;
    window.currentVotesPerStory = votesPerStory;

    const currentId = getCurrentStoryId();
    if (storyId === currentId) {
      updateVoteVisuals(userId, votesRevealed[storyId] ? vote : '👍', true);
    }

    refreshVoteDisplay();
  });

  socket.on('storyVotes', ({ storyId, votes }) => {
    // Don't process votes for deleted stories
    if (deletedStoryIds.has(storyId)) {
      console.log(`[VOTE] Ignoring votes for deleted story: ${storyId}`);
      return;
    }
    
    if (!votesPerStory[storyId]) {
      votesPerStory[storyId] = {};
    }
    
    // Store the votes
    votesPerStory[storyId] = { ...votes };
    window.currentVotesPerStory = votesPerStory;
    
    // Update UI immediately if this is the current story
    const currentStoryId = getCurrentStoryId();
    if (currentStoryId === storyId) {
      if (votesRevealed[storyId]) {
        // Show actual votes if revealed
        applyVotesToUI(votes, false);
      } else {
        // Show thumbs up if not revealed
        applyVotesToUI(votes, true);
      }
    }
  });
  
  // Updated handler for restored user votes
  socket.on('restoreUserVote', ({ storyId, vote }) => {
    // Skip for deleted stories
    if (deletedStoryIds.has(storyId)) {
      console.log(`[VOTE] Ignoring vote restoration for deleted story: ${storyId}`);
      return;
    }

    // Don't update if the vote is the same (prevent flicker)
    if (!votesPerStory[storyId]) votesPerStory[storyId] = {};
    
    const existingVote = votesPerStory[storyId][socket.id];
    if (existingVote === vote) {
      console.log(`[VOTE] Skipping duplicate vote update: ${vote} for story ${storyId}`);
      return;
    }

    votesPerStory[storyId][socket.id] = vote;
    window.currentVotesPerStory = votesPerStory;

    const currentId = getCurrentStoryId();
    if (storyId === currentId) {
      updateVoteVisuals(socket.id, votesRevealed[storyId] ? vote : '👍', true);
      
      // If votes are already revealed, also regenerate statistics
      if (votesRevealed[storyId]) {
        // Use debounce to prevent rapid UI updates after reconnection
        debounceHandleVotesRevealed(storyId, votesPerStory[storyId]);
      }
    }

    // Use debounced refresh to avoid flickering
    debouncedRefreshVoteDisplay();
  });

  // Create debounced version of handleVotesRevealed
  const debounceHandleVotesRevealed = debounce((storyId, votes) => {
    handleVotesRevealed(storyId, votes);
  }, 300);

  // Updated resyncState handler to restore votes
  socket.on('resyncState', ({ tickets, votesPerStory: serverVotes, votesRevealed: serverRevealed, deletedStoryIds: serverDeletedIds }) => {
    console.log('[SOCKET] Received resyncState from server');

    // Flag to track if we need a UI refresh
    let needRefresh = false;

    // Update local deleted stories tracking
    if (Array.isArray(serverDeletedIds)) {
      serverDeletedIds.forEach(id => deletedStoryIds.add(id));
      saveDeletedStoriesToStorage(roomId);
    }

    // Filter and process non-deleted tickets
    const filteredTickets = (tickets || []).filter(ticket => !deletedStoryIds.has(ticket.id));
    if (Array.isArray(filteredTickets)) {
      processAllTickets(filteredTickets);
    }

    // Update local vote state for non-deleted stories
    if (serverVotes) {
      for (const [storyId, votes] of Object.entries(serverVotes)) {
        if (deletedStoryIds.has(storyId)) continue;
        
        // Compare votes before updating
        const previousVotes = JSON.stringify(votesPerStory[storyId] || {});
        const newVotes = JSON.stringify(votes || {});
        
        if (previousVotes !== newVotes) {
          if (!votesPerStory[storyId]) votesPerStory[storyId] = {};
          votesPerStory[storyId] = { ...votes };
          window.currentVotesPerStory = votesPerStory;
          needRefresh = true;
        }

        if (serverRevealed && serverRevealed[storyId]) {
          votesRevealed[storyId] = true;
          persistRevealState(storyId, true);
          
          // Apply to UI if current story - avoid duplicate rendering
          const currentId = getCurrentStoryId();
          if (storyId === currentId) {
            applyVotesToUI(votes, false);
          }
        }
      }
    }

    // Only refresh once if needed, after all changes
    if (needRefresh) {
      // Debounce the UI update to avoid flicker
      debouncedRefreshVoteDisplay();
    }
    
    // Ensure planning cards are visible for guests
    ensurePlanningCardsVisibleForGuests();
  });

  // Updated deleteStory event handler to track deletions locally
  socket.on('deleteStory', ({ storyId }) => {
    console.log('[SOCKET] Story deletion event received:', storyId);
    
    // Add to local deletion tracking
    deletedStoryIds.add(storyId);
    
    // Save to session storage
    saveDeletedStoriesToStorage(roomId);
    
    // Remove from DOM
    const el = document.getElementById(storyId);
    if (el) {
      el.remove();
      normalizeStoryIndexes();
    }
    
    // Clear vote data for the deleted story
    delete votesPerStory[storyId];
    delete votesRevealed[storyId];
  });

  socket.on('votesRevealed', ({ storyId }) => {
    console.log('[DEBUG] Socket received votesRevealed for story:', storyId);
    
    // Check if this story is deleted
    if (deletedStoryIds.has(storyId)) {
      console.log(`[VOTE] Ignoring vote reveal for deleted story: ${storyId}`);
      return;
    }
    
    votesRevealed[storyId] = true;
    persistRevealState(storyId, true);
    const votes = votesPerStory[storyId] || {};
    console.log('[DEBUG] Votes to reveal:', JSON.stringify(votes));

    // Show votes on cards
    applyVotesToUI(votes, false);

    // Use centralized function for UI visibility
    updateUIVisibilityState(storyId, 'stats');

    // Fix font sizes
    setTimeout(fixRevealedVoteFontSizes, 100);
  });

  socket.on('votesReset', ({ storyId }) => {
    // Skip processing for deleted stories
    if (deletedStoryIds.has(storyId)) {
      return;
    }
    
    // Clear vote data for this story
    if (votesPerStory[storyId]) {
      votesPerStory[storyId] = {};
    }
    
    votesRevealed[storyId] = false;
    persistRevealState(storyId, false);
    resetAllVoteVisuals();
    
    // Use centralized function for UI visibility
    updateUIVisibilityState(storyId, 'cards');
  });

  socket.on('storySelected', ({ storyIndex, storyId }) => {
    console.log('[SOCKET] storySelected received:', storyIndex, storyId);
    hasReceivedStorySelection = true;

    // Fallback: get storyId from index if missing
    if (!storyId && typeof storyIndex === 'number') {
      const storyCards = document.querySelectorAll('.story-card');
      const target = storyCards[storyIndex];
      if (target) {
        storyId = target.id;
        console.log('[SOCKET] Fallback resolved storyId from index:', storyId);
      }
    }

    if (!storyId) {
      console.warn(`[storySelected] Could not resolve storyId`);
      return;
    }

    selectStory(storyIndex, false);
    
    // Ensure planning cards are visible for guests
    ensurePlanningCardsVisibleForGuests();
  });

  // Add reconnection handlers for socket
  if (socket) {
    // New handler for reconnect attempts
    socket.on('reconnect_attempt', (attempt) => {
      console.log(`[SOCKET] Reconnection attempt ${attempt}`);
      reconnectingInProgress = true;
    });
    
// Handle successful reconnection with improved UI stability
socket.on('reconnect', () => {
  console.log('[SOCKET] Reconnected to server');
  reconnectingInProgress = false;
  
  // IMPORTANT: Don't modify UI visibility until we know the state
  // Make a SINGLE update after we have all information

  // Request current state and story
  socket.emit('requestCurrentStory');
  socket.emit('requestAllTickets');
  
  // Add a delay before requesting full state and changing UI
  setTimeout(() => {
    socket.emit('requestFullStateResync');
    
    // Check current story reveal state
    const currentId = getCurrentStoryId();
    if (currentId) {
      // Check local storage first for revealed state
      const isRevealed = getPersistedRevealState(currentId);
      votesRevealed[currentId] = isRevealed;
      
      // Only update UI ONCE with correct state
      if (isRevealed) {
        // If votes were revealed, don't show planning cards at all
        if (votesPerStory[currentId]) {
          // Use direct DOM manipulation rather than the function that might transition
          const statsContainer = document.querySelector('.vote-statistics-container');
          const planningCardsSection = document.querySelector('.planning-cards-section');
          
          if (statsContainer) {
            statsContainer.style.transition = 'none';
            statsContainer.innerHTML = '';
            statsContainer.appendChild(createFixedVoteDisplay(votesPerStory[currentId]));
            statsContainer.style.display = 'block';
            
            // Show actual vote values
            applyVotesToUI(votesPerStory[currentId], false);
            setTimeout(fixRevealedVoteFontSizes, 100);
          }
          
          if (planningCardsSection) {
            planningCardsSection.style.transition = 'none';
            planningCardsSection.style.display = 'none';
          }
        }
      } else {
        // If votes not revealed, only show planning cards
        updateUIVisibilityState(currentId, 'cards');
      }
      
      // Request votes for this story
      socket.emit('requestStoryVotes', { storyId: currentId });
    } else {
      // No current story, show planning cards
      updateUIVisibilityState(null, 'cards');
    }

    // Re-apply stored votes after we know the UI state
    if (typeof getUserVotes === 'function') {
      const userVotes = getUserVotes();
      for (const [storyId, vote] of Object.entries(userVotes)) {
        if (deletedStoryIds.has(storyId)) continue;

        if (!votesPerStory[storyId]) votesPerStory[storyId] = {};
        votesPerStory[storyId][socket.id] = vote;
        window.currentVotesPerStory = votesPerStory;

        const currentId = getCurrentStoryId();
        if (storyId === currentId) {
          updateVoteVisuals(socket.id, votesRevealed[storyId] ? vote : '👍', true);
        }
      }

      // Use non-debounced version to ensure immediate update
      refreshVoteDisplay();
    }
    
    // Resume transitions after a delay
    setTimeout(() => {
      const statsContainer = document.querySelector('.vote-statistics-container');
      const planningCardsSection = document.querySelector('.planning-cards-section');
      if (statsContainer) statsContainer.style.transition = '';
      if (planningCardsSection) planningCardsSection.style.transition = '';
    }, 1000);
  }, 500);
});


    
  }
  
  // Guest: Listen for host's voting system
  socket.on('votingSystemUpdate', ({ votingSystem }) => {
    console.log('[SOCKET] Received voting system from host:', votingSystem);
    sessionStorage.setItem('votingSystem', votingSystem);
    setupPlanningCards(); // Dynamically regenerate vote cards
  });

  // Host: Emit selected voting system to server
  const isHost = sessionStorage.getItem('isHost') === 'true';
  const votingSystem = sessionStorage.getItem('votingSystem') || 'fibonacci';

  if (isHost && socket) {
    socket.emit('votingSystemSelected', { roomId, votingSystem });
  }

  updateHeaderStyle();
  addFixedVoteStatisticsStyles();
  setupCSVUploader();
  setupInviteButton();
  setupStoryNavigation();
  
  const storyId = getCurrentStoryId();
  // Use centralized function for initial UI state
  updateUIVisibilityState(storyId);

  setupRevealResetButtons();
  setupAddTicketButton();
  setupGuestModeRestrictions(); // Add guest mode restrictions
  
  const currentId = getCurrentStoryId();

  // Check for stored reveal state during initialization
  if (currentId) {
    const isRevealed = getPersistedRevealState(currentId) || votesRevealed[currentId];
    
    if (isRevealed) {
      votesRevealed[currentId] = true;
      
      // Request votes for this story
      if (socket && socket.connected) {
        socket.emit('requestStoryVotes', { storyId: currentId });
      }
      
      // If we have votes already, show them
      if (votesPerStory[currentId] && Object.keys(votesPerStory[currentId]).length > 0) {
        // Short delay to ensure DOM is ready
        setTimeout(() => {
          handleVotesRevealed(currentId, votesPerStory[currentId]);
        }, 300);
      }
    } else {
      // Use centralized function for planning cards visibility
      updateUIVisibilityState(currentId, 'cards');
    }
  } else {
    // No current story selected yet
    // Use centralized function for planning cards visibility
    updateUIVisibilityState(null, 'cards');
  }

  setupStoryCardInteractions();
  
  // Add these cleanup and setup calls for delete buttons
  cleanupDeleteButtonHandlers();
  setupCSVDeleteButtons();
  
  // Add CSS for new layout
  addNewLayoutStyles();
  
  // Refresh votes periodically to ensure everyone sees the latest votes
  setInterval(refreshCurrentStoryVotes, 30000); // Check every 30 seconds
  
  // Ensure planning cards are visible for guests
  ensurePlanningCardsVisibleForGuests();
}

/**
 * Periodically refresh votes for the current story
 */
function refreshCurrentStoryVotes() {
  if (!socket || !socket.connected) return;
  
  const storyId = getCurrentStoryId();
  
  // Skip for deleted stories or when no story is selected
  if (!storyId || deletedStoryIds.has(storyId)) return;
  
  // Only request votes if we haven't already revealed them
  // This prevents unnecessary traffic and potential re-animation
  if (!votesRevealed[storyId]) {
    console.log(`[AUTO] Refreshing votes for current story: ${storyId}`);
    socket.emit('requestStoryVotes', { storyId });
  }
}

function updateHeaderStyle() {
  // Implement if needed
}

/**
 * Add CSS styles for the new layout
 */
function addNewLayoutStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .poker-table-layout {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      max-width: 800px;
      margin: 0 auto;
      gap: 15px;
      padding: 20px 0;
    }
    
    .avatar-row {
      display: flex;
      justify-content: center;
      width: 100%;
      gap: 20px;
      flex-wrap: wrap;
    }
    .disabled-nav {
      opacity: 0.4;
      pointer-events: none;
      cursor: not-allowed;
    }
    
    .vote-row {
      display: flex;
      justify-content: center;
      width: 100%;
      gap: 20px;
      flex-wrap: wrap;
    }
    
    .avatar-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 80px;
      transition: transform 0.2s;
    }
    
    .avatar-container:hover {
      transform: translateY(-3px);
    }
    
    .avatar-circle {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #ccc;
      background-color: white;
      transition: all 0.3s ease;
    }
    
    .has-voted .avatar-circle {
      border-color: #4CAF50;
      background-color: #c1e1c1;
    }
    
    .user-name {
      font-size: 12px;
      margin-top: 5px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    /* Update the card styling to be thinner */
    .card {
      width: 45px; /* Reduced from original width */
      height: 50px; /* Maintain proportion */
      padding: 10px;
      background: #cfc6f7; /* Light purple background matching your image */
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      font-size: 18px;
      text-align: center;
      transition: transform 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 5px;
    }
    
    .card:hover {
      transform: translateY(-5px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    
    /* Make cards properly align and wrap */
    .cards {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      padding: 10px 0;
    }
     .vote-card-space {
      width: 60px;
      height: 90px;
      border: 2px dashed #ccc;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #f9f9f9;
      transition: all 0.2s ease;
      
    }
    
    .vote-card-space:hover {
      border-color: #999;
      background-color: #f0f0f0;
    }
    
    .vote-card-space.has-vote {
      border-style: solid;
      border-color: #673ab7;
      background-color: #f0e6ff;
    }
    
    .vote-badge {
      font-size: 18px;
      font-weight: bold;
      color: #673ab7 !important; /* Purple color matching your theme */
      opacity: 1 !important;
      transition: none; /* Prevent any transitions that might delay visibility */
    }
     /* Add styles to ensure visibility in vote card spaces */
    .vote-card-space .vote-badge {
      font-size: 24px;
      visibility: visible !important;
    }
    
    /* Make sure the thumbs up is visible in the has-vote state */
    .vote-card-space.has-vote .vote-badge {
      display: block !important;
      color: #673ab7 !important;
    }
    
    .reveal-button-container {
      margin: 10px 0;
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .global-emoji-burst {
      position: fixed;
      font-size: 2rem;
      pointer-events: none;
      opacity: 0;
      transform: scale(0.5) translateY(0);
      transition: transform 0.8s ease-out, opacity 0.8s ease-out;
      z-index: 9999;
    }

    .global-emoji-burst.burst-go {
      opacity: 1;
      transform: scale(1.5) translateY(-100px);
    }

    .reveal-votes-button {
      padding: 12px 24px;
      font-size: 16px;
      font-weight: bold;
      background-color: #ffffff;
      color: #673ab7;
      border: 2px solid #673ab7;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      letter-spacing: 1px;
    }
    
    .reveal-votes-button:hover {
      background-color: #673ab7;
      color: white;
    }
    
    .cards {
      margin-top: 30px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .disabled-story {
      pointer-events: none;
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .card {
      padding: 10px 20px;
      background: #cfc6f7;
      border-radius: 8px;
      cursor: grab;
      font-weight: bold;
      font-size: 18px;
      min-width: 40px;
      text-align: center;
      transition: transform 0.2s;
    }
    
    .card:hover {
      transform: translateY(-5px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    
    /* Add hide-for-guests class if not already defined in index.html */
    .hide-for-guests {
      display: none !important;
    }
    .own-vote-space {
      border: 2px dashed #673ab7;
      position: relative;
    }
    
    .own-vote-space::after {
      content: 'Your vote';
      position: absolute;
      bottom: -20px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 10px;
      color: #673ab7;
      white-space: nowrap;
    }
    
    /* Add styles for the drop-not-allowed state */
    .vote-card-space.drop-not-allowed {
      border-color: #f44336;
      background-color: #ffebee;
      position: relative;
    }
    
    .vote-card-space.drop-not-allowed::before {
      content: '✕';
      position: absolute;
      color: #f44336;
      font-size: 24px;
      font-weight: bold;
      opacity: 0.8;
    }
     /* Delete button styles */
    .story-delete-btn {
      position: absolute;
      right: 8px;
      top: 8px;
      width: 20px;
      height: 20px;
      background-color: #f44336;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.2s, transform 0.2s;
      z-index: 2;
    }
    
    .story-delete-btn:hover {
      opacity: 1;
      transform: scale(1.1);
    }
    
    /* Make sure story cards properly handle the delete button position */
    .story-card {
      position: relative;
      padding-right: 35px;
    }
    
    /* Connection status indicator */
    .connection-status {
      position: fixed;
      bottom: 10px;
      right: 10px;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      color: white;
      background-color: #4caf50;
      transition: all 0.3s ease;
      opacity: 0;
      z-index: 9999;
    }
    
    .connection-status.reconnecting {
      background-color: #ff9800;
      opacity: 1;
    }
    
    .connection-status.error {
      background-color: #f44336;
      opacity: 1;
    }
    
    .connection-status.connected {
      opacity: 1;
      animation: fadeOut 2s ease 2s forwards;
    }
    
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  
  // Create connection status indicator
  const statusIndicator = document.createElement('div');
  statusIndicator.className = 'connection-status';
  statusIndicator.id = 'connectionStatus';
  statusIndicator.textContent = 'Connected';
  document.body.appendChild(statusIndicator);
  
  // Show initial connected state briefly
  statusIndicator.classList.add('connected');
  setTimeout(() => {
    statusIndicator.classList.remove('connected');
  }, 4000);
}

/**
 * Update connection status UI
 * @param {string} status - 'connected', 'reconnecting', or 'error'
 */
function updateConnectionStatus(status) {
  const statusIndicator = document.getElementById('connectionStatus');
  if (!statusIndicator) return;
  
  // Remove all classes first
  statusIndicator.classList.remove('connected', 'reconnecting', 'error');
  
  // Set text and add appropriate class
  switch (status) {
    case 'connected':
      statusIndicator.textContent = 'Connected';
      statusIndicator.classList.add('connected');
      break;
    case 'reconnecting':
      statusIndicator.textContent = 'Reconnecting...';
      statusIndicator.classList.add('reconnecting');
      break;
    case 'error':
      statusIndicator.textContent = 'Connection Error';
      statusIndicator.classList.add('error');
      break;
  }
}

/**
 * This function removes all delete button direct event listeners
 */
function cleanupDeleteButtonHandlers() {
  const deleteButtons = document.querySelectorAll('.story-delete-btn');
  deleteButtons.forEach(btn => {
    // Clone the button to remove all event listeners
    const newBtn = btn.cloneNode(true);
    if (btn.parentNode) {
      btn.parentNode.replaceChild(newBtn, btn);
    }
  });
  console.log(`[CLEANUP] Removed event listeners from ${deleteButtons.length} delete buttons`);
}

/**
 * Setup delegation-based event handling for CSV story delete buttons
 */
function setupCSVDeleteButtons() {
  // Define the handler function if it doesn't exist yet
  if (!window.csvDeleteButtonHandler) {
    window.csvDeleteButtonHandler = function(event) {
      // Only handle clicks on delete buttons inside CSV stories
      const deleteBtn = event.target.closest('.story-delete-btn');
      const storyCard = event.target.closest('.story-card[id^="story_csv_"]');
      
      if (deleteBtn && storyCard && storyCard.id) {
        event.stopPropagation();
        event.preventDefault();
        
        console.log('[DELETE] Delegated handler for CSV story:', storyCard.id);
        deleteStory(storyCard.id);
      }
    };
  }
  
  // Remove any existing delegated click handler first (safely)
  try {
    document.removeEventListener('click', window.csvDeleteButtonHandler);
  } catch (e) {
    console.log('[SETUP] No existing handler to remove');
  }
  
  // Add the new event listener
  document.addEventListener('click', window.csvDeleteButtonHandler);
  console.log('[SETUP] CSV delete button handler installed');
}

/**
 * Delete a story by ID with duplicate confirmation prevention
 */
function deleteStory(storyId) {
  console.log('[DELETE] Attempting to delete story:', storyId);
  
  // Prevent multiple confirmation dialogs
  if (deleteConfirmationInProgress) {
    console.log('[DELETE] Delete confirmation already in progress, ignoring duplicate call');
    return;
  }
  
  deleteConfirmationInProgress = true;
  
  // Confirm deletion
  const confirmResult = confirm('Are you sure you want to delete this story?');
  
  // Reset the flag regardless of result
  setTimeout(() => {
    deleteConfirmationInProgress = false;
  }, 100);
  
  if (!confirmResult) {
    console.log('[DELETE] User canceled deletion');
    return;
  }
  
  // Get the story element BEFORE we do anything else
  const storyCard = document.getElementById(storyId);
  if (!storyCard) {
    console.error('[DELETE] Story card not found:', storyId);
    return;
  }

  console.log('[DELETE] Found story card, proceeding with deletion');
  
  // Mark as deleted in our local tracking
  deletedStoryIds.add(storyId);
  
  // Save to session storage
  const roomId = getRoomIdFromURL();
  saveDeletedStoriesToStorage(roomId);
  
  // Get story index before removal (for selection adjustment)
  const index = parseInt(storyCard.dataset.index);
  
  // Check if this is a CSV story
  const isCsvStory = storyId.startsWith('story_csv_');
  
  // **IMPORTANT: We'll emit to server BEFORE removing from DOM**
  if (socket) {
    console.log('[DELETE] Emitting deleteStory event to server');
    
    if (isCsvStory) {
      // For CSV stories, extract the index and send additional info
      const csvIndex = parseInt(storyId.replace('story_csv_', ''));
      socket.emit('deleteStory', { storyId, isCsvStory: true, csvIndex });
    } else {
      // For regular stories
      socket.emit('deleteStory', { storyId });
    }
  } else {
    console.warn('[DELETE] Socket not available, deleting locally only');
  }
  
  // Remove from the DOM
  storyCard.remove();
  
  // Clear vote data for this story
  delete votesPerStory[storyId];
  delete votesRevealed[storyId];
  
  // After removal, select another item if needed
  if (index === currentStoryIndex) {
    const storyList = document.getElementById('storyList');
    if (storyList && storyList.children.length > 0) {
      // Choose the next story, or the last one if we deleted the last
      const newIndex = Math.min(index, storyList.children.length - 1);
      selectStory(newIndex, true); // Emit to server because we're selecting
    }
  }
  
  // Renumber the remaining stories
  normalizeStoryIndexes();
  
  console.log('[DELETE] Deletion complete for story:', storyId);
}

function createVoteStatisticsDisplay(votes) {
  // Create container
  const container = document.createElement('div');
  container.className = 'vote-statistics-display';
  
  // Calculate statistics
  const voteValues = Object.values(votes);
  const numericValues = voteValues
    .filter(v => !isNaN(parseFloat(v)) && v !== null && v !== undefined)
    .map(v => parseFloat(v));
  
  // Default values
  let mostCommonVote = voteValues.length > 0 ? voteValues[0] : 'No votes';
  let voteCount = voteValues.length;
  let averageValue = 0;
  let agreementPercent = 0;
  
  // Calculate statistics if we have numeric values
  if (numericValues.length > 0) {
    // Find most common vote
    const voteFrequency = {};
    let maxCount = 0;
    
    voteValues.forEach(vote => {
      voteFrequency[vote] = (voteFrequency[vote] || 0) + 1;
      if (voteFrequency[vote] > maxCount) {
        maxCount = voteFrequency[vote];
        mostCommonVote = vote;
      }
    });
    
    // Calculate average
    averageValue = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
    averageValue = Math.round(averageValue * 10) / 10; // Round to 1 decimal place
    
    // Calculate agreement percentage
    agreementPercent = (maxCount / voteValues.length) * 100;
  }
  
  // Create HTML that matches your CSS classes
  container.innerHTML = `
    <div class="vote-chart">
      <div class="vote-card-box">
        <div class="vote-value">${mostCommonVote}</div>
      </div>
      <div class="vote-count">${voteCount} Vote${voteCount !== 1 ? 's' : ''}</div>
    </div>
    <div class="vote-stats">
      <div class="stat-row">
        <div class="stat-label">Average:</div>
        <div class="stat-value">${averageValue}</div>
      </div>
      <div class="stat-row">
        <div class="stat-label">Agreement:</div>
        <div class="stat-circle" style="background-color: ${getAgreementColor(agreementPercent)}">
          <div class="agreement-icon">👍</div>
        </div>
      </div>
    </div>
  `;
  
  return container;
}

// Helper function to find most common vote
function findMostCommonVote(votes) {
  const voteValues = Object.values(votes);
  const counts = {};
  
  voteValues.forEach(vote => {
    counts[vote] = (counts[vote] || 0) + 1;
  });
  
  let maxCount = 0;
  let mostCommon = '';
  
  for (const vote in counts) {
    if (counts[vote] > maxCount) {
      maxCount = counts[vote];
      mostCommon = vote;
    }
  }
  
  return mostCommon;
}

// Helper to get color based on agreement percentage
function getAgreementColor(percentage) {
  if (percentage === 100) return '#00e676'; // Perfect agreement - green
  if (percentage >= 75) return '#76ff03';  // Good agreement - light green
  if (percentage >= 50) return '#ffeb3b';  // Medium agreement - yellow
  if (percentage >= 0) return '#FFEB3B';
  return '#ff9100';  // Low agreement - orange
}

function addVoteStatisticsStyles() {
  // Implement if needed
}

/**
 * Handle votes revealed event by showing statistics
 * @param {number} storyId - ID of the story
 * @param {Object} votes - Vote data
 */
function handleVotesRevealed(storyId, votes) {
  console.log('[VOTES] Handling votes revealed for story:', storyId);

  if (deletedStoryIds.has(storyId)) {
    console.log(`[VOTE] Not revealing votes for deleted story: ${storyId}`);
    return;
  }

  // Store and persist the revealed state
  votesRevealed[storyId] = true;
  persistRevealState(storyId, true);
  
  if (!votesPerStory[storyId]) {
    votesPerStory[storyId] = {};
  }

  votesPerStory[storyId] = { ...votes };
  window.currentVotesPerStory = votesPerStory;

  addFixedVoteStatisticsStyles();

  // Use centralized function to manage UI visibility
  updateUIVisibilityState(storyId, 'stats');
  
  // Make sure the font sizes are correct
  setTimeout(fixRevealedVoteFontSizes, 100);
  setTimeout(fixRevealedVoteFontSizes, 300);
}

/**
 * Setup Add Ticket button
 */
function setupAddTicketButton() {
  const addTicketBtn = document.getElementById('addTicketBtn');
  if (!addTicketBtn) return;

  // Use the modal instead of prompt
  addTicketBtn.addEventListener('click', () => {
    if (typeof window.showAddTicketModal === 'function') {
      window.showAddTicketModal();
    } else {
      // Fallback to the old prompt method if modal function isn't available
      const storyText = prompt("Enter the story details:");
      if (storyText && storyText.trim()) {
        const ticketData = {
          id: `story_${Date.now()}`,
          text: storyText.trim()
        };
        
        // Check if this ID is in our deleted set
        if (deletedStoryIds.has(ticketData.id)) {
          console.log('[ADD] Cannot add previously deleted ticket:', ticketData.id);
          return;
        }
        
        if (typeof emitAddTicket === 'function') {
          emitAddTicket(ticketData);
        } else if (socket) {
          socket.emit('addTicket', ticketData);
        }
        
        addTicketToUI(ticketData, true);
        manuallyAddedTickets.push(ticketData);
        
        // Ensure planning cards are visible for guests
        ensurePlanningCardsVisibleForGuests();
      }
    }
  });
}

function getVoteEmoji(vote) {
  const map = {
    '1': '🟢',
    '2': '🟡',
    '3': '🔴',
    '5': '🚀',
    '8': '🔥',
    '?': '❓',
    '👍': '👍'
  };
  return map[vote] || '🎉';
}

/**
 * Add a ticket to the UI
 * @param {Object} ticketData - Ticket data { id, text }
 * @param {boolean} selectAfterAdd - Whether to select the ticket after adding
 */
function addTicketToUI(ticketData, selectAfterAdd = false) {
  if (!ticketData || !ticketData.id || !ticketData.text) return;
  
  // Check if this ticket is in our deleted set
  if (deletedStoryIds.has(ticketData.id)) {
    console.log('[ADD] Not adding deleted ticket to UI:', ticketData.id);
    return;
  }
  
  const storyList = document.getElementById('storyList');
  if (!storyList) return;
  
  // Check if this ticket already exists (to avoid duplicates)
  const existingTicket = document.getElementById(ticketData.id);
  if (existingTicket) return;
  
  // Create new story card
  const storyCard = document.createElement('div');
  storyCard.className = 'story-card';
  storyCard.id = ticketData.id;
  
  // Set data index attribute (for selection)
  const newIndex = storyList.children.length;
  storyCard.dataset.index = newIndex;
  
  // Create the story title element
  const storyTitle = document.createElement('div');
  storyTitle.className = 'story-title';
  storyTitle.textContent = ticketData.text;
  
  // Add to DOM
  storyCard.appendChild(storyTitle);
  
  // Add delete button for hosts only
  if (isCurrentUserHost()) {
    const deleteButton = document.createElement('div');
    deleteButton.className = 'story-delete-btn';
    deleteButton.innerHTML = '🗑'; // dustbin symbol
    deleteButton.title = 'Delete story';
    
    // Add click handler for delete button
    deleteButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent story selection when clicking delete
      deleteStory(ticketData.id);
    });
    
    storyCard.appendChild(deleteButton);
  }
  
  storyList.appendChild(storyCard);
  
  // Check if user is guest and handle accordingly
  if (isGuestUser()) {
    storyCard.classList.add('disabled-story');
  } else {
    // Add click event listener only for hosts
    storyCard.addEventListener('click', () => {
      selectStory(newIndex);
    });
  }
  
  // Select the new story if requested (only for hosts)
  if (selectAfterAdd && !isGuestUser()) {
    selectStory(newIndex);
  }
  
  // Check for stories message
  const noStoriesMessage = document.getElementById('noStoriesMessage');
  if (noStoriesMessage) {
    noStoriesMessage.style.display = 'none';
  }
  
  // Enable planning cards if they were disabled
  document.querySelectorAll('#planningCards .card').forEach(card => {
    card.classList.remove('disabled');
    card.setAttribute('draggable', 'true');
  });
  normalizeStoryIndexes();
  
  // Ensure planning cards are visible for guests
  ensurePlanningCardsVisibleForGuests();
}

/**
 * Set up a mutation observer to catch any newly added story cards
 */
function setupStoryCardObserver() {
  if (!isGuestUser()) return; // Only needed for guests
  
  const storyList = document.getElementById('storyList');
  if (!storyList) return;
  
  // Create a mutation observer
  const observer = new MutationObserver((mutations) => {
    let needsUpdate = false;
    
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) {
        needsUpdate = true;
      }
    });
    
    if (needsUpdate) {
      applyGuestRestrictions();
    }
  });
  
  // Start observing
  observer.observe(storyList, { 
    childList: true, 
    subtree: true 
  });
}

/**
 * Apply guest restrictions to all story cards
 * This ensures manually added cards are also properly restricted
 */
function applyGuestRestrictions() {
  if (!isGuestUser()) return; // Only apply to guests
  
  // Select all story cards
  const storyCards = document.querySelectorAll('.story-card');
  
  storyCards.forEach(card => {
    // Make sure the card has the disabled class
    card.classList.add('disabled-story');
    
    // Remove all click events by cloning and replacing
    const newCard = card.cloneNode(true);
    if (card.parentNode) {
      card.parentNode.replaceChild(newCard, card);
    }
  });
}

/**
 * Process multiple tickets at once (used when receiving all tickets from server)
 * @param {Array} tickets - Array of ticket data objects
 */
function processAllTickets(tickets) {
  const filtered = tickets.filter(ticket => !deletedStoryIds.has(ticket.id));
  console.log(`[TICKETS] Processing ${filtered.length} tickets (filtered from ${tickets.length})`);

  const storyList = document.getElementById('storyList');
  if (storyList) {
    const manualCards = storyList.querySelectorAll('.story-card[id^="story_"]:not([id^="story_csv_"])');
    manualCards.forEach(card => card.remove());
  }

  filtered.forEach(ticket => {
    if (ticket?.id && ticket?.text) {
      addTicketToUI(ticket, false);
    }
  });
  if (filtered.length > 0) {
    if (currentStoryIndex === null || currentStoryIndex === undefined || currentStoryIndex < 0 || currentStoryIndex >= filtered.length) {
      currentStoryIndex = 0;
      selectStory(0, false);
    } else {
      console.log('[INIT] Skipping auto-select, currentStoryIndex already set:', currentStoryIndex);
      // 🛠️ Add this line to re-highlight the story in UI
      selectStory(currentStoryIndex, false);
    }
    
    // Make sure planning cards are visible if we have stories
    ensurePlanningCardsVisibleForGuests();
  }

  if (isGuestUser()) {
    applyGuestRestrictions();
  }
}

// Get storyId from selected card
function getCurrentStoryId() {
  const selectedCard = document.querySelector('.story-card.selected');
  return selectedCard ? selectedCard.id : null;
}

/**
 * Setup reveal and reset buttons
 */
function setupRevealResetButtons() {
  const revealVotesBtn = document.getElementById('revealVotesBtn');
  if (revealVotesBtn) {
    revealVotesBtn.addEventListener('click', () => {
      const storyId = getCurrentStoryId();
      if (socket && storyId) {
        console.log('[UI] Revealing votes for story:', storyId);
        socket.emit('revealVotes', { storyId });
      }
    });
  }

  const resetVotesBtn = document.getElementById('resetVotesBtn');
  if (resetVotesBtn) {
    resetVotesBtn.addEventListener('click', () => {
      const storyId = getCurrentStoryId();
      if (socket && storyId) {
        socket.emit('resetVotes', { storyId });
        
        // Clear vote data for this story
        if (votesPerStory[storyId]) {
          votesPerStory[storyId] = {};
        }
        
        votesRevealed[storyId] = false;
        persistRevealState(storyId, false);
        resetAllVoteVisuals();
        
        // Use centralized function to update UI visibility
        updateUIVisibilityState(storyId, 'cards');
      }
    });
  }
}

/**
 * Setup CSV file uploader
 */
function setupCSVUploader() {
  const csvInput = document.getElementById('csvInput');
  if (!csvInput) return;

  csvInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      // Save existing manually added tickets before processing CSV
      const storyList = document.getElementById('storyList');
      const existingTickets = [];
      
      if (storyList) {
        const manualTickets = storyList.querySelectorAll('.story-card[id^="story_"]:not([id^="story_csv_"])');
        manualTickets.forEach(card => {
          const title = card.querySelector('.story-title');
          if (title) {
            existingTickets.push({
              id: card.id, 
              text: title.textContent
            });
          }
        });
      }
      
      console.log(`[CSV] Saved ${existingTickets.length} manual tickets before processing upload`);
      
      // Parse the CSV data
      const parsedData = parseCSV(e.target.result);
      
      // Store in the module state
      csvData = parsedData;
      
      // Display CSV data - this will clear and rebuild the story list
      displayCSVData(csvData);
      
      // Re-add the preserved manual tickets
      existingTickets.forEach((ticket, index) => {
        // Skip if this ticket is in our deleted set
        if (deletedStoryIds.has(ticket.id)) {
          console.log('[CSV] Not re-adding deleted manual ticket:', ticket.id);
          return;
        }
        
        // Make sure this ticket isn't already in the list to avoid duplicates
        if (!document.getElementById(ticket.id)) {
          addTicketToUI(ticket, false);
        }
      });
      
      // Store these for future preservation
      preservedManualTickets = [...existingTickets];
      
      // Emit the CSV data to server AFTER ensuring all UI is updated
      emitCSVData(parsedData);
      
      // Reset current story index only if no stories were selected before
      if (!document.querySelector('.story-card.selected')) {
        currentStoryIndex = 0;
        renderCurrentStory();
      }
      
      // Ensure planning cards are visible for guests
      ensurePlanningCardsVisibleForGuests();
    };
    reader.readAsText(file);
  });
}

/**
 * Parse CSV text into array structure
 */
function parseCSV(data) {
  const rows = data.trim().split('\n');
  return rows.map(row => row.split(','));
}

function normalizeStoryIndexes() {
  const storyList = document.getElementById('storyList');
  if (!storyList) return;

  const storyCards = storyList.querySelectorAll('.story-card');
  storyCards.forEach((card, index) => {
    card.dataset.index = index;
    card.onclick = () => selectStory(index); // ensure correct click behavior
  });
}

/**
 * Display CSV data in the story list
 */
function displayCSVData(data) {
  // Prevent reentrant calls that could cause flickering or data loss
  if (processingCSVData) {
    console.log('[CSV] Already processing CSV data, ignoring reentrant call');
    return;
  }
  
  processingCSVData = true;
  
  try {
    const storyListContainer = document.getElementById('storyList');
    if (!storyListContainer) {
      return;
    }

    console.log(`[CSV] Displaying ${data.length} rows of CSV data`);

    // First, identify and save all manually added stories
    const existingStories = [];
    const manualStories = storyListContainer.querySelectorAll('.story-card[id^="story_"]:not([id^="story_csv_"])');
    
    manualStories.forEach(card => {
      // Skip deleted stories
      if (deletedStoryIds.has(card.id)) {
        return;
      }
      
      const title = card.querySelector('.story-title');
      if (title) {
        existingStories.push({
          id: card.id,
          text: title.textContent
        });
      }
    });
    
    console.log(`[CSV] Saved ${existingStories.length} existing manual stories`);
    
    // Clear ONLY the CSV-based stories, not manual ones
    const csvStories = storyListContainer.querySelectorAll('.story-card[id^="story_csv_"]');
    csvStories.forEach(card => card.remove());
    
    // Re-add all stories to ensure they have proper indices
    storyListContainer.innerHTML = '';
    
    // First add back manually added stories
    existingStories.forEach((story, index) => {
      // Skip if this story is in our deleted set
      if (deletedStoryIds.has(story.id)) {
        console.log('[CSV] Not re-adding deleted manual story:', story.id);
        return;
      }
      
      const storyItem = document.createElement('div');
      storyItem.classList.add('story-card');
      storyItem.id = story.id;
      storyItem.dataset.index = index;
      
      const storyTitle = document.createElement('div');
      storyTitle.classList.add('story-title');
      storyTitle.textContent = story.text;
      
      storyItem.appendChild(storyTitle);
      
      // Add delete button for hosts only
      if (isCurrentUserHost()) {
        const deleteButton = document.createElement('div');
        deleteButton.className = 'story-delete-btn';
        deleteButton.innerHTML = '🗑'; // dustbin symbol
        deleteButton.title = 'Delete story';
        
        // Use the CORRECT story ID - this was wrong before!
        deleteButton.onclick = function(e) {
          e.stopPropagation(); // Prevent story selection
          e.preventDefault();
          console.log('[DELETE] Delete button clicked for manual story:', story.id);
          deleteStory(story.id);
        };
        
        storyItem.appendChild(deleteButton);
      }
      
      storyListContainer.appendChild(storyItem);
      
      // Add click event for story selection (for hosts only)
      const isHost = sessionStorage.getItem('isHost') === 'true';
      if (isHost) {
        storyItem.addEventListener('click', () => {
          selectStory(index);
        });
      }
    });
    
    // Then add CSV data
    let startIndex = existingStories.length;
    data.forEach((row, index) => {
      const storyItem = document.createElement('div');
      storyItem.classList.add('story-card');
      
      const csvStoryId = `story_csv_${index}`;
      
      // Skip if this CSV story ID is in our deleted set
      if (deletedStoryIds.has(csvStoryId)) {
        console.log('[CSV] Not adding deleted CSV story:', csvStoryId);
        return;
      }
      
      storyItem.id = csvStoryId;
      storyItem.dataset.index = startIndex + index;
      
      const storyTitle = document.createElement('div');
      storyTitle.classList.add('story-title');
      storyTitle.textContent = row.join(' | ');
      
      storyItem.appendChild(storyTitle);
      
      // Add delete button for hosts only
      if (isCurrentUserHost()) {
        console.log('[CSV] Adding delete button to CSV story:', csvStoryId);
        const deleteButton = document.createElement('div'); // Changed to div
        deleteButton.className = 'story-delete-btn';
        deleteButton.innerHTML = '🗑'; // dustbin symbol
        deleteButton.title = 'Delete CSV story';
        
        // Add direct click handler that references the correct ID
        deleteButton.onclick = function(e) {
          e.stopPropagation(); // Prevent story selection
          e.preventDefault();
          console.log('[DELETE] Delete button clicked for CSV story:', csvStoryId);
          deleteStory(csvStoryId);
        };
        
        storyItem.appendChild(deleteButton);
      }
      
      storyListContainer.appendChild(storyItem);
      
      // For guests, add 'disabled-story' class and no click handler
      if (isGuestUser()) {
        storyItem.classList.add('disabled-story');
      } else {
        // Only hosts can select stories
        storyItem.addEventListener('click', () => {
          selectStory(startIndex + index);
        });
      }
    });
    
    // Update preserved tickets list
    preservedManualTickets = existingStories;
    
    console.log(`[CSV] Display complete: ${existingStories.length} manual + ${data.length} CSV = ${storyListContainer.children.length} total`);
    
    // Check if there are any stories and show/hide message accordingly
    const noStoriesMessage = document.getElementById('noStoriesMessage');
    if (noStoriesMessage) {
      noStoriesMessage.style.display = storyListContainer.children.length === 0 ? 'block' : 'none';
    }
    
    // Enable/disable planning cards based on story availability
    const planningCards = document.querySelectorAll('#planningCards .card');
    planningCards.forEach(card => {
      if (storyListContainer.children.length === 0) {
        card.classList.add('disabled');
        card.setAttribute('draggable', 'false');
      } else {
        card.classList.remove('disabled');
        card.setAttribute('draggable', 'true');
      }
    });
    
    // Select first story if none is selected
    const selectedStory = storyListContainer.querySelector('.story-card.selected');
    if (!selectedStory && storyListContainer.children.length > 0) {
      storyListContainer.children[0].classList.add('selected');
      currentStoryIndex = 0;
    }
    
    // Add cleanup and setup for delete buttons
    cleanupDeleteButtonHandlers();
    setupCSVDeleteButtons();
    
  } finally {
    normalizeStoryIndexes();
    
    const currentId = getCurrentStoryId();
    // Use centralized function for UI state management
    updateUIVisibilityState(currentId);

    setupStoryCardInteractions();
    // Ensure planning cards are visible for guests
    ensurePlanningCardsVisibleForGuests();
    
    // Always release the processing flag
    processingCSVData = false;
  }
}

/**
 * Select a story by index
 * @param {number} index - Story index to select
 * @param {boolean} emitToServer - Whether to emit to server (default: true)
 * @param {boolean} forceSelection - Whether to force selection even after retries
 */
function selectStory(index, emitToServer = true, forceSelection = false) {
    console.log('[UI] Story selected by user:', index, forceSelection ? '(forced)' : '');

    // Update UI first for responsiveness
    document.querySelectorAll('.story-card').forEach(card => {
        card.classList.remove('selected', 'active');
    });

    const storyCard = document.querySelector(`.story-card[data-index="${index}"]`);
    if (storyCard) {
        storyCard.classList.add('selected', 'active');

        // Update local state
        currentStoryIndex = index;

        // Get the story ID from the selected card or other method
        let storyId = getCurrentStoryId();

        // Skip for deleted stories
        if (storyId && deletedStoryIds.has(storyId)) {
            console.log(`[UI] Selected story ${storyId} is marked as deleted, skipping further processing`);
            return;
        }

        // Ensure vote reveal state is initialized for this story
        if (storyId && typeof votesRevealed[storyId] === 'undefined') {
            // Check persisted state first
            votesRevealed[storyId] = getPersistedRevealState(storyId) || false;
        }

        // Use centralized function to manage UI visibility
        updateUIVisibilityState(storyId);

        renderCurrentStory();

        // Reset or restore vote badges for the current story
        resetOrRestoreVotes(storyId);

        // Notify server about selection if requested
        const storyCards = document.querySelectorAll('.story-card');
        const storyCardFromList = storyCards[index];
        storyId = storyCardFromList ? storyCardFromList.id : null;

        if (emitToServer && socket) {
            console.log('[EMIT] Broadcasting story selection:', index);

            // Emit both storyIndex and storyId
            socket.emit('storySelected', { 
                storyIndex: index, 
                storyId: storyId 
            });

            // Request votes for this story
            if (storyId) {
                if (typeof requestStoryVotes === 'function') {
                    requestStoryVotes(storyId);
                } else {
                    socket.emit('requestStoryVotes', { storyId });
                }
            }
        }
        
        // Ensure planning cards are visible for guests
        ensurePlanningCardsVisibleForGuests();

    } else if (forceSelection) {
        console.log(`[UI] Story card with index ${index} not found yet, retrying selection soon...`);
        // Retry selection after short delay
        setTimeout(() => {
            const retryCard = document.querySelector(`.story-card[data-index="${index}"]`);
            if (retryCard) {
                selectStory(index, emitToServer, false);
            } else {
                const allCards = document.querySelectorAll('.story-card');
                let found = false;

                allCards.forEach(card => {
                    if (parseInt(card.dataset.index) === parseInt(index)) {
                        card.classList.add('selected', 'active');
                        currentStoryIndex = index;
                        found = true;

                        let storyId = card.id;
                        if (storyId && !deletedStoryIds.has(storyId)) {
                            if (typeof votesRevealed[storyId] === 'undefined') {
                                votesRevealed[storyId] = getPersistedRevealState(storyId) || false;
                            }
                            resetOrRestoreVotes(storyId);
                        }
                    }
                });

                if (!found) {
                    console.log(`[UI] Could not find story with index ${index} after retries`);
                    currentStoryIndex = index;
                }
            }
            
            // Ensure planning cards are visible for guests
            ensurePlanningCardsVisibleForGuests();
        }, 300);
    } else {
        console.log(`[UI] Story card with index ${index} not found`);
    }
}

/**
 * Reset or restore votes for a story
 */
function resetOrRestoreVotes(storyId) {
  // Skip for deleted stories
  if (!storyId || deletedStoryIds.has(storyId)) {
    return;
  }
  
  resetAllVoteVisuals();
  
  // Make sure we have votes for this story
  if (!votesPerStory[storyId]) {
    votesPerStory[storyId] = {};
    
    // Request votes from the server (this ensures we get everyone's votes)
    if (socket && socket.connected) {
      console.log(`[VOTE] Requesting votes for story: ${storyId}`);
      socket.emit('requestStoryVotes', { storyId });
    }
    return; // We'll update the UI when the votes come back
  }
  
  // Check persisted state first
  const isRevealed = getPersistedRevealState(storyId) || votesRevealed[storyId];
  
  // If we have stored votes for this story and they've been revealed
  if (isRevealed) {
    // Update local state to match persisted state
    votesRevealed[storyId] = true;
    
    // Show the actual vote values
    applyVotesToUI(votesPerStory[storyId], false);
    
    // Use centralized function for UI visibility
    updateUIVisibilityState(storyId);
  } else {
    // If we have votes but they're not revealed, still show that people voted (with thumbs up)
    if (votesPerStory[storyId]) {
      applyVotesToUI(votesPerStory[storyId], true);
    }
  }
}

/**
 * Apply votes to UI
 * @param {Object} votes - Map of user IDs to vote values
 * @param {boolean} hideValues - Whether to hide actual vote values and show thumbs up
 */
function applyVotesToUI(votes, hideValues) {
  console.log('[DEBUG] applyVotesToUI called with:', 
    { votes: JSON.stringify(votes), hideValues });
  
  // Process one vote at a time to avoid accidental cross-updates
  Object.entries(votes).forEach(([userId, vote]) => {
    const displayVote = hideValues ? '👍' : vote;
    console.log(`[DEBUG] Updating vote for ${userId} to ${displayVote}`);
    
    // Update sidebar badge
    const sidebarBadge = document.querySelector(`#user-${userId} .vote-badge`);
    if (sidebarBadge) {
      sidebarBadge.textContent = displayVote;
      sidebarBadge.style.color = '#673ab7';
      sidebarBadge.style.opacity = '1';
    }
    
    // Update vote space
    const voteSpace = document.querySelector(`#vote-space-${userId}`);
    if (voteSpace) {
      // Add vote class
      voteSpace.classList.add('has-vote');
      
      // Update badge
      const voteBadge = voteSpace.querySelector('.vote-badge');
      if (voteBadge) {
        voteBadge.textContent = displayVote;
        voteBadge.style.color = '#673ab7';
        voteBadge.style.opacity = '1';
      }
    }
    
    // Update avatar display
    const avatarContainer = document.querySelector(`#user-circle-${userId}`);
    if (avatarContainer) {
      avatarContainer.classList.add('has-voted');
      
      const avatar = avatarContainer.querySelector('.avatar-circle');
      if (avatar) {
        avatar.style.backgroundColor = '#c1e1c1'; // Green background
      }
    }
    
    // Also update sidebar avatar
    const sidebarAvatar = document.querySelector(`#user-${userId} img.avatar`);
    if (sidebarAvatar) {
      sidebarAvatar.style.backgroundColor = '#c1e1c1';
    }
  });
}



/**
 * Reset all vote visuals
 */
function resetAllVoteVisuals() {
  document.querySelectorAll('.vote-badge').forEach(badge => {
    badge.textContent = '';
  });
  
  document.querySelectorAll('.has-vote').forEach(el => {
    el.classList.remove('has-vote');
  });
  
  document.querySelectorAll('.has-voted').forEach(el => {
    el.classList.remove('has-voted');
  });
}

/**
 * Render the current story
 */
function renderCurrentStory() {
  const storyListContainer = document.getElementById('storyList');
  if (!storyListContainer || csvData.length === 0) return;

  const allStoryItems = storyListContainer.querySelectorAll('.story-card');
  allStoryItems.forEach(card => card.classList.remove('active'));

  const current = allStoryItems[currentStoryIndex];
  if (current) current.classList.add('active');
  
  // Update the current story display, if present
  const currentStoryDisplay = document.getElementById('currentStory');
  if (currentStoryDisplay && csvData[currentStoryIndex]) {
    currentStoryDisplay.textContent = csvData[currentStoryIndex].join(' | ');
  }
}

/**
 * Update the user list display with the new layout
 */
function updateUserList(users) {
  const userListContainer = document.getElementById('userList');
  const userCircleContainer = document.getElementById('userCircle');
  
  if (!userListContainer || !userCircleContainer) return;

  // Clear existing content
  userListContainer.innerHTML = '';
  userCircleContainer.innerHTML = '';

  // Store the current user's ID for comparison
  const currentUserId = socket ? socket.id : null;

  // Create left sidebar user list
  users.forEach(user => {
    const userEntry = document.createElement('div');
    userEntry.classList.add('user-entry');
    userEntry.id = `user-${user.id}`;
      userEntry.innerHTML = `
      <img src="${generateAvatarUrl(user.name)}" class="avatar" alt="${user.name}">
      <span class="username">${user.name}</span>
      <span class="vote-badge"></span>
    `;
    userListContainer.appendChild(userEntry);
  });

  // Create new grid layout for center area
  const gridLayout = document.createElement('div');
  gridLayout.classList.add('poker-table-layout');

  // Split users into two rows
  const halfPoint = Math.ceil(users.length / 2);
  const topUsers = users.slice(0, halfPoint);
  const bottomUsers = users.slice(halfPoint);

  // Create top row of avatars
  const topAvatarRow = document.createElement('div');
  topAvatarRow.classList.add('avatar-row');
  
  topUsers.forEach(user => {
    const avatarContainer = createAvatarContainer(user);
    topAvatarRow.appendChild(avatarContainer);
  });
  
  // Create top row of vote cards
  const topVoteRow = document.createElement('div');
  topVoteRow.classList.add('vote-row');
  
  topUsers.forEach(user => {
    const voteCard = createVoteCardSpace(user, currentUserId === user.id);
    topVoteRow.appendChild(voteCard);
  });

  // Create reveal button
  const revealButtonContainer = document.createElement('div');
  revealButtonContainer.classList.add('reveal-button-container');
  
  const revealBtn = document.createElement('button');
  revealBtn.textContent = 'REVEAL VOTES';
  revealBtn.classList.add('reveal-votes-button');
  
  // Handle guest mode for the reveal button
  if (isGuestUser()) {
    revealBtn.classList.add('hide-for-guests');
  } else {
    revealBtn.onclick = () => {
      // Get the current story ID
      const storyId = getCurrentStoryId();
      
      // Skip for deleted stories
      if (storyId && deletedStoryIds.has(storyId)) {
        console.log(`[VOTE] Cannot reveal votes for deleted story: ${storyId}`);
        return;
      }
      
      if (socket && storyId) {
        console.log('[UI] Revealing votes for story:', storyId);
        // Send the storyId parameter with the event
        socket.emit('revealVotes', { storyId });
        
        // Update local state
        votesRevealed[storyId] = true;
        persistRevealState(storyId, true);
        
        // Update UI if we have votes for this story
        if (votesPerStory[storyId]) {
          applyVotesToUI(votesPerStory[storyId], false);
        }
      } else {
        console.warn('[UI] Cannot reveal votes: No story selected');
      }
    };
  }
  
  revealButtonContainer.appendChild(revealBtn);

  // Create bottom row of vote cards
  const bottomVoteRow = document.createElement('div');
  bottomVoteRow.classList.add('vote-row');
  
  bottomUsers.forEach(user => {
    const voteCard = createVoteCardSpace(user, currentUserId === user.id);
    bottomVoteRow.appendChild(voteCard);
  });

  // Create bottom row of avatars
  const bottomAvatarRow = document.createElement('div');
  bottomAvatarRow.classList.add('avatar-row');
  
  bottomUsers.forEach(user => {
    const avatarContainer = createAvatarContainer(user);
    bottomAvatarRow.appendChild(avatarContainer);
  });

  // Assemble the grid
  gridLayout.appendChild(topAvatarRow);
  gridLayout.appendChild(topVoteRow);
  gridLayout.appendChild(revealButtonContainer);
  gridLayout.appendChild(bottomVoteRow);
  gridLayout.appendChild(bottomAvatarRow);
  
  userCircleContainer.appendChild(gridLayout);
  
  // After updating users, check if we need to request tickets
  if (!hasRequestedTickets && users.length > 0) {
    setTimeout(() => {
      if (socket && socket.connected) {
        console.log('[INFO] Requesting all tickets after user list update');
        socket.emit('requestAllTickets');
        hasRequestedTickets = true;
      }
    }, 500);
  }
  
  // Get current story ID
  const storyId = getCurrentStoryId();
  
  // Skip for deleted stories
  if (storyId && deletedStoryIds.has(storyId)) {
    return;
  }
  
  // After updating users, also update votes
  if (storyId && votesPerStory[storyId]) {
    // Apply the votes
    const votes = votesPerStory[storyId];
    const reveal = votesRevealed[storyId];
    applyVotesToUI(votes, !reveal);
    
    // If votes were revealed, update UI visibility
    if (reveal) {
      updateUIVisibilityState(storyId, 'stats');
    }
  }
  
  // Request the latest votes for current story to ensure we're in sync
  if (storyId && socket && socket.connected) {
    console.log('[USERLIST] Requesting votes for current story to ensure UI is up to date');
    socket.emit('requestStoryVotes', { storyId });
  }
  
  // Ensure planning cards are visible for guests
  ensurePlanningCardsVisibleForGuests();
}

/**
 * Create avatar container for a user
 */
function createAvatarContainer(user) {
  const avatarContainer = document.createElement('div');
  avatarContainer.classList.add('avatar-container');
  avatarContainer.id = `user-circle-${user.id}`;

  avatarContainer.innerHTML = `
    <img src="${generateAvatarUrl(user.name)}" class="avatar-circle" alt="${user.name}" />
    <div class="user-name">${user.name}</div>
  `;
  
  avatarContainer.setAttribute('data-user-id', user.id);
  
  // Get current story ID
  const storyId = getCurrentStoryId();
  
  // Skip for deleted stories
  if (!storyId || deletedStoryIds.has(storyId)) {
    return avatarContainer;
  }
  
  // Check if there's an existing vote for this user in the current story
  const existingVote = votesPerStory[storyId]?.[user.id];
  if (existingVote) {
    avatarContainer.classList.add('has-voted');
  }
  
  return avatarContainer;
}

/**
 * Create vote card space for a user
 */
/**
 * Create vote card space for a user
 */
function createVoteCardSpace(user, isCurrentUser) {
  const voteCard = document.createElement('div');
  voteCard.classList.add('vote-card-space');
  voteCard.id = `vote-space-${user.id}`;

  if (isCurrentUser) voteCard.classList.add('own-vote-space');

  const voteBadge = document.createElement('span');
  voteBadge.classList.add('vote-badge');
  voteBadge.textContent = '';
  voteCard.appendChild(voteBadge);

  if (isCurrentUser) {
    voteCard.addEventListener('dragover', (e) => e.preventDefault());

voteCard.addEventListener('drop', (e) => {
  e.preventDefault();
  const vote = e.dataTransfer.getData('text/plain');
  const storyId = getCurrentStoryId();
  
  // Skip for deleted stories
  if (storyId && deletedStoryIds.has(storyId)) {
    console.log(`[VOTE] Cannot cast vote for deleted story: ${storyId}`);
    return;
  }
  
  if (socket && vote && storyId) {
    // Emit the vote to the server
    socket.emit('castVote', { vote, targetUserId: user.id, storyId });
    
    // Update local state
    if (!votesPerStory[storyId]) {
      votesPerStory[storyId] = {};
    }
    
    votesPerStory[storyId][user.id] = vote;
    window.currentVotesPerStory = votesPerStory;
    
    // IMPORTANT: Immediate UI update for user feedback
    voteCard.classList.add('has-vote');
    voteBadge.textContent = '👍'; // Always show thumbs up if not revealed
    voteBadge.style.color = '#673ab7';
    voteBadge.style.opacity = '1';
    voteBadge.style.visibility = 'visible'; // Add this line to ensure visibility
    voteBadge.style.display = 'block'; // Add this line to ensure it's displayed
    
    // Update avatar with explicit styling to ensure visibility
    const avatarContainer = document.querySelector(`#user-circle-${user.id}`);
    if (avatarContainer) {
      avatarContainer.classList.add('has-voted');
      
      const avatar = avatarContainer.querySelector('.avatar-circle');
      if (avatar) {
        avatar.style.backgroundColor = '#c1e1c1';
      }
    }
    
    // Update sidebar with explicit styling
    const sidebarBadge = document.querySelector(`#user-${user.id} .vote-badge`);
    if (sidebarBadge) {
      sidebarBadge.textContent = '👍';
      sidebarBadge.style.color = '#673ab7';
      sidebarBadge.style.opacity = '1';
      sidebarBadge.style.visibility = 'visible'; // Add this line
    }
    
    // Use a small delay to ensure the UI update persists even if something else tries to change it
    setTimeout(() => {
      // Re-apply the same changes to ensure visibility
      voteCard.classList.add('has-vote');
      if (voteBadge) {
        voteBadge.textContent = '👍';
        voteBadge.style.color = '#673ab7';
        voteBadge.style.opacity = '1';
        voteBadge.style.visibility = 'visible';
        voteBadge.style.display = 'block';
      }
    }, 100);
    
    console.log(`[VOTE] Vote ${vote} cast, displayed as 👍`);
  }
});
  } else {
    voteCard.addEventListener('dragover', (e) => {
      e.preventDefault();
      voteCard.classList.add('drop-not-allowed');
      setTimeout(() => voteCard.classList.remove('drop-not-allowed'), 300);
    });
  }

  const storyId = getCurrentStoryId();
  
  // Skip for deleted stories
  if (!storyId || deletedStoryIds.has(storyId)) {
    return voteCard;
  }
  
  const existingVote = votesPerStory[storyId]?.[user.id];
  if (existingVote) {
    voteCard.classList.add('has-vote');
    voteBadge.textContent = votesRevealed[storyId] ? existingVote : '👍';
    voteBadge.style.color = '#673ab7';
    voteBadge.style.opacity = '1';
  }

  return voteCard;
}

/**
 * Update vote visuals for a user
 */
function updateVoteVisuals(userId, vote, hasVoted = false) {
  console.log(`[DEBUG] updateVoteVisuals: userId=${userId}, vote=${vote}, hasVoted=${hasVoted}`);
  
  // Get the story ID and check its reveal state
  const storyId = getCurrentStoryId();
  
  // Skip for deleted stories or when no story is selected
  if (!storyId || deletedStoryIds.has(storyId)) {
    console.log('[VOTE] Not updating vote visuals for deleted story');
    return;
  }
  
  const isRevealed = storyId && votesRevealed[storyId] === true;
  
  console.log(`[DEBUG] Story ${storyId} revealed state:`, isRevealed);
  
  // Determine what to show based on reveal state
  const displayVote = isRevealed ? vote : '👍';
  
  console.log(`[DEBUG] Will display: ${displayVote}`);
  
  // Update badges in sidebar
  const sidebarBadge = document.querySelector(`#user-${userId} .vote-badge`);
  if (sidebarBadge) {
    // Only set content if the user has voted
    if (hasVoted) {
      sidebarBadge.textContent = displayVote;
      sidebarBadge.style.color = '#673ab7'; // Make sure the text has a visible color
      sidebarBadge.style.opacity = '1'; // Ensure full opacity
    } else {
      sidebarBadge.textContent = ''; // Empty if no vote
    }
  }
  
  // Update vote card space - ONLY update the specified user's card
  const voteSpace = document.querySelector(`#vote-space-${userId}`);
  if (voteSpace) {
    const voteBadge = voteSpace.querySelector('.vote-badge');
    if (voteBadge) {
      // Only show vote if they've voted
      if (hasVoted) {
        voteBadge.textContent = displayVote;
        voteBadge.style.color = '#673ab7'; // Make sure the text has a visible color
        voteBadge.style.opacity = '1'; // Ensure full opacity
        console.log(`[DEBUG] Updated vote badge for ${userId} to "${displayVote}"`);
      } else {
        voteBadge.textContent = ''; // Empty if no vote
      }
    }
    
    // Update vote space class
    if (hasVoted) {
      voteSpace.classList.add('has-vote');
    } else {
      voteSpace.classList.remove('has-vote');
    }
  }

  // Update avatar to show they've voted
  if (hasVoted) {
    const avatarContainer = document.querySelector(`#user-circle-${userId}`);
    if (avatarContainer) {
      avatarContainer.classList.add('has-voted');
      
      const avatar = avatarContainer.querySelector('.avatar-circle');
      if (avatar) {
        avatar.style.backgroundColor = '#c1e1c1'; // Green background
      }
    }
    
    // Also update sidebar avatar
    const sidebarAvatar = document.querySelector(`#user-${userId} img.avatar`);
    if (sidebarAvatar) {
      sidebarAvatar.style.backgroundColor = '#c1e1c1';
    }
  }
}


/**
 * Update story title
 */
function updateStory(story) {
  const storyTitle = document.getElementById('currentStory');
  if (storyTitle) storyTitle.textContent = story;
}

/**
 * Setup story navigation
 */
function setupStoryNavigation() {
  const nextButton = document.getElementById('nextStory');
  const prevButton = document.getElementById('prevStory');

  if (!nextButton || !prevButton) return;
  // ✅ Disable for non-hosts
  const isHost = sessionStorage.getItem('isHost') === 'true';
  if (!isHost) {
    nextButton.disabled = true;
    prevButton.disabled = true;
    nextButton.classList.add('disabled-nav');
    prevButton.classList.add('disabled-nav');
    return;
  }
  // Prevent multiple event listeners from being added
  nextButton.replaceWith(nextButton.cloneNode(true));
  prevButton.replaceWith(prevButton.cloneNode(true));

  const newNextButton = document.getElementById('nextStory');
  const newPrevButton = document.getElementById('prevStory');

  function getOrderedCards() {
    // Get all story cards and filter out deleted ones
    const allCards = [...document.querySelectorAll('.story-card')];
    return allCards.filter(card => !deletedStoryIds.has(card.id));
  }

  function getSelectedCardIndex() {
    const cards = getOrderedCards();
    const selected = document.querySelector('.story-card.selected');
    return cards.findIndex(card => card === selected);
  }

  newNextButton.addEventListener('click', () => {
    const cards = getOrderedCards();
    if (cards.length === 0) return;

    const currentIndex = getSelectedCardIndex();
    const nextIndex = (currentIndex + 1) % cards.length;

    console.log(`[NAV] Next from ${currentIndex} → ${nextIndex}`);
    selectStory(parseInt(cards[nextIndex].dataset.index)); // emit to server
  });

  newPrevButton.addEventListener('click', () => {
    const cards = getOrderedCards();
    if (cards.length === 0) return;

    const currentIndex = getSelectedCardIndex();
    const prevIndex = (currentIndex - 1 + cards.length) % cards.length;

    console.log(`[NAV] Previous from ${currentIndex} → ${prevIndex}`);
    selectStory(parseInt(cards[prevIndex].dataset.index)); // emit to server
  });
}

/**
 * Set up story card interactions based on user role
 */
function setupStoryCardInteractions() {
  // Check if user is a guest (joined via shared URL)
  const isGuest = isGuestUser();
  
  // Select all story cards
  const storyCards = document.querySelectorAll('.story-card');
  
  storyCards.forEach(card => {
    // Skip deleted stories
    if (deletedStoryIds.has(card.id)) {
      return;
    }
    
    if (isGuest) {
      // For guests: disable clicking and add visual indicator
      card.classList.add('disabled-story');
      
      // Remove any existing click handlers by cloning and replacing
      const newCard = card.cloneNode(true);
      if (card.parentNode) {
        card.parentNode.replaceChild(newCard, card);
      }
    } else {
      // For hosts: maintain normal selection behavior
      // Remove existing handlers first to prevent duplicates
      const newCard = card.cloneNode(true);
      if (card.parentNode) {
        card.parentNode.replaceChild(newCard, card);
      
        // Add fresh click event listener
        newCard.addEventListener('click', () => {
          const index = parseInt(newCard.dataset.index || 0);
          selectStory(index);
        });
        
        // Re-add delete button if needed
        if (isCurrentUserHost() && !newCard.querySelector('.story-delete-btn')) {
          const deleteButton = document.createElement('div');
          deleteButton.className = 'story-delete-btn';
          deleteButton.innerHTML = '🗑';
          deleteButton.title = 'Delete story';
          
          deleteButton.onclick = function(e) {
            e.stopPropagation();
            e.preventDefault();
            deleteStory(newCard.id);
          };
          
          newCard.appendChild(deleteButton);
        }
      }
    }
  });
}

/**
 * Generate avatar URL
 */
function generateAvatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&rounded=true`;
}

/**
 * Setup invite button
 */
function setupInviteButton() {
  const inviteButton = document.getElementById('inviteButton');
  if (!inviteButton) return;

  inviteButton.onclick = () => {
    // Check if the custom function exists in window scope
    if (typeof window.showInviteModalCustom === 'function') {
      window.showInviteModalCustom();
    } else if (typeof showInviteModalCustom === 'function') {
      showInviteModalCustom();
    } else {
      // Fallback if function isn't available
      const currentUrl = new URL(window.location.href);
      const params = new URLSearchParams(currentUrl.search);
      const roomId = params.get('roomId') || getRoomIdFromURL();
      
      // Create guest URL (remove any host parameter)
      const guestUrl = `${currentUrl.origin}${currentUrl.pathname}?roomId=${roomId}`;
      
      alert(`Share this invite link: ${guestUrl}`);
    }
  };
}

/**
 * Setup vote cards drag functionality
 */
function setupVoteCardsDrag() {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.textContent.trim());
    });
  });
}

function triggerGlobalEmojiBurst() {
  const emojis = ['😀', '✨', '😆', '😝', '😄', '😍'];
  const container = document.body;

  for (let i = 0; i < 20; i++) {
    const burst = document.createElement('div');
    burst.className = 'global-emoji-burst';
    burst.textContent = emojis[Math.floor(Math.random() * emojis.length)];

    // Random position on screen
    burst.style.left = `${Math.random() * 100}vw`;
    burst.style.top = `${Math.random() * 100}vh`;

    container.appendChild(burst);

    // Trigger animation
    setTimeout(() => {
      burst.classList.add('burst-go');
    }, 10);

    // Remove after animation
    setTimeout(() => {
      burst.remove();
    }, 1200);
  }
}

/**
 * Handle socket messages with improved state persistence
 */
function handleSocketMessage(message) {
  const eventType = message.type;
  
  // console.log(`[SOCKET] Received ${eventType}:`, message);
  
  switch(eventType) {
    case 'userList':
      // Update the user list when server sends an updated list
      if (Array.isArray(message.users)) {
        updateUserList(message.users);
        window.latestUserList = message.users;
      }
      break;

    case 'addTicket':
      // Handle ticket added by another user
      if (message.ticketData) {
        // Skip if this is a deleted story
        if (deletedStoryIds.has(message.ticketData.id)) {
          console.log('[TICKET] Ignoring deleted ticket:', message.ticketData.id);
          return;
        }
        
        console.log('[SOCKET] New ticket received:', message.ticketData);
        // Add ticket to UI without selecting it (to avoid loops)
        addTicketToUI(message.ticketData, false);
        applyGuestRestrictions();
        
        // Ensure planning cards are visible for guests when new story is added
        ensurePlanningCardsVisibleForGuests();
      }
      break;
      
    case 'votingSystemUpdate':
      console.log('[DEBUG] Got voting system update:', message.votingSystem);
      sessionStorage.setItem('votingSystem', message.votingSystem);
      setupPlanningCards(); // Regenerate cards
      break;

    case 'resyncState':
      // Update local deletedStoryIds with array from server
      if (Array.isArray(message.deletedStoryIds)) {
        message.deletedStoryIds.forEach(id => {
          if (!deletedStoryIds.has(id)) {
            deletedStoryIds.add(id);
          }
        });
        
        // Save to session storage
        const roomId = getRoomIdFromURL();
        saveDeletedStoriesToStorage(roomId);
      }
      
      // Filter tickets by deleted status and process them
      const filteredTickets = (message.tickets || []).filter(ticket => 
        !deletedStoryIds.has(ticket.id)
      );
      
      processAllTickets(filteredTickets);
      
      // Update vote state
      if (message.votesPerStory) {
        for (const [storyId, votes] of Object.entries(message.votesPerStory)) {
          // Skip deleted stories
          if (deletedStoryIds.has(storyId)) continue;
          
          if (!votesPerStory[storyId]) {
            votesPerStory[storyId] = {};
          }
          
          // Merge in the votes from server
          votesPerStory[storyId] = { ...votes };
          window.currentVotesPerStory = votesPerStory;
        }
      }
      
      // Update revealed status
      if (message.votesRevealed) {
        for (const storyId in message.votesRevealed) {
          // Skip deleted stories
          if (deletedStoryIds.has(storyId)) continue;
          
          votesRevealed[storyId] = message.votesRevealed[storyId];
          
          // Also update persisted state
          persistRevealState(storyId, message.votesRevealed[storyId]);
          
          // If this is the current story and votes are revealed, update UI
          const currentId = getCurrentStoryId();
          if (votesRevealed[storyId] && storyId === currentId) {
            const storyVotes = votesPerStory[storyId] || {};
            applyVotesToUI(storyVotes, false);
            updateUIVisibilityState(storyId);
          }
        }
      }
      
      // Also refresh the current story votes after a short delay
      const currentStoryId = getCurrentStoryId();
      if (currentStoryId && socket && socket.connected) {
        setTimeout(() => {
          socket.emit('requestStoryVotes', { storyId: currentStoryId });
        }, 300);
      }
      
      // Ensure planning cards are visible for guests
      ensurePlanningCardsVisibleForGuests();
      break;

    case 'restoreUserVote':
      if (message.storyId && message.vote) {
        // Skip for deleted stories
        if (deletedStoryIds.has(message.storyId)) {
          console.log(`[VOTE] Ignoring vote restoration for deleted story: ${message.storyId}`);
          return;
        }
        
        // Get the current user's ID
        const currentUserId = socket.id;
        
        // Update local state
        if (!votesPerStory[message.storyId]) {
          votesPerStory[message.storyId] = {};
        }
        votesPerStory[message.storyId][currentUserId] = message.vote;
        
        // Update UI if this is the current story
        const currentId = getCurrentStoryId();
        if (message.storyId === currentId) {
          updateVoteVisuals(currentUserId, votesRevealed[message.storyId] ? message.vote : '👍', true);
        }
        
        // Also explicitly broadcast this vote to ensure other users see it too
        if (socket && socket.connected) {
          socket.emit('castVote', {
            vote: message.vote,
            targetUserId: currentUserId,
            storyId: message.storyId
          });
        }
      }
      break;

    case 'allTickets':
      // Handle receiving all tickets (used when joining a room)
      if (Array.isArray(message.tickets)) {
        // Filter out any deleted tickets
        const filteredTickets = message.tickets.filter(ticket => !deletedStoryIds.has(ticket.id));
        console.log(`[SOCKET] Received ${filteredTickets.length} valid tickets (filtered from ${message.tickets.length})`);
        processAllTickets(filteredTickets);
        applyGuestRestrictions();
        
        // Ensure planning cards are visible for guests
        ensurePlanningCardsVisibleForGuests();
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
      // Skip processing for deleted story
      if (message.storyId && deletedStoryIds.has(message.storyId)) {
        console.log(`[VOTE] Ignoring vote for deleted story: ${message.storyId}`);
        return;
      }
      
      // Handle vote received
      if (message.userId && message.vote) {
        if (!votesPerStory[message.storyId]) {
          votesPerStory[message.storyId] = {};
        }
        votesPerStory[message.storyId][message.userId] = message.vote;
        
        // Update UI if this is the current story
        const currentStoryId = getCurrentStoryId();
        if (message.storyId === currentStoryId) {
          // Display either actual vote or thumbs up depending on reveal status
          updateVoteVisuals(message.userId, votesRevealed[message.storyId] ? message.vote : '👍', true);
        }
        
        // Use the debounced refresh to avoid UI flicker
        debouncedRefreshVoteDisplay();
      }
      break;
      
    case 'deleteStory':
      // Handle story deletion from another user
      if (message.storyId) {
        console.log('[SOCKET] Story deletion received for ID:', message.storyId);
        
        // Track locally
        deletedStoryIds.add(message.storyId);
        
        // Save to session storage
        const roomId = getRoomIdFromURL();
        saveDeletedStoriesToStorage(roomId);
        
        // Remove from DOM
        const storyCard = document.getElementById(message.storyId);
        if (storyCard) {
          // Get the index for potential reselection
          const index = parseInt(storyCard.dataset.index);
          
          console.log(`[SOCKET] Removing story card ${message.storyId} from DOM`);
          // Remove the story
          storyCard.remove();
          
          // Renumber remaining stories
          normalizeStoryIndexes();
          
          // If this was the current story, select another one
          if (index === currentStoryIndex) {
            const storyList = document.getElementById('storyList');
            if (storyList && storyList.children.length > 0) {
              const newIndex = Math.min(index, storyList.children.length - 1);
              selectStory(newIndex, false); // Don't emit selection to avoid loops
            }
          }
          // Update card interactions after DOM changes
          
          const currentId = getCurrentStoryId();
          updateUIVisibilityState(currentId);
          setupStoryCardInteractions();
          
          // Ensure planning cards are visible for guests
          ensurePlanningCardsVisibleForGuests();
        } else {
          console.warn(`[SOCKET] Could not find story card ${message.storyId} to delete`);
        }
        
        // Clean up votes for this story
        if (votesPerStory[message.storyId]) {
          delete votesPerStory[message.storyId];
          console.log(`[SOCKET] Removed votes for deleted story ${message.storyId}`);
        }
        if (votesRevealed[message.storyId]) {
          delete votesRevealed[message.storyId];
        }
      }
      break;
      
    case 'votesRevealed':
 console.log('[DEBUG] Received votesRevealed event', message);
  
  // Skip processing for deleted story
  if (message.storyId && deletedStoryIds.has(message.storyId)) {
    console.log(`[VOTE] Ignoring vote reveal for deleted story: ${message.storyId}`);
    return;
  }
  
  const storyId = message.storyId;
  
  if (storyId) {
    // Check if we've already revealed this story - IMPORTANT NEW CHECK
    if (votesRevealed[storyId] === true) {
      console.log(`[VOTE] Votes already revealed for story ${storyId}, not triggering effects again`);
      return; // Skip the rest to avoid duplicate animations
    }
    
    // Store the revealed state
    votesRevealed[storyId] = true;
    persistRevealState(storyId, true);
    console.log(`[DEBUG] Set votesRevealed[${storyId}] = true`);
    
    // Get the votes for this story
    const votes = votesPerStory[storyId] || {};
    console.log(`[DEBUG] Votes for story ${storyId}:`, JSON.stringify(votes));
    
    // This is where we display the actual vote values
    applyVotesToUI(votes, false);
    
    // Use centralized function for UI visibility - same for hosts and guests
    updateUIVisibilityState(storyId, 'stats');
    
    // Trigger emoji burst for fun effect - ONLY ONCE
    triggerGlobalEmojiBurst();
  }
  break;
      
    case 'votesReset':
      // Skip processing for deleted story
      if (message.storyId && deletedStoryIds.has(message.storyId)) {
        console.log(`[VOTE] Ignoring vote reset for deleted story: ${message.storyId}`);
        return;
      }
      
      // Handle votes reset
      if (message.storyId) {
        // Clear votes for the specified story
        if (votesPerStory[message.storyId]) {
          votesPerStory[message.storyId] = {};
        }
        
        // Reset revealed status
        votesRevealed[message.storyId] = false;
        persistRevealState(message.storyId, false);
        
        // Update UI if this is the current story
        const currentId = getCurrentStoryId();
        if (message.storyId === currentId) {
          resetAllVoteVisuals();
          
          // Use centralized function for UI visibility
          updateUIVisibilityState(currentId, 'cards');
        }
      }
      break;

    case 'storySelected':
      if (typeof message.storyIndex === 'number') {
        console.log('[SOCKET] Story selected from server:', message.storyIndex);
        
        // Pass the forceSelection parameter if it exists
        const forceSelection = message.forceSelection === true;
        selectStory(message.storyIndex, false, forceSelection); // false to avoid re-emitting
        
        // After story selection, request votes for it
        const currentStoryId = getCurrentStoryId();
        if (currentStoryId && socket && socket.connected && !deletedStoryIds.has(currentStoryId)) {
          setTimeout(() => {
            socket.emit('requestStoryVotes', { storyId: currentStoryId });
          }, 100);
        }
        
        // Ensure planning cards are visible for guests
        ensurePlanningCardsVisibleForGuests();
      }
      break;

    case 'storyVotes':
      // Skip processing for deleted story
      if (message.storyId && deletedStoryIds.has(message.storyId)) {
        console.log(`[VOTE] Ignoring votes for deleted story: ${message.storyId}`);
        return;
      }
      
      // Handle received votes for a specific story with improved state persistence
      if (message.storyId !== undefined && message.votes) {
        // Store votes for this story
        if (!votesPerStory[message.storyId]) {
          votesPerStory[message.storyId] = {};
        }
        
        // Update with received votes
        Object.assign(votesPerStory[message.storyId], message.votes);
        
        // Update UI if this is the current story
        const currentId = getCurrentStoryId();
        if (message.storyId === currentId) {
          // Check persisted state for this story
          const isRevealed = getPersistedRevealState(message.storyId) || votesRevealed[message.storyId];
          
          // If votes are revealed, show them; otherwise, just show that people voted
          if (isRevealed) {
            votesRevealed[message.storyId] = true;
            applyVotesToUI(message.votes, false);
            updateUIVisibilityState(message.storyId, 'stats');
          } else {
            applyVotesToUI(message.votes, true);
          }
        }
      }
      break;
      
    case 'syncCSVData':
      // Handle CSV data sync with improved state handling
      if (Array.isArray(message.csvData)) {
        console.log('[SOCKET] Received CSV data, length:', message.csvData.length);
        
        // Store the CSV data
        csvData = message.csvData;
        csvDataLoaded = true;
        
        // Temporarily save manually added tickets to preserve them
        const storyList = document.getElementById('storyList');
        const manualTickets = [];
        
        if (storyList) {
          const manualStoryCards = storyList.querySelectorAll('.story-card[id^="story_"]:not([id^="story_csv_"])');
          manualStoryCards.forEach(card => {
            // Skip if this is a deleted story
            if (deletedStoryIds.has(card.id)) {
              return;
            }
            
            const title = card.querySelector('.story-title');
            if (title) {
              manualTickets.push({
                id: card.id,
                text: title.textContent
              });
            }
          });
        }
        
        console.log(`[SOCKET] Preserved ${manualTickets.length} manually added tickets before CSV processing`);
        
        // Display CSV data (this will clear CSV stories but preserve manual ones)
        displayCSVData(csvData);
        
        // We don't need to re-add manual tickets because displayCSVData now preserves them
        
        // Update UI
        renderCurrentStory();
        
        // Ensure planning cards are visible for guests
        ensurePlanningCardsVisibleForGuests();
      }
      break;

    case 'connect':
      // When connection is established
      updateConnectionStatus('connected');
      
      // Request tickets and state after connection
      setTimeout(() => {
        if (socket && socket.connected) {
          if (!hasRequestedTickets) {
            console.log('[SOCKET] Connected, requesting all tickets');
            socket.emit('requestAllTickets');
            hasRequestedTickets = true;
          }
          
          // Also request votes for current story
          const currentId = getCurrentStoryId();
          if (currentId && !deletedStoryIds.has(currentId)) {
            socket.emit('requestStoryVotes', { storyId: currentId });
          }
        }
      }, 500);
      break;
      
    case 'reconnect_attempt':
      // Show reconnecting status
      updateConnectionStatus('reconnecting');
      reconnectingInProgress = true;
      break;
      
    case 'reconnect':
      // Handle successful reconnection with improved UI stability
      updateConnectionStatus('connected');
      reconnectingInProgress = false;

      // Request current state and story
      socket.emit('requestAllTickets');
      socket.emit('requestCurrentStory');
      
      // Add a small delay before requesting full state to ensure UI stability
      setTimeout(() => {
        socket.emit('requestFullStateResync');
        
        // Check current story reveal state
        const currentId = getCurrentStoryId();
        if (currentId) {
          // Check local storage first, then fall back to memory
          const isRevealed = getPersistedRevealState(currentId) || votesRevealed[currentId];
          votesRevealed[currentId] = isRevealed; // Make sure to update memory state
          
          // Use centralized function to manage visibility
          updateUIVisibilityState(currentId);
          
          // Request votes to ensure we have current data
          socket.emit('requestStoryVotes', { storyId: currentId });
        } else {
          // No current story selected, use centralized function for cards
          updateUIVisibilityState(null, 'cards');
        }
    
        // Re-apply stored votes
        if (typeof getUserVotes === 'function') {
          const userVotes = getUserVotes();
          for (const [storyId, vote] of Object.entries(userVotes)) {
            if (deletedStoryIds.has(storyId)) continue;
    
            if (!votesPerStory[storyId]) votesPerStory[storyId] = {};
            votesPerStory[storyId][socket.id] = vote;
            window.currentVotesPerStory = votesPerStory;
    
            const currentId = getCurrentStoryId();
            if (storyId === currentId) {
              updateVoteVisuals(socket.id, votesRevealed[storyId] ? vote : '👍', true);
            }
          }
    
          refreshVoteDisplay();
        }
      }, 500);
      break;
      
    case 'error':
      // Show connection error status
      updateConnectionStatus('error');
      break;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  let planningCardsSection = document.querySelector('.planning-cards-section');
  const statsContainer = document.querySelector('.vote-statistics-container');
  if (planningCardsSection) planningCardsSection.style.display = 'none';
  if (statsContainer) statsContainer.style.display = 'none';

  // Check if we're waiting for a username (joining via invite)
  if (window.userNameReady === false) {
    console.log('[APP] Waiting for username before initializing app');
    return; // Exit early, we'll initialize after username is provided
  }
  
  // Normal initialization for users who already have a name
  let roomId = getRoomIdFromURL();
  if (!roomId) {
    roomId = 'room-' + Math.floor(Math.random() * 10000);
  }
  appendRoomIdToURL(roomId);
  
  // Load deleted stories from storage first
  loadDeletedStoriesFromStorage(roomId);
  
  initializeApp(roomId);
});
