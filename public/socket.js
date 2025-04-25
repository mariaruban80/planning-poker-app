let socket;
let currentRoomId = null;
let userName = null;
let userId = null;
const rooms = {}; // In-memory client cache

// Initialize WebSocket connection
export function initializeWebSocket(roomId, handleMessage) {
  socket = new WebSocket(`wss://planning-poker-app-1.onrender.com`); // FIXED URL

  socket.onopen = () => {
    currentRoomId = roomId;
    userName = prompt('Enter your name:') || `User-${Math.floor(Math.random() * 1000)}`;

    socket.send(JSON.stringify({
      type: 'join',
      user: userName,
      userId: getUserId(),
      roomId: roomId,
    }));

    // Keep-alive ping
    setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleRoomData(msg);
    if (typeof handleMessage === 'function') handleMessage(msg);
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// Send structured message
export function sendMessage(type, data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, ...data }));
  }
}

// Persistent user ID
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

// Room-specific state handling
function handleRoomData(msg) {
  if (!rooms[currentRoomId]) {
    rooms[currentRoomId] = {
      users: [],
      storyVotesByUser: {},
      selectedStory: null
    };
  }

  const room = rooms[currentRoomId];

  switch (msg.type) {
    case 'userList':
      room.users = msg.users;
      break;

    case 'voteUpdate':
      room.storyVotesByUser[msg.story] = msg.votes;
      break;

    case 'storyChange':
      room.selectedStory = msg.story;
      break;

    case 'userJoined':
      if (!room.users.includes(msg.user)) {
        room.users.push(msg.user);
      }
      break;

    case 'revealVotes':
      // Nothing to cache, just allow main.js to trigger UI change
      break;

    case 'resetVotes':
      if (room.selectedStory) {
        room.storyVotesByUser[room.selectedStory] = {};
      }
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

// Optional helper if you want to expose room state
export function getRoomData() {
  return rooms[currentRoomId] || {};
}
