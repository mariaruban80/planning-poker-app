import { initializeWebSocket, emitCSVData } from './socket.js';

let socket;
let csvData = [];
let currentStoryIndex = 0;
let userVotes = {};
let roomId, userName;

function getRoomIdFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('roomId');
}

function appendRoomIdToURL(roomId) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('roomId', roomId);
  window.history.pushState(null, '', currentUrl.toString());
}

function initializeApp() {
  userName = prompt("Enter your username:");
  if (!userName) {
    alert("Username is required!");
    return;
  }

  socket = initializeWebSocket(roomId, userName, handleSocketMessage);

  if (socket) {
    socket.on('connect', () => {
      console.log('Connected to socket server!');
      socket.emit('joinRoom', { roomId, userName }); // FIXED here ✅

      socket.on('storySelected', handleStorySelected);
      socket.on('voteUpdate', handleVoteUpdate);
      socket.on('revealVotes', revealVotes);
      socket.on('userList', updateUserList);
      socket.on('syncCSVData', displayCSVData);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
    });
  } else {
    console.error("Socket object not created.");
  }

  setupStoryNavigation();
}

function handleSocketMessage(message) {
  console.log("Received:", message);
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
  return data.trim().split('\n').map(row => row.split(','));
}

function displayCSVData(data) {
  if (JSON.stringify(data) !== JSON.stringify(csvData)) {
    csvData = data;
    const container = document.getElementById('storyList');
    container.innerHTML = '';
    data.forEach((row, index) => {
      const card = document.createElement('div');
      card.className = 'story-card';
      card.textContent = `Story ${index + 1}: ${row.join(' | ')}`;
      card.dataset.index = index;
      container.appendChild(card);
      card.addEventListener('click', () => {
        document.querySelectorAll('.story-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        socket.emit('storySelected', { storyIndex: index });
      });
    });
    renderCurrentStory();
  }
}

function updateUserList(users) {
  const container = document.getElementById('userList');
  container.innerHTML = '';
  users.forEach(user => {
    const entry = document.createElement('div');
    entry.classList.add('user-entry');
    entry.id = `user-${user.id}`;

    const avatar = document.createElement('img');
    avatar.src = generateAvatarUrl(user.name);
    avatar.alt = user.name;
    avatar.classList.add('avatar');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = user.name;
    nameSpan.classList.add('username');

    const badge = document.createElement('span');
    badge.classList.add('vote-badge');
    badge.textContent = '?';

    entry.append(avatar, nameSpan, badge);
    container.appendChild(entry);
  });
}

function handleStorySelected({ storyIndex }) {
  const cards = document.querySelectorAll('.story-card');
  cards.forEach(c => c.classList.remove('selected'));
  const selected = cards[storyIndex];
  if (selected) selected.classList.add('selected');
}

function handleVoteUpdate({ userId, vote }) {
  userVotes[userId] = vote;
  const userElement = document.getElementById(`user-${userId}`);
  if (userElement) {
    const badge = userElement.querySelector('.vote-badge');
    if (badge) badge.textContent = '✔️';
  }
}

function revealVotes(votes) {
  for (const userId in votes) {
    const userElement = document.getElementById(`user-${userId}`);
    if (userElement) {
      const badge = userElement.querySelector('.vote-badge');
      if (badge) badge.textContent = votes[userId];
    }
  }
}

function renderCurrentStory() {
  const container = document.getElementById('storyList');
  if (!container || csvData.length === 0) return;
  const allCards = container.querySelectorAll('.story-card');
  allCards.forEach(c => c.classList.remove('active'));
  const current = allCards[currentStoryIndex];
  if (current) current.classList.add('active');
}

function setupStoryNavigation() {
  document.getElementById('nextStory')?.addEventListener('click', () => {
    if (csvData.length === 0) return;
    currentStoryIndex = (currentStoryIndex + 1) % csvData.length;
    renderCurrentStory();
    socket.emit('storyChange', { story: csvData[currentStoryIndex] });
    socket.emit('storyNavigation', { index: currentStoryIndex });
  });
  document.getElementById('prevStory')?.addEventListener('click', () => {
    if (csvData.length === 0) return;
    currentStoryIndex = (currentStoryIndex - 1 + csvData.length) % csvData.length;
    renderCurrentStory();
    socket.emit('storyChange', { story: csvData[currentStoryIndex] });
    socket.emit('storyNavigation', { index: currentStoryIndex });
  });
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

// --- Start App ---
roomId = getRoomIdFromURL();
if (!roomId) {
  roomId = 'room-' + Math.floor(Math.random() * 10000);
}
appendRoomIdToURL(roomId);

initializeApp();
setupCSVUploader();
setupInviteButton();
