import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js"; // Use CDN or local install

let socket;
let currentRoomId = null;
let userName = null;
let userId = null;
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
    socket.emit('join', { roomId, user: userName });
  });

  socket.on('userList', (data) => {
    console.log('Received userList:', data);
    handleRoomData({ type: 'userList', users: data.users });
    if (typeof handleMessage === 'function') handleMessage({ type: 'userList', users: data.users });
  });

  socket.on('storyChange', (data) => {
    console.log('Received storyChange:', data);
    if (typeof handleMessage === 'function') handleMessage({ type: 'storyChange', story: data.story });
  });
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

// Handle room data (update the UI)
function handleRoomData(data) {
  const userListContainer = document.getElementById('userList'); // Assuming you have a container with id "userList"
  
  if (data.type === 'userList') {
    console.log('User list:', data.users);
    
    // Clear existing list
    userListContainer.innerHTML = '';

    // Add users to the list
    data.users.forEach(user => {
      const userElement = document.createElement('li');
      userElement.textContent = user;
      userListContainer.appendChild(userElement);
    });
  }
  if (data.type === 'storyChange') {
    console.log('Story changed:', data.story);
    // Handle story change (e.g., update the current story on the UI)
  }
}
