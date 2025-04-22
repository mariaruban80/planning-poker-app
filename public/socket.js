import { io } from 'socket.io-client';

let socket;
let currentRoomId = null;
let userName = null;

export function initializeWebSocket(roomId, handleMessage) {
  // Prevent re-initialization if already connected
  if (socket && socket.connected) return;

  socket = io('https://planning-poker-app-2.onrender.com'); // ✅ Update with your backend URL

  socket.on('connect', () => {
    currentRoomId = roomId;

    // Use persistent user ID or ask user for name
    userName = getUserId();
    socket.emit('join', { user: userName, roomId });
  });

  // Handle all incoming messages dynamically
  socket.onAny((event, data) => {
    if (typeof handleMessage === 'function') {
      handleMessage({ type: event, ...data });
    }
  });

  socket.on('disconnect', () => {
    console.warn('❌ Disconnected from server');
  });
}

export function sendMessage(type, data) {
  if (socket && socket.connected) {
    socket.emit(type, data);
  } else {
    console.warn('⚠️ Socket not connected, cannot send message');
  }
}

export function getUserId() {
  let userId = sessionStorage.getItem('userId');
  if (!userId) {
    userId = prompt('Enter your name:') || `User-${Math.floor(Math.random() * 10000)}`;
    sessionStorage.setItem('userId', userId);
  }
  return userId;
}

export function disconnectWebSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentRoomId = null;
  }
}

// --- Event Emission Functions (for server-side) ---

// Emit when a user joins the room
export function userJoin(userName, roomId) {
  socket.emit('join', { user: userName, roomId });
}

// Emit vote updates to the server
export function updateVote(story, votes, roomId) {
  socket.emit('voteUpdate', { story, votes, roomId });
}

// Emit when the story changes (selected story)
export function changeStory(story, index, roomId) {
  socket.emit('storyChange', { story, index, roomId });
}

// Emit when votes are revealed
export function revealVotes(roomId) {
  socket.emit('revealVotes', { roomId });
}

// Emit file upload notification
export function uploadFile(file, roomId) {
  socket.emit('fileUploaded', { file, roomId });
}
