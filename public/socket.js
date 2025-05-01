// === socket.js ===
import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

let socket = null;
let selectedStoryIndex = null;

export function initializeWebSocket(roomId, userName, handleMessage) {
  socket = io({
    transports: ['websocket'],
    query: { roomId, userName }
  });

  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('joinRoom', { roomId, userName });
  });

  socket.on('userList', (users) => {
    handleMessage({ type: 'userList', users });
  });

  socket.on('syncCSVData', (csvData) => {
    handleMessage({ type: 'syncCSVData', csvData });
  });

  socket.on('storySelected', ({ storyIndex }) => {
    selectedStoryIndex = storyIndex;
    handleMessage({ type: 'storySelected', storyIndex });
  });

  //socket.on('voteUpdate', (payload) => {
   // handleMessage({ type: 'voteUpdate', ...payload });
  //});
//socket.on('voteUpdate', ({ userId, vote }) => {
    // Update UI badges directly
  //  const badge = document.querySelector(`#user-${userId} .vote-badge`) ||
    //              document.querySelector(`#user-circle-${userId} .vote-badge`);
    //if (badge) {
     // badge.textContent = vote;
    //}

    // Also forward to handler if needed
   // handleMessage({ type: 'voteUpdate', userId, vote });
  //});
  socket.on('voteUpdate', ({ userId, vote, storyIndex }) => {
    //if (storyIndex !== selectedStoryIndex) return; // Ignore if not the current story
handleMessage({ type: 'voteUpdate', userId, vote, storyIndex });

    const badge = document.querySelector(`#user-${userId} .vote-badge`) ||
                  document.querySelector(`#user-circle-${userId} .vote-badge`);
    if (badge) badge.textContent = vote;

    const avatar = document.querySelector(`#user-circle-${userId} img.avatar`);
    if (avatar) avatar.style.backgroundColor = '#c1e1c1';

    handleMessage({ type: 'voteUpdate', userId, vote, storyIndex });
  });

  socket.on('revealVotes', (votes) => {
    handleMessage({ type: 'revealVotes', votes });
  });
  socket.on('revealVotes', (votes) => {
    handleMessage({ type: 'revealVotes', votes });
  });

  socket.on('storyChange', ({ story }) => {
    handleMessage({ type: 'storyChange', story });
  });

  socket.on('storyNavigation', ({ index }) => {
    handleMessage({ type: 'storyNavigation', index });
  });
}

export function emitCSVData(data) {
  if (socket) socket.emit('syncCSVData', data);
}

export function emitStorySelected(index) {
  if (socket) socket.emit('storySelected', { storyIndex: index });
}
