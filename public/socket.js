// === socket.js ===
import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

let socket = null;
let selectedStoryIndex = null;
let roomId = null;
let userName = null;
let reconnectionEnabled = true;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectTimer = null;

// Stores last known room state
let lastKnownRoomState = {
    votesPerStory: {},
    votesRevealed: {},
    deletedStoryIds: [],
    tickets: [],
    userVotes: {}
};

export function initializeWebSocket(roomIdentifier, userNameValue, handleMessage) {
    if (!userNameValue) {
        console.error('[SOCKET] Cannot initialize without a username');
        return null;
    }

    roomId = roomIdentifier;
    userName = userNameValue;
    reconnectAttempts = 0;
    lastKnownRoomState = { // Reset on initialization
        votesPerStory: {},
        votesRevealed: {},
        deletedStoryIds: [],
        tickets: [],
        userVotes: {}
    };

    loadStateFromSessionStorage(roomIdentifier); // Load saved state

    socket = io({
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        query: { roomId: roomIdentifier, userName: userNameValue }
    });

    socket.on('connect', () => {
        console.log('[SOCKET] Connected to server with ID:', socket.id);
        reconnectAttempts = 0;
        clearTimeout(reconnectTimer);

        socket.emit('joinRoom', { roomId, userName });
        handleMessage({ type: 'connect' });

        restoreVotesFromStorage(roomIdentifier);
        requestSelectedStory();
    });

    socket.on('disconnect', (reason) => {
        console.log('[SOCKET] Disconnected from server. Reason:', reason);
        if ((reason === 'io server disconnect' || reconnectionEnabled) && reconnectAttempts < maxReconnectAttempts) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                if (!socket.connected) {
                    console.log('[SOCKET] Attempting reconnect after disconnect...');
                    socket.connect();
                }
            }, 3000);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
            handleMessage({ type: 'reconnection_failed' });
        }
        handleMessage({ type: 'disconnect', reason });
    });

    socket.on('reconnect', () => {
        console.log('[SOCKET] Reconnected to server');
        reconnectAttempts = 0;
        clearTimeout(reconnectTimer);
        socket.emit('joinRoom', { roomId, userName });
        handleMessage({ type: 'reconnect' });

        restoreVotesFromStorage(roomIdentifier);
        requestSelectedStory();

        setTimeout(() => {
            socket.emit('requestFullStateResync');
        }, 500);
    });

    socket.on('reconnect_attempt', (attempt) => {
        console.log(`[SOCKET] Reconnection attempt ${attempt}`);
        reconnectAttempts = attempt;
        handleMessage({ type: 'reconnect_attempt', attempt });
    });

    socket.on('reconnect_error', (error) => {
        console.error('[SOCKET] Reconnection error:', error);
        handleMessage({ type: 'error', error });
        if (reconnectAttempts < maxReconnectAttempts && reconnectionEnabled) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                if (!socket.connected && reconnectionEnabled) {
                    socket.connect();
                }
            }, 5000);
        }
    });

    socket.on('connect_error', (error) => {
        console.error('[SOCKET] Connection error:', error);
        handleMessage({ type: 'error', error });
        if (reconnectionEnabled && reconnectAttempts < maxReconnectAttempts) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                if (!socket.connected) {
                    socket.connect();
                }
            }, 3000);
        }
    });

    socket.on('addTicket', ({ ticketData }) => {
        console.log('[SOCKET] Received new ticket from another user:', ticketData);

        if (lastKnownRoomState.deletedStoryIds.includes(ticketData.id)) {
            console.log('[SOCKET] Ignoring ticket that was previously deleted:', ticketData.id);
            return;
        }

        if (!lastKnownRoomState.tickets.some(t => t.id === ticketData.id)) {
            lastKnownRoomState.tickets.push(ticketData);
        }

        handleMessage({ type: 'addTicket', ticketData });
    });    

    socket.on('allTickets', ({ tickets }) => {
        console.log('[SOCKET] Received all tickets:', tickets.length);

        const filteredTickets = tickets.filter(ticket =>
            !lastKnownRoomState.deletedStoryIds.includes(ticket.id)
        );

        lastKnownRoomState.tickets = filteredTickets || [];

        handleMessage({ type: 'allTickets', tickets: filteredTickets });
    });

    socket.on('userList', (users) => {
        handleMessage({ type: 'userList', users });
    });

    socket.on('votingSystemUpdate', data => {
        console.log('[SOCKET DEBUG] votingSystemUpdate received:', data);
        lastKnownRoomState.votingSystem = data.votingSystem;
        handleMessage({ type: 'votingSystemUpdate', ...data });
    });

    socket.on('syncCSVData', (csvData) => {
        console.log('[SOCKET] Received CSV data:', Array.isArray(csvData) ? csvData.length : 'invalid', 'rows');
        lastKnownRoomState.csvData = csvData;
        handleMessage({ type: 'syncCSVData', csvData });

        setTimeout(() => {
            console.log('[SOCKET] Notifying server that CSV data is loaded');
            if (socket && socket.connected) {
                socket.emit('csvDataLoaded');
            }
        }, 100);
    });

    socket.on('storySelected', ({ storyIndex }) => {
        console.log('[SOCKET] Story selected:', storyIndex);
        selectedStoryIndex = storyIndex;
        lastKnownRoomState.selectedIndex = storyIndex;
        handleMessage({ type: 'storySelected', storyIndex });

        if (socket && socket.connected) {
            const storyId = getCurrentStoryId();
            if (storyId) {
                requestStoryVotes(storyId);
            }
        }
    });

    socket.on('voteUpdate', ({ userId, vote, storyId }) => {
        if (lastKnownRoomState.deletedStoryIds.includes(storyId)) {
            console.log(`[SOCKET] Ignoring vote for deleted story: ${storyId}`);
            return;
        }

        console.log(`[SOCKET] Vote update received: ${userId} voted ${vote} for story ${storyId}`);

        if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
        if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
        lastKnownRoomState.votesPerStory[storyId][userId] = vote;

        if (socket && userId === socket.id) {
            if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
            lastKnownRoomState.userVotes[storyId] = vote;

            try {
                const votesData = JSON.stringify(lastKnownRoomState.userVotes);
                sessionStorage.setItem(`votes_${roomIdentifier}`, votesData);
                console.log(`[SOCKET] Saved user vote to session storage: ${storyId} = ${vote}`);
            } catch (err) {
                console.warn('[SOCKET] Could not save vote to sessionStorage:', err);
            }
        }

        handleMessage({ type: 'voteUpdate', userId, vote, storyId });
    });

    socket.on('storyVotes', ({ storyId, votes }) => {
        if (lastKnownRoomState.deletedStoryIds.includes(storyId)) {
            console.log(`[SOCKET] Ignoring votes for deleted story: ${storyId}`);
            return;
        }

        console.log(`[SOCKET] Received votes for story ${storyId}:`, Object.keys(votes).length);

        if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
        if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
        lastKnownRoomState.votesPerStory[storyId] = { ...(lastKnownRoomState.votesPerStory[storyId] || {}), ...votes };

        handleMessage({ type: 'storyVotes', storyId, votes });
    });

    socket.on('restoreUserVote', ({ storyId, vote }) => {
        if (lastKnownRoomState.deletedStoryIds.includes(storyId)) {
            console.log(`[SOCKET] Ignoring vote restoration for deleted story: ${storyId}`);
            return;
        }

        console.log(`[SOCKET] Restoring user vote for story ${storyId}: ${vote}`);

        if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
        if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
        lastKnownRoomState.votesPerStory[storyId][socket.id] = vote;


        if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
        lastKnownRoomState.userVotes[storyId] = vote;

        try {
            const votesData = JSON.stringify(lastKnownRoomState.userVotes);
            sessionStorage.setItem(`votes_${roomIdentifier}`, votesData);
            console.log(`[SOCKET] Saved restored vote to session storage: ${storyId} = ${vote}`);
        } catch (err) {
            console.warn('[SOCKET] Could not save restored vote to sessionStorage:', err);
        }

        if (socket && socket.connected) {
            console.log(`[SOCKET] Broadcasting restored vote to all users: ${storyId} = ${vote}`);
            socket.emit('castVote', { vote, targetUserId: socket.id, storyId });
        }

        handleMessage({ type: 'restoreUserVote', storyId, vote });
    });


    socket.on('votesRevealed', ({ storyId }) => {
        if (lastKnownRoomState.deletedStoryIds.includes(storyId)) {
            console.log(`[SOCKET] Ignoring vote reveal for deleted story: ${storyId}`);
            return;
        }

        if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
        lastKnownRoomState.votesRevealed[storyId] = true;

        try {
            const revealedData = JSON.stringify(lastKnownRoomState.votesRevealed);
            sessionStorage.setItem(`revealed_${roomIdentifier}`, revealedData);
        } catch (err) {
            console.warn('[SOCKET] Could not save revealed state to sessionStorage:', err);
        }

        handleMessage({ type: 'votesRevealed', storyId });
    });

    socket.on('deleteStory', ({ storyId }) => {
        console.log('[SOCKET] Story deletion event received:', storyId);

        if (!lastKnownRoomState.deletedStoryIds) lastKnownRoomState.deletedStoryIds = [];

        if (!lastKnownRoomState.deletedStoryIds.includes(storyId)) {
            lastKnownRoomState.deletedStoryIds.push(storyId);

            try {
                const deletedData = JSON.stringify(lastKnownRoomState.deletedStoryIds);
                sessionStorage.setItem(`deleted_${roomIdentifier}`, deletedData);
                console.log(`[SOCKET] Saved deleted story to session storage: ${storyId}`);
            } catch (err) {
                console.warn('[SOCKET] Could not save deleted story to sessionStorage:', err);
            }
        }

        lastKnownRoomState.tickets = lastKnownRoomState.tickets.filter(t => t.id !== storyId);

        if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
            delete lastKnownRoomState.userVotes[storyId];
            try {
                const votesData = JSON.stringify(lastKnownRoomState.userVotes);
                sessionStorage.setItem(`votes_${roomIdentifier}`, votesData);
            } catch (err) {
                console.warn('[SOCKET] Could not update userVotes in session storage:', err);
            }
        }

        delete lastKnownRoomState.votesPerStory[storyId];
        delete lastKnownRoomState.votesRevealed[storyId];

        handleMessage({ type: 'deleteStory', storyId });
    });

    socket.on('votesReset', ({ storyId }) => {
        if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
        if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};

        lastKnownRoomState.votesPerStory[storyId] = {};
        lastKnownRoomState.votesRevealed[storyId] = false;

        if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
            delete lastKnownRoomState.userVotes[storyId];

            try {
                const votesData = JSON.stringify(lastKnownRoomState.userVotes);
                sessionStorage.setItem(`votes_${roomIdentifier}`, votesData);
            } catch (err) {
                console.warn('[SOCKET] Could not update session storage after vote reset:', err);
            }
        }

        handleMessage({ type: 'votesReset', storyId });
    });

    socket.on('revealVotes', (votes) => {
        console.log('[SOCKET] Reveal votes event received (legacy)');
        handleMessage({ type: 'revealVotes', votes });
    });

    socket.on('storyChange', ({ story }) => {
        lastKnownRoomState.story = story;

        handleMessage({ type: 'storyChange', story });
    });

    socket.on('storyNavigation', ({ index }) => {
        handleMessage({ type: 'storyNavigation', index });
    });

    socket.on('exportData', (data) => {
        console.log('[SOCKET] Received export data with',
            data.stories ? data.stories.length : 0, 'stories and',
            data.votes ? Object.keys(data.votes).length : 0, 'vote sets');
        handleMessage({ type: 'exportData', data });
    });


    socket.on('resyncState', (state) => {
        console.log('[SOCKET] Received full state resync from server');

        if (state.deletedStoryIds) {
            lastKnownRoomState.deletedStoryIds = state.deletedStoryIds;
            saveDeletedStoriesToSession(roomIdentifier);
        }

        const filteredTickets = (state.tickets || []).filter(
            ticket => !lastKnownRoomState.deletedStoryIds.includes(ticket.id)
        );
        lastKnownRoomState.tickets = filteredTickets;

        lastKnownRoomState.votesPerStory = state.votesPerStory || {};
        lastKnownRoomState.votesRevealed = state.votesRevealed || {};

        const updatedState = { ...state, tickets: filteredTickets };
        handleMessage({ type: 'resyncState', ...updatedState });

        setTimeout(() => {
            restoreVotesFromStorage(roomIdentifier);
            requestSelectedStory();
        }, 300);
    });

    return socket;
}



