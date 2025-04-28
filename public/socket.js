import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

let socket;
let currentRoomId = null;
let userName = null;
let selectedStoryIndex = null; // Track selected story globally in session

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

  // Events after connection
  socket.on('connect', () => {
    console.log('Socket.IO connection established.');
    socket.emit('joinRoom', roomId);
  });

  // Listening for user list updates
  socket.on('userList', (data) => {
    console.log('Received userList:', data);
    if (typeof handleMessage === 'function') {
      handleMessage({ type: 'userList', users: data.users });
    }
  });

  // Listening for story change updates
  socket.on('storyChange', (data) => {
    console.log('Received storyChange:', data);
    if (typeof handleMessage === 'function') {
      handleMessage({ type: 'storyChange', story: data.story });
    }
  });

  // Receiving initial CSV data
  socket.on('initialCSVData', (data) => {
    console.log('Received initial CSV data:', data);
    if (typeof handleMessage === 'function') {
      handleMessage({ type: 'initialCSVData', csvData: data });
    }
  });

  // Receiving synced CSV data
  socket.on('syncCSVData', (data) => {
    console.log('Received synced CSV data:', data);
    if (typeof handleMessage === 'function') {
      handleMessage({ type: 'syncCSVData', csvData: data });
    }
  });

  // Listening for story selection (highlight selected story for all users)
  socket.on('storySelected', (data) => {
    console.log('Received storySelected:', data);
    selectedStoryIndex = data.storyIndex; // Update local selected story
    if (typeof handleMessage === 'function') {
      handleMessage({ type: 'storySelected', storyIndex: data.storyIndex });
    }
  });

  // Handle story navigation (next/previous)
  socket.on('storyNavigation', (data) => {
    console.log('Received storyNavigation:', data);
    if (typeof handleMessage === 'function') {
      handleMessage({ type: 'storyNavigation', index: data.index });
    }
  });
}

// Get current room and user data
export function getRoomData() {
  return {
    roomId: currentRoomId,
    userName: userName,
  };
}

// Function to send custom message (if needed)
export function sendMessage(message) {
  if (!socket) {
    console.error('Socket is not initialized!');
    return;
  }
  console.log('Sending message:', message);
  socket.emit('message', message);
}

// Emit CSV data to server for syncing
export function emitCSVData(csvData) {
  if (!socket) {
    console.error('Socket is not initialized!');
    return;
  }
  console.log('Emitting CSV data to server:', csvData);
  socket.emit('syncCSVData', csvData);
}
