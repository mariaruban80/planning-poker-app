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
    socket.emit('join'); // No need to send { roomId, user } again because it's already in query
  });

  // Handle receiving the list of users
  socket.on('userList', (data) => {
    console.log('Received userList:', data);
    handleRoomData({ type: 'userList', users: data.users });
    if (typeof handleMessage === 'function') handleMessage({ type: 'userList', users: data.users });
  });

  // Handle receiving the current story
  socket.on('storyChange', (data) => {
    console.log('Received storyChange:', data);
    // Handle story change (display on UI)
    if (data.story) {
      updateStoryUI(data.story);
    }
    if (typeof handleMessage === 'function') handleMessage({ type: 'storyChange', story: data.story });
  });

  // Handle receiving the initial CSV data
  socket.on('initialCSVData', (data) => {
    console.log('Received initial CSV data:', data);
    // Handle the CSV data (e.g., render it in a table or list)
    if (data && data.length) {
      renderCSVData(data);
    }
    if (typeof handleMessage === 'function') handleMessage({ type: 'initialCSVData', csvData: data });
  });

  // Handle selected story index
  socket.on('storySelected', (data) => {
    console.log('Received selected story index:', data);
    // Handle story index (update UI or global state)
    selectedStoryIndex = data.storyIndex;
    updateSelectedStoryUI();
  });

  // Handle sync CSV data
  socket.on('syncCSVData', (data) => {
    console.log('Received synced CSV data:', data);
    if (typeof handleMessage === 'function') handleMessage({ type: 'syncCSVData', csvData: data });
  });
}

// Update the UI with the received story
function updateStoryUI(story) {
  // Example: Assume you have an element to display the current story
  const storyElement = document.getElementById('currentStory');
  if (storyElement) {
    storyElement.textContent = story;
  }
}

// Render CSV Data
function renderCSVData(csvData) {
  // Example: Assume you have a table or list to render the CSV data
  const csvContainer = document.getElementById('csvDataContainer');
  if (csvContainer) {
    csvContainer.innerHTML = ''; // Clear existing content
    csvData.forEach(row => {
      const rowElement = document.createElement('div');
      rowElement.textContent = row; // Or format the CSV data properly
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

// Handle room data (update the UI)
function handleRoomData(data) {
  const userListContainer = document.getElementById('userList'); // Assuming you have a container with id "userList"
  
  if (data.type === 'userList') {
    console.log('User list:', data.users);
    
    // Clear existing list
    if (userListContainer) {
      userListContainer.innerHTML = '';

      // Add users to the list
      data.users.forEach(user => {
        const userElement = document.createElement('li');
        userElement.textContent = user;
        userListContainer.appendChild(userElement);
      });
    }
  }
  if (data.type === 'storyChange') {
    console.log('Story changed:', data.story);
    // You can update the current story on the UI here
    updateStoryUI(data.story);
  }
}
