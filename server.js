const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');

const roomData = {}; // Holds state per room { roomId: { users: [], votes: {}, selectedStory: '' } }

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (!ext) {
        fs.readFile(path.join(__dirname, 'public', 'index.html'), (error, indexContent) => {
          if (error) {
            res.writeHead(500);
            res.end('Error loading index.html');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(indexContent);
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
    }
  });
});

const wss = new WebSocket.Server({ server });

// Track which clients belong to which rooms
const rooms = {}; // { roomId: [ws1, ws2, ...] }

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    try {
      const msg = JSON.parse(message);
      const { type, user, roomId, story, votes, index } = msg;

      // Handle user joining
      if (type === 'join') {
        ws.user = user;
        ws.roomId = roomId;

        if (!rooms[roomId]) rooms[roomId] = [];
        if (!roomData[roomId]) {
          roomData[roomId] = {
            users: [],
            votesByStory: {},
            selectedStory: null,
          };
        }
 // Prevent duplicate connections from same user
  if (!roomData[roomId].users.includes(user)) {
    roomData[roomId].users.push(user);
  }
        rooms[roomId].push(ws);
       // roomData[roomId].users.push(user);

        console.log(`User ${user} joined room ${roomId}`);

        // Notify others in the room
        broadcastToRoom(roomId, {
          type: 'userList',
          users: roomData[roomId].users,
        });

        // Also send current state (if any) to new user
        if (roomData[roomId].selectedStory) {
          ws.send(JSON.stringify({
            type: 'storyChange',
            story: roomData[roomId].selectedStory,
            index: 0,
          }));
        }

        const votes = roomData[roomId].votesByStory[roomData[roomId].selectedStory] || {};
        ws.send(JSON.stringify({
          type: 'voteUpdate',
          story: roomData[roomId].selectedStory,
          votes,
        }));
      }

      // Handle vote update
      if (type === 'voteUpdate') {
        if (!roomData[roomId].votesByStory[story]) {
          roomData[roomId].votesByStory[story] = {};
        }

        roomData[roomId].votesByStory[story] = {
          ...roomData[roomId].votesByStory[story],
          ...votes,
        };

        broadcastToRoom(roomId, {
          type: 'voteUpdate',
          story,
          votes: roomData[roomId].votesByStory[story],
        });
      }

      // Handle story change
      if (type === 'storyChange') {
        roomData[roomId].selectedStory = story;

        broadcastToRoom(roomId, {
          type: 'storyChange',
          story,
          index: index || 0,
        });
      }

    } catch (e) {
      console.error('Invalid message:', message);
    }
  });

ws.on('close', () => {
  const roomId = ws.roomId;
  const user = ws.user;

  if (roomId && rooms[roomId]) {
    // Remove WebSocket connection from room
    rooms[roomId] = rooms[roomId].filter(client => client !== ws);

    // Remove username from user list (if no other WS clients from same user)
    const otherSocketsWithSameUser = rooms[roomId].some(client => client.user === user);
    if (!otherSocketsWithSameUser && roomData[roomId]) {
      roomData[roomId].users = roomData[roomId].users.filter(u => u !== user);
    }

    // Broadcast new user list
    broadcastToRoom(roomId, {
      type: 'userList',
      users: roomData[roomId]?.users || [],
    });

    console.log(`User ${user} left room ${roomId}`);
  }
});


function broadcastToRoom(roomId, message) {
  if (!rooms[roomId]) return;
  const data = JSON.stringify(message);
  rooms[roomId].forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on ${PORT}`);
});
