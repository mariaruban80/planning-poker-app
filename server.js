// === server.js ===
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// added to call the main.html file
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'main.html'));
});
app.use(express.static(join(__dirname, 'public')));


// Enhanced room structure with vote revealing state
const rooms = {}; // roomId: { users, votes, story, revealed, csvData, selectedIndex, votesPerStory, votesRevealed }

io.on('connection', (socket) => {
  console.log(`[SERVER] New client connected: ${socket.id}`);
  
  // Handle room joining
  socket.on('joinRoom', ({ roomId, userName }) => {
     // Validate username - reject if missing
  if (!userName) {
    console.log(`[SERVER] Rejected connection without username for socket ${socket.id}`);
    socket.emit('error', { message: 'Username is required to join a room' });
    return;
  }
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        votes: {},
        story: [],
        revealed: false,
        csvData: [],
        selectedIndex: 0, // Default to first story
        votesPerStory: {},
        votesRevealed: {} // Track which stories have revealed votes
      };
    }

    // Update user list (remove if exists, then add)
    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name: userName });
    socket.join(roomId);

    console.log(`[SERVER] User ${userName} (${socket.id}) joined room ${roomId}`);
    
    // Send user list to everyone in the room
    io.to(roomId).emit('userList', rooms[roomId].users);

    // Send CSV data if available
    if (rooms[roomId].csvData?.length > 0) {
      socket.emit('syncCSVData', rooms[roomId].csvData);
    }
  });
// Handle ticket synchronization - add THIS inside the connection handler
  socket.on('addTicket', (ticketData) => {
  const roomId = socket.data.roomId;
  if (roomId && rooms[roomId]) {
    console.log(`[SERVER] New ticket added to room ${roomId}`);
    
    // Broadcast the new ticket to everyone in the room EXCEPT sender
    socket.broadcast.to(roomId).emit('addTicket', { ticketData });
    
    // Keep track of tickets on the server (optional)
    if (!rooms[roomId].tickets) {
      rooms[roomId].tickets = [];
    }
    rooms[roomId].tickets.push(ticketData);
  }
});

