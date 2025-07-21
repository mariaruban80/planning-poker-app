// Get username from sessionStorage (already set from main.html or by index.html prompt)
let userName = sessionStorage.getItem('userName');
let processingCSVData = false;
// Import socket functionality
import { initializeWebSocket, emitCSVData, requestStoryVotes, emitAddTicket,emitUpdateTicket,getUserVotes } from './socket.js'; 

// Track deleted stories client-side
let deletedStoryIds = new Set();

let preservedManualTickets = [];
let deleteConfirmationInProgress = false;
let hasReceivedStorySelection = false;
window.currentVotesPerStory = {}; // Ensure global reference for UI
let heartbeatInterval; // Store interval reference for cleanup

window.notifyStoriesUpdated = function() {
  const storyList = document.getElementById('storyList');
  if (!storyList) return;

  // Collect current stories from DOM
  const allTickets = [];
  const storyCards = storyList.querySelectorAll('.story-card');

  storyCards.forEach((card, index) => {
    const titleElement = card.querySelector('.story-title');
    if (titleElement) {
      allTickets.push({
        id: card.id,
        text: titleElement.textContent
      });
    }
  });

  // Update our manually added tickets tracker
  preservedManualTickets = allTickets.filter(ticket =>
    ticket.id && !ticket.id.includes('story_csv_')
  );
  console.log(`Preserved ${preservedManualTickets.length} manual tickets`);
};

/**
 * FIX: Only emit to server, do NOT call addTicketToUI here (prevents duplicate tickets as host).
 */
window.addTicketFromModal = function(ticketData) {
  if (!ticketData || !ticketData.id || !ticketData.text) return;

  // Don't add if this story is in our deleted set
  if (deletedStoryIds.has(ticketData.id)) {
    console.log('[MODAL] Cannot add previously deleted ticket:', ticketData.id);
    return;
  }

  console.log('[MODAL] Adding ticket from modal:', ticketData);

  // Emit to server for synchronization
  if (typeof emitAddTicket === 'function') {
    emitAddTicket(ticketData);
  } else if (socket) {
    socket.emit('addTicket', ticketData);
  }

  // NO addTicketToUI here!

  // Store in manually added tickets
  manuallyAddedTickets.push(ticketData);
};

window.updateTicketFromModal = function(ticketData) {
  if (!ticketData || !ticketData.id || !ticketData.text) return;

  console.log('[EDIT] Updating ticket:', ticketData);

  // Update the DOM
  const storyCard = document.getElementById(ticketData.id);
  if (storyCard) {
    const storyTitle = storyCard.querySelector('.story-title');
    if (storyTitle) {
      storyTitle.textContent = ticketData.text;
    }
  }

  // Emit to server for synchronization
  if (socket) {
    socket.emit('updateTicket', ticketData);
  }

  // Update local tickets array if it exists
  if (typeof manuallyAddedTickets !== 'undefined') {
    const ticketIndex = manuallyAddedTickets.findIndex(t => t.id === ticketData.id);
    if (ticketIndex !== -1) {
      manuallyAddedTickets[ticketIndex] = ticketData;
    }
  }
};
function addHostMenu(storyItem, storyId = null, storyTextElement = null) {
  const menuTrigger = storyItem.querySelector('.menu-trigger');
  const menuDropdown = storyItem.querySelector('.menu-dropdown');
  const editStoryItem = storyItem.querySelector('.edit-story');
  const deleteStoryItem = storyItem.querySelector('.delete-story');
  const storyIdentifier = storyId || storyItem.id;

  if (!menuTrigger || !menuDropdown) {
    console.warn('[addHostMenu] Menu trigger or dropdown not found for', storyIdentifier);
    return;
  }

  menuTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.style.display = menuDropdown.style.display === 'block' ? 'none' : 'block';
  });

  if (editStoryItem) {
    editStoryItem.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentText = storyTextElement?.textContent || '';
      if (typeof window.showEditTicketModal === 'function') {
        window.showEditTicketModal(storyIdentifier, currentText);
      }
      menuDropdown.style.display = 'none';
    });
  } else {
    console.warn('[addHostMenu] Edit menu item not found for', storyIdentifier);
  }

  if (deleteStoryItem) {
    deleteStoryItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof deleteStory === 'function') {
        deleteStory(storyIdentifier);
      }
      menuDropdown.style.display = 'none';
    });
  } else {
    console.warn('[addHostMenu] Delete menu item not found for', storyIdentifier);
  }

  if (storyTextElement && typeof storyTextElement.addEventListener === 'function') {
    storyTextElement.addEventListener('input', (e) => {
      console.log('[addHostMenu] Story title edited:', e.target.value);
    });
  }
}

