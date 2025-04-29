import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

let socket;
let currentRoomId = null;
let userName = null;
let selectedStoryIndex = null;
const rooms = {};

// Initialize WebSocket Connection
export function initializeWebSocket(roomId, userNameParam, handleMessage) {
  if (!roomId || !userNameParam) {
    console.error('Room ID or User Name is missing.');
    return;
  }

  currentRoomId = roomId;
  userName = userNameParam;

  console.log(`Initializing WebSocket connection for room: ${roomId}, user: ${userName}`);

  socket = io("https://planning-poker-app-2.onrender.com", {
    transports: ["websocket"],
    query: { roomId, userName }
  });

  socket.on('connect', () => {
    console.log('Socket.IO connection established.');
    socket.emit('join');
  });

  setupSocketListeners(handleMessage);
}

// Setup all WebSocket listeners
function setupSocketListeners(handleMessage) {
  socket.on('userList', (data) => {
    console.log('Received userList:', data);
    handleRoomData({ type: 'userList', users: data.users });
    handleMessageSafely(handleMessage, { type: 'userList', users: data.users });
  });

  socket.on('storyChange', (data) => {
    console.log('Received storyChange:', data);
    if (data.story) updateStoryUI(data.story);
    handleMessageSafely(handleMessage, { type: 'storyChange', story: data.story });
  });

  socket.on('initialCSVData', (data) => {
    console.log('Received initial CSV data:', data);
    if (data?.length) renderCSVData(data);
    handleMessageSafely(handleMessage, { type: 'initialCSVData', csvData: data });
  });

  socket.on('storySelected', (data) => {
    console.log('Received selected story index:', data);
    selectedStoryIndex = data.storyIndex;
    updateSelectedStoryUI();
  });

  socket.on('syncCSVData', (data) => {
    console.log('Received synced CSV data:', data);
    handleMessageSafely(handleMessage, { type: 'syncCSVData', csvData: data });
  });
}

// Safely call handleMessage if it's a function
function handleMessageSafely(handler, message) {
  if (typeof handler === 'function') {
    handler(message);
  }
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
  if (!csvContainer) return;

  csvContainer.innerHTML = '';
  csvData.forEach(row => {
    const rowElement = document.createElement('div');
    rowElement.textContent = row;
    csvContainer.appendChild(rowElement);
  });
}

// Highlight the selected story card
function updateSelectedStoryUI() {
  const storyCards = document.querySelectorAll('.story-card');
  storyCards.forEach(card => card.classList.remove('selected'));

  if (storyCards[selectedStoryIndex]) {
    storyCards[selectedStoryIndex].classList.add('selected');
  }
}

// Handle updating the room data UI
function handleRoomData(data) {
  const userListContainer = document.getElementById('userList');
  if (!userListContainer) return;

  if (data.type === 'userList') {
    console.log('User list:', data.users);
    userListContainer.innerHTML = '';
    data.users.forEach(user => {
      const userElement = document.createElement('li');
      userElement.textContent = user;
      userListContainer.appendChild(userElement);
    });
  }

  if (data.type === 'storyChange') {
    console.log('Story changed:', data.story);
    updateStoryUI(data.story);
  }
}

// Emit the current story index to sync navigation
export function emitStoryNavigation() {
  if (socket && typeof selectedStoryIndex === 'number') {
    socket.emit('storyNavigation', { index: selectedStoryIndex });
  }
}

// Emit CSV data to server
export function emitCSVData(csvData) {
  if (!socket) {
    console.error('Socket is not initialized!');
    return;
  }
  console.log('Emitting CSV data to server:', csvData);
  socket.emit('syncCSVData', csvData);
}

// Send a generic message
export function sendMessage(message) {
  if (!socket) {
    console.error('Socket is not initialized!');
    return;
  }
  console.log('Sending message:', message);
  socket.emit('message', message);
}

// Export current room data
export function getRoomData() {
  return {
    roomId: currentRoomId,
    userName: userName,
    users: Object.keys(rooms),
  };
}
