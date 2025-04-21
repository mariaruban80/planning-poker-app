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

// Initialize WebSocket connection
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
      // Update the votes for the story and re-render
      storyVotesByUser[msg.story] = msg.votes;
      renderUsers();
      break;

    case 'storyChange':
      // Update the selected story and current story index
      selectedStory = msg.story;
      currentStoryIndex = msg.index;
      renderUsers(); // re-render with the new story
      break;

    case 'userJoined':
      // Update users when a new user joins
      users.push(msg.user);
      renderUsers();
      break;

    default:
      console.warn('Unknown message type:', msg.type);
  }
}

function renderUsers() {
  app.innerHTML = `
    <h2>Room: ${currentRoomId}</h2>
    <h3>Users:</h3>
    <ul>${users.map(user => `<li>${user}</li>`).join('')}</ul>
    <p><strong>Selected story:</strong> ${selectedStory || "None"}</p>
    <div>
      ${selectedStory ? `<strong>Votes for ${selectedStory}:</strong>
        <ul>${Object.entries(storyVotesByUser[selectedStory] || {}).map(([user, vote]) => `<li>${user}: ${vote}</li>`).join('')}</ul>` 
        : 'No story selected'}
    </div>
  `;
}

// Update vote after a timeout (this is just for demo purposes)
setTimeout(() => {
  selectedStory = 'Story A';
  storyVotesByUser[selectedStory] = { [getUserId()]: '5' };
  sendMessage('voteUpdate', {
    story: selectedStory,
    votes: storyVotesByUser[selectedStory]
  });
}, 3000);

// Broadcast user votes when updated
function updateVote(story, vote) {
  storyVotesByUser[story] = {
    ...storyVotesByUser[story],
    [getUserId()]: vote
  };
  sendMessage('voteUpdate', {
    story: story,
    votes: storyVotesByUser[story]
  });
}

// Change selected story
function changeStory(story, index) {
  selectedStory = story;
  currentStoryIndex = index;
  sendMessage('storyChange', {
    story: story,
    index: index
  });
}
