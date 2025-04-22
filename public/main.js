function renderUI() {
  const roomId = getRoomId(); // Get the current room ID
  const user = getUserId(); // Get the current user ID
  const currentStory = getCurrentStory(); // Get the current selected story
  
  // Render the user list
  renderUserList(roomId);

  // Render the stories palette (ensure it shows the available stories)
  renderStoryPalette();

  // Render the selected story and its votes
  if (currentStory) {
    renderStory(currentStory);
    renderVotes(currentStory);
  }
  
  // Render the file upload UI
  renderFileUploadUI(roomId);

  // Other UI updates, such as voting buttons and other controls
}

function renderUserList(roomId) {
  const userListElement = document.getElementById('userList');
  if (!userListElement) return;

  // Get the current user list from the server (via socket event or saved state)
  socket.on('userList', ({ users }) => {
    // Clear the current list and append the updated list of users
    userListElement.innerHTML = '';
    users.forEach(user => {
      const userElement = document.createElement('div');
      userElement.textContent = user;
      userListElement.appendChild(userElement);
    });
  });
}

function renderStoryPalette() {
  const storyPalette = document.getElementById('storyPalette');
  if (!storyPalette) return;

  // Clear the current stories and add new ones
  storyPalette.innerHTML = '';

  // Get the available stories (from a predefined list or a server-side list)
  const availableStories = ['Story 1', 'Story 2', 'Story 3', 'Story 4']; // Example

  availableStories.forEach(story => {
    const storyButton = document.createElement('button');
    storyButton.textContent = story;
    storyButton.onclick = () => selectStory(story);
    storyPalette.appendChild(storyButton);
  });
}

function renderStory(story) {
  const storyElement = document.getElementById('selectedStory');
  if (!storyElement) return;

  storyElement.textContent = `Selected Story: ${story}`;
}

function renderVotes(story) {
  const votesElement = document.getElementById('voteDisplay');
  if (!votesElement) return;

  // Get the current votes for the story
  socket.emit('voteUpdate', { story, votes: getVotesForStory(story) });

  // Here you can dynamically update the votes UI based on the current state
  // (e.g., updating the vote display with users' votes)
}

function renderFileUploadUI(roomId) {
  const uploadButton = document.getElementById('uploadButton');
  if (!uploadButton) return;

  uploadButton.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      // Emit file upload event to the server
      socket.emit('fileUploaded', { file, roomId });

      // Show a message or update the UI with the uploaded file information
      const fileNameDisplay = document.getElementById('fileNameDisplay');
      fileNameDisplay.textContent = `Uploaded file: ${file.name}`;
    }
  });
}

// Ensure socket event listeners are correctly handling real-time updates
socket.on('fileUploaded', ({ file }) => {
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  if (fileNameDisplay) {
    fileNameDisplay.textContent = `File uploaded: ${file.name}`;
  }
});

socket.on('voteUpdate', ({ story, votes }) => {
  // Update the votes UI dynamically whenever vote updates occur
  renderVotes(story);
});
