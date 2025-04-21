const WebSocket = require('ws');
const http = require('http');

const rooms = {};

const server = http.createServer();
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
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
