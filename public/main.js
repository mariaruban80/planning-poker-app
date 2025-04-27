import { initializeWebSocket, sendMessage, getRoomData } from './socket.js';

let currentStory = null;

// Initialize the app
function initApp() {
  // Extract roomId from the URL
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId');

  // Debugging log to verify roomId extraction
  console.log("Room ID from URL:", roomId);

  // If no roomId is found, alert the user and exit
  if (!roomId) {
    alert("No Room ID found in the URL!");
    return;
  }

  // Check if userName already exists in sessionStorage
  let userName = sessionStorage.getItem('userName');
  
  if (!userName) {
    userName = prompt('Enter your name:') || `User-${Math.floor(Math.random() * 1000)}`;
    sessionStorage.setItem('userName', userName);
  }

  // Initialize WebSocket (Socket.IO) connection with roomId and userName
  initializeWebSocket(roomId, userName, handleIncomingMessage);

  // Initialize buttons and event listeners
  setupButtonListeners();
}

// Setup button event listeners
function setupButtonListeners() {
  const revealVotesBtn = document.getElementById('revealVotesBtn');
  if (revealVotesBtn) {
    revealVotesBtn.addEventListener('click', revealVotes);
  }

  const resetVotesBtn = document.getElementById('resetVotesBtn');
  if (resetVotesBtn) {
    resetVotesBtn.addEventListener('click', resetVotes);
  }

  const addMemberBtnr = document.getElementById('addMemberBtnr');
  if (addMemberBtnr) {
    addMemberBtnr.addEventListener('click', addMember);
  }

  // Attach vote buttons
  document.querySelectorAll('.vote-btn').forEach(button => {
    button.addEventListener('click', handleVoteClick);
  });
}

// Handle incoming WebSocket messages
function handleIncomingMessage(msg) {
  if (!msg || !msg.type) {
    console.warn('Invalid message format:', msg);
    return;
  }

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
      console.warn('Unhandled message type:', msg.type);
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

// Update the current story
function updateStory(story) {
  currentStory = story;
  const currentStoryElement = document.getElementById('current-story');
  if (currentStoryElement) {
    currentStoryElement.textContent = `Current Story: ${story}`;
  }
}

// Update user list UI
function updateUserList(users = []) {
  const userList = document.getElementById('user-list');
  if (userList) {
    userList.innerHTML = '';
    users.forEach(user => {
      const li = document.createElement('li');
      li.textContent = user;
      userList.appendChild(li);
    });
  }
}

// Update votes UI
function updateVotes(story, votes = {}) {
  const voteList = document.getElementById('vote-list');
  if (voteList) {
    voteList.innerHTML = '';
    for (const [user, vote] of Object.entries(votes)) {
      const li = document.createElement('li');
      li.textContent = `${user}: ${vote}`;
      voteList.appendChild(li);
    }
  }
}

// Reveal votes
function revealVotes() {
  sendMessage('revealVotes', {});
}

// Reset votes
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

// Add a new member manually
function addMember() {
  const memberName = prompt('Enter the name of the new member:');
  if (memberName) {
    sendMessage('addMember', { memberName });
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initApp);
