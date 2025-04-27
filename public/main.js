// Function to get roomId from URL
function getRoomIdFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  let roomId = urlParams.get('roomId'); // This should retrieve the roomId query parameter
  console.log("Room ID from URL:", roomId);

  if (!roomId) {
    alert('No room ID in the URL!');
    return null;
  }

  return roomId;
}

// Function to append roomId to the URL if not already present
function appendRoomIdToURL(roomId) {
  if (!roomId) {
    console.error("Room ID is required!");
    return;
  }

  // Update the URL with the roomId query parameter
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('roomId', roomId); // Set the roomId in the URL
  window.history.pushState(null, '', currentUrl.toString()); // Update the browser URL without reloading the page
}

// Function to initialize WebSocket connection
function initializeApp(roomId) {
  const userName = prompt("Enter your username:");
  if (userName) {
    // Now initialize WebSocket connection with roomId
    initializeWebSocket(roomId, userName, (message) => {
      console.log("Received message:", message);
      // Handle the incoming message (e.g., update UI)
    });
  } else {
    alert("Username is required!");
  }
}

// Check if the roomId is in the URL, if not, generate one and append it to the URL
let roomId = getRoomIdFromURL();

if (!roomId) {
  // If there's no roomId in the URL, generate a new one
  roomId = 'room-' + Math.floor(Math.random() * 10000); // Generate a random room ID
  appendRoomIdToURL(roomId); // Append the generated roomId to the URL
}

console.log("Room ID after update:", roomId);
initializeApp(roomId); // Initialize app with the roomId

// Function to show the invite modal
function showInviteModal() {
  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.top = '50%';
  modal.style.left = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  modal.style.padding = '20px';
  modal.style.backgroundColor = 'white';
  modal.style.border = '1px solid #000';
  modal.innerHTML = `
    <h3>Invite URL</h3>
    <p>Share this link: <a href="${window.location.href}">${window.location.href}</a></p>
    <button onclick="closeInviteModal()">Close</button>
  `;
  document.body.appendChild(modal);
}

// Function to close the invite modal
function closeInviteModal() {
  const modal = document.querySelector('div');
  if (modal) modal.remove();
}

// Example button in HTML to trigger the invite modal
const inviteButton = document.querySelector('#inviteButton'); // Make sure this button exists in the HTML
if (inviteButton) {
  inviteButton.onclick = showInviteModal;
}
