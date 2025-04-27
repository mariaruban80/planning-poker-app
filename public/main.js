import { initializeWebSocket, emitCSVData } from './socket.js'; // Import both initialize and emit functions

let socket; // Declare globally so we can use it everywhere

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

// Initialize the WebSocket and listeners
function initializeApp(roomId) {
  const userName = prompt("Enter your username:");
  if (!userName) {
    alert("Username is required!");
    return;
  }

  socket = initializeWebSocket(roomId, userName, (message) => {
    console.log("Received message:", message);

    if (message.type === 'initialCSVData' || message.type === 'syncCSVData') {
      displayCSVData(message.csvData);
    }
    if (message.type === 'userList') {
      updateUserList(message.users);
    }
    if (message.type === 'storyChange') {
      updateStory(message.story);
    }
  });
}

// CSV Uploading
function setupCSVUploader() {
  const csvInput = document.getElementById('csvInput');
  if (!csvInput) return;

  csvInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const parsedData = parseCSV(e.target.result);
      emitCSVData(parsedData); // Emit to server
      displayCSVData(parsedData); // Show locally
    };
    reader.readAsText(file);
  });
}

// Parse CSV content
function parseCSV(data) {
  const rows = data.trim().split('\n');
  return rows.map(row => row.split(','));
}

// Display CSV content
function displayCSVData(data) {
  const storyListContainer = document.getElementById('storyList');
  if (!storyListContainer) return;

  storyListContainer.innerHTML = '';

  data.forEach((row) => {
    const storyItem = document.createElement('div');
    storyItem.classList.add('story-card');
    storyItem.textContent = row.join(' | ');
    storyListContainer.appendChild(storyItem);
  });
}

// Update user list
function updateUserList(users) {
  const userListContainer = document.getElementById('userList');
  if (!userListContainer) return;

  userListContainer.innerHTML = '';

  users.forEach(user => {
    const userElement = document.createElement('li');
    userElement.textContent = user;
    userListContainer.appendChild(userElement);
  });
}

// Update current story (optional - depends if you show it)
function updateStory(story) {
  const storyTitle = document.getElementById('currentStory');
  if (storyTitle) {
    storyTitle.textContent = story;
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

// ---- App Start ----

let roomId = getRoomIdFromURL();
if (!roomId) {
  roomId = 'room-' + Math.floor(Math.random() * 10000);
  appendRoomIdToURL(roomId);
}

initializeApp(roomId);
setupCSVUploader();
setupInviteButton();