function handleSocketMessage(message) {
  const eventType = message.type;
  switch(eventType) {
    case 'userList':
      // Update the user list when server sends an updated list
      if (Array.isArray(message.users)) {
        updateUserList(message.users);
      }
      break;
    case 'addTicket':
      // FIX: Only add to UI in response to socket event
      if (message.ticketData) {
        if (deletedStoryIds.has(message.ticketData.id)) {
          console.log('[TICKET] Ignoring deleted ticket:', message.ticketData.id);
          return;
        }
        addTicketToUI(message.ticketData, false);
        applyGuestRestrictions();
      }
      break;
    case 'votingSystemUpdate':
      console.log('[DEBUG] Got voting system update:', message.votingSystem);
      sessionStorage.setItem('votingSystem', message.votingSystem);
      setupPlanningCards(); // Regenerate cards
      break;

    case 'resyncState':
      // Update local deletedStoryIds with array from server
      if (Array.isArray(message.deletedStoryIds)) {
        message.deletedStoryIds.forEach(id => {
          if (!deletedStoryIds.has(id)) {
            deletedStoryIds.add(id);
          }
        });
        
        // Save to session storage
        const roomId = getRoomIdFromURL();
        saveDeletedStoriesToStorage(roomId);
      }
      
      // Filter tickets by deleted status and process them
      const filteredTickets = (message.tickets || []).filter(ticket => 
        !deletedStoryIds.has(ticket.id)
      );
      
      processAllTickets(filteredTickets);
      
      // Update vote state
      if (message.votesPerStory) {
        for (const [storyId, votes] of Object.entries(message.votesPerStory)) {
          // Skip deleted stories
          if (deletedStoryIds.has(storyId)) continue;
          
          if (!votesPerStory[storyId]) {
            votesPerStory[storyId] = {};
          }
          
          // Merge in the votes from server
          votesPerStory[storyId] = { ...votes };
          window.currentVotesPerStory = votesPerStory;
        }
      }
      
      // Update revealed status
      if (message.votesRevealed) {
        for (const storyId in message.votesRevealed) {
          // Skip deleted stories
          if (deletedStoryIds.has(storyId)) continue;
          
          votesRevealed[storyId] = message.votesRevealed[storyId];
          
          // If this is the current story and votes are revealed, update UI
          const currentId = getCurrentStoryId();
          if (votesRevealed[storyId] && storyId === currentId) {
            const storyVotes = votesPerStory[storyId] || {};
            applyVotesToUI(storyVotes, false);
            handleVotesRevealed(storyId, storyVotes);
          }
        }
      }
      
      // Also refresh the current story votes after a short delay
      const currentStoryId = getCurrentStoryId();
      if (currentStoryId && socket && socket.connected) {
        setTimeout(() => {
          socket.emit('requestStoryVotes', { storyId: currentStoryId });
        }, 300);
      }
      break;

    case 'restoreUserVote':
      if (message.storyId && message.vote) {
        // Skip for deleted stories
        if (deletedStoryIds.has(message.storyId)) {
          console.log(`[VOTE] Ignoring vote restoration for deleted story: ${message.storyId}`);
          return;
        }
        
        // Get the current user's ID
        const currentUserId = socket.id;
        
        // Update local state
        if (!votesPerStory[message.storyId]) {
          votesPerStory[message.storyId] = {};
        }
        votesPerStory[message.storyId][currentUserId] = message.vote;
        
        // Update UI if this is the current story
        const currentId = getCurrentStoryId();
        if (message.storyId === currentId) {
          updateVoteVisuals(currentUserId, votesRevealed[message.storyId] ? message.vote : '👍', true);
        }
        
        // Also explicitly broadcast this vote to ensure other users see it too
        if (socket && socket.connected) {
          socket.emit('castVote', {
            vote: message.vote,
            targetUserId: currentUserId,
            storyId: message.storyId
          });
        }
      }
      break;

    case 'allTickets':
      // Handle receiving all tickets (used when joining a room)
      if (Array.isArray(message.tickets)) {
        // Filter out any deleted tickets
        const filteredTickets = message.tickets.filter(ticket => !deletedStoryIds.has(ticket.id));
        console.log(`[SOCKET] Received ${filteredTickets.length} valid tickets (filtered from ${message.tickets.length})`);
        processAllTickets(filteredTickets);
        applyGuestRestrictions();
      }
      break;
      
    case 'userJoined':
      // Individual user joined - could update existing list
      break;
      
    case 'userLeft':
      // Handle user leaving
      break;
      
    case 'voteReceived':
    case 'voteUpdate':
      // Skip processing for deleted story
      if (message.storyId && deletedStoryIds.has(message.storyId)) {
        console.log(`[VOTE] Ignoring vote for deleted story: ${message.storyId}`);
        return;
      }
      
      // Handle vote received
      if (message.userId && message.vote) {
        if (!votesPerStory[message.storyId]) {
          votesPerStory[message.storyId] = {};
        }
        votesPerStory[message.storyId][message.userId] = message.vote;
        
        // Update UI if this is the current story
        const currentStoryId = getCurrentStoryId();
        if (message.storyId === currentStoryId) {
          // Display either actual vote or thumbs up depending on reveal status
          updateVoteVisuals(message.userId, votesRevealed[message.storyId] ? message.vote : '👍', true);
        }
      }
      break;
      
    case 'deleteStory':
      // Handle story deletion from another user
      if (message.storyId) {
        console.log('[SOCKET] Story deletion received for ID:', message.storyId);
        
        // Track locally
        deletedStoryIds.add(message.storyId);
        
        // Save to session storage
        const roomId = getRoomIdFromURL();
        saveDeletedStoriesToStorage(roomId);
        
        // Get the story element
        const storyCard = document.getElementById(message.storyId);
        if (storyCard) {
          // Get the index for potential reselection
          const index = parseInt(storyCard.dataset.index);
          
          console.log(`[SOCKET] Removing story card ${message.storyId} from DOM`);
          // Remove the story
          storyCard.remove();
          
          // Renumber remaining stories
          normalizeStoryIndexes();
          
          // If this was the current story, select another one
          if (index === currentStoryIndex) {
            const storyList = document.getElementById('storyList');
            if (storyList && storyList.children.length > 0) {
              const newIndex = Math.min(index, storyList.children.length - 1);
              selectStory(newIndex, false); // Don't emit selection to avoid loops
            }
          }
          // Update card interactions after DOM changes
          setupStoryCardInteractions();
        } else {
          console.warn(`[SOCKET] Could not find story card ${message.storyId} to delete`);
        }
        
        // Clean up votes for this story
        if (votesPerStory[message.storyId]) {
          delete votesPerStory[message.storyId];
          console.log(`[SOCKET] Removed votes for deleted story ${message.storyId}`);
        }
        if (votesRevealed[message.storyId]) {
          delete votesRevealed[message.storyId];
        }
      }
      break;
      
    case 'votesRevealed':
      console.log('[DEBUG] Received votesRevealed event', message);
      
      // Skip processing for deleted story
      if (message.storyId && deletedStoryIds.has(message.storyId)) {
        console.log(`[VOTE] Ignoring vote reveal for deleted story: ${message.storyId}`);
        return;
      }
      
      const storyId = message.storyId;
      
      if (storyId) {
        // Check if we've already revealed this story - IMPORTANT NEW CHECK
        if (votesRevealed[storyId] === true) {
          console.log(`[VOTE] Votes already revealed for story ${storyId}, not triggering effects again`);
          return; // Skip the rest to avoid duplicate animations
        }
        
        // Store the revealed state
        votesRevealed[storyId] = true;
        console.log(`[DEBUG] Set votesRevealed[${storyId}] = true`);
        
        // Get the votes for this story
        const votes = votesPerStory[storyId] || {};
        console.log(`[DEBUG] Votes for story ${storyId}:`, JSON.stringify(votes));
        
        // This is where we display the actual vote values
        applyVotesToUI(votes, false);
        
        // Hide planning cards for this story
        const planningCardsSection = document.querySelector('.planning-cards-section');
        if (planningCardsSection) {
          planningCardsSection.classList.add('hidden-until-init');
          planningCardsSection.style.display = 'none';
        }
        
        // Show statistics  
        handleVotesRevealed(storyId, votes);
        
        // Trigger emoji burst for fun effect - ONLY ONCE
        triggerGlobalEmojiBurst();
        
        // Log action for debugging
        console.log(`[VOTE] Votes revealed for story: ${storyId}, stats should now be visible`);
      }
      break;
      
    case 'votesReset':
      // Skip processing for deleted story
      if (message.storyId && deletedStoryIds.has(message.storyId)) {
        console.log(`[VOTE] Ignoring vote reset for deleted story: ${message.storyId}`);
        return;
      }
      
      // Handle votes reset
      if (message.storyId) {
        // Clear votes for the specified story
        if (votesPerStory[message.storyId]) {
          votesPerStory[message.storyId] = {};
        }
        
        // Reset revealed status
        votesRevealed[message.storyId] = false;
        
        // Always show planning cards and hide stats for this story
        const planningCardsSection = document.querySelector('.planning-cards-section');
        if (planningCardsSection) {
          planningCardsSection.classList.remove('hidden-until-init');
          planningCardsSection.style.display = 'block';
        }
        
        // Hide all stats containers that match this story ID
        const statsContainers = document.querySelectorAll(`.vote-statistics-container[data-story-id="${message.storyId}"]`);
        statsContainers.forEach(container => {
          container.style.display = 'none';
        });
        
        // Update UI if this is the current story
        const currentId = getCurrentStoryId();
        if (message.storyId === currentId) {
          resetAllVoteVisuals();
        }
        
        // Log reset action for debugging
        console.log(`[VOTE] Votes reset for story: ${message.storyId}, planning cards should now be visible`);
      }
      break;
      
    case 'storySelected':
      if (typeof message.storyIndex === 'number') {
        console.log('[SOCKET] Story selected from server:', message.storyIndex);
        
        // Pass the forceSelection parameter if it exists
        const forceSelection = message.forceSelection === true;
        
        // Select the story without re-emitting
        selectStory(message.storyIndex, false, forceSelection);
        
        // For guests, ensure planning cards are visible when changing stories
        const planningCardsSection = document.querySelector('.planning-cards-section');
        if (planningCardsSection) {
          planningCardsSection.classList.remove('hidden-until-init');
          planningCardsSection.style.display = 'block';
        }
        
        // Hide all vote statistics containers when changing stories
        const allStatsContainers = document.querySelectorAll('.vote-statistics-container');
        allStatsContainers.forEach(container => {
          container.style.display = 'none';
        });
        
        // After story selection, request votes and check if they're already revealed
        const currentStoryId = getCurrentStoryId();
        if (currentStoryId && socket && socket.connected && !deletedStoryIds.has(currentStoryId)) {
          setTimeout(() => {
            socket.emit('requestStoryVotes', { storyId: currentStoryId });
            
            // If votes are already revealed for this story, show them
            if (votesRevealed[currentStoryId] && votesPerStory[currentStoryId]) {
              setTimeout(() => {
                handleVotesRevealed(currentStoryId, votesPerStory[currentStoryId]);
              }, 200);
            }
          }, 100);
        }
      }
      break;
      
    case 'storyVotes':
      // Skip processing for deleted story
      if (message.storyId && deletedStoryIds.has(message.storyId)) {
        console.log(`[VOTE] Ignoring votes for deleted story: ${message.storyId}`);
        return;
      }
      
      // Handle received votes for a specific story with improved state persistence
      if (message.storyId !== undefined && message.votes) {
        // Store votes for this story
        if (!votesPerStory[message.storyId]) {
          votesPerStory[message.storyId] = {};
        }
        
        // Update with received votes
        Object.assign(votesPerStory[message.storyId], message.votes);
        
        // Update UI if this is the current story
        const currentId = getCurrentStoryId();
        if (message.storyId === currentId) {
          // If votes are revealed, show them; otherwise, just show that people voted
          if (votesRevealed[message.storyId]) {
            applyVotesToUI(message.votes, false);
            handleVotesRevealed(message.storyId, votesPerStory[message.storyId]);
          } else {
            applyVotesToUI(message.votes, true);
          }
        }
      }
      break;
      
    case 'syncCSVData':
      // Handle CSV data sync with improved state handling
      if (Array.isArray(message.csvData)) {
        console.log('[SOCKET] Received CSV data, length:', message.csvData.length);
        
        // Store the CSV data
        csvData = message.csvData;
        csvDataLoaded = true;
        
        // Temporarily save manually added tickets to preserve them
        const storyList = document.getElementById('storyList');
        const manualTickets = [];
        
        if (storyList) {
          const manualStoryCards = storyList.querySelectorAll('.story-card[id^="story_"]:not([id^="story_csv_"])');
          manualStoryCards.forEach(card => {
            // Skip if this is a deleted story
            if (deletedStoryIds.has(card.id)) {
              return;
            }
            
            const title = card.querySelector('.story-title');
            if (title) {
              manualTickets.push({
                                id: card.id,
                text: title.textContent
              });
            }
          });
        }
        
        console.log(`[SOCKET] Preserved ${manualTickets.length} manually added tickets before CSV processing`);
        
        // Display CSV data (this will clear CSV stories but preserve manual ones)
        displayCSVData(csvData);
        
        // We don't need to re-add manual tickets because displayCSVData now preserves them
        
        // Update UI
        renderCurrentStory();
      }
      break;

    case 'connect':
      // When connection is established
      updateConnectionStatus('connected');
      
      // Request tickets and state after connection
      setTimeout(() => {
        if (socket && socket.connected) {
          if (!hasRequestedTickets) {
            console.log('[SOCKET] Connected, requesting all tickets');
            socket.emit('requestAllTickets');
            hasRequestedTickets = true;
          }
          
          // Also request votes for current story
          const currentId = getCurrentStoryId();
          if (currentId && !deletedStoryIds.has(currentId)) {
            socket.emit('requestStoryVotes', { storyId: currentId });
          }
        }
      }, 500);
      break;
      
    case 'reconnect_attempt':
      // Show reconnecting status
      updateConnectionStatus('reconnecting');
      reconnectingInProgress = true;
      break;
      
    case 'reconnect':
      // Handle successful reconnection
      updateConnectionStatus('connected');
      reconnectingInProgress = false;
      
      // Request current state after reconnection
      setTimeout(() => {
        if (socket && socket.connected) {
          // Request votes for current story
          const currentId = getCurrentStoryId();
          if (currentId && !deletedStoryIds.has(currentId)) {
            socket.emit('requestStoryVotes', { storyId: currentId });
          }
          
          // Request all tickets if we don't have them
          if (!hasRequestedTickets) {
            socket.emit('requestAllTickets');
            hasRequestedTickets = true;
          }
          
          // Request a full state resync to ensure we have the latest state
          socket.emit('requestFullStateResync');
        }
      }, 500);
      break;
      
    case 'error':
      // Show connection error status
      updateConnectionStatus('error');
      break;
      
    // Handle heartbeat responses
    case 'heartbeatResponse':
      console.log('[SOCKET] Received heartbeat response from server');
      break;
  }
}
function setupAddTicketButton() {
  const addTicketBtn = document.getElementById('addTicketBtn');
  if (!addTicketBtn) return;

  addTicketBtn.addEventListener('click', () => {
    if (typeof window.showAddTicketModal === 'function') {
      window.showAddTicketModal();
    } else {
      // Fallback prompt
      const storyText = prompt("Enter the story details:");
      if (storyText && storyText.trim()) {
        const ticketData = {
          id: `story_${Date.now()}`,
          text: storyText.trim()
        };
        if (deletedStoryIds.has(ticketData.id)) {
          console.log('[ADD] Cannot add previously deleted ticket:', ticketData.id);
          return;
        }
        if (typeof emitAddTicket === 'function') {
          emitAddTicket(ticketData);
        } else if (socket) {
          socket.emit('addTicket', ticketData);
        }
        // DO NOT call addTicketToUI directly here for host! The socket will add it.
        manuallyAddedTickets.push(ticketData);
      }
    }
  });
}

