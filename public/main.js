import { initializeWebSocket, emitCSVData } from './socket.js'; 

// Global state variables
let pendingStoryIndex = null;
let csvData = [];
let currentStoryIndex = 0;
let userVotes = {};
let socket = null;
let csvDataLoaded = false;  // New flag to track CSV data state

/**
 * Extract room ID from URL parameters
 */
function getRoomIdFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('roomId');
}

/**
 * Add room ID to URL for sharing
 */
function appendRoomIdToURL(roomId) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('roomId', roomId);
  window.history.pushState(null, '', currentUrl.toString());
}

/**
 * Handle all incoming socket messages
 */
function handleSocketMessage(message) {
  switch (message.type) {
    case 'syncCSVData':
      csvData = message.csvData;
      console.log('[SOCKET] Received syncCSVData:', csvData.length, 'rows');
      displayCSVData(csvData);
      
      // Mark CSV data as loaded and notify server
      csvDataLoaded = true;
      if (socket) socket.emit('csvDataLoaded');
      
      // Apply any pending story selection after displaying CSV data
      if (pendingStoryIndex !== null) {
        console.log('[APPLY] Applying pending story index after CSV load:', pendingStoryIndex);
        currentStoryIndex = pendingStoryIndex;
        pendingStoryIndex = null;
        
        // Apply highlighting with a slight delay to ensure DOM is updated
        setTimeout(() => {
          highlightSelectedStory(currentStoryIndex);
          renderCurrentStory();
        }, 100);
      } else {
        currentStoryIndex = 0;
        highlightSelectedStory(currentStoryIndex);
        renderCurrentStory();
      }
      break;
      
    case 'userList':
      updateUserList(message.users);
      break;
      
    case 'storyChange':
      updateStory(message.story);
      break;
      
    case 'storySelected':
      console.log('[SOCKET] Processing storySelected event:', message.storyIndex);
      
      // If CSV data isn't loaded yet, save the selection for later
      if (!csvDataLoaded) {
        console.log('[DELAY] CSV not ready, saving pendingStoryIndex:', message.storyIndex);
        pendingStoryIndex = message.storyIndex;
        return;
      }
      
      // Update the current index
      currentStoryIndex = message.storyIndex;
      console.log('[APPLY] Setting currentStoryIndex to:', currentStoryIndex);
      
      // Apply highlighting with a slight delay
      setTimeout(() => {
        highlightSelectedStory(currentStoryIndex);
        renderCurrentStory();
      }, 50);
      break;
      
    case 'voteUpdate':
      if (message.storyIndex === currentStoryIndex) {
        updateVoteVisuals(message.userId, message.vote);
      }
      break;
      
    default:
      console.warn('Unhandled message:', message);
  }
}

/**
 * Highlight the currently selected story
 */
function highlightSelectedStory(index) {
  console.log('[HIGHLIGHT] Applying highlight to story:', index);
  
  // Clear all highlights first
  const storyCards = document.querySelectorAll('.story-card');
  console.log('[HIGHLIGHT] Total story cards found:', storyCards.length);
  storyCards.forEach(card => card.classList.remove('selected', 'active'));
  
  // Find the specific card by data-index attribute (more reliable than array index)
  const selectedStory = document.querySelector(`.story-card[data-index="${index}"]`);
  
  if (selectedStory) {
    console.log('[HIGHLIGHT] Found story to highlight:', selectedStory.textContent.substring(0, 30));
    selectedStory.classList.add('selected', 'active');
    
    // Scroll the story into view if needed
    selectedStory.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    console.warn('[HIGHLIGHT] No story card found with data-index:', index);
    
    // Fallback to position-based selection if data-index fails
    if (storyCards[index]) {
      console.log('[HIGHLIGHT] Falling back to position-based selection');
      storyCards[index].classList.add('selected', 'active');
    }
  }
}

/**
 * Initialize the application
 */
function initializeApp(roomId) {
  let userName = '';
  while (!userName) {
    userName = prompt("Enter your username:");
    if (!userName) alert("Username is required!");
  }

  console.log('[INIT] Initializing app for room:', roomId);
  socket = initializeWebSocket(roomId, userName, handleSocketMessage);
  setupCSVUploader();
  setupInviteButton();
  setupStoryNavigation();
  setupVoteCardsDrag();
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
      const parsedData = parseCSV(e.target.result);
      emitCSVData(parsedData);
      csvData = parsedData;
      csvDataLoaded = true;
      displayCSVData(csvData);
      renderCurrentStory();
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
  const storyListContainer = document.getElementById('storyList');
  if (!storyListContainer) return;

  console.log('[UI] Displaying CSV data, rows:', data.length);
  storyListContainer.innerHTML = '';

  data.forEach((row, index) => {
    const storyItem = document.createElement('div');
    storyItem.classList.add('story-card');
    storyItem.textContent = `Story ${index + 1}: ${row.join(' | ')}`;
    storyItem.dataset.index = index;

    storyItem.addEventListener('click', () => {
      selectStory(index);
    });

    storyListContainer.appendChild(storyItem);
  });
}

/**
 * Select a story both locally and remotely
 */
function selectStory(index) {
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
  
  // Notify server about selection
  if (socket) {
    console.log('[EMIT] Broadcasting story selection:', index);
    socket.emit('storySelected', { storyIndex: index });
  }
}

