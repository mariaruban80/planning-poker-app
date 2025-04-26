import { initializeWebSocket, sendMessage, getRoomData } from './socket.js';

let currentStory = null;

// Initialize the app
function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId');

  if (!roomId) {
    alert("No Room ID found in the URL!");
    return;
  }

  // Check if userName already exists in sessionStorage
  let userName = sessionStorage.getItem('userName');
  
  // If not, prompt for the userName
  if (!userName) {
    userName = prompt('Enter your name:') || `User-${Math.floor(Math.random() * 1000)}`;
    sessionStorage.setItem('userName', userName);
  }

  // Initialize WebSocket connection with the roomId and userName
  initializeWebSocket(roomId, userName, handleIncomingMessage);

  document.getElementById('vote-buttons').addEventListener('click', handleVoteClick);
  document.getElementById('revealVotesBtn').addEventListener('click', revealVotes);
  document.getElementById('resetVotesBtn').addEventListener('click', resetVotes);
  document.getElementById('addMemberBtnr').addEventListener('click', addMember);

  // Update user list
  updateUserList(getRoomData().users);
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

// Add a new member to the room
function addMember() {
  const memberName = prompt('Enter the name of the new member:');
  if (memberName) {
    sendMessage('addMember', { memberName });
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initApp);
