import { initializeWebSocket, sendMessage, getUserId } from './socket.js';

let users = [];
let storyVotesByUser = {};
let selectedStory = null;
let currentStoryIndex = 0;
let currentUser = null;
let uploadedFile = null; // Track the uploaded file

const app = document.getElementById('app');

// Function to submit the user's name
window.submitName = function () {
  const userName = document.getElementById('userName').value;
  if (userName) {
    currentUser = userName; // Store the entered name
    sendMessage('userJoin', { userName }); // Send the name to the server
    document.getElementById('nameInput').style.display = 'none'; // Hide name input field
  }
};

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
initializeWebSocket(currentRoomId, handleMessage); // Using the imported version from socket.js

function handleMessage(msg) {
  switch (msg.type) {
    case 'userList':
      users = msg.users;
      renderUsers(); // Re-render the users when the list is updated
      break;

    case 'voteUpdate':
      storyVotesByUser[msg.story] = msg.votes;
      renderVotes();
      break;

    case 'storyChange':
      selectedStory = msg.story;
      currentStoryIndex = msg.index;
      renderStory();
      break;

    case 'revealVotes':
      alert('Votes revealed!');
      renderVotes(); // re-render votes when they are revealed
      break;

    case 'fileUploaded':
      uploadedFile = msg.file;
      renderFileUpload();
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

// Render Users
function renderUsers() {
  const userList = document.getElementById("userList");
  userList.innerHTML = ''; // Clear the current list
  users.forEach(user => {
    const div = document.createElement("div");
    div.textContent = user;
    userList.appendChild(div);
  });
}

// Render Story
function renderStory() {
  const storyInput = document.getElementById('storyInput');
  const storyArea = document.getElementById('storyArea');
  if (storyInput) {
    storyInput.value = selectedStory || '';
  }
  storyArea.innerHTML = `
    <h3>Selected Story: ${selectedStory}</h3>
    <div>
      <label>Your Vote:</label>
      <input type="text" id="voteInput" placeholder="Enter your vote" />
      <button onclick="window.submitVote()">Submit Vote</button>
    </div>
    <div id="votesList">
      ${Object.entries(storyVotesByUser[selectedStory] || {}).map(([user, vote]) => `
        <div>${user}: ${vote}</div>
      `).join('')}
    </div>
  `;
}

// Render Votes
function renderVotes() {
  const votesList = document.getElementById('votesList');
  votesList.innerHTML = ''; // Clear previous votes
  if (selectedStory) {
    Object.entries(storyVotesByUser[selectedStory] || {}).forEach(([user, vote]) => {
      const voteElement = document.createElement('div');
      voteElement.textContent = `${user}: ${vote}`;
      votesList.appendChild(voteElement);
    });
  }
}

// Render File Upload UI
function renderFileUpload() {
  const fileSection = document.getElementById('fileSection');
  fileSection.innerHTML = uploadedFile ? `
    <p>File uploaded: <a href="${uploadedFile.url}" target="_blank">${uploadedFile.name}</a></p>
  ` : '<p>No file uploaded.</p>';
}

// --- Interaction Functions (bound to window so inline handlers work) ---

window.changeStory = function () {
  const story = document.getElementById('storyInput').value;
  if (story) {
    selectedStory = story;
    storyVotesByUser[story] = storyVotesByUser[story] || {};
    sendMessage('storyChange', { story, index: currentStoryIndex });
  }
};

window.submitVote = function () {
  const vote = document.getElementById('voteInput').value;
  if (selectedStory && vote) {
    storyVotesByUser[selectedStory] = {
      ...storyVotesByUser[selectedStory],
      [currentUser]: vote
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
      sendMessage('fileUploaded', { file: data }); // Notify other users about the uploaded file
      console.log('Uploaded file info:', data);
    })
    .catch(err => {
      alert('Upload failed.');
      console.error(err);
    });
}

document.getElementById('uploadForm').addEventListener('submit', handleFileUpload);