/**
 * Update the current story display
 */
function renderCurrentStory() {
  const storyDisplay = document.getElementById('currentStory');
  if (!storyDisplay || csvData.length === 0) return;

  const story = csvData[currentStoryIndex];
  if (story) {
    storyDisplay.textContent = story.join(' | ');
  }
  
  // Also highlight in sidebar
  highlightSelectedStory(currentStoryIndex);
}

/**
 * Update the user list display
 */
function updateUserList(users) {
  const userListContainer = document.getElementById('userList');
  const userCircleContainer = document.getElementById('userCircle');
  if (!userListContainer || !userCircleContainer) return;

  userListContainer.innerHTML = '';
  userCircleContainer.innerHTML = '';

  const radius = 150, centerX = 200, centerY = 200;
  const angleStep = (2 * Math.PI) / users.length;

  users.forEach((user, index) => {
    const angle = index * angleStep;
    const x = centerX + radius * Math.cos(angle) - 30;
    const y = centerY + radius * Math.sin(angle) - 30;

    // Create user entry in the side list
    const userEntry = document.createElement('div');
    userEntry.classList.add('user-entry');
    userEntry.id = `user-${user.id}`;
    userEntry.innerHTML = `
      <img src="${generateAvatarUrl(user.name)}" class="avatar" alt="${user.name}">
      <span class="username">${user.name}</span>
      <span class="vote-badge">?</span>
    `;
    userListContainer.appendChild(userEntry);

    // Create user entry in the circle
    const circleEntry = document.createElement('div');
    circleEntry.classList.add('user-circle-entry');
    circleEntry.id = `user-circle-${user.id}`;
    circleEntry.style.position = 'absolute';
    circleEntry.style.left = `${x}px`;
    circleEntry.style.top = `${y}px`;
    circleEntry.style.textAlign = 'center';

    circleEntry.innerHTML = `
      <img src="${generateAvatarUrl(user.name)}" class="avatar" style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid #ccc; background-color: white;" />
      <span class="vote-badge" style="display:block; margin-top:5px;">?</span>
    `;

    circleEntry.setAttribute('draggable', 'false');
    circleEntry.addEventListener('dragover', (e) => e.preventDefault());
    circleEntry.addEventListener('drop', (e) => {
      e.preventDefault();
      const vote = e.dataTransfer.getData('text/plain');
      const userId = user.id;

      if (socket && vote) {
        socket.emit('castVote', { vote, targetUserId: userId });
      }

      updateVoteVisuals(userId, vote);
    });

    userCircleContainer.appendChild(circleEntry);
  });

  // Add reveal button
  const revealBtn = document.createElement('button');
  revealBtn.textContent = 'Reveal Cards';
  revealBtn.id = 'revealBtn';
  Object.assign(revealBtn.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#007bff',
    color: 'white',
    cursor: 'pointer'
  });
  revealBtn.onclick = () => {
    if (socket) socket.emit('revealVotes');
  };
  userCircleContainer.appendChild(revealBtn);
}

/**
 * Update vote visuals for a user
 */
function updateVoteVisuals(userId, vote) {
  // Update badges in both list and circle
  const badges = document.querySelectorAll(`#user-${userId} .vote-badge, #user-circle-${userId} .vote-badge`);
  badges.forEach(badge => {
    if (badge) badge.textContent = vote;
  });

  // Update avatar background to show they've voted
  const avatar = document.querySelector(`#user-circle-${userId} img.avatar`);
  if (avatar) avatar.style.backgroundColor = '#c1e1c1';
}

/**
 * Update story title
 */
function updateStory(story) {
  const storyTitle = document.getElementById('currentStory');
  if (storyTitle) storyTitle.textContent = story;
}

/**
 * Setup story navigation buttons
 */
function setupStoryNavigation() {
  const nextButton = document.getElementById('nextStory');
  const prevButton = document.getElementById('prevStory');

  if (nextButton) {
    nextButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      const newIndex = (currentStoryIndex + 1) % csvData.length;
      console.log('[NAV] Next Story Clicked, new index:', newIndex);
      selectStory(newIndex);
    });
  }

  if (prevButton) {
    prevButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      const newIndex = (currentStoryIndex - 1 + csvData.length) % csvData.length;
      console.log('[NAV] Previous Story Clicked, new index:', newIndex);
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
 * Setup invite button functionality
 */
function setupInviteButton() {
  const inviteButton = document.getElementById('inviteButton');
  if (!inviteButton) return;

  inviteButton.onclick = () => {
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '50%';
    modal.style.left = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.padding = '20px';
    modal.style.backgroundColor = 'white';
    modal.style.border = '1px solid #000';
    modal.innerHTML = ` 
      <h3>Invite URL</h3>
      <p>Share this link: <a href="${window.location.href}" target="_blank">${window.location.href}</a></p>
      <button onclick="document.body.removeChild(this.parentNode)">Close</button>
    `;
    document.body.appendChild(modal);
  };
}

/**
 * Setup vote card drag functionality
 */
function setupVoteCardsDrag() {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.textContent.trim());
    });
  });
}

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  let roomId = getRoomIdFromURL();
  if (!roomId) {
    roomId = 'room-' + Math.floor(Math.random() * 10000);
  }
  appendRoomIdToURL(roomId);
  initializeApp(roomId);
});
