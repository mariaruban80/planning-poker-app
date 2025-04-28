import { initializeWebSocket, emitCSVData } from './socket.js';

let socket;
let csvData = [];
let currentStoryIndex = 0;
let userVotes = {}; // Track votes for users

// Get roomId from URL or generate one
function getRoomIdFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('roomId');
}

function appendRoomIdToURL(roomId) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('roomId', roomId);
  window.history.pushState(null, '', currentUrl.toString());
}

// Initialize app
function initializeApp(roomId) {
  const userName = prompt("Enter your username:");
  if (!userName) {
    alert("Username is required!");
    return;
  }

  // Initialize the socket with roomId and userName
  socket = io({ query: { roomId, userName } });

  socket.on('connect', () => {
    console.log('Connected to socket server!');
    socket.emit('joinRoom', { roomId, userName });

    socket.on('storySelected', handleStorySelected);
    socket.on('voteUpdate', handleVoteUpdate);
    socket.on('revealVotes', revealVotes);
    socket.on('userList', updateUserList);
    socket.on('syncCSVData', displayCSVData);
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
  });

  setupStoryNavigation();
}

// Display CSV content
function displayCSVData(data) {
  // Check if data is an array
  if (!Array.isArray(data)) {
    console.error('Expected an array but got:', data);
    return;
  }

  if (JSON.stringify(data) !== JSON.stringify(csvData)) {
    csvData = data;

    const storyListContainer = document.getElementById('storyList');
    if (!storyListContainer) return;

    storyListContainer.innerHTML = ''; // Clear current list

    data.forEach((row, index) => {
      const storyItem = document.createElement('div');
      storyItem.classList.add('story-card');
      storyItem.textContent = `Story ${index + 1}: ${row.join(' | ')}`;
      storyItem.dataset.index = index;
      storyListContainer.appendChild(storyItem);

      storyItem.addEventListener('click', function () {
        document.querySelectorAll('.story-card').forEach(card => card.classList.remove('selected'));
        storyItem.classList.add('selected');
        if (socket) {
          socket.emit('storySelected', { storyIndex: index });
        }
      });
    });

    renderCurrentStory();
  }
}

// Update user list with avatar + badge
function updateUserList(users) {
  const userListContainer = document.getElementById('userList');
  if (!userListContainer) return;

  userListContainer.innerHTML = ''; // Clear current list

  users.forEach(user => {
    const userElement = document.createElement('div');
    userElement.classList.add('user-entry');
    userElement.id = `user-${user.id}`; // Ensure user ID matches the server-side ID

    const avatar = document.createElement('img');
    avatar.src = generateAvatarUrl(user.name);
    avatar.alt = user.name;
    avatar.classList.add('avatar');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = user.name; // Display username
    nameSpan.classList.add('username');

    const voteBadge = document.createElement('span');
    voteBadge.classList.add('vote-badge');
    voteBadge.textContent = '?'; // Vote is hidden initially

    userElement.append(avatar, nameSpan, voteBadge); // Append the elements
    userListContainer.appendChild(userElement); // Add to the container
  });
}

// Generate avatar URL (can be replaced with real API later)
function generateAvatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&rounded=true`;
}

// Handle story selection from server
function handleStorySelected(data) {
  const storyCards = document.querySelectorAll('.story-card');
  storyCards.forEach(card => card.classList.remove('selected'));

  const selectedStory = storyCards[data.storyIndex];
  if (selectedStory) {
    selectedStory.classList.add('selected');
  }
}

// Setup navigation
function setupStoryNavigation() {
  const nextButton = document.getElementById('nextStory');
  const prevButton = document.getElementById('prevStory');

  if (nextButton) {
    nextButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      currentStoryIndex = (currentStoryIndex + 1) % csvData.length;
      renderCurrentStory();
      emitStoryChange();
      emitStoryNavigation();
    });
  }

  if (prevButton) {
    prevButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      currentStoryIndex = (currentStoryIndex - 1 + csvData.length) % csvData.length;
      renderCurrentStory();
      emitStoryChange();
      emitStoryNavigation();
    });
  }
}

// Emit story change
function emitStoryChange() {
  if (socket) {
    socket.emit('storyChange', { story: csvData[currentStoryIndex] });
  }
}

// Emit story navigation
function emitStoryNavigation() {
  if (socket && typeof currentStoryIndex === 'number') {
    socket.emit('storyNavigation', { index: currentStoryIndex });
  }
}

// Handle user voting
function sendVote(vote) {
  if (socket) {
    socket.emit('castVote', { vote });
  }
}

// Handle receiving votes
function handleVoteUpdate({ userId, vote }) {
  userVotes[userId] = vote;
  const userElement = document.getElementById(`user-${userId}`);
  if (userElement) {
    const badge = userElement.querySelector('.vote-badge');
    if (badge) {
      badge.textContent = '✔️'; // Voted indicator (don't show value yet)
    }
  }
}

// Reveal all votes
function revealVotes(votes) {
  for (const userId in votes) {
    const userElement = document.getElementById(`user-${userId}`);
    if (userElement) {
      const badge = userElement.querySelector('.vote-badge');
      if (badge) {
        badge.textContent = votes[userId];
      }
    }
  }
}

// Invite Modal
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

// --- App Start ---
let roomId = getRoomIdFromURL();
if (!roomId) {
  roomId = 'room-' + Math.floor(Math.random() * 10000);
}
appendRoomIdToURL(roomId);
initializeApp(roomId);
setupInviteButton();