function requestSelectedStory() {
    if (socket && socket.connected) {
        socket.emit('requestSelectedStory');
    }
}

function loadStateFromSessionStorage(roomIdentifier) {
    try {
        const storedDeletedStories = sessionStorage.getItem(`deleted_${roomIdentifier}`);
        if (storedDeletedStories) {
            lastKnownRoomState.deletedStoryIds = JSON.parse(storedDeletedStories);
        }

        const votesData = sessionStorage.getItem(`votes_${roomIdentifier}`);
        if (votesData) {
            lastKnownRoomState.userVotes = JSON.parse(votesData);
        }

        const revealedData = sessionStorage.getItem(`revealed_${roomIdentifier}`);
        if (revealedData) {
            lastKnownRoomState.votesRevealed = JSON.parse(revealedData);
        }
    } catch (err) {
        console.warn('[SOCKET] Error loading state from session storage:', err);
    }
}





function saveDeletedStoriesToSession(roomId) {
    try {
        sessionStorage.setItem(`deleted_${roomId}`, JSON.stringify(lastKnownRoomState.deletedStoryIds));
    } catch (error) {
        console.error("Error saving deleted stories to session storage:", error);
    }
}

function restoreVotesFromStorage(roomIdentifier) {
    if (!socket || !socket.connected || !lastKnownRoomState.userVotes) return;

    for (const storyId in lastKnownRoomState.userVotes) {
        if (!lastKnownRoomState.deletedStoryIds.includes(storyId)) {
            const vote = lastKnownRoomState.userVotes[storyId];
            socket.emit('restoreUserVote', { storyId, vote }); // Restore on server

            // Broadcast vote to other users
            socket.emit('castVote', { vote, targetUserId: socket.id, storyId });
        }
    }
}


