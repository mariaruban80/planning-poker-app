import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

let socket;
let currentRoomId = null;
let userName = null;
let selectedStoryIndex = null;

// Initialize WebSocket connection
export function initializeWebSocket(roomId, userNameParam, handleMessage) {
  if (!roomId || !userNameParam) {
    console.error('Room ID or User Name is missing.');
    return;
  }

  currentRoomId = roomId;
  userName = userNameParam;

  socket = io("/", {
    transports: ["websocket"],
    query: { roomId, userName }
  });

  socket.on('connect', () => {
    console.log(`✅ Connected: ${socket.id}`);
    socket.emit('joinRoom', { roomId, userName }); // ✅ Fix: match server event
  });

  setupSocketListeners(handleMessage);
  return socket; // So main.js can use it too
}

function setupSocketListeners(handleMessage) {
  socket.on('userList', (users) => {
    console.log('🔁 userList from server:', users);
    handleMessageSafely(handleMessage, { type: 'userList', users });
  });

  socket.on('storyChange', (data) => {
    console.log('🔁 storyChange:', data);
    handleMessageSafely(handleMessage, { type: 'storyChange', story: data.story });
  });

  socket.on('syncCSVData', (data) => {
    console.log('🔁 syncCSVData:', data);
    handleMessageSafely(handleMessage, { type: 'syncCSVData', csvData: data });
  });
socket.on('storySelected', (data) => {
  console.log('Received selected story index:', data);
  selectedStoryIndex = data.storyIndex;
  handleMessageSafely(handleMessage, {
    type: 'storySelected',
    storyIndex: selectedStoryIndex
  });
});

//  socket.on('storySelected', (data) => {
  //  console.log('🔁 storySelected:', data);
    //selectedStoryIndex = data.storyIndex;
    //updateSelectedStoryUI();
  //});
//}

function handleMessageSafely(handler, message) {
  if (typeof handler === 'function') {
    handler(message);
  }
}
function updateSelectedStoryUI() {
  const storyCards = document.querySelectorAll('.story-card');
  storyCards.forEach(card => card.classList.remove('selected', 'active'));

  if (storyCards[selectedStoryIndex]) {
    storyCards[selectedStoryIndex].classList.add('selected');
    storyCards[selectedStoryIndex].classList.add('active');

    // Sync with currentStoryIndex in main.js if accessible
    currentStoryIndex = selectedStoryIndex;
  }
}


//function updateSelectedStoryUI() {
  //const cards = document.querySelectorAll('.story-card');
  //cards.forEach(c => c.classList.remove('selected'));
  //if (cards[selectedStoryIndex]) {
   // cards[selectedStoryIndex].classList.add('selected');
 // }
//}

// Sync story index across clients
export function emitStoryNavigation() {
  if (socket && typeof selectedStoryIndex === 'number') {
    socket.emit('storyNavigation', { index: selectedStoryIndex });
  }
}

// Sync CSV data across room
export function emitCSVData(csvData) {
  if (!socket) {
    console.error('⚠️ Socket not initialized');
    return;
  }
  console.log('📤 Sending CSV data');
  socket.emit('syncCSVData', csvData);
}

// Optional utility
export function sendMessage(message) {
  if (!socket) return console.error('Socket not ready');
  socket.emit('message', message);
}

// Room metadata (optional)
export function getRoomData() {
  return { roomId: currentRoomId, userName };
}
