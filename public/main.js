import { initializeWebSocket, sendMessage, getUserId } from './socket.js';

let users = [];
let storyVotesByUser = {};
let selectedStory = null;
let currentStoryIndex = 0;
let currentUser = null;

const app = document.getElementById('app');

function ensureRoomId() {
  const url = new URL(window.location.href);
  let roomId = url.searchParams.get("roomId");
  if (!roomId) {
    roomId = 'room-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
    url.searchParams.set("roomId", roomId);
    window.history.replaceState({}, '', url);
  }
  return roomId;
}

const currentRoomId = ensureRoomId();
initializeWebSocket(currentRoomId, handleMessage);

function initializeWebSocket(roomId, messageHandler) {
  const socket = new WebSocket(`wss://https://planning-poker-app-2.onrender.com/${roomId}`);

  socket.addEventListener('open', () => {
    console.log('WebSocket connection established');
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    messageHandler(msg);
  });

  socket.addEventListener('close', () => {
    console.warn('WebSocket connection closed. Attempting to reconnect...');
    setTimeout(() => initializeWebSocket(roomId, messageHandler), 5000);
  });

  socket.addEventListener('error', (error) => {
    console.error('WebSocket error:', error);
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'userList':
      users = msg.users;
      renderUI();
      break;

    case 'voteUpdate':
      storyVotesByUser[msg.story] = msg.votes;
      renderUI();
      break;

    case 'storyChange':
      selectedStory = msg.story;
      currentStoryIndex = msg.index;
      renderUI();
      break;

    case 'revealVotes':
      alert('Votes revealed!');
      renderUI(); // already uses storyVotesByUser
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

function renderUI() {
  app.innerHTML = `
    <h2>Room: ${currentRoomId}</h2>
    <h3>Users:</h3>
    <ul>${users.map(user => `<li>${user}</li>`).join('')}</ul>
    
    <div>
      <label>Selected Story: </label>
      <input type="text" id="storyInput" value="${selectedStory || ''}" placeholder="Enter story..." />
      <button onclick="window.changeStory()">Set Story</button>
    </div>

    <div>
      ${selectedStory ? `
        <p><strong>Votes for ${selectedStory}:</strong></p>
        <ul>${Object.entries(storyVotesByUser[selectedStory] || {}).map(([user, vote]) => `<li>${user}: ${vote}</li>`).join('')}</ul>
        <label>Your Vote:</label>
        <input type="text" id="voteInput" placeholder="Enter your vote" />
        <button onclick="window.submitVote()">Submit Vote</button>
      ` : '<p>No story selected.</p>'}
    </div>

    <div>
      <button onclick="window.revealVotes()">Reveal Votes</button>
      <button onclick="window.resetVotes()">Reset Votes</button>
    </div>

    <hr />
    <h3>Upload File:</h3>
    <form id="uploadForm">
      <input type="file" name="storyFile" />
      <button type="submit">Upload</button>
    </form>
  `;

  document.getElementById('uploadForm').addEventListener('submit', handleFileUpload);
}

// --- Interaction Functions (bound to window so inline handlers work) ---

window.changeStory = function () {
  const story = document.getElementById('storyInput').value;
  if (story) {
    selectedStory = story;
    storyVotesByUser[story] = storyVotesByUser[story] || {};
    sendMessage('storyChange', { story, index: 0 });
  }
};

window.submitVote = function () {
  const vote = document.getElementById('voteInput').value;
  if (selectedStory && vote) {
    storyVotesByUser[selectedStory] = {
      ...storyVotesByUser[selectedStory],
      [getUserId()]: vote
    };
    sendMessage('voteUpdate', {
      story: selectedStory,
      votes: storyVotesByUser[selectedStory]
    });
  }
};

window.revealVotes = function () {
  sendMessage('revealVotes', { roomId: currentRoomId });
};

window.resetVotes = function () {
  if (selectedStory) {
    storyVotesByUser[selectedStory] = {};
    sendMessage('resetVotes', { story: selectedStory });
  }
};

// --- File Upload Handler ---

function handleFileUpload(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  fetch('/upload', {
    method: 'POST',
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      alert('File uploaded successfully!');
      console.log('Uploaded file info:', data);
    })
    .catch(err => {
      alert('Upload failed.');
      console.error(err);
    });
}
