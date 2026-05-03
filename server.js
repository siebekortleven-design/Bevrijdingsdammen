import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const rooms = new Map();

function makeCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function getRoomBySocket(socketId) {
  for (const [code, room] of rooms.entries()) {
    if (room.players.includes(socketId)) return [code, room];
  }
  return [null, null];
}

io.on('connection', (socket) => {
  socket.on('create-room', () => {
    let code;
    do { code = makeCode(); } while (rooms.has(code));
    rooms.set(code, { players: [socket.id], white: socket.id, black: null, pending: null });
    socket.join(code);
    socket.emit('room-created', { code });
  });

  socket.on('join-room', (code) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('room-error', 'Kamer niet gevonden');
    if (room.players.length >= 2) return socket.emit('room-error', 'Kamer is al vol');
    room.players.push(socket.id);
    room.black = socket.id;
    socket.join(code);
    socket.emit('room-joined', { code });
    io.to(code).emit('game-start');
  });

  socket.on('move', (move) => {
    const [code] = getRoomBySocket(socket.id);
    if (!code) return;
    socket.to(code).emit('opponent-move', move);
  });

  socket.on('request-action', (data) => {
    const [code, room] = getRoomBySocket(socket.id);
    if (!code || !room) return;
    const from = room.white === socket.id ? 'white' : 'black';
    room.pending = { ...data, from, roomCode: code };
    socket.to(code).emit('request-action', room.pending);
  });

  socket.on('action-response', (data) => {
    const [code, room] = getRoomBySocket(socket.id);
    if (!code || !room || !room.pending) return;
    const response = { ...room.pending, accepted: !!data.accepted };
    io.to(code).emit('action-response', response);
    room.pending = null;
  });

  socket.on('disconnect', () => {
    const [code] = getRoomBySocket(socket.id);
    if (!code) return;
    socket.to(code).emit('opponent-left');
    rooms.delete(code);
  });
});
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Game server running on port ${PORT}`);
});
