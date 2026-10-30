import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

type PlayerState = { id: string; name: string; x: number; z: number; yaw: number; hp: number; shielding: boolean };
type Room = { code: string; players: Map<string, Connection> };
type ClientMessage =
  | { type: 'create-room'; name: string }
  | { type: 'join-room'; name: string; code: string }
  | { type: 'player-state'; state: Omit<PlayerState, 'id' | 'name'> }
  | { type: 'leave-room' };
type ServerMessage =
  | { type: 'room-joined'; playerId: string; code: string; players: PlayerState[] }
  | { type: 'player-joined'; player: PlayerState }
  | { type: 'player-updated'; player: PlayerState }
  | { type: 'player-left'; playerId: string }
  | { type: 'room-left' }
  | { type: 'room-error'; message: string };
type Connection = { socket: WebSocket; state: PlayerState; roomCode: string };

const port = Number(process.env.PORT ?? 8080);
const maxPlayers = 16;
const worldBounds = 40;
const rooms = new Map<string, Room>();
const sessions = new Map<WebSocket, string>();
const server = new WebSocketServer({ port, host: '0.0.0.0' });

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
function broadcast(room: Room, message: ServerMessage, except?: WebSocket): void {
  room.players.forEach(({ socket }) => { if (socket !== except) send(socket, message); });
}
function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return 'Arquera';
  return value.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20) || 'Arquera';
}
function makeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function removePlayer(socket: WebSocket): void {
  const playerId = sessions.get(socket);
  if (!playerId) return;
  sessions.delete(socket);
  for (const [code, room] of rooms) {
    if (!room.players.has(playerId)) continue;
    room.players.delete(playerId);
    broadcast(room, { type: 'player-left', playerId });
    if (room.players.size === 0) rooms.delete(code);
    return;
  }
}
function parseMessage(raw: WebSocket.RawData): ClientMessage | null {
  try {
    const value: unknown = JSON.parse(raw.toString());
    if (!value || typeof value !== 'object' || !('type' in value)) return null;
    return value as ClientMessage;
  } catch { return null; }
}
function createPlayer(socket: WebSocket, name: unknown, room: Room): void {
  if (room.players.size >= maxPlayers) {
    send(socket, { type: 'room-error', message: 'La sala está llena (máximo 16 jugadores).' });
    return;
  }
  const playerId = randomUUID();
  const slot = room.players.size;
  const player: PlayerState = {
    id: playerId, name: sanitizeName(name),
    x: -9.9 + (slot % 4) * 0.85, z: -9.9 + Math.floor(slot / 4) * 0.85,
    yaw: 0, hp: 100, shielding: false,
  };
  room.players.set(playerId, { socket, state: player, roomCode: room.code });
  sessions.set(socket, playerId);
  send(socket, { type: 'room-joined', playerId, code: room.code, players: Array.from(room.players.values(), (entry) => entry.state) });
  broadcast(room, { type: 'player-joined', player }, socket);
}

server.on('connection', (socket) => {
  socket.on('message', (raw) => {
    const message = parseMessage(raw);
    if (!message) { send(socket, { type: 'room-error', message: 'Mensaje de red no válido.' }); return; }
    if (message.type === 'create-room' || message.type === 'join-room') {
      removePlayer(socket);
      let room: Room | undefined;
      if (message.type === 'create-room') {
        room = { code: makeCode(), players: new Map() };
        rooms.set(room.code, room);
      } else {
        const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
        room = rooms.get(code);
        if (!room) { send(socket, { type: 'room-error', message: 'No existe una sala con ese código.' }); return; }
      }
      createPlayer(socket, message.name, room);
      return;
    }
    const playerId = sessions.get(socket);
    const room = playerId ? [...rooms.values()].find((candidate) => candidate.players.has(playerId)) : undefined;
    if (!playerId || !room) { send(socket, { type: 'room-error', message: 'Conéctate a una sala primero.' }); return; }
    if (message.type === 'leave-room') {
      removePlayer(socket);
      send(socket, { type: 'room-left' });
      return;
    }
    if (message.type === 'player-state') {
      const current = room.players.get(playerId);
      const state = message.state;
      if (!current || !state || !Number.isFinite(state.x) || !Number.isFinite(state.z) || !Number.isFinite(state.yaw)) return;
      current.state = {
        ...current.state,
        x: Math.max(-worldBounds, Math.min(worldBounds, state.x)),
        z: Math.max(-worldBounds, Math.min(worldBounds, state.z)),
        yaw: Math.max(-Math.PI * 8, Math.min(Math.PI * 8, state.yaw)),
        hp: Math.max(0, Math.min(100, Math.round(Number.isFinite(state.hp) ? state.hp : 100))),
        shielding: Boolean(state.shielding),
      };
      broadcast(room, { type: 'player-updated', player: current.state }, socket);
    }
  });
  socket.on('close', () => removePlayer(socket));
  socket.on('error', () => removePlayer(socket));
});
server.on('listening', () => console.log(`Servidor de salas Krikas escuchando en ws://0.0.0.0:${port}`));
