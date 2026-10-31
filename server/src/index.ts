import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

type PlayerState = { id: string; name: string; x: number; z: number; yaw: number; hp: number; wood: number; shielding: boolean };
type WorldLocation = 'taganga' | 'centro' | 'rodadero' | 'gaira' | 'libano' | 'mamatoco' | 'bonda' | 'brumalia';
type BuildingKind = 'floor' | 'wall' | 'house' | 'campfire';
type WorldCell = { x: number; y: number };
type HealingTilePosition = { tileId: WorldLocation; cell: WorldCell };
type BuildingRecord = { id: string; kind: BuildingKind; cell: WorldCell; rotation: number };
type Room = {
  code: string;
  location: WorldLocation;
  players: Map<string, Connection>;
  healingTiles: Map<WorldLocation, WorldCell>;
  harvestedTrees: Set<string>;
  buildings: BuildingRecord[];
};
type ClientMessage =
  | { type: 'create-room'; name: string }
  | { type: 'join-room'; name: string; code: string }
  | { type: 'player-state'; state: Omit<PlayerState, 'id' | 'name' | 'wood'> }
  | { type: 'travel-to-location'; location: WorldLocation }
  | { type: 'healing-tiles-sync'; tiles: HealingTilePosition[] }
  | { type: 'healing-tile-moved'; tileId: WorldLocation; cell: WorldCell }
  | { type: 'harvest-wood'; treeId: string }
  | { type: 'place-building'; kind: BuildingKind; cell: WorldCell; rotation?: number }
  | { type: 'leave-room' };
type ServerMessage =
  | { type: 'room-joined'; playerId: string; code: string; location: WorldLocation; players: PlayerState[]; healingTiles: HealingTilePosition[]; harvestedTrees: string[]; buildings: BuildingRecord[] }
  | { type: 'player-joined'; player: PlayerState }
  | { type: 'player-updated'; player: PlayerState }
  | { type: 'player-left'; playerId: string }
  | { type: 'healing-tile-moved'; tileId: WorldLocation; cell: WorldCell }
  | { type: 'wood-collected'; playerId: string; treeId: string; wood: number }
  | { type: 'tree-harvested'; playerId: string; treeId: string; wood: number }
  | { type: 'wood-harvest-denied'; treeId: string }
  | { type: 'building-placed'; builderId: string; building: BuildingRecord; wood: number }
  | { type: 'build-error'; message: string }
  | { type: 'room-left' }
  | { type: 'room-error'; message: string };
type Connection = { socket: WebSocket; state: PlayerState; roomCode: string };