function setupCSVUploader() {
  const csvInput = document.getElementById('csvInput');
  if (!csvInput) return;

  csvInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      // Save existing manually added tickets before processing CSV
      const storyList = document.getElementById('storyList');
      const existingTickets = [];
      if (storyList) {
        const manualTickets = storyList.querySelectorAll('.story-card[id^="story_"]:not([id^="story_csv_"])');
        manualTickets.forEach(card => {
          const title = card.querySelector('.story-title');
          if (title) {
            existingTickets.push({
              id: card.id, 
              text: title.textContent
            });
          }
        });
      }
      // Parse the CSV data
      const parsedData = parseCSV(e.target.result);
      // Store in the module state
      csvData = parsedData;
      // Display CSV data - this will clear and rebuild the story list
      displayCSVData(csvData);
      // Re-add the preserved manual tickets
      existingTickets.forEach((ticket, index) => {
        if (deletedStoryIds.has(ticket.id)) return;
        if (!document.getElementById(ticket.id)) {
          addTicketToUI(ticket, false);
        }
      });
      preservedManualTickets = [...existingTickets];
      // Emit the CSV data to server AFTER ensuring all UI is updated
      emitCSVData(parsedData);
      if (!document.querySelector('.story-card.selected')) {
        currentStoryIndex = 0;
        renderCurrentStory();
      }
    };
    reader.readAsText(file);
  });
}

