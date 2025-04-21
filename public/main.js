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

function handleMessage(msg) {
  switch (msg.type) {
    case "userList":
      users = msg.users;
      renderUsers();
      break;
    case "voteUpdate":
      storyVotesByUser[msg.story] = msg.votes;
      renderUsers();
      break;
    case "storyChange":
      selectedStory = msg.story;
      currentStoryIndex = msg.index;
      renderUsers();
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
