import { initializeWebSocket, emitCSVData } from './socket.js';

let socket;
let csvData = [];
let currentStoryIndex = 0;
let userVotes = {};

function getRoomIdFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('roomId');
}

function appendRoomIdToURL(roomId) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('roomId', roomId);
  window.history.pushState(null, '', currentUrl.toString());
}

function initializeApp(roomId) {
  const userName = prompt("Enter your username:");
  if (!userName) {
    alert("Username is required!");
    return;
  }

  socket = io({ query: { roomId, userName } });

  socket.on('connect', () => {
    console.log('Connected to server.');
    socket.emit('joinRoom', { roomId, userName });
  });

  socket.on('storySelected', handleStorySelected);
  socket.on('voteUpdate', handleVoteUpdate);
  socket.on('revealVotes', revealVotes);
  socket.on('userList', updateUserList);
  socket.on('syncCSVData', (data) => {
    if (Array.isArray(data)) {
      displayCSVData(data);
    } else {
      console.error('syncCSVData payload is not an array:', data);
    }
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
  });

  setupStoryNavigation();
}

function handleStorySelected(data) {
  const storyCards = document.querySelectorAll('.story-card');
  storyCards.forEach(card => card.classList.remove('selected'));

  const selectedStory = storyCards[data.storyIndex];
  if (selectedStory) {
    selectedStory.classList.add('selected');
  }
}

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
      displayCSVData(parsedData);
    };
    reader.readAsText(file);
  });
}

function parseCSV(data) {
  const rows = data.trim().split('\n');
  return rows.map(row => row.split(','));
}

function displayCSVData(data) {
  if (!Array.isArray(data)) {
    console.error('displayCSVData received invalid data:', data);
    return;
  }

  if (JSON.stringify(data) !== JSON.stringify(csvData)) {
    csvData = data;

    const storyListContainer = document.getElementById('storyList');
    if (!storyListContainer) return;

    storyListContainer.innerHTML = '';

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

function updateUserList(users) {
  const userListContainer = document.getElementById('userList');
  if (!userListContainer) return;

  userListContainer.innerHTML = '';

  users.forEach(user => {
const userElement = document.createElement('div');
userElement.classList.add('user-entry');
userElement.id = `user-${user.id}`;

// Avatar
const avatar = document.createElement('img');
avatar.src = generateAvatarUrl(user.name);
avatar.alt = user.name;
avatar.classList.add('avatar');

// Username
const nameSpan = document.createElement('span');
nameSpan.textContent = user.name;
nameSpan.classList.add('username');

// Vote Badge
const voteBadge = document.createElement('span');
voteBadge.classList.add('vote-badge');
voteBadge.textContent = '?'; // Hidden initially

// Append all in order
userElement.append(avatar, nameSpan, voteBadge);
userListContainer.appendChild(userElement);



  });
}

function updateStory(story) {
  const storyTitle = document.getElementById('currentStory');
  if (storyTitle) {
    storyTitle.textContent = story;
  }
}

function renderCurrentStory() {
  const storyListContainer = document.getElementById('storyList');
  if (!storyListContainer || csvData.length === 0) return;

  const allStoryItems = storyListContainer.querySelectorAll('.story-card');
  allStoryItems.forEach(storyItem => storyItem.classList.remove('active'));

  const currentStoryItem = allStoryItems[currentStoryIndex];
  if (currentStoryItem) {
    currentStoryItem.classList.add('active');
  }
}

function emitStoryChange() {
  if (socket) {
    socket.emit('storyChange', { story: csvData[currentStoryIndex] });
  }
}

function emitStoryNavigation() {
  if (socket && typeof currentStoryIndex === 'number') {
    socket.emit('storyNavigation', { index: currentStoryIndex });
  }
}

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

function sendVote(vote) {
  if (socket) {
    socket.emit('castVote', { vote });
  }
}

function handleVoteUpdate({ userId, vote }) {
  userVotes[userId] = vote;
  const userElement = document.getElementById(`user-${userId}`);
  if (userElement) {
    const badge = userElement.querySelector('.vote-badge');
    if (badge) {
      badge.textContent = '✔️';
    }
  }
}

function revealVotes(votes) {
  for (const userId in votes) {
    const userElement = document.getElementById(`user-${userId}`);
    if (userElement) {
      const badge = userElement.querySelector('.vote-badge');
      if (badge) {
        const vote = votes[userId];
        badge.textContent = vote;

        // Color logic based on vote
        if (vote === '?' || vote === '☕') {
          badge.style.backgroundColor = '#6c757d'; // Gray
        } else if (!isNaN(vote)) {
          const voteNum = parseFloat(vote);
          if (voteNum <= 3) {
            badge.style.backgroundColor = '#28a745'; // Green
          } else if (voteNum <= 8) {
            badge.style.backgroundColor = '#ffc107'; // Yellow
          } else {
            badge.style.backgroundColor = '#dc3545'; // Red
          }
        } else {
          badge.style.backgroundColor = '#007bff'; // Default Blue
        }
      }
    }
  }
}

function generateAvatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&rounded=true`;
}

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
setupCSVUploader();
setupInviteButton();