export function emitDeleteStory(storyId) {
    if (!socket) return;

    socket.emit('deleteStory', { storyId });

    if (!lastKnownRoomState.deletedStoryIds.includes(storyId)) {
        lastKnownRoomState.deletedStoryIds.push(storyId);
        saveDeletedStoriesToSession(roomId);
    }

    if (lastKnownRoomState.userVotes && lastKnownRoomState.userVotes[storyId]) {
        delete lastKnownRoomState.userVotes[storyId];
        try {
            sessionStorage.setItem(`votes_${roomId}`, JSON.stringify(lastKnownRoomState.userVotes));
        } catch (err) {
            console.warn('[SOCKET] Could not update userVotes in session storage:', err);
        }
    }

    delete lastKnownRoomState.votesPerStory[storyId];
    delete lastKnownRoomState.votesRevealed[storyId];
}





export function emitCSVData(data) {
    if (socket) {
        console.log('[SOCKET] Sending CSV data:', data.length, 'rows');
        socket.emit('syncCSVData', data);
    }
}


export function emitStorySelected(index) {
    if (socket) {
        console.log('[SOCKET] Emitting storySelected:', index);
        socket.emit('storySelected', { storyIndex: index });
        selectedStoryIndex = index;

        lastKnownRoomState.selectedIndex = index;

        setTimeout(() => {
            const selectedCard = document.querySelector('.story-card.selected');
            if (selectedCard && socket && socket.connected) {
                const storyId = selectedCard.id;
                if (storyId && !lastKnownRoomState.deletedStoryIds.includes(storyId)) {
                    console.log(`[SOCKET] Requesting votes for selected story: ${storyId}`);
                    socket.emit('requestStoryVotes', { storyId });
                }
            }
        }, 100);

    }
}


