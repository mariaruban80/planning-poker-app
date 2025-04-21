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
    // Store the current room ID
    currentRoomId = roomId;
    // Generate or prompt user for a unique name
    userName = prompt('Enter your name: ') || `User-${Math.floor(Math.random() * 1000)}`;
    
    // Send the 'join' message with the user and roomId
    socket.send(JSON.stringify({
      type: 'join',
      user: userName,
      roomId: roomId,
    }));
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
     switch (message.type) {
    case 'userList':
      updateUserList(message.users);
      break;

    case 'voteUpdate':
      // existing logic
      break;

    case 'storyChange':
      // existing logic
      break;
  }
    //handleMessage(msg);
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
      // Update the list of users in the current room
      if (!rooms[currentRoomId]) {
        rooms[currentRoomId] = { users: [], storyVotesByUser: {}, selectedStory: null };
      }
      rooms[currentRoomId].users = msg.users; // Update the users list
      break;

    case 'voteUpdate':
      // Update the votes for the selected story in the current room
      if (!rooms[currentRoomId]) {
        rooms[currentRoomId] = { users: [], storyVotesByUser: {}, selectedStory: null };
      }
      rooms[currentRoomId].storyVotesByUser[msg.story] = msg.votes;
      break;

    case 'storyChange':
      // Update the selected story in the current room
      if (!rooms[currentRoomId]) {
        rooms[currentRoomId] = { users: [], storyVotesByUser: {}, selectedStory: null };
      }
      rooms[currentRoomId].selectedStory = msg.story;
      break;

    case 'userJoined':
      // Add a new user to the list of users in the current room
      if (!rooms[currentRoomId]) {
        rooms[currentRoomId] = { users: [], storyVotesByUser: {}, selectedStory: null };
      }
      rooms[currentRoomId].users.push(msg.user);
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

// Listen to room-specific data and notify all users in the room
function broadcastRoomData() {
  if (rooms[currentRoomId]) {
    const roomData = rooms[currentRoomId];
    // Broadcast user list, story votes, and selected story to all clients in the room
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
function updateUserList(users) {
  const container = document.getElementById('user-list'); // example element
  container.innerHTML = '';

  users.forEach(user => {
    const div = document.createElement('div');
    div.textContent = user;
    container.appendChild(div);
  });
}
// For updating user votes on a story in the room
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

// For changing the selected story in the room
export function changeStory(story) {
  if (rooms[currentRoomId]) {
    rooms[currentRoomId].selectedStory = story;
    sendMessage('storyChange', {
      story: story,
      index: Object.keys(rooms[currentRoomId].storyVotesByUser).indexOf(story),
    });
  }
}
