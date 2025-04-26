import { initializeWebSocket, sendMessage, getRoomData } from './socket.js';

let currentStory = null;

// Initialize app
function initApp() {
  let roomId = getRoomIdFromUrl();
  if (!roomId) {
    roomId = prompt('Enter Room ID:') || 'default-room';
    window.location.href = `/${roomId}`;
    return;
  }

  initializeWebSocket(roomId, handleIncomingMessage);

  document.getElementById('vote-buttons').addEventListener('click', handleVoteClick);
  document.getElementById('reveal-btn').addEventListener('click', revealVotes);
  document.getElementById('reset-btn').addEventListener('click', resetVotes);
  document.getElementById('add-user-btn').addEventListener('click', addUser);
}

function getRoomIdFromUrl() {
  const path = window.location.pathname;
  return path.split('/')[1] || null;
}

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

function addUser() {
  const userName = prompt('Enter new member name:');
  if (userName) {
    sendMessage('addUser', { user: userName });
  }
}

function updateStory(story) {
  currentStory = story;
  document.getElementById('current-story').textContent = `Current Story: ${story}`;
}

function updateUserList(users) {
  const userList = document.getElementById('user-list');
  userList.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.textContent = user;
    userList.appendChild(li);
  });
}

function updateVotes(story, votes) {
  const voteList = document.getElementById('vote-list');
  voteList.innerHTML = '';
  for (const [user, vote] of Object.entries(votes)) {
    const li = document.createElement('li');
    li.textContent = `${user}: ${vote}`;
    voteList.appendChild(li);
  }
}

function revealVotes() {
  sendMessage('revealVotes', {});
}

function resetVotes() {
  sendMessage('resetVotes', {});
}

function revealAllVotes() {
  alert('Votes revealed!');
}

function resetAllVotes() {
  alert('Votes reset!');
  updateVotes(currentStory, {});
}

document.addEventListener('DOMContentLoaded', initApp);
