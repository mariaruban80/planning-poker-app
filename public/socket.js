import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js"; // Use CDN or local install

let socket;
let currentRoomId = null;
let userName = null;
let userId = null;
let selectedStoryIndex = null; // track globally in session
const rooms = {};

export function initializeWebSocket(roomId, userNameParam, handleMessage) {
  currentRoomId = roomId;
  userName = userNameParam;

  if (!roomId || !userName) {
    console.error('Room ID or User Name is missing.');
    return;
  }

  console.log(`Initializing WebSocket connection for room: ${roomId}, user: ${userName}`);

  socket = io("https://planning-poker-app-2.onrender.com", {
    transports: ["websocket"],
    query: { roomId, userName }
  });

  socket.on('connect', () => {
    console.log('Socket.IO connection established.');
    socket.emit('join');
  });

  socket.on('userList', (data) => {
    console.log('Received userList:', data);
    handleRoomData({ type: 'userList', users: data.users });
    if (typeof handleMessage === 'function') handleMessage({ type: 'userList', users: data.users });
  });

  socket.on('storyChange', (data) => {
    console.log('Received storyChange:', data);
    if (data.story) {
      updateStoryUI(data.story);
    }
    if (typeof handleMessage === 'function') handleMessage({ type: 'storyChange', story: data.story });
  });

  socket.on('initialCSVData', (data) => {
    console.log('Received initial CSV data:', data);
    if (data && data.length) {
      renderCSVData(data);
    }
    if (typeof handleMessage === 'function') handleMessage({ type: 'initialCSVData', csvData: data });
  });

  socket.on('storySelected', (data) => {
    console.log('Received selected story index:', data);
    selectedStoryIndex = data.storyIndex;
    updateSelectedStoryUI();
  });

  socket.on('syncCSVData', (data) => {
    console.log('Received synced CSV data:', data);
    if (typeof handleMessage === 'function') handleMessage({ type: 'syncCSVData', csvData: data });
  });
}

// Update the UI with the received story
function updateStoryUI(story) {
  const storyElement = document.getElementById('currentStory');
  if (storyElement) {
    storyElement.textContent = story;
  }
}

// Render CSV Data
function renderCSVData(csvData) {
  const csvContainer = document.getElementById('csvDataContainer');
  if (csvContainer) {
    csvContainer.innerHTML = '';
    csvData.forEach(row => {
      const rowElement = document.createElement('div');
      rowElement.textContent = row;
      csvContainer.appendChild(rowElement);
    });
  }
}

// Emit the current story index to sync navigation across all users
function emitStoryNavigation() {
  if (socket && typeof selectedStoryIndex === 'number') {
    socket.emit('storyNavigation', { index: selectedStoryIndex });
  }
}

// Handle selected story UI highlight
function updateSelectedStoryUI() {
  const storyCards = document.querySelectorAll('.story-card');
  storyCards.forEach(card => card.classList.remove('selected'));

  if (storyCards[selectedStoryIndex]) {
    storyCards[selectedStoryIndex].classList.add('selected');
  }
}

// Exporting the getRoomData function
export function getRoomData() {
  return {
    roomId: currentRoomId,
    userName: userName,
    users: Object.keys(rooms),
  };
}

export function sendMessage(message) {
  if (!socket) {
    console.error('Socket is not initialized!');
    return;
  }

  console.log('Sending message:', message);
  socket.emit('message', message);
}

// Function to emit CSV data to server
export function emitCSVData(csvData) {
  if (!socket) {
    console.error('Socket is not initialized!');
    return;
  }
  console.log('Emitting CSV data to server:', csvData);
  socket.emit('syncCSVData', csvData);
}

// Helper to generate consistent background colors from names
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = `hsl(${hash % 360}, 70%, 80%)`;
  return color;
}

// Handle room data (update the UI)
function handleRoomData(data) {
  const userListContainer = document.getElementById('userList');
  if (!userListContainer) return;

  if (data.type === 'userList') {
    console.log('User list:', data.users);
    userListContainer.innerHTML = '';

    data.users.forEach(userName => {
      const userElement = document.createElement('li');
      userElement.style.display = 'flex';
      userElement.style.alignItems = 'center';
      userElement.style.marginBottom = '8px';

      // Create avatar
      const avatar = document.createElement('div');
      avatar.textContent = userName.substring(0, 2).toUpperCase();
      avatar.style.width = '40px';
      avatar.style.height = '40px';
      avatar.style.borderRadius = '50%';
      avatar.style.backgroundColor = stringToColor(userName);
      avatar.style.display = 'flex';
      avatar.style.alignItems = 'center';
      avatar.style.justifyContent = 'center';
      avatar.style.fontWeight = 'bold';
      avatar.style.color = '#333';
      avatar.style.fontSize = '16px';
      avatar.style.flexShrink = '0';

      // Create name text
      const nameSpan = document.createElement('span');
      nameSpan.textContent = userName;
      nameSpan.style.marginLeft = '12px';
      nameSpan.style.fontSize = '16px';

      userElement.appendChild(avatar);
      userElement.appendChild(nameSpan);
      userListContainer.appendChild(userElement);
    });
  }

  if (data.type === 'storyChange') {
    console.log('Story changed:', data.story);
    updateStoryUI(data.story);
  }
}
