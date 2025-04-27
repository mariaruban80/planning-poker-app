import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js'; // Import Socket.IO client

let socket;
let currentRoomId = null;
let userName = null;
let userId = null;
const rooms = {};

// Initialize Socket.IO connection
export function initializeWebSocket(roomId, name, handleMessage) {
  currentRoomId = roomId;
  userName = name;

  // Connect to server (no need to specify full URL if served from same origin)
  socket = io('https://planning-poker-app-2.onrender.com', {
    transports: ['websocket'], // Force pure WebSocket transport
  });

  socket.on('connect', () => {
    console.log('Socket.IO connection established.');

    // Send join message
    socket.emit('join', {
      roomId: roomId,
      user: userName,
      userId: getUserId(),
    });
  });

  socket.on('disconnect', () => {
    console.log('Socket.IO connection closed.');
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
  });

  // Handle incoming messages
  socket.onAny((event, data) => {
    console.log(`Received event: ${event}`, data);

    const msg = { type: event, ...data }; // Normalize into { type, ...data }
    handleRoomData(msg);

    if (typeof handleMessage === 'function') {
      handleMessage(msg);
    }
  });
}

// Send a message using Socket.IO
export function sendMessage(type, data) {
  if (socket && socket.connected) {
    socket.emit(type, data);
  } else {
    console.error('Socket.IO not connected. Cannot send message.');
  }
}

// Generate or retrieve a userId from sessionStorage
export function getUserId() {
  if (!userId) {
    userId = sessionStorage.getItem('userId');
    if (!userId) {
      userId = `User-${Math.floor(Math.random() * 10000)}`;
      sessionStorage.setItem('userId', userId);
    }
  }
  return userId;
}

// Handle incoming room data and update local state
function handleRoomData(msg) {
  if (!rooms[currentRoomId]) {
    rooms[currentRoomId] = {
      users: [],
      storyVotesByUser: {},
      selectedStory: null,
    };
  }

  const room = rooms[currentRoomId];

  switch (msg.type) {
    case 'userList':
      room.users = msg.users || [];
      break;

    case 'userJoined':
      if (msg.user && !room.users.includes(msg.user)) {
        room.users.push(msg.user);
      }
      break;

    case 'voteUpdate':
      if (msg.story && msg.votes) {
        room.storyVotesByUser[msg.story] = msg.votes;
      }
      break;

    case 'storyChange':
      room.selectedStory = msg.story;
      break;

    case 'revealVotes':
    case 'resetVotes':
      // Optional: handle vote reveal/reset behavior if needed
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

// Retrieve room data (users, story, votes)
export function getRoomData() {
  return rooms[currentRoomId] || {};
}
