// Get username from sessionStorage (already set from main.html or by index.html prompt)
let userName = sessionStorage.getItem('userName');
let processingCSVData = false;
// Import socket functionality
import { initializeWebSocket, emitCSVData, requestStoryVotes, emitAddTicket  } from './socket.js'; 

// Flag to track manually added tickets that need to be preserved
let preservedManualTickets = [];

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
  
  // Add CSS for new layout
  addNewLayoutStyles();
};

// Modify the existing DOMContentLoaded event handler to check if username is ready
document.addEventListener('DOMContentLoaded', () => {
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

/**
 * Determines if current user is a guest
 */
function isGuestUser() {
  // Check if URL contains 'roomId' parameter but not 'host=true'
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.has('roomId') && !urlParams.has('host');
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
  
  setupCSVUploader();
  setupInviteButton();
  setupStoryNavigation();
  setupVoteCardsDrag();
  setupRevealResetButtons();
  setupAddTicketButton();
  setupGuestModeRestrictions(); // Add guest mode restrictions
  
  // Add CSS for new layout
  addNewLayoutStyles();
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
      font-size: 22px;
      font-weight: bold;
      color: #673ab7;
    }
    
    .reveal-button-container {
      margin: 10px 0;
      width: 100%;
      display: flex;
      justify-content: center;
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
  `;
  document.head.appendChild(style);
}

/**
 * Setup Add Ticket button
 
function setupAddTicketButton() {
  const addTicketBtn = document.getElementById('addTicketBtn');
  if (addTicketBtn) {
      // Set flag to prevent double handling
    window.ticketHandlerAttached = true;
    addTicketBtn.addEventListener('click', () => {
      const storyText = prompt("Enter the story details:");
      if (storyText && storyText.trim()) {
        // Create ticket data
        const ticketData = {
          id: `story_${Date.now()}`,
          text: storyText.trim()
        };
        
        // Emit to server for synchronization
         emitAddTicket(ticketData);
       // if (socket) {
          //socket.emit('addTicket', ticketData);
        //}
        
        // Add ticket locally
        addTicketToUI(ticketData, true);
        
        // Store in manually added tickets
        manuallyAddedTickets.push(ticketData);
      }
    });
  }
} */
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
        
        if (typeof emitAddTicket === 'function') {
          emitAddTicket(ticketData);
        } else if (socket) {
          socket.emit('addTicket', ticketData);
        }
        
        addTicketToUI(ticketData, true);
        manuallyAddedTickets.push(ticketData);
      }
    }
  });
}

/**
 * Add a ticket to the UI
 * @param {Object} ticketData - Ticket data { id, text }
 * @param {boolean} selectAfterAdd - Whether to select the ticket after adding
 */
function addTicketToUI(ticketData, selectAfterAdd = false) {
  if (!ticketData || !ticketData.id || !ticketData.text) return;
  
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
  storyList.appendChild(storyCard);
  
  // Add click event listener
  storyCard.addEventListener('click', () => {
    selectStory(newIndex);
  });
  
  // Select the new story if requested
  if (selectAfterAdd) {
    selectStory(newIndex);
  }
  
  // Add this ticket to csvData if not already there
  if (!Array.isArray(csvData)) {
    csvData = [];
  }
  
  // Check if this ticket is already in csvData
  const existingIndex = csvData.findIndex(row => 
    row.length > 0 && row[0] === ticketData.text);
  
  if (existingIndex === -1) {
    csvData.push([ticketData.text]);
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
}

/**
 * Process multiple tickets at once (used when receiving all tickets from server)
 * @param {Array} tickets - Array of ticket data objects
 */
function processAllTickets(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return;
  
  console.log('[INFO] Processing all tickets received from server:', tickets.length);
  
  // Clear the story list first
  const storyList = document.getElementById('storyList');
  if (storyList) {
    storyList.innerHTML = '';
  }
  
  // Reset csvData
  csvData = [];
  
  // Add all tickets to the UI
  tickets.forEach((ticket, index) => {
    // Only add if it has required properties
    if (ticket && ticket.id && ticket.text) {
      // Add to UI without selecting
      addTicketToUI(ticket, false);
    }
  });
  
  // Select first story if any
  if (tickets.length > 0) {
    currentStoryIndex = 0;
    selectStory(0, false); // Don't emit to avoid loops
  }
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
        socket.emit('revealVotes');
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
        socket.emit('resetVotes');
        
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
        // Make sure this ticket isn't already in the list to avoid duplicates
        if (!document.getElementById(ticket.id)) {
          addTicketToUI(ticket, false);
        }
      });
      
      // Store these for future preservation
      preservedManualTickets = [...existingTickets];
      
      // Emit the CSV data to server AFTER ensuring all UI is updated
      emitCSVData(parsedData);
      
      // Reset voting state for new data
      votesPerStory = {};
      votesRevealed = {};
      
      // Reset current story index only if no stories were selected before
      if (!document.querySelector('.story-card.selected')) {
        currentStoryIndex = 0;
        renderCurrentStory();
      }
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
      const storyItem = document.createElement('div');
      storyItem.classList.add('story-card');
      storyItem.id = story.id;
      storyItem.dataset.index = index;
      
      const storyTitle = document.createElement('div');
      storyTitle.classList.add('story-title');
      storyTitle.textContent = story.text;
      
      storyItem.appendChild(storyTitle);
      storyListContainer.appendChild(storyItem);
      
      storyItem.addEventListener('click', () => {
        selectStory(index);
      });
    });
    
    // Then add CSV data
    let startIndex = existingStories.length;
    data.forEach((row, index) => {
      const storyItem = document.createElement('div');
      storyItem.classList.add('story-card');
      storyItem.id = `story_csv_${index}`;
      storyItem.dataset.index = startIndex + index;
      
      const storyTitle = document.createElement('div');
      storyTitle.classList.add('story-title');
      storyTitle.textContent = row.join(' | ');
      
      storyItem.appendChild(storyTitle);
      storyListContainer.appendChild(storyItem);
      
      storyItem.addEventListener('click', () => {
        selectStory(startIndex + index);
      });
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
  } finally {
    // Always release the processing flag
    processingCSVData = false;
  }
}
/**
 * Select a story by index
 * @param {number} index - Story index to select
 * @param {boolean} emitToServer - Whether to emit to server (default: true)
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
  resetAllVoteVisuals();
  
  // If we have stored votes for this story and they've been revealed
  if (votesPerStory[index] && votesRevealed[index]) {
    applyVotesToUI(votesPerStory[index], false);
  }
}

/**
 * Apply votes to UI
 */
function applyVotesToUI(votes, hideValues) {
  Object.entries(votes).forEach(([userId, vote]) => {
    updateVoteVisuals(userId, hideValues ? '✓' : vote, true);
  });
}

/**
 * Reset all vote visuals
 */
function resetAllVoteVisuals() {
  document.querySelectorAll('.vote-badge').forEach(badge => {
    badge.textContent = '?';
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

  // Create left sidebar user list
  users.forEach(user => {
    const userEntry = document.createElement('div');
    userEntry.classList.add('user-entry');
    userEntry.id = `user-${user.id}`;
    userEntry.innerHTML = `
      <img src="${generateAvatarUrl(user.name)}" class="avatar" alt="${user.name}">
      <span class="username">${user.name}</span>
      <span class="vote-badge">?</span>
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
    const voteCard = createVoteCardSpace(user);
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
      if (socket) {
        socket.emit('revealVotes');
        votesRevealed[currentStoryIndex] = true;
        
        // Update UI if we have votes for this story
        if (votesPerStory[currentStoryIndex]) {
          applyVotesToUI(votesPerStory[currentStoryIndex], false);
        }
      }
    };
  }
  
  revealButtonContainer.appendChild(revealBtn);

  // Create bottom row of vote cards
  const bottomVoteRow = document.createElement('div');
  bottomVoteRow.classList.add('vote-row');
  
  bottomUsers.forEach(user => {
    const voteCard = createVoteCardSpace(user);
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
  
  // Check if there's an existing vote for this user in the current story
  const existingVote = votesPerStory[currentStoryIndex]?.[user.id];
  if (existingVote) {
    avatarContainer.classList.add('has-voted');
  }
  
  return avatarContainer;
}

/**
 * Create vote card space for a user
 */
function createVoteCardSpace(user) {
  const voteCard = document.createElement('div');
  voteCard.classList.add('vote-card-space');
  voteCard.id = `vote-space-${user.id}`;
  
  // Add vote badge inside the card space
  const voteBadge = document.createElement('span');
  voteBadge.classList.add('vote-badge');
  voteBadge.textContent = '?';
  voteCard.appendChild(voteBadge);
  
  // Make it a drop target for vote cards
  voteCard.addEventListener('dragover', (e) => e.preventDefault());
  voteCard.addEventListener('drop', (e) => {
    e.preventDefault();
    const vote = e.dataTransfer.getData('text/plain');
    const userId = user.id;

    if (socket && vote) {
      socket.emit('castVote', { vote, targetUserId: userId });
    }

    // Store vote locally
    if (!votesPerStory[currentStoryIndex]) {
      votesPerStory[currentStoryIndex] = {};
    }
    votesPerStory[currentStoryIndex][userId] = vote;
    
    // Update UI - show checkmark if votes aren't revealed
    updateVoteVisuals(userId, votesRevealed[currentStoryIndex] ? vote : '✓', true);
  });
  
  // Check if there's an existing vote for this user in the current story
  const existingVote = votesPerStory[currentStoryIndex]?.[user.id];
  if (existingVote) {
    voteCard.classList.add('has-vote');
    voteBadge.textContent = votesRevealed[currentStoryIndex] ? existingVote : '✓';
  }
  
  return voteCard;
}

/**
 * Update vote visuals for a user
 */
function updateVoteVisuals(userId, vote, hasVoted = false) {
  // Update badges in sidebar
  const sidebarBadge = document.querySelector(`#user-${userId} .vote-badge`);
  if (sidebarBadge) sidebarBadge.textContent = vote;
  
  // Update vote card space
  const voteSpace = document.querySelector(`#vote-space-${userId}`);
  if (voteSpace) {
    const voteBadge = voteSpace.querySelector('.vote-badge');
    if (voteBadge) voteBadge.textContent = vote;
    
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

  if (nextButton) {
    nextButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      const newIndex = (currentStoryIndex + 1) % csvData.length;
      console.log('[NAV] Next Story Clicked:', newIndex);
      selectStory(newIndex);
    });
  }

  if (prevButton) {
    prevButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      const newIndex = (currentStoryIndex - 1 + csvData.length) % csvData.length;
      console.log('[NAV] Previous Story Clicked:', newIndex);
      selectStory(newIndex);
    });
  }
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

