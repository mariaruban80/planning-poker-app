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

// Get the roomId from URL
const roomId = getRoomIdFromURL();

// Check if roomId is valid before initializing WebSocket
if (roomId) {
  // Example initialization for WebSocket
  const userName = prompt("Enter your username:");
  if (userName) {
    initializeWebSocket(roomId, userName, (message) => {
      console.log("Received message:", message);
      // Handle the incoming message (e.g., update UI)
    });
  } else {
    alert("Username is required!");
  }
}

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