const port = Number(process.env.PORT ?? 8080);
const maxPlayers = 16;
const worldBounds = 90;
const worldGridWidth = 64;
const worldGridHeight = 56;
const worldSpawnCells: Record<WorldLocation, { x: number; y: number }> = {
  taganga: { x: 10, y: 7 }, centro: { x: 21, y: 21 }, rodadero: { x: 28, y: 38 },
  gaira: { x: 37, y: 46 }, libano: { x: 38, y: 23 }, mamatoco: { x: 48, y: 17 },
  bonda: { x: 50, y: 36 }, brumalia: { x: 54, y: 7 },
};
const buildingCosts: Record<BuildingKind, number> = { floor: 2, wall: 3, house: 12, campfire: 5 };
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
function isWorldLocation(value: unknown): value is WorldLocation {
  return value === 'taganga' || value === 'centro' || value === 'rodadero' || value === 'gaira'
    || value === 'libano' || value === 'mamatoco' || value === 'bonda' || value === 'brumalia';
}
function isWorldCell(value: unknown): value is WorldCell {
  if (!value || typeof value !== 'object' || !('x' in value) || !('y' in value)) return false;
  const cell = value as Record<string, unknown>;
  return Number.isInteger(cell.x) && Number.isInteger(cell.y)
    && Number(cell.x) >= 2 && Number(cell.x) < worldGridWidth - 2
    && Number(cell.y) >= 2 && Number(cell.y) < worldGridHeight - 2;
}
function isBuildingKind(value: unknown): value is BuildingKind {
  return value === 'floor' || value === 'wall' || value === 'house' || value === 'campfire';
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
  const spawn = worldSpawnCells[room.location];
  const player: PlayerState = {
    id: playerId, name: sanitizeName(name),
    x: (spawn.x - 31.5) * 2.2 + (slot % 4) * 0.9,
    z: (spawn.y - 27.5) * 2.2 + Math.floor(slot / 4) * 0.9,
    yaw: 0, hp: 100, wood: 0, shielding: false,
  };
  room.players.set(playerId, { socket, state: player, roomCode: room.code });
  sessions.set(socket, playerId);
  send(socket, {
    type: 'room-joined', playerId, code: room.code, location: room.location,
    players: Array.from(room.players.values(), (entry) => entry.state),
    healingTiles: Array.from(room.healingTiles, ([tileId, cell]) => ({ tileId, cell })),
    harvestedTrees: Array.from(room.harvestedTrees),
    buildings: room.buildings,
  });
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
        room = {
          code: makeCode(), location: 'brumalia', players: new Map(), healingTiles: new Map(),
          harvestedTrees: new Set(), buildings: [],
        };
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
    if (message.type === 'travel-to-location') {
      if (!isWorldLocation(message.location)) {
        send(socket, { type: 'room-error', message: 'Ese barrio no existe.' });
        return;
      }
      room.location = message.location;
      return;
    }
    if (message.type === 'healing-tiles-sync') {
      if (room.healingTiles.size === 0 && Array.isArray(message.tiles)) {
        message.tiles.forEach((entry) => {
          if (entry && typeof entry === 'object' && isWorldLocation(entry.tileId) && isWorldCell(entry.cell)) {
            room.healingTiles.set(entry.tileId, entry.cell);
          }
        });
      }
      return;
    }
    if (message.type === 'healing-tile-moved') {
      if (!isWorldLocation(message.tileId) || !isWorldCell(message.cell)) return;
      room.healingTiles.set(message.tileId, message.cell);
      broadcast(room, { type: 'healing-tile-moved', tileId: message.tileId, cell: message.cell }, socket);
      return;
    }
    if (message.type === 'harvest-wood') {
      const current = room.players.get(playerId);
      const match = typeof message.treeId === 'string' ? /^(\d{1,2}):(\d{1,2})$/.exec(message.treeId) : null;
      if (!current || !match) { send(socket, { type: 'wood-harvest-denied', treeId: String(message.treeId || '') }); return; }
      const x = Number(match[1]); const y = Number(match[2]);
      if (x < 1 || x >= worldGridWidth - 1 || y < 1 || y >= worldGridHeight - 1) {
        send(socket, { type: 'wood-harvest-denied', treeId: message.treeId });
        return;
      }
      if (room.harvestedTrees.has(message.treeId)) {
        send(socket, { type: 'tree-harvested', playerId, treeId: message.treeId, wood: current.state.wood });
        return;
      }
      const treeX = (x - (worldGridWidth - 1) / 2) * 2.2;
      const treeZ = (y - (worldGridHeight - 1) / 2) * 2.2;
      if (Math.hypot(current.state.x - treeX, current.state.z - treeZ) > 5.5) {
        send(socket, { type: 'wood-harvest-denied', treeId: message.treeId });
        return;
      }
      room.harvestedTrees.add(message.treeId);
      current.state.wood += 3;
      broadcast(room, { type: 'wood-collected', playerId, treeId: message.treeId, wood: current.state.wood });
      return;
    }
    if (message.type === 'place-building') {
      const current = room.players.get(playerId);
      if (!current || !isBuildingKind(message.kind) || !isWorldCell(message.cell)) {
        send(socket, { type: 'build-error', message: 'La ubicación o la pieza no es válida.' });
        return;
      }
      const cost = buildingCosts[message.kind];
      if (current.state.wood < cost) {
        send(socket, { type: 'build-error', message: `Necesitas ${cost} bloques de madera para construir ${message.kind}.` });
        return;
      }
      const targetX = (message.cell.x - (worldGridWidth - 1) / 2) * 2.2;
      const targetZ = (message.cell.y - (worldGridHeight - 1) / 2) * 2.2;
      if (Math.hypot(current.state.x - targetX, current.state.z - targetZ) > 14) {
        send(socket, { type: 'build-error', message: 'Acércate al lugar donde quieres construir.' });
        return;
      }
      if (room.buildings.some((building) => building.cell.x === message.cell.x && building.cell.y === message.cell.y)) {
        send(socket, { type: 'build-error', message: 'Esa casilla ya está ocupada.' });
        return;
      }
      const rotation = Number.isInteger(message.rotation) ? ((Number(message.rotation) % 4) + 4) % 4 : 0;
      const building: BuildingRecord = { id: randomUUID(), kind: message.kind, cell: message.cell, rotation };
      room.buildings.push(building);
      current.state.wood -= cost;
      broadcast(room, { type: 'building-placed', builderId: playerId, building, wood: current.state.wood });
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
