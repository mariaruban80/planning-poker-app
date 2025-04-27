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
    handleRoomData({ type: 'userList', users: data.users });
    if (typeof handleMessage === 'function') handleMessage({ type: 'userList', users: data.users });
  });

  socket.on('storyChange', (data) => {
    handleRoomData({ type: 'storyChange', story: data.story });
    if (typeof handleMessage === 'function') handleMessage({ type: 'storyChange', story: data.story });
  });

  socket.on('voteUpdate', (data) => {
    handleRoomData({ type: 'voteUpdate', story: data.story, votes: data.votes });
    if (typeof handleMessage === 'function') handleMessage({ type: 'voteUpdate', story: data.story, votes: data.votes });
  });

  socket.on('revealVotes', () => {
    if (typeof handleMessage === 'function') handleMessage({ type: 'revealVotes' });
  });

  socket.on('resetVotes', () => {
    if (typeof handleMessage === 'function') handleMessage({ type: 'resetVotes' });
  });

  socket.on('disconnect', () => {
    console.log('Socket.IO connection closed.');
  });
}

export function sendMessage(type, data) {
  if (socket && socket.connected) {
    socket.emit(type, data);
  } else {
    console.error('Socket.IO is not connected. Unable to send message.');
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
    case 'voteUpdate':
      room.storyVotesByUser[msg.story] = msg.votes;
      break;
    case 'storyChange':
      room.selectedStory = msg.story;
      break;
    default:
      console.warn('Unknown message type:', msg.type);
  }
}

export function getRoomData() {
  return rooms[currentRoomId] || {};
}