export function emitVote(vote, targetUserId, storyId) {
    if (socket) {
        if (lastKnownRoomState.deletedStoryIds && lastKnownRoomState.deletedStoryIds.includes(storyId)) {
            console.log(`[SOCKET] Cannot vote for deleted story: ${storyId}`);
            return;
        }

        socket.emit('castVote', { vote, targetUserId, storyId });

        if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
        if (!lastKnownRoomState.votesPerStory[storyId]) lastKnownRoomState.votesPerStory[storyId] = {};
        lastKnownRoomState.votesPerStory[storyId][targetUserId] = vote;

        if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};
        lastKnownRoomState.userVotes[storyId] = vote;

        try {
            const votesData = JSON.stringify(lastKnownRoomState.userVotes);
            sessionStorage.setItem(`votes_${roomId}`, votesData);
        } catch (err) {
            console.warn('[SOCKET] Could not save vote to sessionStorage:', err);
        }
    }
}


export function requestStoryVotes(storyId) {
    if (socket && !lastKnownRoomState.deletedStoryIds.includes(storyId)) {
        console.log(`[SOCKET] Requesting votes for story: ${storyId}`);
        socket.emit('requestStoryVotes', { storyId });
    }
}


export function revealVotes(storyId) {
    if (socket && !lastKnownRoomState.deletedStoryIds.includes(storyId)) {
        socket.emit('revealVotes', { storyId });

        if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
        lastKnownRoomState.votesRevealed[storyId] = true;

        try {
            const revealedData = JSON.stringify(lastKnownRoomState.votesRevealed);
            sessionStorage.setItem(`revealed_${roomId}`, revealedData);
        } catch (err) {
            console.warn('[SOCKET] Could not save revealed state to sessionStorage:', err);
        }
    }
}


