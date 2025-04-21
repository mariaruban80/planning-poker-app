let socket;
let currentRoomId = null;
let userName = null;
let userId = null;
const rooms = {}; // In-memory storage of rooms and their data

// Function to initialize WebSocket connection and join a room
export function initializeWebSocket(roomId, handleMessage) {
  // Establish WebSocket connection
  socket = new WebSocket(`wss://${window.location.host}`);

  socket.onopen = () => {
    currentRoomId = roomId;
    userName = prompt('Enter your name: ') || `User-${Math.floor(Math.random() * 1000)}`;

    socket.send(JSON.stringify({
      type: 'join',
      user: userName,
      roomId: roomId,
    }));

    // Start a keep-alive ping every 30 seconds
    setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleRoomData(msg);

    if (msg.type === 'userList') {
      updateUserList(msg.users);
    }

    if (typeof handleMessage === 'function') {
      handleMessage(msg); // Optional external message handler
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// Function to send messages to the WebSocket server
export function sendMessage(type, data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, ...data }));
  }
}

// Function to get the current user's ID (e.g., their name)
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

// Handle server messages and update room data
function handleRoomData(msg) {
  switch (msg.type) {
    case 'userList':
      if (!rooms[currentRoomId]) {
        rooms[currentRoomId] = { users: [], storyVotesByUser: {}, selectedStory: null };
      }
      rooms[currentRoomId].users = msg.users;
      break;

    case 'voteUpdate':
      if (!rooms[currentRoomId]) {
        rooms[currentRoomId] = { users: [], storyVotesByUser: {}, selectedStory: null };
      }
      rooms[currentRoomId].storyVotesByUser[msg.story] = msg.votes;
      break;

    case 'storyChange':
      if (!rooms[currentRoomId]) {
        rooms[currentRoomId] = { users: [], storyVotesByUser: {}, selectedStory: null };
      }
      rooms[currentRoomId].selectedStory = msg.story;
      break;

    case 'userJoined':
      if (!rooms[currentRoomId]) {
        rooms[currentRoomId] = { users: [], storyVotesByUser: {}, selectedStory: null };
      }
      rooms[currentRoomId].users.push(msg.user);
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

// Update the user list UI
function updateUserList(users) {
  const container = document.getElementById('user-list');
  if (!container) return;
  container.innerHTML = '';

  users.forEach(user => {
    const div = document.createElement('div');
    div.textContent = user;
    container.appendChild(div);
  });
}

// Broadcast updated room data to all users
function broadcastRoomData() {
  if (rooms[currentRoomId]) {
    const roomData = rooms[currentRoomId];
    sendMessage('userList', { users: roomData.users });
    sendMessage('voteUpdate', {
      story: roomData.selectedStory,
      votes: roomData.storyVotesByUser[roomData.selectedStory] || {},
    });
    sendMessage('storyChange', {
      story: roomData.selectedStory,
      index: roomData.selectedStory ? Object.keys(roomData.storyVotesByUser).indexOf(roomData.selectedStory) : 0,
    });
  }
}

// Record a vote for a story
export function updateVote(story, vote) {
  if (rooms[currentRoomId]) {
    if (!rooms[currentRoomId].storyVotesByUser[story]) {
      rooms[currentRoomId].storyVotesByUser[story] = {};
    }
    rooms[currentRoomId].storyVotesByUser[story][userName] = vote;
    sendMessage('voteUpdate', {
      story: story,
      votes: rooms[currentRoomId].storyVotesByUser[story],
    });
  }
}

// Change the current story
export function changeStory(story) {
  if (rooms[currentRoomId]) {
    rooms[currentRoomId].selectedStory = story;
    sendMessage('storyChange', {
      story: story,
      index: Object.keys(rooms[currentRoomId].storyVotesByUser).indexOf(story),
    });
  }
}