function addTicketToUI(ticketData, isManual = false) {
  const storyList = document.getElementById('storyList');
  if (!storyList || !ticketData || !ticketData.id || !ticketData.text) return;

  const card = document.createElement('div');
  card.className = 'story-card';
  card.id = ticketData.id;

  // Create story text
  const title = document.createElement('div');
  title.className = 'story-title';
  title.textContent = ticketData.text;
  card.appendChild(title);

  // Only add the menu if current user is host
  if (typeof isCurrentUserHost === "function" && isCurrentUserHost()) {
    const menuContainer = document.createElement('div');
    menuContainer.className = 'story-menu-container';
    menuContainer.innerHTML = `
      <div class="story-menu-trigger">⋮</div>
      <div class="story-menu-dropdown">
        <div class="story-menu-item edit-story">Edit</div>
        <div class="story-menu-item delete-story">Delete</div>
      </div>
    `;
    card.appendChild(menuContainer);

    const menuTrigger = menuContainer.querySelector('.story-menu-trigger');
    const menuDropdown = menuContainer.querySelector('.story-menu-dropdown');

    if (menuTrigger && menuDropdown) {
      menuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.story-menu-dropdown').forEach(d => d.style.display = 'none');
        menuDropdown.style.display = 'block';
      });

      document.addEventListener('click', () => {
        menuDropdown.style.display = 'none';
      });

      // Hook up edit and delete actions
      menuDropdown.querySelector('.edit-story')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const titleDiv = card.querySelector('.story-title');
        const currentText = titleDiv ? titleDiv.textContent : ticketData.text;
        if (typeof window.showEditTicketModal === 'function') {
          window.showEditTicketModal(ticketData.id, currentText);
        }
        menuDropdown.style.display = 'none';
      });

      menuDropdown.querySelector('.delete-story')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof deleteStory === 'function') {
          deleteStory(ticketData.id);
        }
        menuDropdown.style.display = 'none';
      });
    }
  }

  storyList.appendChild(card);
  normalizeStoryIndexes();

  if (typeof isCurrentUserHost === "function" && isCurrentUserHost()) {
    const index = Array.from(storyList.children).findIndex(child => child.id === ticketData.id);
    if (index !== -1) {
      selectStory(index, true);
    }
  }
}
// ... more utility/voting/state functions as in your original file ...

