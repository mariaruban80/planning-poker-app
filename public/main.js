import { initializeWebSocket, emitCSVData } from './socket.js'; 

let csvData = [];
let currentStoryIndex = 0;
let userVotes = {};
let socket = null; // Keep reference for reuse

function getRoomIdFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('roomId');
}

function appendRoomIdToURL(roomId) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('roomId', roomId);
  window.history.pushState(null, '', currentUrl.toString());
}

function handleSocketMessage(message) {
  switch (message.type) {
    case 'syncCSVData':
      csvData = message.csvData;
      currentStoryIndex = 0;
      displayCSVData(csvData);
      renderCurrentStory();
      break;
    case 'userList':
      updateUserList(message.users);
      break;
    case 'storyChange':
      updateStory(message.story);
      break;
    case 'storySelected':
      currentStoryIndex = message.storyIndex;
      highlightSelectedStory(currentStoryIndex);
      renderCurrentStory();  // <-- Ensure visual state is in sync
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

function highlightSelectedStory(index) {
  const storyCards = document.querySelectorAll('.story-card');
  storyCards.forEach(card => card.classList.remove('selected', 'active'));

  const selectedStory = storyCards[index];
  if (selectedStory) {
    selectedStory.classList.add('selected');
    selectedStory.classList.add('active');
  }
}

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
      csvData = parsedData;
      displayCSVData(csvData);
      renderCurrentStory();
    };
    reader.readAsText(file);
  });
}

function parseCSV(data) {
  const rows = data.trim().split('\n');
  return rows.map(row => row.split(','));
}

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
      document.querySelectorAll('.story-card').forEach(card => card.classList.remove('selected'));
      storyItem.classList.add('selected');
      currentStoryIndex = index;
      renderCurrentStory();

      if (socket) {
        socket.emit('storySelected', { storyIndex: currentStoryIndex });
      }
    });

    storyListContainer.appendChild(storyItem);
  });
}

function renderCurrentStory() {
  const storyListContainer = document.getElementById('storyList');
  if (!storyListContainer || csvData.length === 0) return;

  const allStoryItems = storyListContainer.querySelectorAll('.story-card');
  allStoryItems.forEach(card => card.classList.remove('active'));

  const current = allStoryItems[currentStoryIndex];
  if (current) current.classList.add('active');
}

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

    const userEntry = document.createElement('div');
    userEntry.classList.add('user-entry');
    userEntry.id = `user-${user.id}`;
    userEntry.innerHTML = `
      <img src="${generateAvatarUrl(user.name)}" class="avatar" alt="${user.name}">
      <span class="username">${user.name}</span>
      <span class="vote-badge">?</span>
    `;
    userListContainer.appendChild(userEntry);

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

function updateVoteVisuals(userId, vote) {
  const badge = document.querySelector(`#user-${userId} .vote-badge`) ||
                document.querySelector(`#user-circle-${userId} .vote-badge`);
  if (badge) badge.textContent = vote;

  const avatar = document.querySelector(`#user-circle-${userId} img.avatar`);
  if (avatar) avatar.style.backgroundColor = '#c1e1c1';
}

function updateStory(story) {
  const storyTitle = document.getElementById('currentStory');
  if (storyTitle) storyTitle.textContent = story;
}

function setupStoryNavigation() {
  const nextButton = document.getElementById('nextStory');
  const prevButton = document.getElementById('prevStory');

  if (nextButton) {
    nextButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      currentStoryIndex = (currentStoryIndex + 1) % csvData.length;
      renderCurrentStory();
      if (socket) socket.emit('storySelected', { storyIndex: currentStoryIndex });
    });
  }

  if (prevButton) {
    prevButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      currentStoryIndex = (currentStoryIndex - 1 + csvData.length) % csvData.length;
      renderCurrentStory();
      if (socket) socket.emit('storySelected', { storyIndex: currentStoryIndex });
    });
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

function setupVoteCardsDrag() {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.textContent.trim());
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  let roomId = getRoomIdFromURL();
  if (!roomId) {
    roomId = 'room-' + Math.floor(Math.random() * 10000);
  }
  appendRoomIdToURL(roomId);
  initializeApp(roomId);
  setupVoteCardsDrag();
});
