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

  console.log("User Name:", userName);  // Debugging log to verify user name
  
  // Initialize WebSocket (Socket.IO) connection with roomId and userName
  initializeWebSocket(roomId, userName, handleIncomingMessage);

  // Initialize buttons and event listeners
  setupButtonListeners();
}

// Show the invite modal
export function showInviteModal() {
  const modal = document.getElementById('inviteModal');
  modal.style.display = 'flex';  // Show the modal
}

// Hide the invite modal
export function hideInviteModal() {
  const modal = document.getElementById('inviteModal');
  modal.style.display = 'none';  // Hide the modal
}

// Copy the invite link to clipboard
export function copyInviteLink() {
  const inviteLink = document.getElementById('inviteLink');
  inviteLink.select();
  document.execCommand('copy');
  alert('Invite link copied to clipboard!');
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

  const addMemberBtn = document.getElementById('addMemberBtn');
  if (addMemberBtn) {
    addMemberBtn.addEventListener('click', addMember);
  }

  // Attach vote buttons
  document.querySelectorAll('.vote-btn').forEach(button => {
    button.addEventListener('click', handleVoteClick);
  });
}

// Handle incoming WebSocket messages
function handleIncomingMessage(msg) {
  if (!msg || !msg.type) {
    console.warn('Invalid message received:', msg);
    return;
  }

  switch (msg.type) {
    case 'userList':
      updateUserList(msg.users);
      break;
    case 'voteUpdate':
      updateVote(msg);
      break;
    case 'storyChange':
      currentStory = msg.story;
      updateStoryDisplay();
      break;
    case 'revealVotes':
      revealVotes();
      break;
    case 'resetVotes':
      resetVotes();
      break;
    default:
      console.warn('Unhandled message type:', msg.type);
  }
}

// Update user list
function updateUserList(users) {
  const userListElement = document.getElementById('userList');
  userListElement.innerHTML = '';  // Clear current list

  users.forEach(user => {
    const userDiv = document.createElement('div');
    userDiv.textContent = user;
    userListElement.appendChild(userDiv);
  });
}

// Update the story display
function updateStoryDisplay() {
  const storyInfo = document.getElementById('story-info');
  if (currentStory) {
    storyInfo.textContent = `Current story: ${currentStory}`;
  } else {
    storyInfo.textContent = 'No story selected.';
  }
}

// Handle vote click
function handleVoteClick(event) {
  const vote = event.target.textContent;
  sendMessage('vote', { story: currentStory, vote });
}

// Reveal votes
function revealVotes() {
  sendMessage('revealVotes', {});
}

// Reset votes
function resetVotes() {
  sendMessage('resetVotes', {});
}

// Add a new member
function addMember() {
  const userName = prompt('Enter new member name:');
  if (userName) {
    sendMessage('addMember', { userName });
  }
}

// Initialize app when the page loads
window.addEventListener('load', initApp);
