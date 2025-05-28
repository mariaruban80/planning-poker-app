// === server.js ===
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*' },
    pingTimeout: 120000,
    pingInterval: 25000,
    connectTimeout: 30000
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'main.html'));
});
app.use(express.static(join(__dirname, 'public')));

const rooms = {}; // roomId: { users, story, revealed, csvData, selectedIndex, votesPerStory, votesRevealed, tickets, deletedStoryIds, deletedStoriesTimestamp, lastActivity }
const roomVotingSystems = {}; // roomId → voting system
const userNameToIdMap = {};   // userName → { socketIds: [socketId1, socketId2, ...] }

// Periodic cleanup of room data
function cleanupRoomData() {
    console.log('[SERVER] Running room data cleanup');
    const now = Date.now();

    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (room.deletedStoriesTimestamp) {
            const oneDayAgo = now - (24 * 60 * 60 * 1000);
            for (const storyId in room.deletedStoriesTimestamp) {
                if (room.deletedStoriesTimestamp[storyId] < oneDayAgo) {
                    delete room.votesPerStory[storyId];
                    delete room.votesRevealed[storyId];
                    console.log(`[SERVER] Cleaned up old vote data for story ${storyId} in room ${roomId}`);
                }
            }
        }

        const lastActivity = room.lastActivity || 0;
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        if (lastActivity < sevenDaysAgo && room.users.length === 0) {
            console.log(`[SERVER] Removing inactive room: ${roomId}`);
            delete rooms[roomId];
            delete roomVotingSystems[roomId];
        }
    }
}

setInterval(cleanupRoomData, 60 * 60 * 1000); // Run cleanup every hour

// Helper function to find a user's past votes
function findExistingVotesForUser(roomId, userName) {
    if (!rooms[roomId] || !userName) return {};

    const result = {};
    const userMapping = userNameToIdMap[userName] || { socketIds: [] };

    for (const storyId in rooms[roomId].votesPerStory) {
        if (!rooms[roomId].deletedStoryIds.has(storyId)) {
            for (const pastSocketId of userMapping.socketIds) {
                if (rooms[roomId].votesPerStory[storyId][pastSocketId]) {
                    result[storyId] = rooms[roomId].votesPerStory[storyId][pastSocketId];
                    break;
                }
            }
        }
    }
    return result;
}

io.on('connection', (socket) => {
    console.log(`[SERVER] New client connected: ${socket.id}`);

    socket.on('joinRoom', ({ roomId, userName }) => {
        if (!userName || !roomId) return; // Or handle the error appropriately

        socket.data.roomId = roomId;
        socket.data.userName = userName;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],
                story: [],
                revealed: false,
                csvData: [],
                selectedIndex: 0,  // Initialize selectedIndex
                votesPerStory: {},
                votesRevealed: {},
                tickets: [],
                deletedStoryIds: new Set(),
                deletedStoriesTimestamp: {},
                lastActivity: Date.now()
            };
        }

        rooms[roomId].lastActivity = Date.now();

        // User tracking for vote persistence
        userNameToIdMap[userName] = userNameToIdMap[userName] || { socketIds: [] };
        userNameToIdMap[userName].socketIds.push(socket.id);
        userNameToIdMap[userName].socketIds = userNameToIdMap[userName].socketIds.slice(-5); // Keep last 5 socket IDs

        // Remove duplicate user entries
        rooms[roomId].users = rooms[roomId].users.filter(user => user.id !== socket.id);
        rooms[roomId].users.push({ id: socket.id, name: userName });

        socket.join(roomId);

        const activeTickets = rooms[roomId].tickets.filter(t => !rooms[roomId].deletedStoryIds.has(t.id));

        // Send initial state to the joining user
        const initialState = {
            tickets: activeTickets,
            votesPerStory: rooms[roomId].votesPerStory,
            votesRevealed: rooms[roomId].votesRevealed,
            deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds),
            selectedIndex: rooms[roomId].selectedIndex // Send selected story index
        };
        socket.emit('resyncState', initialState);


        // Restore user's votes and broadcast to others
        const existingVotes = findExistingVotesForUser(roomId, userName);
        for (const storyId in existingVotes) {
            const vote = existingVotes[storyId];
            rooms[roomId].votesPerStory[storyId] = rooms[roomId].votesPerStory[storyId] || {};
            rooms[roomId].votesPerStory[storyId][socket.id] = vote;
            socket.emit('restoreUserVote', { storyId, vote });
            socket.to(roomId).emit('voteUpdate', { userId: socket.id, vote, storyId }); // Broadcast to others
        }

        socket.emit('votingSystemUpdate', { votingSystem: roomVotingSystems[roomId] || 'fibonacci' });
        io.to(roomId).emit('userList', { users: rooms[roomId].users });

        if (rooms[roomId].csvData.length > 0) {
            socket.emit('syncCSVData', rooms[roomId].csvData);
        }



        // Emit vote updates for the current story after a short delay
        if (rooms[roomId].selectedIndex !== undefined && rooms[roomId].selectedIndex !== null) {
            const storyId = getStoryIdFromIndex(roomId, rooms[roomId].selectedIndex);
            if (storyId) {
                setTimeout(() => {
                    const votes = rooms[roomId].votesPerStory[storyId] || {};
                    io.to(roomId).emit('storyVotes', { storyId, votes }); // send to everyone
                    if (rooms[roomId].votesRevealed[storyId]) {
                      io.to(roomId).emit('votesRevealed', {storyId});
                    }
                }, 500);
            }
        }


    });

    socket.on('requestSelectedStory', () => {
      const roomId = socket.data.roomId;
      if (!roomId || !rooms[roomId] || typeof rooms[roomId].selectedIndex !== 'number') return;
      socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;

        console.log(`[SERVER] Client disconnected: ${socket.id} from room ${roomId}`);
        rooms[roomId].lastActivity = Date.now();
        rooms[roomId].users = rooms[roomId].users.filter(user => user.id !== socket.id);
        io.to(roomId).emit('userList', { users: rooms[roomId].users });

        if (rooms[roomId].users.length === 0) {
            setTimeout(() => {
                if (rooms[roomId] && rooms[roomId].users.length === 0) {
                    console.log(`[SERVER] Removing empty room after timeout: ${roomId}`);
                    delete rooms[roomId];
                    delete roomVotingSystems[roomId];
                }
            }, 300000); // 5 minutes
        }
    });

    // ... (rest of the socket handlers as before. Make sure they include the fixes for vote visibility, 
    // deleted story persistence, and the emoji burst issue from our previous exchanges)
    
    // Helper function to get story ID from index (handling deleted stories)
    function getStoryIdFromIndex(roomId, storyIndex) {
        if (!rooms[roomId] || !rooms[roomId].tickets) return null;

        const activeTickets = rooms[roomId].tickets.filter(ticket => !rooms[roomId].deletedStoryIds.has(ticket.id));
        if (storyIndex >= 0 && storyIndex < activeTickets.length) {
            return activeTickets[storyIndex].id;
        }
        return null;
    }


});


const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
