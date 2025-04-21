import { initializeWebSocket, sendMessage, getUserId } from './socket.js';

let users = [];
let storyVotesByUser = {};
let selectedStory = null;
let currentStoryIndex = 0;

const app = document.getElementById('app');

function ensureRoomId() {
  const url = new URL(window.location.href);
  let roomId = url.searchParams.get("roomId");
  if (!roomId) {
    roomId = 'room-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
    url.searchParams.set("roomId", roomId);
    window.history.replaceState({}, '', url);
  }
  return roomId;
}

const currentRoomId = ensureRoomId();

initializeWebSocket(currentRoomId, handleMessage);
function initializeWebSocket(roomId, handleMessage) {
  const socket = new WebSocket(`wss://${window.location.host}`);

  socket.onopen = () => {
    const user = prompt('Enter your name: ') || `User-${Math.floor(Math.random() * 1000)}`;
    socket.send(JSON.stringify({
      type: 'join',
      user: user,
      roomId: roomId,
    }));
    console.log(`Sent join message: ${user} joined ${roomId}`);
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}
function handleMessage(msg) {
  switch (msg.type) {
    case 'userList':
      users = msg.users; // update the list of users
      renderUsers(); // re-render the user list
      break;

    case 'voteUpdate':
      storyVotesByUser[msg.story] = msg.votes; // update the votes for the story
      renderUsers(); // re-render the votes and users
      break;

    case 'storyChange':
      selectedStory = msg.story; // change the story in question
      currentStoryIndex = msg.index; // update the index of the current story
      renderUsers(); // re-render story and votes
      break;
  }
}


function renderUsers() {
  app.innerHTML = `
    <h2>Room: ${currentRoomId}</h2>
    <h3>Users:</h3>
    <ul>${users.map(user => `<li>${user}</li>`).join('')}</ul>
    <p><strong>Selected story:</strong> ${selectedStory || "None"}</p>
  `;
}

// Example vote update on timer (for demo)
setTimeout(() => {
  selectedStory = 'Story A';
  storyVotesByUser[selectedStory] = { [getUserId()]: '5' };
  sendMessage('voteUpdate', {
    story: selectedStory,
    votes: storyVotesByUser[selectedStory]
  });
}, 3000);
