import { initializeWebSocket, sendMessage } from './socket.js';

let currentStory = null;

// Initialize the app
function initApp() {
  const roomId = window.location.pathname.slice(1) || prompt('Enter Room ID to join:') || 'default-room';
  initializeWebSocket(roomId, handleIncomingMessage);

  document.getElementById('vote-buttons').addEventListener('click', handleVoteClick);
  document.getElementById('reveal-btn').addEventListener('click', revealVotes);
  document.getElementById('reset-btn').addEventListener('click', resetVotes);
}

// Handle incoming WebSocket messages
function handleIncomingMessage(msg) {
  switch (msg.type) {
    case 'userList':
      updateUserList(msg.users);
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

// Update user list UI
function updateUserList(users) {
  const userList = document.getElementById('user-list');
  userList.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.textContent = user;
    userList.appendChild(li);
  });
}

// Update votes UI
function updateVotes(story, votes) {
  const voteList = document.getElementById('vote-list');
  voteList.innerHTML = '';

  for (const [userId, vote] of Object.entries(votes)) {
    const li = document.createElement('li');
    li.textContent = `${userId}: ${vote}`;
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
