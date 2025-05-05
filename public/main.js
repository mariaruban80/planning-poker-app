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
let manuallyAddedTickets = []; // Track tickets added manually

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
  
  // Add CSS for new layout
  addNewLayoutStyles();
  
  // Request current session state after connection (important for shared URL joins)
  setTimeout(() => {
    if (socket && socket.connected) {
      console.log('[INIT] Requesting all tickets data');
      socket.emit('requestAllTickets');
    }
  }, 1000); // Give time for connection to establish
}

/**
 * Add CSS styles for the new layout
 */
function addNewLayoutStyles() {
  // Unchanged CSS code
}

/**
 * Setup Add Ticket button
 */
function setupAddTicketButton() {
  const addTicketBtn = document.getElementById('addTicketBtn');
  if (addTicketBtn) {
    addTicketBtn.addEventListener('click', () => {
      const storyText = prompt("Enter the story details:");
      if (storyText && storyText.trim()) {
        // Create ticket data
        const ticketData = {
          id: `story_${Date.now()}`,
          text: storyText.trim()
        };
        
        // Emit to server for synchronization
        if (socket) {
          socket.emit('addTicket', ticketData);
        }
        
        // Add ticket locally
        addTicketToUI(ticketData, true);
        
        // Store in manually added tickets
        manuallyAddedTickets.push(ticketData);
      }
    });
  }
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
  // Unchanged code
}

/**
 * Setup CSV file uploader
 */
function setupCSVUploader() {
  // Unchanged code
}

/**
 * Parse CSV text into array structure
 */
function parseCSV(data) {
  // Unchanged code
}

/**
 * Display CSV data in the story list
 */
function displayCSVData(data) {
  // Unchanged code
}

/**
 * Select a story by index
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
 * Rest of the functions remain unchanged
 */

/**
 * Handle socket messages - updated to handle sync of all tickets
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
      // Handle CSV data sync
      if (Array.isArray(message.csvData)) {
        csvData = message.csvData;
        displayCSVData(csvData);
        
        // Reset voting state when new CSV is loaded
        votesPerStory = {};
        votesRevealed = {};
        currentStoryIndex = 0;
        
        renderCurrentStory();
      }
      break;
      
    case 'storySelected':
      // Handle story selection from another user
      if (message.storyIndex !== undefined) {
        console.log('[SOCKET] Story selected by another user:', message.storyIndex);
        
        // If this is a different story than currently selected
        if (message.storyIndex !== currentStoryIndex) {
          // Update currentStoryIndex without emitting back to server
          currentStoryIndex = message.storyIndex;
          
          // Update UI
          document.querySelectorAll('.story-card').forEach(card => {
            card.classList.remove('selected', 'active');
          });
          
          const storyCard = document.querySelector(`.story-card[data-index="${currentStoryIndex}"]`);
          if (storyCard) {
            storyCard.classList.add('selected', 'active');
          }
          
          renderCurrentStory();
          resetOrRestoreVotes(currentStoryIndex);
        }
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
