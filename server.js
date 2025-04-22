const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { parse } = require('url');
const formidable = require('formidable'); // Add this to handle file uploads

// Room state
const roomData = {};
const rooms = {}; // roomId: [ws1, ws2, ...]

const server = http.createServer((req, res) => {
  const parsedUrl = parse(req.url, true);

  // Handle file upload
  if (req.method === 'POST' && parsedUrl.pathname === '/upload') {
    const form = new formidable.IncomingForm({ uploadDir: path.join(__dirname, 'uploads'), keepExtensions: true });

    form.parse(req, (err, fields, files) => {
      if (err) {
        res.writeHead(500);
        res.end('File upload error');
        return;
      }

      // You can process or broadcast uploaded file info if needed
      res.writeHead(200);
      res.end(JSON.stringify({ fields, files }));
    });
    return;
  }

  // Serve static files
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
          res.writeHead(error ? 500 : 200, { 'Content-Type': 'text/html' });
          res.end(error ? 'Error loading index.html' : indexContent);
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

const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      const { type, user, roomId, story, votes, index } = msg;

      switch (type) {
        case 'join':
          handleJoin(ws, user, roomId);
          break;
        case 'voteUpdate':
          handleVoteUpdate(roomId, story, votes);
          break;
        case 'storyChange':
          handleStoryChange(roomId, story, index);
          break;
        case 'revealVotes':
          handleRevealVotes(roomId);
          break;
        case 'resetVotes':
          handleResetVotes(roomId, story);
          break;
        default:
          console.warn('Unhandled message type:', type);
      }
    } catch (e) {
      console.error('Invalid message:', message);
    }
  });

  ws.on('close', () => handleDisconnect(ws));
});

// --- Event Handlers ---

function handleJoin(ws, user, roomId) {
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

  if (!roomData[roomId].users.includes(user)) {
    roomData[roomId].users.push(user);
  }

  rooms[roomId].push(ws);

  console.log(`User ${user} joined room ${roomId}`);

  broadcastToRoom(roomId, {
    type: 'userList',
    users: roomData[roomId].users,
  });
 }
  const currentStory = roomData[roomId].selectedStory;
  if (currentStory) {
    ws.send(JSON.stringify({ type: 'storyChange', story: currentStory, index: 0 }));

    const currentVotes = roomData[roomId].votesByStory[currentStory] || {};
    ws.send(JSON.stringify({ type: 'voteUpdate', story: currentStory, votes: currentVotes }));
  }
}

function handleVoteUpdate(roomId, story, votes) {
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

function handleStoryChange(roomId, story, index) {
  roomData[roomId].selectedStory = story;

  broadcastToRoom(roomId, {
    type: 'storyChange',
    story,
    index: index || 0,
  });
}

function handleRevealVotes(roomId) {
  const story = roomData[roomId].selectedStory;
  const votes = roomData[roomId].votesByStory[story] || {};

  broadcastToRoom(roomId, {
    type: 'revealVotes',
    story,
    votes,
  });
}

function handleResetVotes(roomId, story) {
  if (roomData[roomId].votesByStory[story]) {
    roomData[roomId].votesByStory[story] = {};
  }

  broadcastToRoom(roomId, {
    type: 'voteUpdate',
    story,
    votes: {},
  });
}

function handleDisconnect(ws) {
  const roomId = ws.roomId;
  const user = ws.user;

  if (roomId && rooms[roomId]) {
    rooms[roomId] = rooms[roomId].filter(client => client !== ws);

    const userStillConnected = rooms[roomId].some(client => client.user === user);
    if (!userStillConnected && roomData[roomId]) {
      roomData[roomId].users = roomData[roomId].users.filter(u => u !== user);
    }

    broadcastToRoom(roomId, {
      type: 'userList',
      users: roomData[roomId]?.users || [],
    });

    console.log(`User ${user} left room ${roomId}`);
  }
}

// --- Utility ---

function broadcastToRoom(roomId, message) {
  if (!rooms[roomId]) return;
  const data = JSON.stringify(message);
  rooms[roomId].forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// --- Start Server ---

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on ${PORT}`);
});
