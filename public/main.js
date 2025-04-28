import { initializeWebSocket, emitCSVData } from './socket.js'; // Import both initialize and emit functions

let socket; // Declare globally so we can use it everywhere
let csvData = []; // Store parsed CSV data
let currentStoryIndex = 0; // Index to keep track of the current story

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
    if (message.type === 'storyNavigation') {
      currentStoryIndex = message.index;
      renderCurrentStory();
    }
  });

  // Handle Next/Previous story buttons
  setupStoryNavigation();
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
  // Only update the csvData if new data is provided
  if (JSON.stringify(data) !== JSON.stringify(csvData)) {
    csvData = data;  // Update the global CSV data

    // Ensure the story list container exists
    const storyListContainer = document.getElementById('storyList');
    if (!storyListContainer) return;

    // Clear the container before appending new data
    storyListContainer.innerHTML = '';

    // Iterate over all the rows in the CSV and render them
    data.forEach((row, index) => {
      const storyItem = document.createElement('div');
      storyItem.classList.add('story-card');
      storyItem.textContent = `Story ${index + 1}: ${row.join(' | ')}`;
      storyItem.dataset.index = index; // Store index in the data attribute
      storyListContainer.appendChild(storyItem);
       // Add this click event here
      storyItem.addEventListener('click', function() {
      document.querySelectorAll('.story-card').forEach(card => card.classList.remove('selected'));
      storyItem.classList.add('selected');
      socket.emit('storySelected', { storyIndex: index }); // ✨ Send selected story index to server
    });
});  

    renderCurrentStory();  // Make sure the current story is rendered after the data is displayed
  }
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

// Update current story
function updateStory(story) {
  const storyTitle = document.getElementById('currentStory');
  if (storyTitle) {
    storyTitle.textContent = story;
  }
}

// Render the current story with highlight
function renderCurrentStory() {
  const storyListContainer = document.getElementById('storyList');
  if (!storyListContainer || csvData.length === 0) return;

  // Clear the container (if needed)
  const allStoryItems = storyListContainer.querySelectorAll('.story-card');
  
  // Remove the 'active' class from all story items
  allStoryItems.forEach(storyItem => {
    storyItem.classList.remove('active');
  });

  // Add the 'active' class to the current story
  const currentStoryItem = allStoryItems[currentStoryIndex];
  if (currentStoryItem) {
    currentStoryItem.classList.add('active'); // Mark as active
  }
}

// Emit a story change to the server
function emitStoryChange() {
  if (socket) {
    socket.emit('storyChange', { story: csvData[currentStoryIndex] });
  }
}

// Handle Next/Previous story buttons
function setupStoryNavigation() {
  const nextButton = document.getElementById('nextStory');
  const prevButton = document.getElementById('prevStory');

  if (nextButton) {
    nextButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      currentStoryIndex = (currentStoryIndex + 1) % csvData.length; // Loop through stories
      renderCurrentStory();
      emitStoryChange();
      emitStoryNavigation();
    });
  }

  if (prevButton) {
    prevButton.addEventListener('click', () => {
      if (csvData.length === 0) return;
      currentStoryIndex = (currentStoryIndex - 1 + csvData.length) % csvData.length; // Loop through stories
      renderCurrentStory();
      emitStoryChange();
      emitStoryNavigation();
    });
  }
}

// Emit the current story index to sync navigation across all users
function emitStoryNavigation() {
  if (socket && typeof currentStoryIndex === 'number') {
    socket.emit('storyNavigation', { index: currentStoryIndex });
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
// --- Handle story selection across clients ---
if (!socket) {
  console.error('Socket not initialized yet.');
} else {
  socket.on('storySelected', (data) => {
    const storyCards = document.querySelectorAll('.story-card');
    storyCards.forEach(card => card.classList.remove('selected'));

    const selectedStory = storyCards[data.storyIndex];
    if (selectedStory) {
      selectedStory.classList.add('selected');
    }
  });
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
