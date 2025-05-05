// Extract user name from URL
const urlParams = new URLSearchParams(window.location.search);
let userName = urlParams.get('name');

if (!userName || userName.trim() === "") {
  userName = prompt("Enter your name");
}

// Now we assume roomId is already generated or parsed elsewhere
// Join room logic must use the userName variable
// Example (if room joining logic exists elsewhere):
// socket.emit('joinRoom', { roomId, userName });

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
  `;
  document.head.appendChild(style);
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
document.addEventListener("DOMContentLoaded", () => {
  const createBtn = document.getElementById("createBtn");
  const nameInput = document.getElementById("nameInput");

  function handleCreate() {
    const userName = nameInput.value.trim();
    if (userName === "") {
      alert("Please enter your name.");
      return;
    }
    sessionStorage.setItem("userName", userName);
    window.location.href = "index.html";
  }

  createBtn.addEventListener("click", handleCreate);

  // Cleanup to avoid memory leaks
  window.addEventListener("beforeunload", () => {
    createBtn.removeEventListener("click", handleCreate);
  });
});
