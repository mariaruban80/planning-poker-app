let socket;
let currentRoomId = null;
let userName = null;
let userId = null;
const rooms = {};

// Initialize WebSocket connection
export function initializeWebSocket(roomId,userName,handleMessage) {
  socket = new WebSocket(`wss://planning-poker-app-2.onrender.com/`);
  currentRoomId = roomId;
 

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: 'join',
      roomId: roomId,
      user: userName
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

export function sendMessage(type, data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, ...data }));
  }
}

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
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

export function getRoomData() {
  return rooms[currentRoomId] || {};
}
