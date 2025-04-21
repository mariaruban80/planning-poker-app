// socket.js
let socket;

export function initializeWebSocket(roomId, handleMessage) {
  // Establish WebSocket connection
  socket = new WebSocket(`wss://${window.location.host}`);

  socket.onopen = () => {
    // Send the 'join' message with the user and roomId
    const user = prompt('Enter your name: ') || `User-${Math.floor(Math.random() * 1000)}`;
    socket.send(JSON.stringify({
      type: 'join',
      user: user,
      roomId: roomId,
    }));
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
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
  // Return some unique ID, e.g., username or a random ID
  return `User-${Math.floor(Math.random() * 1000)}`;
}