export function resetVotes(storyId) {
    if (socket) {
        socket.emit('resetVotes', { storyId });

        if (!lastKnownRoomState.votesPerStory) lastKnownRoomState.votesPerStory = {};
        if (!lastKnownRoomState.votesRevealed) lastKnownRoomState.votesRevealed = {};
        if (!lastKnownRoomState.userVotes) lastKnownRoomState.userVotes = {};

        lastKnownRoomState.votesPerStory[storyId] = {};
        lastKnownRoomState.votesRevealed[storyId] = false;

        if (lastKnownRoomState.userVotes[storyId]) {
            delete lastKnownRoomState.userVotes[storyId];

            try {
                const votesData = JSON.stringify(lastKnownRoomState.userVotes);
                sessionStorage.setItem(`votes_${roomId}`, votesData);
            } catch (err) {
                console.warn('[SOCKET] Could not update session storage after vote reset:', err);
            }
        }
    }
}

export function requestExport() {
    if (socket) {
        console.log('[SOCKET] Requesting vote data export');
        socket.emit('exportVotes');
    }
}


export function getCurrentStoryIndex() {
    return selectedStoryIndex;
}


function getCurrentStoryId() {
  if (selectedStoryIndex !== null && lastKnownRoomState.tickets) {
    if (selectedStoryIndex >= 0 && selectedStoryIndex < lastKnownRoomState.tickets.length) {
      return lastKnownRoomState.tickets[selectedStoryIndex]?.id || null;
    }
  }
  return null;
}


export function isConnected() {
    return socket && socket.connected;
}


export function emitAddTicket(ticketData) {
    if (socket) {
        if (lastKnownRoomState.deletedStoryIds &&
            lastKnownRoomState.deletedStoryIds.includes(ticketData.id)) {
            console.log(`[SOCKET] Cannot add previously deleted ticket: ${ticketData.id}`);
            return;
        }

        console.log('[SOCKET] Adding new ticket:', ticketData);
        socket.emit('addTicket', ticketData);

        if (!lastKnownRoomState.tickets) lastKnownRoomState.tickets = [];

        const existingIndex = lastKnownRoomState.tickets.findIndex(t => t.id === ticketData.id);
        if (existingIndex === -1) {
            lastKnownRoomState.tickets.push(ticketData);
        }
    }
}


export function reconnect() {
    if (!socket) {
        console.warn('[SOCKET] Cannot reconnect: no socket instance');
        return false;
    }
    if (!socket.connected && roomId && userName) {
        console.log('[SOCKET] Attempting to reconnect...');
        socket.connect();

        setTimeout(() => {
            if (socket && socket.connected) {
                console.log('[SOCKET] Requesting full state resync after manual reconnection');
                socket.emit('requestFullStateResync');

                setTimeout(() => {
                    restoreVotesFromStorage(roomId);
                }, 500);
            }
        }, 1000);

        return true;
    }

    return false;
}


export function setReconnectionEnabled(enable) {
    reconnectionEnabled = enable;
    console.log(`[SOCKET] Reconnection ${enable ? 'enabled' : 'disabled'}`);

    if (!enable) {
        clearTimeout(reconnectTimer);
    }
}


export function requestAllTickets() {
    if (socket) {
        console.log('[SOCKET] Requesting all tickets');
        socket.emit('requestAllTickets');
    }
}


export function requestFullStateResync() {
    if (socket && socket.connected) {
        console.log('[SOCKET] Manually requesting full state resync');
        socket.emit('requestFullStateResync');

        setTimeout(() => {
            restoreVotesFromStorage(roomId);
        }, 500);

    }
}



export function setMaxReconnectAttempts(max) {
    if (typeof max === 'number' && max > 0) {
        maxReconnectAttempts = max;
        console.log(`[SOCKET] Max reconnection attempts set to ${max}`);
    }
}


export function getReconnectionStatus() {
    return {
        enabled: reconnectionEnabled,
        attempts: reconnectAttempts,
        maxAttempts: maxReconnectAttempts,
        connected: socket ? socket.connected : false
    };
}


export function getLastKnownRoomState() {
    return lastKnownRoomState;
}


export function getUserVotes() {
    return lastKnownRoomState.userVotes || {};
}


export function cleanup() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }

    clearTimeout(reconnectTimer);
    lastKnownRoomState = {
        votesPerStory: {},
        votesRevealed: {},
        deletedStoryIds: [],
        tickets: [],
        userVotes: {}
    };
    reconnectAttempts = 0;
    roomId = null;
    userName = null;
    selectedStoryIndex = null;
    console.log('[SOCKET] Socket connection cleaned up');

    if (roomId) {
        try {
            sessionStorage.removeItem(`votes_${roomId}`);
            sessionStorage.removeItem(`revealed_${roomId}`);
            sessionStorage.removeItem(`deleted_${roomId}`);
        } catch (err) {
            console.warn('[SOCKET] Error clearing session storage during cleanup:', err);
        }
    }
}
