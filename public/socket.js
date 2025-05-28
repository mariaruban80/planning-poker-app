import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

let socket = null;
let roomId = null;
let userName = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectionEnabled = true;

export function initializeWebSocket(roomIdentifier, userNameValue, handleMessage) {
  roomId = roomIdentifier;
  userName = userNameValue;
  reconnectAttempts = 0;

  socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: maxReconnectAttempts,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    query: { roomId, userName }
  });

  // Standard listeners
  socket.on('connect', () => {
    console.log('[SOCKET] Connected as', socket.id);
    socket.emit('joinRoom', { roomId, userName });
    handleMessage({ type: 'connect' });
  });

  socket.on('reconnect', () => {
    console.log('[SOCKET] Reconnected');
    socket.emit('joinRoom', { roomId, userName });
    handleMessage({ type: 'reconnect' });
  });

  socket.on('deleteStory', ({ storyId }) => {
    console.log('[SOCKET] Story deleted:', storyId);
    handleMessage({ type: 'deleteStory', storyId });
  });

  socket.on('resyncState', ({ tickets, votesPerStory, votesRevealed }) => {
    console.log('[SOCKET] Resync received');
    handleMessage({ type: 'resyncState', tickets, votesPerStory, votesRevealed });
  });

  socket.on('storyVotes', ({ storyId, votes }) => {
    handleMessage({ type: 'storyVotes', storyId, votes });
  });

  socket.on('votesRevealed', ({ storyId }) => {
    handleMessage({ type: 'votesRevealed', storyId });
  });

  socket.on('voteUpdate', ({ userId, vote, storyId }) => {
    handleMessage({ type: 'voteUpdate', userId, vote, storyId });
  });

  // Ensure all story votes are re-requested on reconnect
  socket.on('reconnect', () => {
    setTimeout(() => {
      handleMessage({ type: 'reconnectedRequestVotes' });
    }, 500);
  });

  return socket;
}

export function emitVote(vote, userId, storyId) {
  if (socket) socket.emit('castVote', { vote, targetUserId: userId, storyId });
}

export function emitDeleteStory(storyId, isCsvStory = false, csvIndex = null) {
  if (!socket) return;
  const payload = { storyId };
  if (isCsvStory) {
    payload.isCsvStory = true;
    payload.csvIndex = csvIndex;
  }
  socket.emit('deleteStory', payload);
}

export function requestStoryVotes(storyId) {
  if (socket) socket.emit('requestStoryVotes', { storyId });
}

export function emitAddTicket(ticketData) {
  if (socket) socket.emit('addTicket', ticketData);
}

export function requestAllTickets() {
  if (socket) socket.emit('requestAllTickets');
}

export function setReconnectionEnabled(enable) {
  reconnectionEnabled = enable;
}
