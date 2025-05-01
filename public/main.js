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
 * Handle incoming socket messages
 */
function handleSocketMessage(message) {
  switch (message.type) {
    case 'syncCSVData':
      csvData = message.csvData;
      console.log('[SOCKET] Received syncCSVData:', message.csvData.length, 'rows');
      displayCSVData(csvData);
      
      // Mark CSV data as loaded
      csvDataLoaded = true;
      
      // Apply any pending story selection after displaying CSV data
      if (pendingStoryIndex !== null) {
        console.log('[APPLY] Applying pending story index after CSV load:', pendingStoryIndex);
        currentStoryIndex = pendingStoryIndex;
        pendingStoryIndex = null;
        
        // Apply highlighting with a slight delay to ensure DOM is updated
        setTimeout(() => {
          highlightSelectedStory(currentStoryIndex);
          renderCurrentStory();
          
          // Request votes for this story
          if (typeof requestStoryVotes === 'function') {
            requestStoryVotes(currentStoryIndex);
          }
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
      
      // Apply highlighting and reset votes
      highlightSelectedStory(currentStoryIndex);
      renderCurrentStory();
      resetOrRestoreVotes(currentStoryIndex);
      
      // Request votes for this story
      if (typeof requestStoryVotes === 'function') {
        requestStoryVotes(currentStoryIndex);
      }
      break;
      
    case 'voteUpdate':
      // Store vote in our local state
      if (!votesPerStory[message.storyIndex]) {
        votesPerStory[message.storyIndex] = {};
      }
      votesPerStory[message.storyIndex][message.userId] = message.vote;
      
      // Update UI if this is for the current story
      if (message.storyIndex === currentStoryIndex) {
        // Show a checkmark instead of the actual vote
        updateVoteVisuals(message.userId, '✓', true);
      }
      break;
      
    case 'storyVotes':
      console.log('[VOTES] Received votes for story', message.storyIndex, ':', message.votes);
      votesPerStory[message.storyIndex] = message.votes;
      
      if (message.storyIndex === currentStoryIndex) {
        // Apply votes but mask them
        applyVotesToUI(message.votes, !votesRevealed[message.storyIndex]);
      }
      break;
      
    case 'votesRevealed':
      votesRevealed[message.storyIndex] = true;
      
      // If this is the current story, update UI to show actual values
      if (message.storyIndex === currentStoryIndex && votesPerStory[message.storyIndex]) {
        applyVotesToUI(votesPerStory[message.storyIndex], false);
      }
      break;
      
    case 'votesReset':
      if (message.storyIndex === currentStoryIndex) {
        resetAllVoteVisuals();
      }
      if (votesPerStory[message.storyIndex]) {
        votesPerStory[message.storyIndex] = {};
      }
      votesRevealed[message.storyIndex] = false;
      break;
      
    default:
      console.warn('Unhandled message:', message);
  }
}

/**
 * Apply votes from server to the UI
 * @param {Object} votes - The votes to apply
 * @param {boolean} masked - Whether to mask votes with "✓" instead of showing actual values
 */
function applyVotesToUI(votes, masked = true) {
  // Reset all votes first
  resetAllVoteVisuals();
  
  // Apply each vote
  Object.entries(votes).forEach(([userId, vote]) => {
    updateVoteVisuals(userId, masked ? '✓' : vote, true);
  });
}

/**
 * Reset all vote visuals to default state
 */
function resetAllVoteVisuals() {
  // Reset all vote badges to "?"
  const badges = document.querySelectorAll('.vote-badge');
  badges.forEach(badge => {
    badge.textContent = '?';
  });
  
  // Reset avatar backgrounds
  const avatars = document.querySelectorAll('img.avatar');
  avatars.forEach(avatar => {
    avatar.style.backgroundColor = 'white';
  });
}

/**
 * Reset or restore votes when switching stories
 */
function resetOrRestoreVotes(storyIndex) {
  // Reset all visuals first
  resetAllVoteVisuals();
  
  // Restore saved votes if any
  const savedVotes = votesPerStory[storyIndex] || {};
  if (Object.keys(savedVotes).length > 0) {
    console.log('[VOTES] Restoring votes for story', storyIndex, ':', savedVotes);
    
    // Check if votes for this story are revealed
    const isRevealed = votesRevealed[storyIndex] === true;
    
    Object.entries(savedVotes).forEach(([userId, vote]) => {
      updateVoteVisuals(userId, isRevealed ? vote : '✓', true);
    });
  }
}

/**
 * Highlight the selected story
 */
function highlightSelectedStory(index) {
  console.log('[HIGHLIGHT] Applying highlight to story:', index);
  
  // Clear all highlights
  const storyCards = document.querySelectorAll('.story-card');
  console.log('[HIGHLIGHT] Total story cards:', storyCards.length);
  storyCards.forEach(card => card.classList.remove('selected', 'active'));
  
  // Find the card by index
  if (index >= 0 && index < storyCards.length) {
    const selectedStory = storyCards[index];
    if (selectedStory) {
      console.log('[HIGHLIGHT] Found story to highlight:', selectedStory.textContent.substring(0, 30));
      selectedStory.classList.add('selected', 'active');
      
      // Scroll into view if needed
      selectedStory.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      console.warn('[HIGHLIGHT] No story card found at index:', index);
    }
  } else {
    console.warn('[HIGHLIGHT] Index out of range:', index, 'for', storyCards.length, 'stories');
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

  socket = initializeWebSocket(roomId, userName, handleSocketMessage);
  setupCSVUploader();
  setupInviteButton();
  setupStoryNavigation();
  setupVoteCardsDrag();
  setupRevealResetButtons();
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
      displayCSVData(csvData);
      
      // Reset voting state when new CSV is loaded
      votesPerStory = {};
      votesRevealed = {};
      currentStoryIndex = 0;
      
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
 * Select a story by index
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
  
  // Reset or restore vote badges for the current story
  resetOrRestoreVotes(index);
  
  // Notify server about selection
  if (socket) {
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

    // Create user entry in side list
    const userEntry = document.createElement('div');
    userEntry.classList.add('user-entry');
    userEntry.id = `user-${user.id}`;
    userEntry.innerHTML = `
      <img src="${generateAvatarUrl(user.name)}" class="avatar" alt="${user.name}">
      <span class="username">${user.name}</span>
      <span class="vote-badge">?</span>
    `;
    userListContainer.appendChild(userEntry);

    // Create user entry in circle
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

      // Store vote locally
      if (!votesPerStory[currentStoryIndex]) {
        votesPerStory[currentStoryIndex] = {};
      }
      votesPerStory[currentStoryIndex][userId] = vote;
      
      // Update UI - show checkmark if votes aren't revealed
      updateVoteVisuals(userId, votesRevealed[currentStoryIndex] ? vote : '✓', true);
    });

    userCircleContainer.appendChild(circleEntry);
  });

  // Add reveal button to circle
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
    if (socket) {
      socket.emit('revealVotes');
      votesRevealed[currentStoryIndex] = true;
      
      // Update UI if we have votes for this story
      if (votesPerStory[currentStoryIndex]) {
        applyVotesToUI(votesPerStory[currentStoryIndex], false);
      }
    }
  };
  userCircleContainer.appendChild(revealBtn);
}

/**
 * Update vote visuals for a user
 * @param {string} userId - The user ID
 * @param {string} vote - The vote value ("✓" for masked votes)
 * @param {boolean} hasVoted - Whether the user has voted (for green background)
 */
function updateVoteVisuals(userId, vote, hasVoted = false) {
  // Update badges in both list and circle
  const badges = document.querySelectorAll(`#user-${userId} .vote-badge, #user-circle-${userId} .vote-badge`);
  badges.forEach(badge => {
    if (badge) badge.textContent = vote;
  });

  // Update avatar background to show they've voted
  if (hasVoted) {
    const avatars = document.querySelectorAll(`#user-${userId} img.avatar, #user-circle-${userId} img.avatar`);
    avatars.forEach(avatar => {
      if (avatar) avatar.style.backgroundColor = '#c1e1c1'; // Green background
    });
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
