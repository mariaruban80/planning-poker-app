// socket.js

let socket;
let userId;
let roomId;
let onMessageCallback = () => {};

export const initializeWebSocket = (currentRoomId, messageHandler) => {
  roomId = currentRoomId;
  userId = "User" + Math.floor(Math.random() * 10000);
  onMessageCallback = messageHandler;

  socket = new WebSocket('wss://your-app-name.onrender.com'); // Change this

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: "join",
      user: userId,
      roomId
    }));
    console.log(`Joined room ${roomId} as ${userId}`);
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (typeof onMessageCallback === 'function') {
      onMessageCallback(message);
    }
  };

  socket.onerror = (error) => console.error('WebSocket error:', error);
  socket.onclose = () => console.log('WebSocket closed');
};

export const sendMessage = (type, payload = {}) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, user: userId, roomId, ...payload }));
  }
};

export const getUserId = () => userId;
