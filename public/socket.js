let socket;
let currentRoomId = null;
let userName = null;
let userId = null;
const rooms = {};

// Initialize WebSocket connection
export function initializeWebSocket(roomId, userName, handleMessage) {
  currentRoomId = roomId;
  userName = userName;

  // Make sure the WebSocket uses a secure (wss://) connection if deployed
  socket = new WebSocket(`wss://planning-poker-app-2.onrender.com`); // wss:// ensures WebSocket over HTTPS

  // Add event listener for WebSocket open event
  socket.onopen = () => {
    console.log('WebSocket connection established.');

    // Join the room by sending a message to the server
    socket.send(JSON.stringify({
      type: 'join',
      roomId: roomId,
      user: userName
    }));

    // Keep-alive ping to ensure the WebSocket remains active
    setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // Ping every 30 seconds
  };

  // Handle incoming WebSocket messages
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    handleRoomData(msg);

    // If there's a custom message handler, pass the message to it
    if (typeof handleMessage === 'function') {
      handleMessage(msg);
    }
  };

  // Handle WebSocket error
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  // Handle WebSocket close event
  socket.onclose = () => {
    console.log('WebSocket connection closed');
  };
}

// Send a message via WebSocket
export function sendMessage(type, data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, ...data }));
  } else {
    console.error('WebSocket is not open. Unable to send message.');
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

// Handle incoming room data and update the state
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

    case 'userJoined':
      if (!room.users.includes(msg.user)) {
        room.users.push(msg.user);
      }
      break;

    case 'voteUpdate':
      room.storyVotesByUser[msg.story] = msg.votes;
      break;

    case 'storyChange':
      room.selectedStory = msg.story;
      break;

    case 'revealVotes':
    case 'resetVotes':
      // Handle these actions if needed
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

// Retrieve room data (users, story, votes) for the current room
export function getRoomData() {
  return rooms[currentRoomId] || {};
}
