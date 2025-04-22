import { io } from 'socket.io-client';

let socket;
let currentRoomId = null;

export function initializeWebSocket(roomId, handleMessage) {
  socket = io('https://planning-poker-app-2.onrender.com'); // Replace with your correct backend URL

  socket.on('connect', () => {
    currentRoomId = roomId;
    const userName = prompt('Enter your name:') || `User-${Math.floor(Math.random() * 1000)}`;
    socket.emit('join', { user: userName, roomId });
  });

  socket.onAny((event, data) => {
    if (typeof handleMessage === 'function') {
      handleMessage({ type: event, ...data });
    }
  });

  socket.on('disconnect', () => {
    console.warn('Disconnected from server');
  });
}

export function sendMessage(type, data) {
  if (socket && socket.connected) {
    socket.emit(type, data);
  } else {
    console.warn('Socket not connected');
  }
}

export function getUserId() {
  let userId = sessionStorage.getItem('userId');
  if (!userId) {
    userId = `User-${Math.floor(Math.random() * 10000)}`;
    sessionStorage.setItem('userId', userId);
  }
  return userId;
}
