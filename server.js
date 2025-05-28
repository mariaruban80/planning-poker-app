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
        if (rooms[roomId].deletedStoryIds && !rooms[roomId].deletedStoryIds.has(storyId)) {
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


// Helper function to get story ID from index (handling deleted stories)
function getStoryIdFromIndex(roomId, storyIndex) {
    if (!rooms[roomId] || !rooms[roomId].tickets) return null;

    const activeTickets = rooms[roomId].tickets.filter(ticket => !rooms[roomId].deletedStoryIds.has(ticket.id));
    if (storyIndex >= 0 && storyIndex < activeTickets.length) {
        return activeTickets[storyIndex].id;
    }
    return null;
}

io.on('connection', (socket) => {
    console.log(`[SERVER] New client connected: ${socket.id}`);

    socket.on('joinRoom', ({ roomId, userName }) => {
        if (!userName || !roomId) return;

        socket.data.roomId = roomId;
        socket.data.userName = userName;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],
                story: [],
                revealed: false,
                csvData: [],
                selectedIndex: null, // Start with no story selected
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


        const activeTickets = rooms[roomId].tickets.filter(t => !(rooms[roomId].deletedStoryIds || new Set()).has(t.id));
        const initialState = {
            tickets: activeTickets,
            votesPerStory: rooms[roomId].votesPerStory,
            votesRevealed: rooms[roomId].votesRevealed,
            deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds || []), // Ensure deletedStoryIds exists
            selectedIndex: rooms[roomId].selectedIndex
        };
        socket.emit('resyncState', initialState);
        

        // Restore and broadcast votes
        const existingVotes = findExistingVotesForUser(roomId, userName);
        for (const storyId in existingVotes) {
            const vote = existingVotes[storyId];
            if (!(rooms[roomId].deletedStoryIds || new Set()).has(storyId)) { // Check for deleted story
                rooms[roomId].votesPerStory[storyId] = rooms[roomId].votesPerStory[storyId] || {};
                rooms[roomId].votesPerStory[storyId][socket.id] = vote;
                socket.emit('restoreUserVote', { storyId, vote });
                socket.to(roomId).emit('voteUpdate', { userId: socket.id, vote, storyId });
            }
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
                    if (rooms[roomId].votesRevealed && rooms[roomId].votesRevealed[storyId]) {
                        io.to(roomId).emit('votesRevealed', { storyId });
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

    socket.on('requestFullStateResync', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;

        console.log(`[SERVER] Full state resync requested by ${socket.id} for room ${roomId}`);
        rooms[roomId].lastActivity = Date.now();

        const filteredTickets = rooms[roomId].tickets.filter(ticket => !rooms[roomId].deletedStoryIds.has(ticket.id));

        const activeVotes = {};
        const activeRevealed = {};

        for (const storyId in rooms[roomId].votesPerStory) {
            if (!rooms[roomId].deletedStoryIds.has(storyId)) {
                activeVotes[storyId] = rooms[roomId].votesPerStory[storyId];
                if (rooms[roomId].votesRevealed && rooms[roomId].votesRevealed[storyId]) {
                    activeRevealed[storyId] = true;
                }
            }
        }
        const resyncState = {
            tickets: filteredTickets,
            votesPerStory: activeVotes,
            votesRevealed: activeRevealed,
            deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds || []),
            selectedIndex: rooms[roomId].selectedIndex   // Include selected Index
        };

        socket.emit('resyncState', resyncState);


        if (socket.data.userName) {
            const existingUserVotes = findExistingVotesForUser(roomId, socket.data.userName);

            for (const storyId in existingUserVotes) {   // Resend user specific votes (after resync)
                const vote = existingUserVotes[storyId];
                if (!rooms[roomId].deletedStoryIds.has(storyId)) {
                  if (!rooms[roomId].votesPerStory[storyId]) {
                    rooms[roomId].votesPerStory[storyId] = {};
                  }
                   rooms[roomId].votesPerStory[storyId][socket.id] = vote;

                   socket.emit('restoreUserVote', { storyId, vote });
                   socket.broadcast.to(roomId).emit('voteUpdate',{userId: socket.id, vote, storyId});
                }

             }


          }





    });


    socket.on('reconnect', () => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            console.log(`[SERVER] Client ${socket.id} reconnected to room ${roomId}`);

            rooms[roomId].lastActivity = Date.now();

            socket.emit('userList', rooms[roomId].users);

            if (rooms[roomId].csvData?.length > 0) {
                socket.emit('syncCSVData', rooms[roomId].csvData);
            }

            if (rooms[roomId].tickets) {
                const filteredTickets = rooms[roomId].tickets.filter(ticket =>
                    !rooms[roomId].deletedStoryIds || !rooms[roomId].deletedStoryIds.has(ticket.id)
                );

                console.log(`[SERVER] Sending ${filteredTickets.length} active tickets to reconnected user ${socket.id}`);
                socket.emit('allTickets', { tickets: filteredTickets });
            }

            if (typeof rooms[roomId].selectedIndex === 'number') {
                socket.emit('storySelected', { storyIndex: rooms[roomId].selectedIndex });
            }

            const votesPerStory = rooms[roomId].votesPerStory || {};
            for (const storyId in votesPerStory) {

                if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
                    continue;
                }

                const votes = votesPerStory[storyId] || {};
                if (Object.keys(votes).length > 0) {
                    console.log(`[SERVER] Resending votes for story ${storyId} to reconnected user:`, JSON.stringify(votes));
                    socket.emit('storyVotes', { storyId, votes });

                    if (rooms[roomId].votesRevealed?.[storyId]) {
                        socket.emit('votesRevealed', { storyId });
                    }
                }
            }

            if (socket.data.userName) {  // Restore user votes upon reconnection if possible
                const userVotes = findExistingVotesForUser(roomId, socket.data.userName);

                for (const storyId in userVotes) {
                    if(!rooms[roomId].deletedStoryIds.has(storyId)) {
                    const vote = userVotes[storyId];
                    rooms[roomId].votesPerStory[storyId] = rooms[roomId].votesPerStory[storyId] || {};
                    rooms[roomId].votesPerStory[storyId][socket.id] = vote;

                    socket.emit("restoreUserVote", { storyId, vote});

                    socket.broadcast.to(roomId).emit("voteUpdate", {userId: socket.id, vote, storyId });


                    }


                }
            }
        }
    });


    socket.on('addTicket', (ticketData) => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            console.log(`[SERVER] New ticket added to room ${roomId}:`, ticketData.id);

            rooms[roomId].lastActivity = Date.now();

            if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(ticketData.id)) {
                rooms[roomId].deletedStoryIds.delete(ticketData.id);
            }


            socket.broadcast.to(roomId).emit('addTicket', { ticketData });

            if (!rooms[roomId].tickets) {
                rooms[roomId].tickets = [];
            }

            const existingIndex = rooms[roomId].tickets.findIndex(ticket => ticket.id === ticketData.id);
            if (existingIndex === -1) {
                rooms[roomId].tickets.push(ticketData);
                console.log(`[SERVER] Ticket added to server state. Total tickets: ${rooms[roomId].tickets.length}`);

            } else {
                console.log(`[SERVER] Ticket ${ticketData.id} already exists, not duplicating`);
            }


        }
    });

    socket.on('deleteCSVStory', ({ storyId, csvIndex }) => {
        const roomId = socket.data.roomId;

        if (roomId && rooms[roomId]) {
            console.log(`[SERVER] CSV story deleted in room ${roomId}: ${storyId}, csvIndex: ${csvIndex}`);

            rooms[roomId].lastActivity = Date.now();


            if (!rooms[roomId].deletedStoryIds) {
                rooms[roomId].deletedStoryIds = new Set();
            }
            rooms[roomId].deletedStoryIds.add(storyId);


            if (!rooms[roomId].deletedStoriesTimestamp) {
                rooms[roomId].deletedStoriesTimestamp = {};
            }
            rooms[roomId].deletedStoriesTimestamp[storyId] = Date.now();


            if (rooms[roomId].csvData && !isNaN(csvIndex) && csvIndex >= 0 && csvIndex < rooms[roomId].csvData.length) {
                rooms[roomId].csvData.splice(csvIndex, 1);


                io.to(roomId).emit('syncCSVData', rooms[roomId].csvData);
                console.log(`[SERVER] Resynced CSV data after deletion, ${rooms[roomId].csvData.length} items remain`);

            }

            if (rooms[roomId].tickets) {
                const previousCount = rooms[roomId].tickets.length;
                rooms[roomId].tickets = rooms[roomId].tickets.filter(ticket => ticket.id !== storyId);
                console.log(`[SERVER] Removed CSV story from tickets. Before: ${previousCount}, After: ${rooms[roomId].tickets.length}`);

            }


            io.to(roomId).emit('deleteStory', { storyId });
        }
    });


    socket.on('votingSystemSelected', ({ roomId, votingSystem }) => {
        if (roomId && votingSystem) {
            console.log(`[SERVER] Host selected voting system '${votingSystem}' for room ${roomId}`);
            if (rooms[roomId]) {
                rooms[roomId].lastActivity = Date.now();
            }
            roomVotingSystems[roomId] = votingSystem;
            io.to(roomId).emit('votingSystemUpdate', { votingSystem });

        }
    });



    socket.on('deleteStory', ({ storyId, isCsvStory, csvIndex }) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;

        console.log(`[SERVER] Deleting story ${storyId} in room ${roomId}`);
        rooms[roomId].lastActivity = Date.now();

        if (!rooms[roomId].deletedStoryIds) {
            rooms[roomId].deletedStoryIds = new Set();
        }
        rooms[roomId].deletedStoryIds.add(storyId);

        if (!rooms[roomId].deletedStoriesTimestamp) {
            rooms[roomId].deletedStoriesTimestamp = {};
        }
        rooms[roomId].deletedStoriesTimestamp[storyId] = Date.now();
        if (rooms[roomId].tickets) {
            rooms[roomId].tickets = rooms[roomId].tickets.filter(t => t.id !== storyId);
        }

        // Handle CSV data updates if it's a CSV story
        if (isCsvStory && !isNaN(csvIndex)) {
            if (rooms[roomId].csvData && csvIndex >= 0 && csvIndex < rooms[roomId].csvData.length) {
                rooms[roomId].csvData.splice(csvIndex, 1);
                io.to(roomId).emit('syncCSVData', rooms[roomId].csvData);
            }
        }

        io.to(roomId).emit('deleteStory', { storyId });

        console.log(`[SERVER] Story ${storyId} deleted and clients notified.`);

    });




    socket.on('requestAllTickets', () => {
        const roomId = socket.data.roomId;

        if (roomId && rooms[roomId]) {
            console.log(`[SERVER] Ticket request from client ${socket.id}`);
            rooms[roomId].lastActivity = Date.now();


            const filteredTickets = rooms[roomId].tickets.filter(ticket =>
                !rooms[roomId].deletedStoryIds || !rooms[roomId].deletedStoryIds.has(ticket.id)
            );

            console.log(`[SERVER] Sending ${filteredTickets.length} active tickets (filtered from ${rooms[roomId].tickets.length} total)`);

            socket.emit('allTickets', { tickets: filteredTickets });

        } else {
            console.log(`[SERVER] No tickets available to send to client ${socket.id}`);
            socket.emit('allTickets', { tickets: [] }); // Send empty array if no tickets
        }

    });

    socket.on('csvDataLoaded', () => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {

            rooms[roomId].lastActivity = Date.now();

            if (typeof rooms[roomId].selectedIndex === 'number') {  // Send the selected Index to the user
                const storyIndex = rooms[roomId].selectedIndex;
                console.log(`[SERVER] Client ${socket.id} confirmed CSV loaded, sending current story: ${storyIndex}`);

                socket.emit('storySelected', { storyIndex });



                const storyId = getStoryIdFromIndex(roomId, storyIndex);  // Get StoryId from Index

                if (storyId) {

                    const existingVotes = rooms[roomId].votesPerStory[storyId] || {};
                    if (Object.keys(existingVotes).length > 0) {

                        socket.emit('storyVotes', { storyId, votes: existingVotes });


                        if (rooms[roomId].votesRevealed[storyId]) {

                            socket.emit('votesRevealed', { storyId });
                        }
                    }




                    if (socket.data.userName) {
                        const userVotes = findExistingVotesForUser(roomId, socket.data.userName);
                        if (userVotes[storyId]) {

                            if (!rooms[roomId].votesPerStory[storyId]) {
                                rooms[roomId].votesPerStory[storyId] = {};
                            }
                            rooms[roomId].votesPerStory[storyId][socket.id] = userVotes[storyId];
                            socket.emit('restoreUserVote', { storyId, vote: userVotes[storyId] });

                            socket.broadcast.to(roomId).emit("voteUpdate", { userId: socket.id, vote: userVotes[storyId], storyId });


                        }
                    }

                }
            }
        }
    });



    socket.on('storySelected', ({ storyIndex }) => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            console.log(`[SERVER] storySelected received from ${socket.id} in room ${roomId}, storyIndex: ${storyIndex}`);
            rooms[roomId].lastActivity = Date.now();
            rooms[roomId].selectedIndex = storyIndex;

            io.to(roomId).emit('storySelected', { storyIndex }); // Broadcast to all clients in the room

            if (typeof storyIndex === "number") {
                const storyId = getStoryIdFromIndex(roomId, storyIndex);
                if (storyId && !rooms[roomId].deletedStoryIds.has(storyId)) {
                  setTimeout(() => {

                      if (rooms[roomId].votesPerStory && rooms[roomId].votesPerStory[storyId]) {
                          io.to(roomId).emit('storyVotes', { storyId, votes: rooms[roomId].votesPerStory[storyId]});
                      }

                        if (rooms[roomId].votesRevealed && rooms[roomId].votesRevealed[storyId]) {
                          io.to(roomId).emit('votesRevealed', {storyId});

                        }
                  }, 200);



                }

            }


        }
    });

    socket.on('castVote', ({ vote, targetUserId, storyId }) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId] || targetUserId !== socket.id) return;

        rooms[roomId].lastActivity = Date.now();

        if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
            console.log(`[SERVER] Ignoring vote for deleted story: ${storyId}`);
            return;
        }

        if (!rooms[roomId].votesPerStory[storyId]) {
            rooms[roomId].votesPerStory[storyId] = {};
        }

        rooms[roomId].votesPerStory[storyId][targetUserId] = vote;

        io.to(roomId).emit('voteUpdate', { userId: targetUserId, vote, storyId });

    });

    socket.on('requestStoryVotes', ({ storyId }) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;

        rooms[roomId].lastActivity = Date.now();

        if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
            console.log(`[SERVER] Ignoring vote request for deleted story: ${storyId}`);
            return;
        }

        if (!rooms[roomId].votesPerStory[storyId]) {
            rooms[roomId].votesPerStory[storyId] = {};
        }

        socket.emit('storyVotes', {
            storyId,
            votes: rooms[roomId].votesPerStory[storyId]  || {}
        });

        if (rooms[roomId].votesRevealed && rooms[roomId].votesRevealed[storyId]) {
            socket.emit('votesRevealed', { storyId });
        }


        if (socket.data.userName) {  // send user specific vote data if available
          const userVotes = findExistingVotesForUser(roomId, socket.data.userName);


            if (userVotes[storyId]) {
              rooms[roomId].votesPerStory[storyId] = rooms[roomId].votesPerStory[storyId] || {};
                rooms[roomId].votesPerStory[storyId][socket.id] = userVotes[storyId];
                socket.emit('restoreUserVote', { storyId, vote: userVotes[storyId] });

                socket.broadcast.to(roomId).emit('voteUpdate', { userId: socket.id, vote: userVotes[storyId], storyId });

            }



        }


    });

    socket.on('revealVotes', ({ storyId }) => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            console.log(`[SERVER] Revealing votes for story: ${storyId} in room ${roomId}`);

            rooms[roomId].lastActivity = Date.now();


            if (rooms[roomId].deletedStoryIds && rooms[roomId].deletedStoryIds.has(storyId)) {
                console.log(`[SERVER] Cannot reveal votes for deleted story: ${storyId}`);

                return;
            }


            if (!rooms[roomId].votesRevealed) {
                rooms[roomId].votesRevealed = {};
            }

            rooms[roomId].votesRevealed[storyId] = true;


            io.to(roomId).emit('votesRevealed', { storyId });
        }
    });


    socket.on('resetVotes', ({ storyId }) => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId] && rooms[roomId].votesPerStory?.[storyId]) {
            rooms[roomId].lastActivity = Date.now();
            rooms[roomId].votesPerStory[storyId] = {};

            if (rooms[roomId].votesRevealed) {
                rooms[roomId].votesRevealed[storyId] = false;
            }

            io.to(roomId).emit('votesReset', { storyId });
        }
    });


    socket.on('storyChange', ({ story }) => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {

            rooms[roomId].lastActivity = Date.now();
            rooms[roomId].story = story;


            io.to(roomId).emit('storyChange', { story });

        }
    });


    socket.on('storyNavigation', ({ index }) => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {

            rooms[roomId].lastActivity = Date.now();

            io.to(roomId).emit('storyNavigation', { index });
        }
    });

    socket.on('syncCSVData', (csvData) => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            console.log(`[SERVER] Received CSV data for room ${roomId}, ${csvData.length} rows`);
            rooms[roomId].lastActivity = Date.now();
            rooms[roomId].csvData = csvData;
            rooms[roomId].selectedIndex = 0; // Reset selected index when new CSV data comes in

            if (rooms[roomId].tickets) {
                const manualTickets = rooms[roomId].tickets.filter(ticket => !ticket.id.startsWith('story_csv_'));
                console.log(`[SERVER] Preserved ${manualTickets.length} manual tickets during CSV sync`);
            }

            if (rooms[roomId].tickets) {
                rooms[roomId].tickets = rooms[roomId].tickets.filter(ticket => !ticket.id.startsWith('story_csv_'));
            }

            // Clear deleted IDs for CSV stories, but preserve those for manual tickets
            const preservedDeletedIds = new Set();
            (rooms[roomId].deletedStoryIds || []).forEach(storyId => {
              if (!storyId.startsWith('story_csv_')) {
                preservedDeletedIds.add(storyId);
              }
            });
            rooms[roomId].deletedStoryIds = preservedDeletedIds;

            const preservedVotes = {};
            const preservedRevealed = {};

            if (rooms[roomId].votesPerStory) {
                for (const storyId in rooms[roomId].votesPerStory) {
                    if (!storyId.startsWith('story_csv_')) {
                        preservedVotes[storyId] = rooms[roomId].votesPerStory[storyId];
                    }
                }
            }


            if (rooms[roomId].votesRevealed) {
                for (const storyId in rooms[roomId].votesRevealed) {
                    if (!storyId.startsWith('story_csv_')) {
                        preservedRevealed[storyId] = rooms[roomId].votesRevealed[storyId];
                    }
                }
            }

            rooms[roomId].votesPerStory = preservedVotes;
            rooms[roomId].votesRevealed = preservedRevealed;
            io.to(roomId).emit('syncCSVData', csvData);
        }
    });


    socket.on('exportVotes', () => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            rooms[roomId].lastActivity = Date.now();

            const exportData = {
                room: roomId,
                stories: rooms[roomId].csvData,
                votes: rooms[roomId].votesPerStory,
                revealed: rooms[roomId].votesRevealed,
                tickets: rooms[roomId].tickets.filter(t => !rooms[roomId].deletedStoryIds.has(t.id)),
                deletedStoryIds: Array.from(rooms[roomId].deletedStoryIds),
                timestamp: new Date().toISOString()
            };

            socket.emit('exportData', exportData);
        }
    });
});


const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
