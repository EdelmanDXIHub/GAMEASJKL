export type Cell = {
  x: number;
  y: number;
};

export type MapTile = 0 | 1;

export type Direction = 'up' | 'down' | 'left' | 'right';

export type PlayerState = {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  mp: number;
  turn: number;
};

export type GameState = {
  players: PlayerState[];
  turn: number;
  phase: 'waiting' | 'player-turn' | 'enemy-turn';
};

export type PlayerMovedPayload = {
  playerId: string;
  from: Cell;
  to: Cell;
  path: Cell[];
};

export type StartTurnPayload = {
  playerId: string;
  turn: number;
};

export type EndTurnPayload = {
  playerId: string;
  turn: number;
};

export type CastSpellPayload = {
  playerId: string;
  spellId: string;
  target: Cell | null;
  range: number;
};

export type ClientToServerEvents = {
  joinGame: (payload: { name: string }) => void;
  movePlayer: (payload: PlayerMovedPayload) => void;
  endTurn: (payload: EndTurnPayload) => void;
  castSpell: (payload: CastSpellPayload) => void;
};

export type ServerToClientEvents = {
  gameState: (state: GameState) => void;
  playerMoved: (payload: PlayerMovedPayload) => void;
  startTurn: (payload: StartTurnPayload) => void;
  endTurn: (payload: EndTurnPayload) => void;
  castSpell: (payload: CastSpellPayload) => void;
};

export type MultiplayerPlayer = {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  shielding: boolean;
};

export type RoomClientMessage =
  | { type: 'join-game'; name: string }
  | { type: 'player-state'; state: Omit<MultiplayerPlayer, 'id' | 'name'> }
  | { type: 'leave-game' };

export type RoomServerMessage =
  | { type: 'game-joined'; playerId: string; players: MultiplayerPlayer[] }
  | { type: 'player-joined'; player: MultiplayerPlayer }
  | { type: 'player-updated'; player: MultiplayerPlayer }
  | { type: 'player-left'; playerId: string }
  | { type: 'game-error'; message: string };