// Add handler for getting all tickets
socket.on('requestAllTickets', () => {
  const roomId = socket.data.roomId;
  if (roomId && rooms[roomId] && rooms[roomId].tickets) {
    console.log(`[SERVER] Sending all tickets to client ${socket.id}`);
    socket.emit('allTickets', { tickets: rooms[roomId].tickets });
  }
});

  // Handle CSV data loaded confirmation
  socket.on('csvDataLoaded', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      // Now that CSV is loaded, send the current story selection
      if (typeof rooms[roomId].selectedIndex === 'number') {
        const storyIndex = rooms[roomId].selectedIndex;
        console.log(`[SERVER] Client ${socket.id} confirmed CSV loaded, sending current story: ${storyIndex}`);
        socket.emit('storySelected', { storyIndex });
        
        // Send votes for the current story if any exist
        const existingVotes = rooms[roomId].votesPerStory[storyIndex] || {};
        if (Object.keys(existingVotes).length > 0) {
          socket.emit('storyVotes', { storyIndex, votes: existingVotes });
          
          // Also send vote reveal status
          if (rooms[roomId].votesRevealed[storyIndex]) {
            socket.emit('votesRevealed', { storyIndex });
          }
        }
      }
    }
  });

  // Handle story selection
  socket.on('storySelected', ({ storyIndex }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] storySelected received from ${socket.id} in room ${roomId}, storyIndex: ${storyIndex}`);
      
      // Store the selected index in room state
      rooms[roomId].selectedIndex = storyIndex;
      
      // Broadcast to ALL clients in the room (including sender for confirmation)
      io.to(roomId).emit('storySelected', { storyIndex });
    }
  });

  // Handle user votes
  socket.on('castVote', ({ vote, targetUserId }) => {
    const roomId = socket.data.roomId;
    if (roomId && targetUserId != null && rooms[roomId]) {
      const currentStoryIndex = rooms[roomId].selectedIndex;

      // Initialize vote storage for this story if needed
      if (!rooms[roomId].votesPerStory[currentStoryIndex]) {
        rooms[roomId].votesPerStory[currentStoryIndex] = {};
      }

      // Store the vote
      rooms[roomId].votesPerStory[currentStoryIndex][targetUserId] = vote;

      // Broadcast vote to all clients in the room
      io.to(roomId).emit('voteUpdate', {
        userId: targetUserId,
        vote,
        storyIndex: currentStoryIndex
      });
    }
  });

  // Handle requests for votes for a specific story
  socket.on('requestStoryVotes', ({ storyIndex }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const votes = rooms[roomId].votesPerStory[storyIndex] || {};
      console.log(`[SERVER] Sending votes for story ${storyIndex} to client ${socket.id}`);
      socket.emit('storyVotes', { storyIndex, votes });
      
      // If votes have been revealed for this story, also send that info
      if (rooms[roomId].votesRevealed[storyIndex]) {
        socket.emit('votesRevealed', { storyIndex });
      }
    }
  });

  // Handle vote revealing
  socket.on('revealVotes', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const currentStoryIndex = rooms[roomId].selectedIndex;
      
      // Mark this story as having revealed votes
      rooms[roomId].votesRevealed[currentStoryIndex] = true;
      
      // Send the reveal signal to all clients
      io.to(roomId).emit('votesRevealed', { storyIndex: currentStoryIndex });
      
      console.log(`[SERVER] Votes revealed for story ${currentStoryIndex} in room ${roomId}`);
    }
  });

  // Handle vote reset for current story
  socket.on('resetVotes', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const currentStoryIndex = rooms[roomId].selectedIndex;
      
      // Clear votes for the current story
      if (rooms[roomId].votesPerStory[currentStoryIndex]) {
        rooms[roomId].votesPerStory[currentStoryIndex] = {};
        // Reset revealed status
        rooms[roomId].votesRevealed[currentStoryIndex] = false;
        
        console.log(`[SERVER] Votes reset for story ${currentStoryIndex} in room ${roomId}`);
        io.to(roomId).emit('votesReset', { storyIndex: currentStoryIndex });
      }
    }
  });

  // Handle story changes
  socket.on('storyChange', ({ story }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].story = story;
      io.to(roomId).emit('storyChange', { story });
    }
  });

  // Handle story navigation
  socket.on('storyNavigation', ({ index }) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      io.to(roomId).emit('storyNavigation', { index });
    }
  });

  // Handle CSV data synchronization
  socket.on('syncCSVData', (csvData) => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].csvData = csvData;
      rooms[roomId].selectedIndex = 0; // Reset selected index when new CSV data is loaded
      rooms[roomId].votesPerStory = {}; // Reset all votes when new CSV data is loaded
      rooms[roomId].votesRevealed = {}; // Reset all reveal states when new CSV data is loaded
      io.to(roomId).emit('syncCSVData', csvData);
    }
  });

  // Export votes data (optional feature)
  socket.on('exportVotes', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const exportData = {
        room: roomId,
        stories: rooms[roomId].csvData,
        votes: rooms[roomId].votesPerStory,
        revealed: rooms[roomId].votesRevealed,
        timestamp: new Date().toISOString()
      };
      
      socket.emit('exportData', exportData);
    }
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      console.log(`[SERVER] Client disconnected: ${socket.id} from room ${roomId}`);
      
      // Remove user from room
      rooms[roomId].users = rooms[roomId].users.filter(user => user.id !== socket.id);
      
      // Notify remaining users
      io.to(roomId).emit('userList', rooms[roomId].users);
      
      // Clean up empty rooms
      if (rooms[roomId].users.length === 0) {
        console.log(`[SERVER] Removing empty room: ${roomId}`);
        delete rooms[roomId];
      }
    }
  });
});
// In server.js add:

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