/**
 * Handle socket messages
 */
function handleSocketMessage(message) {
  const eventType = message.type;
  
  // console.log(`[SOCKET] Received ${eventType}:`, message);
  
  switch(eventType) {
    case 'userList':
      // Update the user list when server sends an updated list
      if (Array.isArray(message.users)) {
        updateUserList(message.users);
      }
      break;

    case 'addTicket':
      // Handle ticket added by another user
      if (message.ticketData) {
        console.log('[SOCKET] New ticket received:', message.ticketData);
        // Add ticket to UI without selecting it (to avoid loops)
        addTicketToUI(message.ticketData, false);
      }
      break;

      case 'allTickets':
      // Handle receiving all tickets (used when joining a room)
      if (Array.isArray(message.tickets)) {
        console.log('[SOCKET] Received all tickets:', message.tickets.length);
        processAllTickets(message.tickets);
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
      // Handle votes revealed
      votesRevealed[currentStoryIndex] = true;
      if (votesPerStory[currentStoryIndex]) {
        applyVotesToUI(votesPerStory[currentStoryIndex], false);
      }
      break;
      
    case 'votesReset':
      // Handle votes reset
      if (votesPerStory[currentStoryIndex]) {
        votesPerStory[currentStoryIndex] = {};
      }
      votesRevealed[currentStoryIndex] = false;
      resetAllVoteVisuals();
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
       // Handle CSV data sync with improved handling
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
  }
  break;

    case 'addTicket':
      // Handle new ticket added by another user
      if (message.ticketData) {
        console.log('[SOCKET] New ticket received:', message.ticketData);
        // Add ticket to UI without selecting it (to avoid loops)
        addTicketToUI(message.ticketData, false);
      }
      break;
      
    case 'allTickets':
      // Handle receiving all tickets (used when joining a room)
      if (Array.isArray(message.tickets)) {
        console.log('[SOCKET] Received all tickets:', message.tickets.length);
        processAllTickets(message.tickets);
      }
      break;
      
    case 'connect':
      // When connection is established, request tickets
      setTimeout(() => {
        if (socket && socket.connected && !hasRequestedTickets) {
          console.log('[SOCKET] Connected, requesting all tickets');
          socket.emit('requestAllTickets');
          hasRequestedTickets = true;
        }
      }, 500);
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
