import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js"; // Use CDN or local install

let socket;
let currentRoomId = null;
let userName = null;
let userId = null;
const rooms = {};

export function initializeWebSocket(roomId, userNameParam, handleMessage) {
  currentRoomId = roomId;
  userName = userNameParam;

  // Ensure roomId and userName are properly passed in
  if (!roomId || !userName) {
    console.error('Room ID or User Name is missing.');
    return;
  }

  console.log(`Initializing WebSocket connection for room: ${roomId}, user: ${userName}`);

  // Use socket.io client to connect to the server, passing roomId and userName in query
  socket = io("https://planning-poker-app-2.onrender.com", {
    transports: ["websocket"], // Force websocket if possible
    query: { roomId, userName } // Pass roomId and userName as part of the connection
  });

  socket.on('connect', () => {
    console.log('Socket.IO connection established.');

    // Emit join event to the server after the connection is established
    socket.emit('join', { roomId, user: userName });
  });

  // Handle different socket events and pass the data to the provided callback
  socket.on('userList', (data) => {
    console.log('Received userList:', data);
    handleRoomData({ type: 'userList', users: data.users });
    if (typeof handleMessage === 'function') handleMessage({ type: 'userList', users: data.users });
  });

  socket.on('storyChange', (data) => {
    console.log('Received storyChange:', data);
    if (typeof handleMessage === 'function') handleMessage({ type: 'storyChange', story: data.story });
  });

  // Add other socket event listeners below (e.g., for votes, reset, etc.)
}

// Handle room data (optional: customize based on your needs)
function handleRoomData(data) {
  if (data.type === 'userList') {
    console.log('User list:', data.users);
    // Handle user list (e.g., display users in the UI)
  }
  if (data.type === 'storyChange') {
    console.log('Story changed:', data.story);
    // Handle story change (e.g., update the current story on the UI)
  }
}
