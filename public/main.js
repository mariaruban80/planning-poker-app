import { initializeWebSocket, sendMessage, getRoomData } from './socket.js';

let currentStory = null;
let socket;

// Initialize the app
function initApp() {
  const roomId = getRoomIdFromUrl();
  joinRoom(roomId); // Join the room when the page loads
  initializeWebSocket(roomId, handleIncomingMessage);

  document.getElementById('vote-buttons').addEventListener('click', handleVoteClick);
  document.getElementById('reveal-btn').addEventListener('click', revealVotes);
  document.getElementById('reset-btn').addEventListener('click', resetVotes);
}

// Get roomId from URL
function getRoomIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('roomId') || 'default-room';
}

// Join the room and emit 'joinRoom' event
function joinRoom(roomId) {
  const userName = prompt('Enter your name:') || 'Guest';
  socket.emit('joinRoom', roomId, userName);
}

// Handle incoming WebSocket messages
function handleIncomingMessage(msg) {
  switch (msg.type) {
    case 'userList':
      updateUserList(msg.users); // Update user list UI
      break;
    case 'storyChange':
      updateStory(msg.story);
      break;
    case 'voteUpdate':
      updateVotes(msg.story, msg.votes);
      break;
    case 'revealVotes':
      revealAllVotes();
      break;
    case 'resetVotes':
      resetAllVotes();
      break;
    default:
      console.warn('Unhandled message:', msg);
  }
}

// Update user list UI
function updateUserList(users) {
  const userList = document.getElementById('user-list');
  userList.innerHTML = ''; // Clear current list
  users.forEach(user => {
    const li = document.createElement('li');
    li.textContent = user;
    userList.appendChild(li);
  });
}

// Handle vote button clicks
function handleVoteClick(event) {
  if (event.target.classList.contains('vote-btn')) {
    const voteValue = event.target.dataset.value;
    if (currentStory) {
      sendMessage('vote', { story: currentStory, vote: voteValue });
    } else {
      alert('No story selected.');
    }
  }
}

// Change the current story
function updateStory(story) {
  currentStory = story;
  document.getElementById('current-story').textContent = `Current Story: ${story}`;
}

// Update votes UI
function updateVotes(story, votes) {
  const voteList = document.getElementById('vote-list');
  voteList.innerHTML = '';

  for (const [user, vote] of Object.entries(votes)) {
    const li = document.createElement('li');
    li.textContent = `${user}: ${vote}`;
    voteList.appendChild(li);
  }
}

// Send reveal command
function revealVotes() {
  sendMessage('revealVotes', {});
}

// Send reset command
function resetVotes() {
  sendMessage('resetVotes', {});
}

// Handle revealing votes
function revealAllVotes() {
  alert('Votes are now revealed!');
}

// Handle resetting votes
function resetAllVotes() {
  alert('Votes have been reset.');
  updateVotes(currentStory, {});
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initApp);
