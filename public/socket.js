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
    console.log('[socket] userList:', users);
    handleMessage({ type: 'userList', users });
  });

  socket.on('syncCSVData', (csvData) => {
    console.log('[socket] syncCSVData');
    handleMessage({ type: 'syncCSVData', csvData });
  });

  socket.on('storySelected', ({ storyIndex }) => {
    console.log('[socket] storySelected:', storyIndex);
    selectedStoryIndex = storyIndex;
    handleMessage({ type: 'storySelected', storyIndex });
  });

  socket.on('voteUpdate', ({ userId, vote, storyIndex }) => {
    console.log('[socket] voteUpdate:', { userId, vote, storyIndex });
    handleMessage({ type: 'voteUpdate', userId, vote, storyIndex });
  });

  socket.on('revealVotes', (votes) => {
    console.log('[socket] revealVotes:', votes);
    handleMessage({ type: 'revealVotes', votes });
  });

  socket.on('storyChange', ({ story }) => {
    console.log('[socket] storyChange:', story);
    handleMessage({ type: 'storyChange', story });
  });

  socket.on('storyNavigation', ({ index }) => {
    console.log('[socket] storyNavigation:', index);
    handleMessage({ type: 'storyNavigation', index });
  });
}

export function emitCSVData(data) {
  if (socket) {
    console.log('[emit] syncCSVData');
    socket.emit('syncCSVData', data);
  }
}

export function emitStorySelected(index) {
  if (socket) {
    console.log('[emit] storySelected:', index);
    socket.emit('storySelected', { storyIndex: index });
  }
}
