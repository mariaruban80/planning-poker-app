const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');

const rooms = {};

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
      // ✅ fallback to index.html for client-side routing (e.g., /room/xyz)
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



// ✅ Add this for Render HTTP port check
//const server = http.createServer((req, res) => {
  // res.writeHead(200);
  //res.end('WebSocket server is live');
//});

const wss = new WebSocket.Server({ server });

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    try {
      const msg = JSON.parse(message);
      const { type, user, roomId, ...rest } = msg;

      if (type === 'join') {
        ws.user = user;
        ws.roomId = roomId;

        if (!rooms[roomId]) rooms[roomId] = [];
        rooms[roomId].push(ws);

        broadcastToRoom(roomId, {
          type: 'userList',
          users: rooms[roomId].map(client => client.user),
        });
      }

      if (['voteUpdate', 'storyChange'].includes(type)) {
        broadcastToRoom(roomId, { type, user, ...rest });
      }

    } catch (e) {
      console.error('Invalid message:', message);
    }
  });

  ws.on('close', () => {
    const roomId = ws.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(client => client !== ws);
      broadcastToRoom(roomId, {
        type: 'userList',
        users: rooms[roomId].map(client => client.user),
      });
    }
  });
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