// Main page/content ready handlers
document.addEventListener('DOMContentLoaded', () => {
  if (window.userNameReady === false) {
    console.log('[APP] Waiting for username before initializing app');
    return;
  }
  let roomId = getRoomIdFromURL();
  if (!roomId) roomId = 'room-' + Math.floor(Math.random() * 10000);
  appendRoomIdToURL(roomId);
  loadDeletedStoriesFromStorage(roomId);
  initializeApp(roomId);
});

// Event delegation for menu and dropdown items
document.addEventListener('click', function (event) {
  const isMenuButton = event.target.closest('.menu-button');
  const isDropdownItem = event.target.closest('.dropdown-item');

  document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.add('hidden'));

  if (isMenuButton) {
    const menu = isMenuButton.nextElementSibling;
    if (menu) {
      menu.classList.toggle('hidden');
      event.stopPropagation();
    }
  } else if (isDropdownItem) {
    const card = event.target.closest('.story-card');
    const storyId = card?.id;

    if (event.target.classList.contains('edit')) {
      const storyTitle = card.querySelector('.story-title');
      const currentText = storyTitle ? storyTitle.textContent : '';

      if (typeof window.showEditTicketModal === 'function') {
        window.showEditTicketModal(storyId, currentText);
      }
    } else if (event.target.classList.contains('delete')) {
      if (typeof deleteStory === 'function') {
        deleteStory(storyId);
      }
    }
  } else {
    document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.add('hidden'));
  }
});

