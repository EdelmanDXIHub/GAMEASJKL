import * as THREE from 'three';
import { Grid } from '../../../shared/src/grid/Grid';
import { aStar, hasLineOfSight, manhattanDistance } from '../../../shared/src/pathfinding/astar';
import type { Cell } from '../../../shared/src/types/network';

const GRID_WIDTH = 64;
const GRID_HEIGHT = 56;
const CELL_SIZE = 2.2;
const PLAYER_HEIGHT = 1.65;
const PLAYER_SPEED = 4.8;
const SPRINT_MULTIPLIER = 1.65;
const JUMP_SPEED = 6.5;
const GRAVITY = 18;
const ENEMY_STEP_DURATION = 0.54;
const COVER_STEP_DURATION = 0.42;
const ARROW_RANGE = 100;
type SkillId = 'earth' | 'wind' | 'water';
type Phase = 'ready' | 'combat' | 'victory' | 'defeat';
type WorldLocationId = 'taganga' | 'centro' | 'rodadero' | 'gaira' | 'libano' | 'mamatoco' | 'bonda' | 'brumalia';
type BuildingKind = 'floor' | 'wall' | 'house' | 'campfire';
type BuildingRecord = { id: string; kind: BuildingKind; cell: Cell; rotation?: number };
type BuildingInstance = BuildingRecord & { group: THREE.Group };
const BUILDING_COST: Record<BuildingKind, number> = { floor: 2, wall: 3, house: 12, campfire: 5 };
const BUILDING_NAME: Record<BuildingKind, string> = { floor: 'Piso', wall: 'Muro', house: 'Casa', campfire: 'Fogata' };
const WORLD_CENTERS: Record<WorldLocationId, Cell> = {
  taganga: { x: 10, y: 7 }, centro: { x: 21, y: 21 }, rodadero: { x: 28, y: 38 },
  gaira: { x: 37, y: 46 }, libano: { x: 38, y: 23 }, mamatoco: { x: 48, y: 17 },
  bonda: { x: 50, y: 36 }, brumalia: { x: 54, y: 7 },
};
const WORLD_ROUTES: Array<[WorldLocationId, WorldLocationId]> = [
  ['taganga', 'centro'], ['centro', 'rodadero'], ['rodadero', 'gaira'],
  ['gaira', 'bonda'], ['bonda', 'mamatoco'], ['mamatoco', 'brumalia'],
  ['centro', 'libano'], ['libano', 'mamatoco'],
];

function distanceToWorldRoute(x: number, y: number): number {
  return Math.min(...WORLD_ROUTES.map(([from, to]) => {
    const a = WORLD_CENTERS[from]; const b = WORLD_CENTERS[to];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
  }));
}

function buildWorldObstacles(): Array<[number, number]> {
  const obstacles: Array<[number, number]> = [];
  const enemyOffsets: Cell[] = [{ x: 7, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 2 }, { x: 4, y: 8 }];
  for (let x = 0; x < GRID_WIDTH; x++) obstacles.push([x, 0], [x, GRID_HEIGHT - 1]);
  for (let y = 1; y < GRID_HEIGHT - 1; y++) obstacles.push([0, y], [GRID_WIDTH - 1, y]);
  for (let y = 1; y < GRID_HEIGHT - 1; y++) {
    for (let x = 1; x < GRID_WIDTH - 1; x++) {
      const nearNeighborhood = Object.values(WORLD_CENTERS).some((center) => Math.hypot(x - center.x, y - center.y) < 5);
      const nearEnemySpawn = Object.values(WORLD_CENTERS).some((center) => enemyOffsets.some((offset) =>
        Math.hypot(x - center.x - offset.x, y - center.y - offset.y) < 2,
      ));
      if (!nearNeighborhood && !nearEnemySpawn && distanceToWorldRoute(x, y) > 2.6 && (x * 37 + y * 71) % 173 < 2) obstacles.push([x, y]);
    }
  }
  return obstacles;
}

const OBSTACLES = buildWorldObstacles();
type EnemyModel = 'archer' | 'crab' | 'shadow' | 'wraith';
type LandmarkKind = 'palm' | 'rocks' | 'flowers' | 'market' | 'lantern' | 'bench' | 'reeds' | 'fallen-log' | 'mushrooms' | 'umbrella' | 'crates' | 'sign' | 'ruins' | 'bush';
type EnemyDefinition = { id: string; name: string; cell: Cell; hp: number; color: number; model: EnemyModel };
type WorldEncounter = {
  background: number;
  ground: number;
  tiles: [number, number];
  enemies: EnemyDefinition[];
};

const WORLD_LOCATION_DESCRIPTIONS: Record<WorldLocationId, string> = {
  taganga: 'Bahia pesquera al norte de Santa Marta, entre acantilados y aguas profundas.',
  centro: 'Calles antiguas junto a la bahia, plazas, mercado y el puerto de la ciudad.',
  rodadero: 'Playa amplia al sur de la bahia, con muelles, comercios y caletas cercanas.',
  gaira: 'Antiguo poblado costero al sur, entre el rio, la via del tren y la montana.',
  libano: 'Barrio de ladera con callejones, escalinatas y miradores sobre la ciudad.',
  mamatoco: 'Cruce oriental de caminos hacia los barrios altos y las estribaciones.',
  bonda: 'Poblado ribereno en la ruta que sube desde la ciudad hacia la Sierra Nevada.',
  brumalia: 'Bosque antiguo en las faldas de la Sierra, territorio de los chirretes del pando.',
};
const WORLD_LANDMARKS: Record<WorldLocationId, LandmarkKind[]> = {
  taganga: ['palm', 'rocks', 'crates', 'reeds', 'flowers', 'sign', 'rocks', 'palm', 'bench', 'bush', 'crates', 'flowers'],
  centro: ['market', 'crates', 'lantern', 'bench', 'market', 'sign', 'flowers', 'bush', 'ruins', 'lantern', 'crates', 'bench'],
  rodadero: ['palm', 'umbrella', 'rocks', 'flowers', 'umbrella', 'sign', 'palm', 'bush', 'crates', 'flowers', 'rocks', 'umbrella'],
  gaira: ['reeds', 'palm', 'fallen-log', 'crates', 'rocks', 'sign', 'flowers', 'bush', 'bench', 'reeds', 'palm', 'rocks'],
  libano: ['rocks', 'lantern', 'ruins', 'flowers', 'sign', 'bush', 'rocks', 'bench', 'lantern', 'crates', 'flowers', 'ruins'],
  mamatoco: ['sign', 'rocks', 'crates', 'bush', 'ruins', 'flowers', 'lantern', 'bench', 'rocks', 'sign', 'fallen-log', 'bush'],
  bonda: ['reeds', 'palm', 'fallen-log', 'rocks', 'flowers', 'crates', 'palm', 'bush', 'bench', 'reeds', 'rocks', 'flowers'],
  brumalia: ['mushrooms', 'fallen-log', 'flowers', 'rocks', 'bush', 'ruins', 'mushrooms', 'fallen-log', 'lantern', 'flowers', 'rocks', 'bush'],
};
const COASTAL_LOCATIONS = new Set<WorldLocationId>(['taganga', 'rodadero', 'gaira']);

const WORLD_ENCOUNTERS: Record<WorldLocationId, WorldEncounter> = {
  taganga: {
    background: 0x9db8bd, ground: 0x567a7c, tiles: [0x688b82, 0x5a7b73],
    enemies: [
      { id: 'taganga-rock-crab', name: 'Cangrejo de roca', cell: { x: 8, y: 2 }, hp: 72, color: 0xc7694a, model: 'crab' },
      { id: 'taganga-hermit-crab', name: 'Cangrejo ermitaño', cell: { x: 9, y: 2 }, hp: 82, color: 0xd99554, model: 'crab' },
      { id: 'taganga-reef-crab', name: 'Cangrejo del arrecife', cell: { x: 9, y: 3 }, hp: 78, color: 0x9a5141, model: 'crab' },
      { id: 'taganga-shore-crab', name: 'Cangrejo de la orilla', cell: { x: 5, y: 9 }, hp: 90, color: 0xc77b43, model: 'crab' },
    ],
  },
  centro: {
    background: 0xbab6a8, ground: 0x777263, tiles: [0x928a75, 0x807965],
    enemies: [
      { id: 'centro-market-raider', name: 'Saqueador del mercado', cell: { x: 8, y: 2 }, hp: 72, color: 0x8c4f43, model: 'archer' },
      { id: 'centro-harbor-watch', name: 'Vigía del puerto', cell: { x: 9, y: 2 }, hp: 82, color: 0x536e7e, model: 'archer' },
      { id: 'centro-bay-raider', name: 'Bandido de la bahía', cell: { x: 9, y: 3 }, hp: 78, color: 0x765341, model: 'archer' },
      { id: 'centro-square-scout', name: 'Explorador de la plaza', cell: { x: 5, y: 9 }, hp: 90, color: 0x607a4c, model: 'archer' },
    ],
  },
  rodadero: {
    background: 0xc8c6b2, ground: 0xb69c70, tiles: [0xd1b982, 0xc5ad79],
    enemies: [
      { id: 'rodadero-red-crab', name: 'Cangrejo rojo', cell: { x: 8, y: 2 }, hp: 78, color: 0xd85d46, model: 'crab' },
      { id: 'rodadero-sand-crab', name: 'Cangrejo de arena', cell: { x: 9, y: 2 }, hp: 86, color: 0xd99b55, model: 'crab' },
      { id: 'rodadero-giant-crab', name: 'Cangrejo gigante', cell: { x: 9, y: 3 }, hp: 112, color: 0xa94338, model: 'crab' },
      { id: 'rodadero-rock-crab', name: 'Cangrejo de muelle', cell: { x: 5, y: 9 }, hp: 94, color: 0xba6748, model: 'crab' },
    ],
  },
  gaira: {
    background: 0xb4b79c, ground: 0x8c8a62, tiles: [0xa3a071, 0x928f65],
    enemies: [
      { id: 'gaira-river-crab', name: 'Cangrejo del estuario', cell: { x: 8, y: 2 }, hp: 76, color: 0xb95d43, model: 'crab' },
      { id: 'gaira-rail-guard', name: 'Guardia ferroviario', cell: { x: 9, y: 2 }, hp: 86, color: 0x536e7e, model: 'archer' },
      { id: 'gaira-track-raider', name: 'Saqueador de la vía', cell: { x: 9, y: 3 }, hp: 82, color: 0x8c4f43, model: 'archer' },
      { id: 'gaira-river-rock-crab', name: 'Cangrejo de río', cell: { x: 5, y: 9 }, hp: 90, color: 0xd18a4c, model: 'crab' },
    ],
  },
  libano: {
    background: 0xa9a596, ground: 0x686451, tiles: [0x817b65, 0x726c59],
    enemies: [
      { id: 'libano-alley-scout', name: 'Vigía del callejón', cell: { x: 8, y: 2 }, hp: 78, color: 0x607a4c, model: 'archer' },
      { id: 'libano-hill-raider', name: 'Bandido de la ladera', cell: { x: 9, y: 2 }, hp: 88, color: 0x8c4f43, model: 'archer' },
      { id: 'libano-stair-guard', name: 'Guardián de las escaleras', cell: { x: 9, y: 3 }, hp: 82, color: 0x536e7e, model: 'archer' },
      { id: 'libano-lookout', name: 'Explorador del mirador', cell: { x: 5, y: 9 }, hp: 92, color: 0x80633f, model: 'shadow' },
    ],
  },
  mamatoco: {
    background: 0xb3b99d, ground: 0x6c7650, tiles: [0x89916a, 0x778158],
    enemies: [
      { id: 'mamatoco-crossing-scout', name: 'Explorador del cruce', cell: { x: 8, y: 2 }, hp: 74, color: 0x607a4c, model: 'archer' },
      { id: 'mamatoco-stone-guard', name: 'Guardián de piedra', cell: { x: 9, y: 2 }, hp: 90, color: 0x72766b, model: 'archer' },
      { id: 'mamatoco-road-raider', name: 'Saqueador del camino', cell: { x: 9, y: 3 }, hp: 82, color: 0x8c4f43, model: 'archer' },
      { id: 'mamatoco-sierra-scout', name: 'Vigía de la Sierra', cell: { x: 5, y: 9 }, hp: 94, color: 0x536e7e, model: 'archer' },
    ],
  },
  bonda: {
    background: 0xa7b59a, ground: 0x5b7050, tiles: [0x78906a, 0x68805d],
    enemies: [
      { id: 'bonda-river-crab', name: 'Cangrejo del río Bonda', cell: { x: 8, y: 2 }, hp: 78, color: 0xc46e45, model: 'crab' },
      { id: 'bonda-river-guard', name: 'Guardián ribereño', cell: { x: 9, y: 2 }, hp: 88, color: 0x536e7e, model: 'archer' },
      { id: 'bonda-bank-crab', name: 'Cangrejo de la orilla', cell: { x: 9, y: 3 }, hp: 82, color: 0xd29350, model: 'crab' },
      { id: 'bonda-trail-raider', name: 'Saqueador del camino', cell: { x: 5, y: 9 }, hp: 92, color: 0x8c4f43, model: 'wraith' },
    ],
  },
  brumalia: {
    background: 0x9cad94, ground: 0x304f3e, tiles: [0x466d50, 0x3d6249],
    enemies: [
      { id: 'mossling', name: 'Musguito', cell: { x: 8, y: 2 }, hp: 72, color: 0x607a4c, model: 'archer' },
      { id: 'thornling', name: 'Espinajo', cell: { x: 9, y: 2 }, hp: 82, color: 0x8c4f43, model: 'archer' },
      { id: 'mireling', name: 'Lodoso', cell: { x: 9, y: 3 }, hp: 78, color: 0x536e7e, model: 'archer' },
      { id: 'wildling', name: 'Silvestre', cell: { x: 5, y: 9 }, hp: 90, color: 0x80633f, model: 'archer' },
      { id: 'shadow-stalker', name: 'Acechador de sombra', cell: { x: 5, y: 5 }, hp: 108, color: 0x382c4f, model: 'shadow' },
      { id: 'sierra-wraith', name: 'Aparición de la Sierra', cell: { x: 3, y: 7 }, hp: 126, color: 0x7d91a0, model: 'wraith' },
    ],
  },
};

type EnemyState = {
  id: string;
  location: WorldLocationId;
  name: string;
  cell: Cell;
  hp: number;
  maxHp: number;
  color: number;
  model: EnemyModel;
  group: THREE.Group;
  bow: THREE.Object3D | null;
  bowString: THREE.Object3D | null;
  bowArrow: THREE.Object3D | null;
  attackCooldown: number;
  replanTimer: number;
  stepTarget: Cell | null;
  stepElapsed: number;
  stepStart: THREE.Vector3;
  stepEnd: THREE.Vector3;
  slowTimer: number;
  lastKnownPlayerCell: Cell;
  lastSeenTimer: number;
  searchTimer: number;
  searchTarget: Cell | null;
  patrolTarget: Cell | null;
  needsCover: boolean;
  coverTarget: Cell | null;
  coverPath: Cell[];
  coverCooldown: number;
  coverTimer: number;
  isHiding: boolean;
};

type VisualEffect = {
  object: THREE.Object3D;
  elapsed: number;
  duration: number;
  update: (progress: number) => void;
  finish?: () => void;
  sourceEnemy?: EnemyState;
};

type SkillState = {
  cooldown: number;
};
type HealingTileState = {
  id: WorldLocationId;
  location: WorldLocationId;
  cell: Cell;
  group: THREE.Group;
  glowMaterial: THREE.MeshBasicMaterial;
};
type LevelTileState = { cell: Cell; group: THREE.Group; phase: number };

type NetworkPlayer = { id: string; name: string; x: number; z: number; yaw: number; hp: number; wood: number; shielding: boolean };
type RemotePlayer = { group: THREE.Group; target: THREE.Vector3; yaw: number };
const WORLD_LOCATION_IDS: WorldLocationId[] = ['taganga', 'centro', 'rodadero', 'gaira', 'libano', 'mamatoco', 'bonda', 'brumalia'];

function isWorldLocation(value: unknown): value is WorldLocationId {
  return typeof value === 'string' && WORLD_LOCATION_IDS.includes(value as WorldLocationId);
}
function isBuildingKind(value: unknown): value is BuildingKind {
  return value === 'floor' || value === 'wall' || value === 'house' || value === 'campfire';
}

export class RealtimeGame {
  private readonly root: HTMLElement;
  private readonly world: HTMLElement;
  private readonly worldMap: HTMLElement;
  private readonly mapLocationTitle: HTMLElement;
  private readonly mapLocationDescription: HTMLElement;
  private readonly locationLabel: HTMLElement;
  private readonly waypointLabel: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 180);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly grid = new Grid(GRID_WIDTH, GRID_HEIGHT, OBSTACLES);
  private currentLocation: WorldLocationId = 'brumalia';
  private readonly ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_WIDTH * CELL_SIZE + 12, GRID_HEIGHT * CELL_SIZE + 12),
    new THREE.MeshStandardMaterial({ color: 0x304f3e, roughness: 1 }),
  );
  private readonly worldAmbientLight = new THREE.HemisphereLight(0xe4f0dc, 0x344433, 2.1);
  private readonly worldSunlight = new THREE.DirectionalLight(0xffe6b6, 2.5);
  private readonly treeTrunkGeometry = new THREE.CylinderGeometry(0.2, 0.38, 3.1, 9, 3);
  private readonly treeRootGeometry = new THREE.CylinderGeometry(0.36, 0.52, 0.52, 8);
  private readonly treeBranchGeometry = new THREE.CylinderGeometry(0.035, 0.13, 1.35, 7);
  private readonly treeLeafGeometry = new THREE.IcosahedronGeometry(0.82, 1);
  private readonly treeBarkMaterial = new THREE.MeshStandardMaterial({ color: 0x69492d, roughness: 1 });
  private readonly treeRootMaterial = new THREE.MeshStandardMaterial({ color: 0x513a27, roughness: 1 });
  private readonly treeBranchMaterial = new THREE.MeshStandardMaterial({ color: 0x60432b, roughness: 1 });
  private readonly treeLeafMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x28583c, roughness: 0.96, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x346b43, roughness: 0.96, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x47784a, roughness: 0.96, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x527d4d, roughness: 0.96, flatShading: true }),
  ];
  private readonly landmarkBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly landmarkRockGeometry = new THREE.IcosahedronGeometry(0.72, 0);
  private readonly landmarkWoodPostGeometry = new THREE.CylinderGeometry(0.09, 0.13, 1, 6);
  private readonly landmarkReedGeometry = new THREE.CylinderGeometry(0.035, 0.055, 1, 5);
  private readonly landmarkLeafGeometry = new THREE.ConeGeometry(0.28, 1.35, 5);
  private readonly landmarkFlowerGeometry = new THREE.SphereGeometry(0.13, 6, 4);
  private readonly landmarkBarrelGeometry = new THREE.CylinderGeometry(0.36, 0.4, 0.85, 8);
  private readonly landmarkMushroomStemGeometry = new THREE.CylinderGeometry(0.11, 0.14, 0.34, 7);
  private readonly landmarkMushroomCapGeometry = new THREE.SphereGeometry(0.27, 8, 5);
  private readonly landmarkAwningGeometry = new THREE.ConeGeometry(1, 0.42, 8);
  private readonly landmarkWoodMaterial = new THREE.MeshStandardMaterial({ color: 0x79542f, roughness: 0.92 });
  private readonly landmarkDarkWoodMaterial = new THREE.MeshStandardMaterial({ color: 0x503b2b, roughness: 0.96 });
  private readonly landmarkStoneMaterial = new THREE.MeshStandardMaterial({ color: 0x77786a, roughness: 0.98, flatShading: true });
  private readonly landmarkLeafMaterial = new THREE.MeshStandardMaterial({ color: 0x397344, roughness: 0.95, flatShading: true });
  private readonly landmarkGrassMaterial = new THREE.MeshStandardMaterial({ color: 0x779653, roughness: 1 });
  private readonly landmarkFlowerMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xf0d47b, roughness: 0.72, emissive: 0x392b08 }),
    new THREE.MeshStandardMaterial({ color: 0xd98ca8, roughness: 0.75 }),
  ];
  private readonly landmarkFabricMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xb94f3c, roughness: 0.92 }),
    new THREE.MeshStandardMaterial({ color: 0xe4c982, roughness: 0.9 }),
  ];
  private readonly landmarkGlowMaterial = new THREE.MeshStandardMaterial({ color: 0xffd37a, emissive: 0xe59a3a, emissiveIntensity: 1.5 });
  private readonly tiles: Array<{ cell: Cell; baseColor: THREE.Color }> = [];
  private readonly healingTiles: HealingTileState[] = [];
  private readonly levelTiles: LevelTileState[] = [];
  private occupiedHealingTile: string | null = null;
  private terrainMesh!: THREE.InstancedMesh;
  private playerBowVisual!: THREE.Group;
  private playerBowString!: THREE.Object3D;
  private playerBowArrow!: THREE.Object3D;
  private readonly forestProps: THREE.Group[] = [];
  private readonly coastalObstacleProps: THREE.Group[] = [];
  private readonly landmarkCollisionRadii: number[] = [];
  private readonly landmarkProps: THREE.Group[] = [];
  private readonly enemies: EnemyState[] = [];
  private readonly effects: VisualEffect[] = [];
  private readonly keys = new Set<string>();
  private readonly skillStates: Record<SkillId, SkillState> = {
    earth: { cooldown: 0 },
    wind: { cooldown: 0 },
    water: { cooldown: 0 },
  };

  private readonly playerCell: Cell = { ...WORLD_CENTERS.brumalia };
  private destinationLocation: WorldLocationId | null = null;
  private playerHp = 100;
  private playerMaxHp = 100;
  private playerLevel = 1;
  private levelTileProgress = 0;
  private playerSpeedBoost = 0;
  private bowCooldown = 0;
  private phase: Phase = 'ready';
  private selectedSkill: SkillId | null = null;
  private notice = '';
  private yaw = 0;
  private pitch = -0.035;
  private dragging = false;
  private aiming = false;
  private pointerLocked = false;
  private nativePointerLock = false;
  private lockingMouse = false;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private leftButtonHeld = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private isShielding = false;
  private invulnerable = false;
  private isGrounded = true;
  private verticalVelocity = 0;
  private readonly shieldVisual: THREE.Group;
  private readonly flashlightVisual = new THREE.Group();
  private readonly flashlightSpot = new THREE.SpotLight(0xffe4a6, 5.2, 30, 0.42, 0.58, 1.45);
  private flashlightOn = false;
  private worldCycleElapsed = 0;
  private nightBlend = 0;
  private animationFrame = 0;
  private previousFrameTime = 0;

  private readonly hoverCard: HTMLElement;
  private readonly hoverName: HTMLElement;
  private readonly hoverRole: HTMLElement;
  private readonly hoverHealth: HTMLElement;
  private readonly hoverMove: HTMLElement;
  private readonly hoverHealthFill: HTMLElement;
  private readonly healthLabel: HTMLElement;
  private readonly levelLabel: HTMLElement;
  private readonly shieldLabel: HTMLElement;
  private readonly enemyCountLabel: HTMLElement;
  private readonly turnIndicator: HTMLElement;
  private readonly dayNightLabel: HTMLElement;
  private readonly turnMessage: HTMLElement;
  private readonly defeatMenu: HTMLElement;
  private readonly startMenu: HTMLElement;
  private readonly skillButtons = new Map<SkillId, HTMLButtonElement>();
  private readonly mapLocationButtons = new Map<WorldLocationId, HTMLButtonElement>();
  private readonly remotePlayers = new Map<string, RemotePlayer>();
  private roomSocket: WebSocket | null = null;
  private roomCode = '';
  private localPlayerId = '';
  private roomJoined = false;
  private networkUpdateElapsed = 0;
  private readonly roomLobby: HTMLElement;
  private readonly roomStatus: HTMLElement;
  private readonly roomConnected: HTMLElement;
  private readonly roomCodeDisplay: HTMLElement;
  private readonly roomMembers: HTMLElement;
  private readonly roomButton: HTMLButtonElement;
  private audioContext: AudioContext | null = null;
  private shieldFlashTimer = 0;
  private readonly woodLabel: HTMLElement;
  private readonly buildWoodValue: HTMLElement;
  private readonly buildPanel: HTMLElement;
  private readonly buildButtons = new Map<BuildingKind, HTMLButtonElement>();
  private readonly builtStructures: BuildingInstance[] = [];
  private buildPreview!: THREE.Group;
  private selectedBuilding: BuildingKind | null = null;
  private buildingRotation = 0;
  private woodCount = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.world = this.getElement('#world');
    this.worldMap = this.getElement('#world-map');
    this.mapLocationTitle = this.getElement('#map-location-title');
    this.mapLocationDescription = this.getElement('#map-location-description');
    this.locationLabel = this.getElement('#location-label');
    this.waypointLabel = this.getElement('#world-waypoint');
    this.hoverCard = this.getElement('#hover-card');
    this.hoverName = this.getElement('#hover-name');
    this.hoverRole = this.getElement('#hover-role');
    this.hoverHealth = this.getElement('#hover-health');
    this.hoverMove = this.getElement('#hover-move');
    this.hoverHealthFill = this.getElement('#hover-health-fill');
    this.healthLabel = this.getElement('#player-health');
    this.levelLabel = this.getElement('#player-level');
    this.shieldLabel = this.getElement('#player-shield');
    this.enemyCountLabel = this.getElement('#enemy-count');
    this.turnIndicator = this.getElement('#turn-indicator');
    this.dayNightLabel = this.getElement('#day-night-label');
    this.turnMessage = this.getElement('#turn-message');
    this.defeatMenu = this.getElement('#defeat-menu');
    this.startMenu = this.getElement('#start-menu');
    this.roomLobby = this.getElement('#room-lobby');
    this.roomStatus = this.getElement('#room-status');
    this.roomConnected = this.getElement('#room-connected');
    this.roomCodeDisplay = this.getElement('#room-code-display');
    this.roomMembers = this.getElement('#room-members');
    this.roomButton = this.getElement<HTMLButtonElement>('#room-button');
    this.woodLabel = this.getElement('#wood-count');
    this.buildWoodValue = this.getElement('#build-wood-value');
    this.buildPanel = this.getElement('#build-panel');

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.raycaster.far = ARROW_RANGE;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Juego de Krikas en primera persona');
    this.world.appendChild(this.renderer.domElement);

    this.configureWorld();
    this.createTerrain();
    this.applyLocationAppearance(this.currentLocation);
    this.createEnemies();
    this.enemies.forEach((enemy) => this.setEnemyCombatRing(enemy, true));
    this.shieldVisual = this.createShieldVisual();
    this.camera.add(this.shieldVisual);
    this.scene.add(this.camera);
    this.createBow();
    this.createFlashlight();
    this.createBuildPreview();
    this.configureCamera();
    this.bindControls();
    this.resize();
    this.setNotice('Pulsa INICIAR cuando estés listo. Los enemigos están en pausa.');
    this.updateHud();
    window.addEventListener('resize', this.resize);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  private configureWorld(): void {
    const encounter = WORLD_ENCOUNTERS[this.currentLocation];
    this.scene.background = new THREE.Color(encounter.background);
    this.scene.fog = new THREE.Fog(encounter.background, 30, 64);
    this.scene.add(this.worldAmbientLight);
    this.worldSunlight.position.set(-8, 18, -10);
    this.scene.add(this.worldSunlight);

    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.08;
    this.scene.add(this.ground);
  }

  private createTerrain(): void {
    const geometry = new THREE.PlaneGeometry(CELL_SIZE * 0.985, CELL_SIZE * 0.985);
    this.terrainMesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
      GRID_WIDTH * GRID_HEIGHT,
    );
    const transform = new THREE.Object3D();
    let instance = 0;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = { x, y };
        const region = this.locationAtCell(cell);
        const palette = WORLD_ENCOUNTERS[region].tiles;
        const baseColor = new THREE.Color((x + y) % 2 === 0 ? palette[0] : palette[1]);
        const position = this.cellToWorld(cell);
        transform.position.set(position.x, 0.015, position.z);
        transform.rotation.set(-Math.PI / 2, 0, 0);
        transform.scale.set(1, 1, 1);
        transform.updateMatrix();
        this.terrainMesh.setMatrixAt(instance++, transform.matrix);
        this.terrainMesh.setColorAt(instance - 1, baseColor);
        this.tiles.push({ cell, baseColor });
      }
    }
    this.terrainMesh.instanceMatrix.needsUpdate = true;
    if (this.terrainMesh.instanceColor) this.terrainMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.terrainMesh);

    WORLD_ROUTES.forEach(([from, to]) => {
      const start = this.cellToWorld(WORLD_CENTERS[from]);
      const end = this.cellToWorld(WORLD_CENTERS[to]);
      const dx = end.x - start.x; const dz = end.z - start.z;
      const road = new THREE.Mesh(
        new THREE.BoxGeometry(Math.hypot(dx, dz) + 2, 0.04, 3.2),
        new THREE.MeshStandardMaterial({ color: 0x9a8965, roughness: 1 }),
      );
      road.position.set((start.x + end.x) / 2, 0.045, (start.z + end.z) / 2);
      road.rotation.y = -Math.atan2(dz, dx);
      this.scene.add(road);
    });

    OBSTACLES.forEach(([x, y]) => {
      const cell = { x, y };
      this.createTree(cell);
      this.createCoastalRocks(cell);
    });
    this.createLandmarks();
    this.createHealingTiles();
    this.createLevelTiles();
    this.createForestEdge();
  }

  private createTree(cell: Cell): void {
    const tree = this.createTreeModel(cell.x * 47 + cell.y * 83, true);
    const position = this.cellToWorld(cell);
    tree.position.set(position.x, 0, position.z);
    tree.userData.cell = cell;
    tree.userData.worldLocation = this.locationAtCell(cell);
    tree.userData.woodTreeId = `${cell.x}:${cell.y}`;
    tree.children.forEach((part, index) => { part.userData.treeRoot = index === 0; });
    this.forestProps.push(tree);
    this.scene.add(tree);
  }

  private createBuildPreview(): void {
    this.buildPreview = new THREE.Group();
    this.buildPreview.visible = false;
    this.scene.add(this.buildPreview);
  }

  private setBuildPreviewKind(kind: BuildingKind): void {
    this.buildPreview.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.buildPreview.clear();
    const model = this.createBuildingModel(kind);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = new THREE.MeshBasicMaterial({
        color: 0x65e6a5,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      });
      object.material = material;
      object.renderOrder = 3;
    });
    this.buildPreview.add(model);
  }

  private setTreeHarvestPending(treeId: string, pending: boolean): void {
    const tree = this.forestProps.find((prop) => prop.userData.woodTreeId === treeId);
    if (!tree) return;
    tree.userData.harvestPending = pending;
    tree.scale.setScalar(pending ? 0.93 : 1);
  }

  private applyHarvestedTree(treeIdValue: unknown): void {
    if (typeof treeIdValue !== 'string') return;
    const tree = this.forestProps.find((prop) => prop.userData.woodTreeId === treeIdValue);
    if (!tree) return;
    tree.userData.harvested = true;
    tree.userData.harvestPending = false;
    tree.scale.setScalar(1);
    tree.children.forEach((part) => { part.visible = Boolean(part.userData.treeRoot); });
    if (!tree.getObjectByName('harvested-stump')) {
      const stump = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.34, 0.48, 8),
        this.treeRootMaterial,
      );
      stump.name = 'harvested-stump';
      stump.position.y = 0.32;
      tree.add(stump);
    }
  }

  private collectNearbyWood(): void {
    if (this.phase === 'defeat') return;
    const nearby = this.forestProps
      .filter((tree) => tree.visible && tree.userData.woodTreeId && !tree.userData.harvested && !tree.userData.harvestPending)
      .map((tree) => ({ tree, distance: Math.hypot(tree.position.x - this.camera.position.x, tree.position.z - this.camera.position.z) }))
      .filter(({ distance }) => distance <= 4.8)
      .sort((a, b) => a.distance - b.distance)[0]?.tree;
    if (!nearby) {
      this.setNotice('Acércate a un árbol para recolectar madera.');
      return;
    }

    const treeId = String(nearby.userData.woodTreeId);
    const position = nearby.position.clone();
    position.y = 2.1;
    this.playFloatLabel(position, '+3 MADERA', 0xd9b77a);
    if (this.roomJoined && this.roomSocket?.readyState === WebSocket.OPEN) {
      this.setTreeHarvestPending(treeId, true);
      this.roomSocket.send(JSON.stringify({ type: 'harvest-wood', treeId }));
      this.setNotice('Recolectando madera…');
      return;
    }

    this.woodCount += 3;
    this.playSound('collect');
    this.applyHarvestedTree(treeId);
    this.setNotice('Recolectaste 3 bloques de madera.');
    this.updateHud();
  }

  private toggleBuildPanel(): void {
    if (this.phase === 'defeat') return;
    if (this.selectedBuilding) {
      this.selectedBuilding = null;
      this.root.classList.remove('build-mode');
      this.buildPreview.visible = false;
      this.setNotice('Modo construcción cancelado.');
      this.updateHud();
      return;
    }
    this.keys.clear();
    if (this.nativePointerLock) document.exitPointerLock();
    else if (this.pointerLocked) this.releaseCaptureUi();
    this.lockingMouse = false;
    this.buildPanel.hidden = !this.buildPanel.hidden;
  }

  private selectBuilding(kind: BuildingKind): void {
    const cost = BUILDING_COST[kind];
    if (this.woodCount < cost) {
      this.setNotice(`Necesitas ${cost} bloques de madera para construir ${BUILDING_NAME[kind]}.`);
      return;
    }
    this.selectedBuilding = kind;
    this.buildingRotation = 0;
    this.setBuildPreviewKind(kind);
    this.buildPanel.hidden = true;
    this.root.classList.add('build-mode');
    this.setNotice(`${BUILDING_NAME[kind]} seleccionada. Gira con la rueda del mouse; haz clic para colocarla.`);
    this.updateHud();
    if (!this.pointerLocked && !this.nativePointerLock) {
      this.lockingMouse = true;
      try {
        Promise.resolve(this.renderer.domElement.requestPointerLock())
          .catch(() => this.enterFallbackCapture());
      } catch {
        this.enterFallbackCapture();
      }
    }
  }

  private updateBuildingPreview(): void {
    if (!this.selectedBuilding || !this.worldMap.hidden) {
      this.buildPreview.visible = false;
      return;
    }
    const cell = this.pickCellAtReticle();
    if (!cell) {
      this.buildPreview.visible = false;
      return;
    }
    const position = this.cellToWorld(cell);
    this.buildPreview.position.set(position.x, 0, position.z);
    this.buildPreview.rotation.y = this.buildingRotation * Math.PI / 2;
    const buildable = this.canBuildAtCell(cell, this.selectedBuilding);
    this.buildPreview.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshBasicMaterial;
      material.color.setHex(buildable ? 0x65e6a5 : 0xef786b);
    });
    this.buildPreview.visible = true;
  }

  private canBuildAtCell(cell: Cell, kind: BuildingKind): boolean {
    if (!this.grid.isWalkable(cell.x, cell.y)) return false;
    if (this.builtStructures.some((building) => building.cell.x === cell.x && building.cell.y === cell.y)) return false;
    if (this.healingTiles.some((tile) => tile.cell.x === cell.x && tile.cell.y === cell.y)) return false;
    if (this.enemies.some((enemy) => enemy.hp > 0 && Math.hypot(enemy.cell.x - cell.x, enemy.cell.y - cell.y) < 1.5)) return false;
    const target = this.cellToWorld(cell);
    if (Math.hypot(target.x - this.camera.position.x, target.z - this.camera.position.z) > 13) return false;
    if (this.landmarkProps.some((prop) => Math.hypot(prop.position.x - target.x, prop.position.z - target.z) < 1.55)) return false;
    if (kind === 'floor' && this.isCellBlockedByBuilding(cell)) return false;
    return true;
  }

  private placeSelectedBuilding(cell: Cell): void {
    const kind = this.selectedBuilding;
    if (!kind) return;
    if (!this.canBuildAtCell(cell, kind)) {
      this.setNotice('Esa casilla no está libre o queda demasiado lejos.');
      return;
    }
    const cost = BUILDING_COST[kind];
    if (this.woodCount < cost) {
      this.setNotice(`Te faltan bloques de madera para construir ${BUILDING_NAME[kind]}.`);
      return;
    }
    if (this.roomJoined && this.roomSocket?.readyState === WebSocket.OPEN) {
      this.roomSocket.send(JSON.stringify({ type: 'place-building', kind, cell, rotation: this.buildingRotation }));
      this.setNotice('Enviando construcción a la sala…');
      return;
    }

    this.woodCount -= cost;
    this.addBuilding({ id: `local-${Date.now()}-${Math.floor(Math.random() * 100000)}`, kind, cell, rotation: this.buildingRotation });
    this.playSound('build');
    this.setNotice(`${BUILDING_NAME[kind]} construida por ${cost} bloques de madera.`);
    this.updateHud();
    if (this.woodCount < cost) {
      this.selectedBuilding = null;
      this.root.classList.remove('build-mode');
    }
  }

  private addBuilding(record: BuildingRecord): void {
    if (!record || typeof record.id !== 'string' || !isBuildingKind(record.kind)
      || !Number.isInteger(record.cell?.x) || !Number.isInteger(record.cell?.y)) return;
    if (this.builtStructures.some((building) => building.id === record.id
      || (building.cell.x === record.cell.x && building.cell.y === record.cell.y))) return;
    const group = this.createBuildingModel(record.kind);
    const position = this.cellToWorld(record.cell);
    group.position.set(position.x, 0, position.z);
    group.rotation.y = (((Number.isInteger(record.rotation) ? Number(record.rotation) : 0) % 4) + 4) % 4 * Math.PI / 2;
    group.userData.buildingId = record.id;
    this.scene.add(group);
    this.builtStructures.push({ ...record, cell: { ...record.cell }, group });
  }

  private createBuildingModel(kind: BuildingKind): THREE.Group {
    const group = new THREE.Group();
    const addBox = (position: [number, number, number], scale: [number, number, number], material = this.landmarkWoodMaterial, rotationZ = 0): void => {
      const mesh = new THREE.Mesh(this.landmarkBoxGeometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      mesh.rotation.z = rotationZ;
      group.add(mesh);
    };

    if (kind === 'floor') {
      addBox([0, 0.1, 0], [CELL_SIZE * 0.92, 0.18, CELL_SIZE * 0.92]);
      for (let index = -1; index <= 1; index++) addBox([index * 0.68, 0.2, 0], [0.045, 0.025, CELL_SIZE * 0.86], this.landmarkDarkWoodMaterial);
    } else if (kind === 'wall') {
      for (let row = 0; row < 4; row++) addBox([0, 0.28 + row * 0.38, 0], [CELL_SIZE * 0.92, 0.34, 0.22]);
      addBox([0, 1.05, 0.13], [CELL_SIZE * 0.92, 0.08, 0.08], this.landmarkDarkWoodMaterial);
    } else if (kind === 'house') {
      addBox([0, 0.12, 0], [2.1, 0.2, 2.05]);
      addBox([0, 1.03, -0.87], [2, 1.72, 0.2]);
      addBox([-0.91, 1.03, 0], [0.18, 1.72, 1.75]);
      addBox([0.91, 1.03, 0], [0.18, 1.72, 1.75]);
      addBox([0, 1.03, 0.87], [0.72, 1.72, 0.2], this.landmarkDarkWoodMaterial);
      addBox([-0.58, 2.03, 0], [1.25, 0.18, 2.4], this.landmarkFabricMaterials[1], -0.53);
      addBox([0.58, 2.03, 0], [1.25, 0.18, 2.4], this.landmarkFabricMaterials[1], 0.53);
      addBox([0, 2.58, 0], [2.35, 0.16, 2.52], this.landmarkDarkWoodMaterial);
    } else {
      for (let stone = 0; stone < 7; stone++) {
        const angle = (stone / 7) * Math.PI * 2;
        const rock = new THREE.Mesh(this.landmarkRockGeometry, this.landmarkStoneMaterial);
        rock.position.set(Math.cos(angle) * 0.58, 0.2, Math.sin(angle) * 0.58);
        rock.scale.set(0.48, 0.3, 0.48);
        group.add(rock);
      }
      for (const side of [-1, 1]) addBox([side * 0.32, 0.22, 0], [1.05, 0.14, 0.16], this.landmarkDarkWoodMaterial, side * 0.38);
      const flame = new THREE.Mesh(this.landmarkFlowerGeometry, this.landmarkGlowMaterial);
      flame.name = 'campfire-flame';
      flame.position.y = 0.5;
      flame.scale.set(0.68, 1.25, 0.68);
      group.add(flame);
      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.85, 0.08, 16),
        this.landmarkGlowMaterial,
      );
      glow.position.y = 0.08;
      group.add(glow);
    }
    return group;
  }

  private isCellBlockedByBuilding(cell: Cell): boolean {
    return this.builtStructures.some((building) =>
      (building.kind === 'wall' || building.kind === 'house')
      && building.cell.x === cell.x && building.cell.y === cell.y,
    );
  }

  private createCoastalRocks(cell: Cell): void {
    const group = new THREE.Group();
    const position = this.cellToWorld(cell);
    group.position.set(position.x, 0, position.z);
    group.userData.worldLocation = this.locationAtCell(cell);
    for (let index = 0; index < 4; index++) {
      const size = 0.42 + ((cell.x * 7 + cell.y * 3 + index) % 4) * 0.1;
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(size, 0),
        new THREE.MeshStandardMaterial({
          color: [0x817d70, 0x9b927e, 0x6e786f][(cell.x + cell.y + index) % 3],
          roughness: 0.98,
          flatShading: true,
        }),
      );
      rock.position.set((index - 1.5) * 0.38, size * 0.42, Math.sin(index * 2.1) * 0.3);
      rock.scale.set(1.15, 0.72 + (index % 2) * 0.16, 0.9);
      group.add(rock);
    }
    this.coastalObstacleProps.push(group);
    this.scene.add(group);
  }

  private createLandmarks(): void {
    const blocked = new Set(OBSTACLES.map(([x, y]) => `${x},${y}`));
    const enemyCells = WORLD_LOCATION_IDS.flatMap((location) => WORLD_ENCOUNTERS[location].enemies.map((enemy) => {
      const center = WORLD_CENTERS[location];
      return { x: center.x + enemy.cell.x - 1, y: center.y + enemy.cell.y - 1 };
    }));

    WORLD_LOCATION_IDS.forEach((location) => {
      const center = WORLD_CENTERS[location];
      const quadrants: Array<Array<{ cell: Cell; score: number }>> = [[], [], [], []];
      for (let y = Math.max(1, center.y - 14); y <= Math.min(GRID_HEIGHT - 2, center.y + 14); y++) {
        for (let x = Math.max(1, center.x - 14); x <= Math.min(GRID_WIDTH - 2, center.x + 14); x++) {
          const cell = { x, y };
          const distance = Math.hypot(x - center.x, y - center.y);
          if (distance < 5.2 || distance > 13 || this.locationAtCell(cell) !== location) continue;
          if (distanceToWorldRoute(x, y) < 3.8 || blocked.has(`${x},${y}`) || !this.grid.isWalkable(x, y)) continue;
          if (enemyCells.some((enemy) => Math.hypot(x - enemy.x, y - enemy.y) < 3.4)) continue;
          const quadrant = (x >= center.x ? 1 : 0) + (y >= center.y ? 2 : 0);
          const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
          const score = Math.abs(distance - 8.8) + (hash % 1000) / 1000 * 2.2;
          quadrants[quadrant].push({ cell, score });
        }
      }

      const sites = quadrants.flatMap((quadrant) =>
        quadrant.sort((a, b) => a.score - b.score).slice(0, 3).map((entry) => entry.cell),
      );
      const kinds = WORLD_LANDMARKS[location];
      sites.forEach((cell, index) => this.createLandmark(location, kinds[index % kinds.length], cell, index));
    });
  }

  private createLandmark(location: WorldLocationId, kind: LandmarkKind, cell: Cell, variant: number): void {
    const group = new THREE.Group();
    const random = (variant * 47 + cell.x * 19 + cell.y * 31) % 11;
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      scale: [number, number, number] = [1, 1, 1],
      rotation: [number, number, number] = [0, 0, 0],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      mesh.rotation.set(...rotation);
      group.add(mesh);
      return mesh;
    };
    const box = (material: THREE.Material, position: [number, number, number], scale: [number, number, number]): THREE.Mesh =>
      add(this.landmarkBoxGeometry, material, position, scale);

    if (kind === 'palm') {
      add(this.treeTrunkGeometry, this.treeBarkMaterial, [0, 1.95, 0], [0.67, 1.22, 0.67], [0, 0, (random - 5) * 0.025]);
      for (let leaf = 0; leaf < 7; leaf++) {
        const angle = (leaf / 7) * Math.PI * 2;
        add(this.landmarkLeafGeometry, this.landmarkLeafMaterial,
          [Math.cos(angle) * 0.48, 3.72 + (leaf % 2) * 0.08, Math.sin(angle) * 0.48],
          [1.05, 0.9, 0.72], [Math.sin(angle) * 0.82, 0, -Math.cos(angle) * 0.82]);
      }
    } else if (kind === 'rocks') {
      for (let rock = 0; rock < 4; rock++) {
        const angle = (rock / 4) * Math.PI * 2;
        add(this.landmarkRockGeometry, this.landmarkStoneMaterial,
          [Math.cos(angle) * 0.62, 0.34 + (rock % 2) * 0.1, Math.sin(angle) * 0.48],
          [0.72 + (random % 4) * 0.08, 0.55 + (rock % 2) * 0.15, 0.7]);
      }
    } else if (kind === 'flowers') {
      for (let flower = 0; flower < 5; flower++) {
        const x = ((flower % 3) - 1) * 0.34;
        const z = (Math.floor(flower / 3) - 0.5) * 0.42;
        add(this.landmarkReedGeometry, this.landmarkGrassMaterial, [x, 0.3, z], [0.55, 0.48 + (flower % 2) * 0.16, 0.55]);
        add(this.landmarkFlowerGeometry, this.landmarkFlowerMaterials[flower % 2], [x, 0.62 + (flower % 2) * 0.07, z], [1, 0.82, 1]);
      }
    } else if (kind === 'market') {
      for (const x of [-1, 1]) for (const z of [-0.56, 0.56]) {
        box(this.landmarkWoodMaterial, [x, 0.86, z], [0.13, 1.72, 0.13]);
      }
      box(this.landmarkFabricMaterials[variant % 2], [0, 1.75, 0], [2.35, 0.18, 1.45]);
      box(this.landmarkFabricMaterials[(variant + 1) % 2], [0, 0.62, 0.34], [1.6, 0.16, 0.7]);
      box(this.landmarkWoodMaterial, [-0.57, 0.29, 0.24], [0.48, 0.52, 0.48]);
      box(this.landmarkDarkWoodMaterial, [0.55, 0.29, 0.2], [0.48, 0.52, 0.48]);
    } else if (kind === 'lantern') {
      add(this.landmarkWoodPostGeometry, this.landmarkDarkWoodMaterial, [0, 1.38, 0], [0.76, 2.76, 0.76]);
      box(this.landmarkDarkWoodMaterial, [0, 2.7, 0], [0.48, 0.12, 0.48]);
      add(this.landmarkFlowerGeometry, this.landmarkGlowMaterial, [0, 2.94, 0], [0.88, 1.4, 0.88]);
      box(this.landmarkDarkWoodMaterial, [0, 3.15, 0], [0.55, 0.1, 0.55]);
    } else if (kind === 'bench') {
      box(this.landmarkWoodMaterial, [0, 0.56, 0], [1.6, 0.16, 0.52]);
      box(this.landmarkDarkWoodMaterial, [0, 0.94, -0.19], [1.6, 0.64, 0.12]);
      for (const x of [-0.58, 0.58]) {
        box(this.landmarkDarkWoodMaterial, [x, 0.29, 0], [0.13, 0.58, 0.18]);
      }
    } else if (kind === 'reeds') {
      for (let reed = 0; reed < 7; reed++) {
        const angle = reed * 2.4;
        const height = 0.85 + (reed % 3) * 0.22;
        add(this.landmarkReedGeometry, reed % 3 === 0 ? this.landmarkGrassMaterial : this.landmarkLeafMaterial,
          [Math.cos(angle) * 0.48, height / 2, Math.sin(angle) * 0.48],
          [1, height, 1], [Math.sin(angle) * 0.13, 0, Math.cos(angle) * 0.13]);
      }
    } else if (kind === 'fallen-log') {
      add(this.landmarkBarrelGeometry, this.landmarkWoodMaterial, [0, 0.34, 0], [0.82, 3.1, 0.82], [0, 0, Math.PI / 2]);
      for (const x of [-0.82, 0.82]) add(this.landmarkRockGeometry, this.landmarkLeafMaterial, [x, 0.22, 0.24], [0.55, 0.35, 0.62]);
    } else if (kind === 'mushrooms') {
      for (let mushroom = 0; mushroom < 4; mushroom++) {
        const x = ((mushroom % 2) - 0.5) * 0.56;
        const z = (Math.floor(mushroom / 2) - 0.5) * 0.52;
        const height = 0.36 + (mushroom % 2) * 0.15;
        add(this.landmarkMushroomStemGeometry, this.landmarkFabricMaterials[1], [x, height / 2, z], [0.75, height / 0.34, 0.75]);
        add(this.landmarkMushroomCapGeometry, this.landmarkFabricMaterials[mushroom % 2], [x, height + 0.08, z], [1.1, 0.56, 1.1]);
      }
    } else if (kind === 'umbrella') {
      add(this.landmarkWoodPostGeometry, this.landmarkDarkWoodMaterial, [0, 1.05, 0], [0.34, 2.1, 0.34]);
      add(this.landmarkAwningGeometry, this.landmarkFabricMaterials[variant % 2], [0, 2.18, 0], [1.45, 0.95, 1.45]);
      box(this.landmarkWoodMaterial, [0.72, 0.28, 0], [0.65, 0.1, 0.6]);
    } else if (kind === 'crates') {
      box(this.landmarkWoodMaterial, [-0.34, 0.42, 0], [0.78, 0.78, 0.78]);
      box(this.landmarkDarkWoodMaterial, [0.35, 0.34, 0.05], [0.72, 0.62, 0.72]);
      box(this.landmarkWoodMaterial, [-0.26, 1.12, 0], [0.58, 0.58, 0.58]);
    } else if (kind === 'sign') {
      add(this.landmarkWoodPostGeometry, this.landmarkDarkWoodMaterial, [0, 0.94, 0], [0.72, 1.88, 0.72]);
      box(this.landmarkWoodMaterial, [0, 2, 0], [1.4, 0.56, 0.16]);
      box(this.landmarkFabricMaterials[1], [0, 2, 0.1], [1.05, 0.08, 0.035]);
    } else if (kind === 'ruins') {
      for (const x of [-0.78, 0, 0.78]) {
        add(this.landmarkRockGeometry, this.landmarkStoneMaterial, [x, 0.8, 0], [0.78, 1.15 + (x === 0 ? 0.25 : 0), 0.82]);
      }
      box(this.landmarkStoneMaterial, [0, 1.72, 0], [2.2, 0.3, 0.62]);
    } else {
      for (let leaf = 0; leaf < 5; leaf++) {
        const angle = (leaf / 5) * Math.PI * 2;
        add(this.treeLeafGeometry, this.landmarkLeafMaterial,
          [Math.cos(angle) * 0.4, 0.58 + (leaf % 2) * 0.15, Math.sin(angle) * 0.36],
          [0.72, 0.65, 0.68]);
      }
    }

    const position = this.cellToWorld(cell);
    group.position.set(position.x, 0, position.z);
    group.rotation.y = random * 0.57;
    group.userData.cell = { ...cell };
    group.userData.worldLocation = location;
    group.userData.landmark = kind;
    this.landmarkProps.push(group);
    this.landmarkCollisionRadii.push(this.getLandmarkCollisionRadius(kind));
    this.scene.add(group);
  }

  private getLandmarkCollisionRadius(kind: LandmarkKind): number {
    if (kind === 'flowers' || kind === 'reeds' || kind === 'mushrooms' || kind === 'bush') return 0;
    if (kind === 'market' || kind === 'ruins') return 1.2;
    if (kind === 'fallen-log') return 1.05;
    if (kind === 'bench' || kind === 'umbrella' || kind === 'crates') return 0.88;
    return 0.72;
  }

  private createHealingTiles(): void {
    const enemyCells = WORLD_LOCATION_IDS.flatMap((location) => WORLD_ENCOUNTERS[location].enemies.map((enemy) => {
      const center = WORLD_CENTERS[location];
      return { x: center.x + enemy.cell.x - 1, y: center.y + enemy.cell.y - 1 };
    }));

    WORLD_LOCATION_IDS.forEach((location) => {
      const center = WORLD_CENTERS[location];
      const candidates: Array<{ cell: Cell; score: number }> = [];
      for (let y = center.y - 4; y <= center.y + 4; y++) {
        for (let x = center.x - 4; x <= center.x + 4; x++) {
          const cell = { x, y };
          const distance = Math.hypot(x - center.x, y - center.y);
          if (distance < 2.2 || distance > 4 || this.locationAtCell(cell) !== location) continue;
          if (!this.grid.isWalkable(x, y) || distanceToWorldRoute(x, y) < 1.8) continue;
          if (enemyCells.some((enemy) => Math.hypot(x - enemy.x, y - enemy.y) < 2.8)) continue;
          candidates.push({ cell, score: Math.abs(distance - 3.2) + (x * 31 + y * 17) % 7 * 0.035 });
        }
      }

      candidates.sort((a, b) => a.score - b.score);
      const cell = candidates[0]?.cell ?? { x: center.x + 2, y: center.y + 2 };
      const group = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.88, 0.94, 0.12, 24),
        new THREE.MeshStandardMaterial({ color: 0x254a38, roughness: 0.75, metalness: 0.12 }),
      );
      base.position.y = 0.08;
      group.add(base);

      const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x70f0ae, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.78, 28), glowMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.16;
      group.add(ring);

      const crossVertical = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.62), glowMaterial);
      crossVertical.position.y = 0.17;
      group.add(crossVertical);
      const crossHorizontal = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.045, 0.18), glowMaterial);
      crossHorizontal.position.y = 0.17;
      group.add(crossHorizontal);

      const position = this.cellToWorld(cell);
      group.position.set(position.x, 0, position.z);
      group.userData.healingTile = location;
      this.scene.add(group);
      this.healingTiles.push({ id: location, location, cell, group, glowMaterial });
    });
  }

  private checkHealingTile(cell: Cell): void {
    const tile = this.healingTiles.find((candidate) =>
      candidate.location === this.currentLocation && candidate.cell.x === cell.x && candidate.cell.y === cell.y,
    );
    if (!tile) {
      this.occupiedHealingTile = null;
      return;
    }

    const id = tile.id;
    if (this.occupiedHealingTile === id) return;
    this.occupiedHealingTile = id;
    if (this.playerHp >= this.playerMaxHp) {
      this.setNotice('Casilla de curación: tu salud ya está completa.');
      return;
    }

    const restored = Math.min(35, this.playerMaxHp - this.playerHp);
    this.playerHp += restored;
    this.playSound('heal');
    const position = this.cellToWorld(tile.cell);
    position.y = 1.2;
    this.playRing(position, 0x70f0ae);
    this.playFloatLabel(position.clone().add(new THREE.Vector3(0, 0.5, 0)), `+${restored} PV`, 0x70f0ae);
    this.relocateHealingTile(tile);
    this.setNotice(`Recuperaste ${restored} PV. La casilla verde apareció en otro punto del mapa.`);
    this.updateHud();
  }

  private createLevelTiles(): void {
    for (let index = 0; index < 18; index++) {
      const cell = this.randomLevelTileCell();
      if (!cell) break;
      const group = this.createLevelTileModel();
      const position = this.cellToWorld(cell);
      group.position.set(position.x, 0, position.z);
      this.scene.add(group);
      this.levelTiles.push({ cell, group, phase: Math.random() * Math.PI * 2 });
    }
  }

  private createLevelTileModel(): THREE.Group {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.66, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: 0x78551f, roughness: 0.72, metalness: 0.18 }),
    );
    base.position.y = 0.1;
    group.add(base);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.045, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.19;
    ring.name = 'level-tile-ring';
    group.add(ring);
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3, 0),
      new THREE.MeshStandardMaterial({ color: 0xffe49a, emissive: 0xd88c22, emissiveIntensity: 1.15, roughness: 0.3, metalness: 0.12 }),
    );
    crystal.position.y = 0.72;
    crystal.name = 'level-tile-crystal';
    group.add(crystal);
    return group;
  }

  private randomLevelTileCell(ignore?: LevelTileState): Cell | null {
    for (let attempt = 0; attempt < 1800; attempt++) {
      const cell = { x: 2 + Math.floor(Math.random() * (GRID_WIDTH - 4)), y: 2 + Math.floor(Math.random() * (GRID_HEIGHT - 4)) };
      if (!this.grid.isWalkable(cell.x, cell.y)) continue;
      if (Math.hypot(cell.x - this.playerCell.x, cell.y - this.playerCell.y) < 8) continue;
      if (this.levelTiles.some((tile) => tile !== ignore && Math.hypot(cell.x - tile.cell.x, cell.y - tile.cell.y) < 5)) continue;
      if (this.healingTiles.some((tile) => Math.hypot(cell.x - tile.cell.x, cell.y - tile.cell.y) < 3)) continue;
      if (this.landmarkProps.some((prop) => {
        const landmarkCell = prop.userData.cell as Cell | undefined;
        return landmarkCell && Math.hypot(cell.x - landmarkCell.x, cell.y - landmarkCell.y) < 2.5;
      })) continue;
      if (this.enemies.some((enemy) => Math.hypot(cell.x - enemy.cell.x, cell.y - enemy.cell.y) < 4)) continue;
      if (this.builtStructures.some((building) => Math.hypot(cell.x - building.cell.x, cell.y - building.cell.y) < 2)) continue;
      return cell;
    }
    return null;
  }

  private checkLevelTile(cell: Cell): void {
    const tile = this.levelTiles.find((candidate) => candidate.cell.x === cell.x && candidate.cell.y === cell.y);
    if (!tile) return;
    this.levelTileProgress++;
    this.playSound('collect');
    const position = this.cellToWorld(tile.cell);
    position.y = 1.35;
    this.playFloatLabel(position, '+1 EXPERIENCIA', 0xffdc82);
    const requirement = this.playerLevel + 1;
    if (this.levelTileProgress >= requirement) {
      this.playerLevel++;
      this.levelTileProgress = 0;
      this.playerMaxHp += 12;
      this.playerHp = Math.min(this.playerMaxHp, this.playerHp + 20);
      this.playSound('level-up');
      this.playFloatLabel(position.clone().add(new THREE.Vector3(0, 0.55, 0)), `NIVEL ${this.playerLevel}`, 0xffd36a);
      this.setNotice(`¡Subiste al nivel ${this.playerLevel}! Aumentaron tu salud máxima y tu poder.`);
    } else {
      this.setNotice(`Experiencia ${this.levelTileProgress}/${requirement}. Encuentra otra casilla dorada.`);
    }
    const nextCell = this.randomLevelTileCell(tile);
    if (nextCell) {
      tile.cell = nextCell;
      const nextPosition = this.cellToWorld(nextCell);
      tile.group.position.set(nextPosition.x, 0, nextPosition.z);
    }
    this.updateHud();
  }

  private relocateHealingTile(tile: HealingTileState): void {
    const current = this.worldToCell(this.camera.position.x, this.camera.position.z);
    const candidates: Cell[] = [];
    for (let y = 2; y < GRID_HEIGHT - 2; y++) {
      for (let x = 2; x < GRID_WIDTH - 2; x++) {
        const cell = { x, y };
        if (!this.grid.isWalkable(x, y)) continue;
        if (this.healingTiles.some((other) => other !== tile && Math.hypot(other.cell.x - x, other.cell.y - y) < 5)) continue;
        if (Math.hypot(x - current.x, y - current.y) < 8) continue;
        if (distanceToWorldRoute(x, y) < 2.8) continue;
        if (this.enemies.some((enemy) => enemy.hp > 0 && Math.hypot(enemy.cell.x - x, enemy.cell.y - y) < 3.2)) continue;
        const position = this.cellToWorld(cell);
        if (this.landmarkProps.some((prop) => Math.hypot(prop.position.x - position.x, prop.position.z - position.z) < 2.4)) continue;
        candidates.push(cell);
      }
    }
    if (candidates.length === 0) return;
    const cell = candidates[Math.floor(Math.random() * candidates.length)];
    this.applyHealingTileMove(tile.id, cell, true);
    if (this.roomJoined && this.roomSocket?.readyState === WebSocket.OPEN) {
      this.roomSocket.send(JSON.stringify({ type: 'healing-tile-moved', tileId: tile.id, cell }));
    }
  }

  private applyHealingTileMove(tileId: unknown, cellValue: unknown, showEffect = false): void {
    if (!isWorldLocation(tileId) || !cellValue || typeof cellValue !== 'object') return;
    const cell = cellValue as Cell;
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !this.grid.isWalkable(cell.x, cell.y)) return;
    const tile = this.healingTiles.find((candidate) => candidate.id === tileId);
    if (!tile) return;
    if (this.healingTiles.some((other) => other !== tile && other.cell.x === cell.x && other.cell.y === cell.y)) return;
    tile.cell = { x: cell.x, y: cell.y };
    tile.location = this.locationAtCell(tile.cell);
    const position = this.cellToWorld(tile.cell);
    tile.group.position.set(position.x, 0, position.z);
    tile.group.userData.worldLocation = tile.location;
    this.occupiedHealingTile = null;
    if (showEffect) {
      position.y = 0.55;
      this.playRing(position, 0x70f0ae);
    }
  }

  private applyLocationAppearance(location: WorldLocationId): void {
    this.forestProps.forEach((object) => {
      const region = object.userData.worldLocation as WorldLocationId | undefined;
      object.visible = !region || !COASTAL_LOCATIONS.has(region);
    });
    this.coastalObstacleProps.forEach((object) => {
      const region = object.userData.worldLocation as WorldLocationId | undefined;
      object.visible = Boolean(region && COASTAL_LOCATIONS.has(region));
    });
  }

  private createTreeModel(seed: number, detailed: boolean): THREE.Group {
    let randomState = (seed + 1) >>> 0;
    const random = (): number => {
      randomState = (randomState * 1664525 + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    const tree = new THREE.Group();

    const roots = new THREE.Mesh(this.treeRootGeometry, this.treeRootMaterial);
    roots.position.y = 0.27;
    tree.add(roots);

    const trunk = new THREE.Mesh(this.treeTrunkGeometry, this.treeBarkMaterial);
    trunk.position.y = 1.55;
    trunk.scale.set(0.86 + random() * 0.24, 0.92 + random() * 0.2, 0.86 + random() * 0.24);
    trunk.rotation.z = (random() - 0.5) * 0.08;
    tree.add(trunk);

    const branchCount = detailed ? 4 : 3;
    for (let index = 0; index < branchCount; index++) {
      const angle = (index / branchCount) * Math.PI * 2 + random() * 0.35;
      const branch = new THREE.Mesh(this.treeBranchGeometry, this.treeBranchMaterial);
      branch.position.set(Math.cos(angle) * 0.28, 1.75 + random() * 0.55, Math.sin(angle) * 0.28);
      branch.rotation.z = Math.cos(angle) * 0.88;
      branch.rotation.x = Math.sin(angle) * 0.88;
      branch.scale.setScalar(0.72 + random() * 0.42);
      tree.add(branch);
    }

    const leafCounts = detailed ? [7, 9, 6] : [5, 6, 4];
    const crownRadii = [0.82, 1.12, 0.48];
    const crownHeights = [2.78, 3.55, 4.28];
    leafCounts.forEach((count, layer) => {
      for (let index = 0; index < count; index++) {
        const angle = (index / count) * Math.PI * 2 + random() * 0.42;
        const radius = crownRadii[layer] * (0.72 + random() * 0.5);
        const leaves = new THREE.Mesh(
          this.treeLeafGeometry,
          this.treeLeafMaterials[Math.floor(random() * this.treeLeafMaterials.length)],
        );
        leaves.position.set(
          Math.cos(angle) * radius,
          crownHeights[layer] + (random() - 0.5) * 0.48,
          Math.sin(angle) * radius,
        );
        leaves.rotation.set(random() * 0.7, random() * Math.PI, random() * 0.7);
        leaves.scale.set(0.78 + random() * 0.5, 0.7 + random() * 0.55, 0.78 + random() * 0.5);
        tree.add(leaves);
      }
    });

    const overallScale = detailed ? 0.88 + random() * 0.28 : 0.72 + random() * 0.32;
    tree.scale.set(overallScale, overallScale, overallScale);
    return tree;
  }

  private createForestEdge(): void {
    const edgeCells: Cell[] = [];
    for (let x = 0; x < GRID_WIDTH; x += 8) edgeCells.push({ x, y: 0 }, { x, y: GRID_HEIGHT - 1 });
    for (let y = 8; y < GRID_HEIGHT - 1; y += 8) edgeCells.push({ x: 0, y }, { x: GRID_WIDTH - 1, y });
    edgeCells.forEach((cell, index) => {
      const tree = this.createTreeModel(900 + index * 29, false);
      const position = this.cellToWorld(cell);
      tree.position.set(position.x, 0, position.z);
      tree.userData.worldEdge = true;
      this.forestProps.push(tree);
      this.scene.add(tree);
    });
  }

  private createEnemies(): void {
    WORLD_LOCATION_IDS.forEach((location, locationIndex) => {
      WORLD_ENCOUNTERS[location].enemies.forEach((definition, index) => {
        const center = WORLD_CENTERS[location];
        const cell = { x: center.x + definition.cell.x - 1, y: center.y + definition.cell.y - 1 };
        const variant = locationIndex * 4 + index;
        const group = definition.model === 'crab'
          ? this.createCrab(definition.color, variant)
          : definition.model === 'shadow' || definition.model === 'wraith'
            ? this.createDarkArcher(definition.color, variant, definition.model)
            : this.createMaskedArcher(definition.color, variant);
        const position = this.cellToWorld(cell);
        group.position.set(position.x, 0, position.z);
        group.userData.enemyId = definition.id;
        group.userData.worldLocation = location;
        this.scene.add(group);
        this.enemies.push({
          ...definition,
          location,
          cell,
          maxHp: definition.hp,
          group,
          bow: group.getObjectByName('enemy-bow') ?? null,
          bowString: group.getObjectByName('enemy-bow-string') ?? null,
          bowArrow: group.getObjectByName('enemy-bow-arrow') ?? null,
          attackCooldown: 1.3 + index * 0.35,
          replanTimer: 0,
          stepTarget: null,
          stepElapsed: 0,
          stepStart: new THREE.Vector3(),
          stepEnd: new THREE.Vector3(),
          slowTimer: 0,
          lastKnownPlayerCell: { ...cell },
          lastSeenTimer: 6,
          searchTimer: 0,
          searchTarget: null,
          patrolTarget: null,
          needsCover: false,
          coverTarget: null,
          coverPath: [],
          coverCooldown: 0,
          coverTimer: 0,
          isHiding: false,
        });
      });
    });
  }

  private createCrab(color: number, variant: number): THREE.Group {
    const crab = new THREE.Group();
    const shellMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.04, flatShading: true });
    const undersideMaterial = new THREE.MeshStandardMaterial({ color: 0xd6b28a, roughness: 0.9 });
    const jointMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.78), roughness: 0.75 });
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x171a17, roughness: 0.35 });

    const underside = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), undersideMaterial);
    underside.scale.set(1.2, 0.42, 0.82);
    underside.position.y = 0.35;
    crab.add(underside);

    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 9), shellMaterial);
    shell.scale.set(1.22, 0.62, 0.9);
    shell.position.y = 0.58;
    crab.add(shell);

    for (const side of [-1, 1]) {
      for (let index = 0; index < 3; index++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.62, 6), jointMaterial);
        const z = (index - 1) * 0.28;
        leg.position.set(side * 0.64, 0.3, z - 0.03);
        leg.rotation.z = side * -0.76;
        leg.rotation.x = (index - 1) * 0.24;
        crab.add(leg);
      }

      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.48, 7), jointMaterial);
      arm.position.set(side * 0.58, 0.48, 0.42);
      arm.rotation.z = side * -0.58;
      crab.add(arm);

      const claw = new THREE.Mesh(new THREE.SphereGeometry(0.2 + (variant % 2) * 0.035, 9, 7), shellMaterial);
      claw.scale.set(1.15, 0.85, 1.05);
      claw.position.set(side * 0.82, 0.38, 0.61);
      crab.add(claw);

      const eyeStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 6), jointMaterial);
      eyeStem.position.set(side * 0.2, 0.86, 0.35);
      eyeStem.rotation.x = -0.3;
      crab.add(eyeStem);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), eyeMaterial);
      eye.position.set(side * 0.2, 0.98, 0.38);
      crab.add(eye);
    }

    const healthBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.075, 0.035),
      new THREE.MeshBasicMaterial({ color: 0x17221c }),
    );
    healthBack.position.set(0, 1.45, 0);
    crab.add(healthBack);
    const healthFill = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.045, 0.045),
      new THREE.MeshBasicMaterial({ color: 0xe16e60 }),
    );
    healthFill.position.set(0, 1.45, -0.025);
    healthFill.userData.healthBar = true;
    crab.add(healthFill);
    return crab;
  }

  private createMaskedArcher(color: number, variant: number): THREE.Group {
    const archer = new THREE.Group();
    const clothMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.88 });
    const armorMaterial = new THREE.MeshStandardMaterial({ color: 0x626963, metalness: 0.72, roughness: 0.42 });
    const darkArmorMaterial = new THREE.MeshStandardMaterial({ color: 0x282e2a, metalness: 0.45, roughness: 0.62 });
    const leatherMaterial = new THREE.MeshStandardMaterial({ color: 0x69492d, roughness: 0.9 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xb88a4d, metalness: 0.62, roughness: 0.46 });
    const maskMaterial = new THREE.MeshStandardMaterial({ color: 0xd5c8a9, metalness: 0.24, roughness: 0.78 });
    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: variant % 2 === 0 ? 0xf05e39 : 0xe7bc65,
      emissive: variant % 2 === 0 ? 0x761a0b : 0x5b3b0b,
      emissiveIntensity: 1.4,
    });

    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.32), leatherMaterial);
    pelvis.position.y = 0.86;
    archer.add(pelvis);

    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.46, 8), clothMaterial);
      thigh.position.set(side * 0.16, 0.51, 0);
      archer.add(thigh);

      const greave = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.25), armorMaterial);
      greave.position.set(side * 0.16, 0.24, 0.045);
      archer.add(greave);

      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.38), darkArmorMaterial);
      boot.position.set(side * 0.16, 0.07, 0.08);
      archer.add(boot);

      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), trimMaterial);
      knee.scale.set(1, 0.7, 0.55);
      knee.position.set(side * 0.16, 0.37, 0.15);
      archer.add(knee);
    }

    const cuirass = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 4, 8), clothMaterial);
    cuirass.position.set(0, 1.27, 0);
    archer.add(cuirass);

    const breastplate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.17), armorMaterial);
    breastplate.position.set(0, 1.31, 0.23);
    archer.add(breastplate);

    const chestTrim = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.055, 0.19), trimMaterial);
    chestTrim.position.set(0, 1.53, 0.235);
    archer.add(chestTrim);

    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.11, 0.35), leatherMaterial);
    belt.position.set(0, 0.99, 0);
    archer.add(belt);
    const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.04), trimMaterial);
    beltBuckle.position.set(0, 0.99, 0.19);
    archer.add(beltBuckle);

    for (const side of [-1, 1]) {
      const tasset = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.14), armorMaterial);
      tasset.position.set(side * 0.16, 0.76, 0.19);
      archer.add(tasset);

      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.24, 9, 7), trimMaterial);
      shoulder.scale.set(1.05, 0.72, 0.9);
      shoulder.position.set(side * 0.39, 1.56, 0);
      archer.add(shoulder);

      const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.13, 0.42, 8), clothMaterial);
      upperArm.position.set(side * 0.44, 1.29, 0.015);
      upperArm.rotation.z = side * -0.18;
      archer.add(upperArm);

      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.39, 8), armorMaterial);
      forearm.position.set(side * 0.5, 0.99, 0.08);
      forearm.rotation.z = side * 0.24;
      archer.add(forearm);

      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), darkArmorMaterial);
      glove.position.set(side * 0.52, 0.78, 0.11);
      archer.add(glove);
    }

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.2, 8), leatherMaterial);
    neck.position.y = 1.72;
    archer.add(neck);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), armorMaterial);
    helmet.scale.set(1, 0.82, 0.9);
    helmet.position.set(0, 1.99, 0);
    archer.add(helmet);

    const helmetBrow = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.09, 0.1), trimMaterial);
    helmetBrow.position.set(0, 1.85, 0.29);
    archer.add(helmetBrow);

    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.3, 0.095), maskMaterial);
    mask.position.set(0, 1.67, 0.32);
    mask.userData.mask = true;
    archer.add(mask);

    for (const eyeX of [-0.125, 0.125]) {
      const socket = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.065, 0.025), darkArmorMaterial);
      socket.position.set(eyeX, 1.72, 0.376);
      archer.add(socket);

      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.025, 0.02), eyeMaterial);
      eye.position.set(eyeX, 1.72, 0.392);
      archer.add(eye);
    }

    const noseGuard = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.19, 0.07), trimMaterial);
    noseGuard.position.set(0, 1.61, 0.39);
    archer.add(noseGuard);

    for (const side of [-1, 1]) {
      const cheekGuard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.09), armorMaterial);
      cheekGuard.position.set(side * 0.24, 1.62, 0.27);
      archer.add(cheekGuard);
    }

    const crest = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, variant % 2 === 0 ? 0.62 : 0.42, 5),
      new THREE.MeshStandardMaterial({ color: variant % 2 === 0 ? 0x963c2b : 0x314d41, roughness: 0.86 }),
    );
    crest.position.set(0, 2.42, -0.02);
    archer.add(crest);

    const bowWood = new THREE.MeshStandardMaterial({ color: 0xb88a4d, roughness: 0.75 });
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.035, 8, 22, Math.PI), bowWood);
    bow.position.set(0.65, 1.01, 0.22);
    bow.rotation.z = Math.PI / 2;
    bow.userData.bow = true;
    bow.name = 'enemy-bow';
    archer.add(bow);

    const bowstring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.66, 5),
      new THREE.MeshStandardMaterial({ color: 0xe8dbc0 }),
    );
    bowstring.position.set(0.47, 1.01, 0.22);
    bowstring.name = 'enemy-bow-string';
    archer.add(bowstring);
    const drawnArrow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.78, 5),
      new THREE.MeshStandardMaterial({ color: 0xe8dbc0, roughness: 0.78 }),
    );
    drawnArrow.name = 'enemy-bow-arrow';
    drawnArrow.position.set(0.47, 1.01, 0.28);
    drawnArrow.rotation.x = Math.PI / 2;
    drawnArrow.visible = false;
    archer.add(drawnArrow);

    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.58, 7), leatherMaterial);
    quiver.position.set(-0.25, 1.42, -0.22);
    quiver.rotation.x = -0.2;
    archer.add(quiver);

    for (let index = 0; index < 3; index++) {
      const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.66, 5), trimMaterial);
      arrowShaft.position.set(-0.31 + index * 0.06, 1.77, -0.2);
      arrowShaft.rotation.z = (index - 1) * 0.08;
      archer.add(arrowShaft);
    }

    const healthBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.075, 0.035),
      new THREE.MeshBasicMaterial({ color: 0x17221c }),
    );
    healthBack.position.set(0, 2.8, 0);
    archer.add(healthBack);

    const healthFill = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.045, 0.045),
      new THREE.MeshBasicMaterial({ color: 0xe16e60 }),
    );
    healthFill.position.set(0, 2.8, -0.025);
    healthFill.userData.healthBar = true;
    archer.add(healthFill);
    return archer;
  }

  private createDarkArcher(color: number, variant: number, model: 'shadow' | 'wraith'): THREE.Group {
    const archer = this.createMaskedArcher(color, variant + 17);
    const changed = new Set<THREE.Material>();
    archer.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (changed.has(material)) return;
        changed.add(material);
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        if (material.emissiveIntensity > 1) {
          material.color.setHex(model === 'shadow' ? 0xff6747 : 0x9cf4ff);
          material.emissive.setHex(model === 'shadow' ? 0xd52d18 : 0x38cdeb);
          material.emissiveIntensity = model === 'shadow' ? 2.8 : 3.2;
          return;
        }
        if (model === 'shadow') {
          material.color.multiplyScalar(0.28);
          material.roughness = Math.min(material.roughness, 0.62);
        } else {
          material.color.setHex(0x8293a5);
          material.transparent = true;
          material.opacity = 0.76;
          material.depthWrite = false;
          material.emissive.setHex(0x162b3b);
          material.emissiveIntensity = 0.38;
        }
      });
    });

    if (model === 'shadow') {
      const clawMaterial = new THREE.MeshStandardMaterial({ color: 0x18131f, roughness: 0.45, metalness: 0.2 });
      for (const side of [-1, 1]) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.38, 5), clawMaterial);
        claw.position.set(side * 0.57, 0.72, 0.26);
        claw.rotation.z = side * -0.45;
        claw.rotation.x = Math.PI;
        archer.add(claw);
      }
    } else {
      const wispMaterial = new THREE.MeshStandardMaterial({ color: 0x72859a, transparent: true, opacity: 0.56, emissive: 0x315d76, emissiveIntensity: 0.72, depthWrite: false });
      for (let index = 0; index < 3; index++) {
        const wisp = new THREE.Mesh(new THREE.ConeGeometry(0.2 + index * 0.025, 0.78 + index * 0.12, 7), wispMaterial);
        wisp.position.set((index - 1) * 0.2, 0.48 + index * 0.08, -0.24);
        wisp.rotation.z = (index - 1) * 0.28;
        wisp.name = 'wraith-trail';
        archer.add(wisp);
      }
    }
    archer.userData.enemyClass = model;
    return archer;
  }

  private createBow(): void {
    const bow = new THREE.Group();
    bow.name = 'player-bow';
    const wood = new THREE.MeshStandardMaterial({ color: 0xb98a4a, roughness: 0.65 });
    const string = new THREE.MeshStandardMaterial({ color: 0xf2e5c4, roughness: 0.8 });

    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.027, 8, 24, Math.PI), wood);
    arc.rotation.z = -Math.PI / 2;
    bow.add(arc);
    const bowString = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.53, 5), string);
    bowString.position.x = -0.18;
    bowString.name = 'player-bow-string';
    bow.add(bowString);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.17, 8), wood);
    grip.rotation.z = Math.PI / 2;
    bow.add(grip);

    bow.position.set(0.52, -0.43, -0.86);
    bow.rotation.z = -0.12;
    const arrow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.92, 5),
      new THREE.MeshStandardMaterial({ color: 0xf1d28c, roughness: 0.75 }),
    );
    arrow.name = 'player-bow-arrow';
    arrow.position.set(-0.18, 0, -0.06);
    arrow.rotation.x = -Math.PI / 2;
    arrow.visible = false;
    bow.add(arrow);
    this.playerBowVisual = bow;
    this.playerBowString = bowString;
    this.playerBowArrow = arrow;
    this.camera.add(bow);
  }

  private createFlashlight(): void {
    this.flashlightVisual.position.set(0.43, -0.38, -0.78);
    this.flashlightVisual.rotation.x = -0.12;
    const wood = new THREE.MeshStandardMaterial({ color: 0x493522, roughness: 0.9 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xa97935, metalness: 0.68, roughness: 0.42 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xffe5a0, emissive: 0xffb947, emissiveIntensity: 1.8, roughness: 0.25 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.3, 9), wood);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.08;
    this.flashlightVisual.add(handle);
    const lanternBody = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.28, 8, 1, true), brass);
    lanternBody.rotation.x = Math.PI / 2;
    lanternBody.position.z = -0.12;
    this.flashlightVisual.add(lanternBody);
    for (const z of [-0.27, 0.03]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 6, 12), brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.z = z;
      this.flashlightVisual.add(ring);
    }
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.105, 12), glass);
    lens.position.z = -0.285;
    this.flashlightVisual.add(lens);
    this.flashlightVisual.visible = false;
    this.camera.add(this.flashlightVisual);
    this.flashlightSpot.position.set(0.43, -0.36, -0.74);
    this.flashlightSpot.target.position.set(0.43, -0.42, -18);
    this.flashlightSpot.visible = false;
    this.camera.add(this.flashlightSpot, this.flashlightSpot.target);
  }

  private updateDayNight(delta: number): void {
    if (this.phase !== 'ready') this.worldCycleElapsed = (this.worldCycleElapsed + delta) % 1200;
    const phase = this.worldCycleElapsed;
    const smooth = (value: number): number => {
      const clamped = THREE.MathUtils.clamp(value, 0, 1);
      return clamped * clamped * (3 - 2 * clamped);
    };
    if (phase < 590) this.nightBlend = 0;
    else if (phase < 610) this.nightBlend = smooth((phase - 590) / 20);
    else if (phase < 1180) this.nightBlend = 1;
    else this.nightBlend = 1 - smooth((phase - 1180) / 20);

    const encounter = WORLD_ENCOUNTERS[this.currentLocation];
    const dayColor = new THREE.Color(encounter.background);
    const nightColor = dayColor.clone().lerp(new THREE.Color(0x10172b), 0.82);
    const skyColor = dayColor.lerp(nightColor, this.nightBlend);
    this.scene.background = skyColor;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(skyColor);
      this.scene.fog.near = THREE.MathUtils.lerp(30, 15, this.nightBlend);
      this.scene.fog.far = THREE.MathUtils.lerp(64, 42, this.nightBlend);
    }
    this.worldAmbientLight.intensity = THREE.MathUtils.lerp(2.1, 0.42, this.nightBlend);
    this.worldAmbientLight.color.setHex(this.nightBlend > 0.35 ? 0x8ea8d7 : 0xe4f0dc);
    this.worldAmbientLight.groundColor.setHex(this.nightBlend > 0.35 ? 0x172033 : 0x344433);
    this.worldSunlight.intensity = THREE.MathUtils.lerp(2.5, 0.12, this.nightBlend);
    this.worldSunlight.color.setHex(this.nightBlend > 0.35 ? 0x8394cf : 0xffe6b6);

    const isNight = phase >= 600;
    const seconds = isNight ? 1200 - phase : 600 - phase;
    const remaining = Math.max(0, Math.ceil(seconds));
    const minutesText = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`;
    this.dayNightLabel.textContent = `${isNight ? 'NOCHE' : 'DÍA'} · ${minutesText}`;
    this.dayNightLabel.classList.toggle('night-mode', isNight);
  }

  private toggleFlashlight(): void {
    this.flashlightOn = !this.flashlightOn;
    this.flashlightSpot.visible = this.flashlightOn;
    this.flashlightVisual.visible = this.flashlightOn;
    this.playSound('flashlight');
    this.setNotice(this.flashlightOn ? 'Linterna encendida.' : 'Linterna apagada.');
  }

  private createShieldVisual(): THREE.Group {
    const shield = new THREE.Group();
    shield.name = 'wooden-buckler';
    const outline = new THREE.Shape();
    outline.moveTo(-0.36, 0.32);
    outline.quadraticCurveTo(-0.42, 0.5, -0.22, 0.52);
    outline.quadraticCurveTo(0, 0.57, 0.22, 0.52);
    outline.quadraticCurveTo(0.42, 0.5, 0.36, 0.32);
    outline.lineTo(0.28, -0.18);
    outline.quadraticCurveTo(0.2, -0.44, 0, -0.58);
    outline.quadraticCurveTo(-0.2, -0.44, -0.28, -0.18);
    outline.closePath();
    const face = new THREE.Mesh(
      new THREE.ExtrudeGeometry(outline, { depth: 0.075, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.025, bevelThickness: 0.025 }),
      new THREE.MeshStandardMaterial({ color: 0x75502e, roughness: 0.88, metalness: 0.04 }),
    );
    face.name = 'shield-face';
    shield.add(face);
    const planks = new THREE.Group();
    const plankMaterial = new THREE.MeshStandardMaterial({ color: 0x9b6b3c, roughness: 0.92 });
    for (let index = -1; index <= 1; index++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.72, 0.035), plankMaterial);
      plank.position.set(index * 0.18, -0.015, 0.075);
      plank.rotation.z = index * -0.045;
      planks.add(plank);
    }
    shield.add(planks);
    const rimPoints = outline.getPoints(28).map((point) => new THREE.Vector3(point.x, point.y, 0.09));
    const rim = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPoints, true), 48, 0.025, 6, true),
      new THREE.MeshStandardMaterial({ color: 0x80633f, roughness: 0.65, metalness: 0.38 }),
    );
    rim.name = 'shield-rim';
    shield.add(rim);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 8), new THREE.MeshStandardMaterial({ color: 0x8c8170, roughness: 0.48, metalness: 0.65 }));
    boss.name = 'shield-boss';
    boss.position.set(0, 0, 0.135);
    boss.scale.set(1, 1, 0.42);
    shield.add(boss);
    const straps = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.04), new THREE.MeshStandardMaterial({ color: 0x493323, roughness: 0.95 }));
    straps.position.set(0, -0.28, 0.11);
    shield.add(straps);
    for (const x of [-0.27, 0.27]) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0xb5a17d, metalness: 0.72, roughness: 0.5 }));
      rivet.position.set(x, -0.28, 0.14);
      shield.add(rivet);
    }
    shield.position.set(-0.48, -0.18, -0.92);
    shield.rotation.set(0.04, -0.08, -0.12);
    shield.scale.setScalar(0.9);
    shield.visible = false;
    return shield;
  }

  private configureCamera(): void {
    const start = this.cellToWorld(this.playerCell);
    const enemiesCenter = this.enemies.slice(0, 3).reduce((center, enemy) => {
      return center.add(this.cellToWorld(enemy.cell));
    }, new THREE.Vector3()).divideScalar(3);

    this.camera.position.set(start.x, PLAYER_HEIGHT, start.z);
    this.yaw = Math.atan2(-(enemiesCenter.x - start.x), -(enemiesCenter.z - start.z));
    this.pitch = -0.045;
    this.applyCameraRotation();
  }

  private bindControls(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    this.root.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((button) => {
      const skill = button.dataset.skill as SkillId;
      this.skillButtons.set(skill, button);
      button.addEventListener('click', () => this.selectSkill(skill));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((button) => {
      const kind = button.dataset.build as BuildingKind;
      this.buildButtons.set(kind, button);
      button.addEventListener('click', () => this.selectBuilding(kind));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-world-location]').forEach((button) => {
      const location = button.dataset.worldLocation as WorldLocationId;
      this.mapLocationButtons.set(location, button);
      button.addEventListener('click', () => this.selectWorldLocation(location));
    });
    this.getElement<HTMLButtonElement>('#close-map').addEventListener('click', () => this.closeWorldMap());
    this.getElement<HTMLButtonElement>('#close-build').addEventListener('click', () => { this.buildPanel.hidden = true; });
    this.roomButton.addEventListener('click', () => { this.roomLobby.hidden = false; });
    this.getElement<HTMLButtonElement>('#close-room').addEventListener('click', () => { this.roomLobby.hidden = true; });
    this.getElement<HTMLButtonElement>('#create-room').addEventListener('click', () => this.connectToRoom('create-room'));
    this.getElement<HTMLButtonElement>('#join-room').addEventListener('click', () => this.connectToRoom('join-room'));
    this.getElement<HTMLButtonElement>('#leave-room').addEventListener('click', () => this.leaveRoom());
    this.getElement<HTMLButtonElement>('#copy-room-code').addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.roomCode).then(() => { this.roomStatus.textContent = 'Código copiado. Compártelo con tus amigos.'; });
    });
    const serverUrl = this.getElement<HTMLInputElement>('#room-server-url');
    serverUrl.value = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:8080`;
    this.getElement<HTMLButtonElement>('#restart-game').addEventListener('click', () => window.location.reload());
    this.getElement<HTMLButtonElement>('#start-game').addEventListener('click', () => this.startGame());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private connectToRoom(action: 'create-room' | 'join-room'): void {
    const name = this.getElement<HTMLInputElement>('#room-player-name').value.trim() || 'Krika';
    const url = this.getElement<HTMLInputElement>('#room-server-url').value.trim();
    const code = this.getElement<HTMLInputElement>('#room-code-input').value.trim().toUpperCase();
    if (!url || (action === 'join-room' && !code)) { this.roomStatus.textContent = 'Escribe la dirección del servidor y el código de sala.'; return; }
    if (this.roomSocket) this.roomSocket.close();
    this.roomJoined = false;
    this.roomStatus.textContent = 'Conectando con el servidor…';
    this.roomSocket = new WebSocket(url);
    this.roomSocket.addEventListener('open', () => {
      this.roomSocket?.send(JSON.stringify(action === 'create-room' ? { type: action, name } : { type: action, name, code }));
    }, { once: true });
    this.roomSocket.addEventListener('message', (event) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(event.data as string) as Record<string, unknown>; } catch { return; }
      if (message.type === 'room-error') { this.roomStatus.textContent = String(message.message || 'No se pudo conectar a la sala.'); return; }
      if (message.type === 'room-joined') {
        this.roomJoined = true;
        this.localPlayerId = String(message.playerId || '');
        this.roomCode = String(message.code || '');
        this.roomCodeDisplay.textContent = this.roomCode;
        this.roomConnected.hidden = false;
        this.roomButton.textContent = `SALA · ${this.roomCode}`;
        this.roomStatus.textContent = 'Conectados en la misma sala.';
        const sharedHealingTiles = Array.isArray(message.healingTiles)
          ? message.healingTiles as Array<{ tileId: unknown; cell: unknown }>
          : [];
        sharedHealingTiles.forEach((entry) => {
          if (entry && typeof entry === 'object') this.applyHealingTileMove(entry.tileId, entry.cell);
        });
        if (Array.isArray(message.harvestedTrees)) message.harvestedTrees.forEach((id) => this.applyHarvestedTree(id));
        if (Array.isArray(message.buildings)) {
          message.buildings.forEach((building) => {
            if (building && typeof building === 'object') this.addBuilding(building as BuildingRecord);
          });
        }
        this.roomSocket?.send(JSON.stringify({
          type: 'healing-tiles-sync',
          tiles: this.healingTiles.map((tile) => ({ tileId: tile.id, cell: tile.cell })),
        }));
        if (isWorldLocation(message.location) && message.location !== this.currentLocation) {
          this.enterLocation(message.location, false);
        }
        const players = Array.isArray(message.players) ? message.players as NetworkPlayer[] : [];
        players.forEach((player) => {
          if (player.id === this.localPlayerId) {
            this.woodCount = Number.isFinite(player.wood) ? player.wood : 0;
            this.camera.position.set(player.x, PLAYER_HEIGHT, player.z);
            this.yaw = player.yaw;
            this.playerCell.x = this.worldToCell(player.x, player.z).x;
            this.playerCell.y = this.worldToCell(player.x, player.z).y;
            this.applyCameraRotation();
          } else this.addRemotePlayer(player);
        });
        this.updateRoomMembers(players.length);
        this.updateHud();
      } else if (message.type === 'player-joined') {
        const player = message.player as NetworkPlayer;
        if (player?.id && player.id !== this.localPlayerId) this.addRemotePlayer(player);
        this.updateRoomMembers(this.remotePlayers.size + 1);
      } else if (message.type === 'player-updated') {
        const player = message.player as NetworkPlayer;
        const remote = player?.id ? this.remotePlayers.get(player.id) : undefined;
        if (remote) { remote.target.set(player.x, 0, player.z); remote.yaw = player.yaw; }
      } else if (message.type === 'player-left') {
        this.removeRemotePlayer(String(message.playerId || ''));
        this.updateRoomMembers(this.remotePlayers.size + 1);
      } else if (message.type === 'healing-tile-moved') {
        this.applyHealingTileMove(message.tileId, message.cell, true);
      } else if (message.type === 'wood-collected' || message.type === 'tree-harvested') {
        this.applyHarvestedTree(message.treeId);
        if (message.type === 'wood-collected' && message.playerId === this.localPlayerId && Number.isFinite(message.wood)) {
          this.woodCount = Number(message.wood);
          this.playSound('collect');
          this.updateHud();
        }
      } else if (message.type === 'wood-harvest-denied') {
        this.setTreeHarvestPending(String(message.treeId || ''), false);
        this.setNotice('Acércate más al árbol para recoger la madera.');
      } else if (message.type === 'building-placed') {
        if (message.building && typeof message.building === 'object') this.addBuilding(message.building as BuildingRecord);
        if (message.builderId === this.localPlayerId && Number.isFinite(message.wood)) {
          this.woodCount = Number(message.wood);
          this.playSound('build');
          const kind = message.building && typeof message.building === 'object'
            ? (message.building as BuildingRecord).kind
            : null;
          if (this.selectedBuilding && kind && this.woodCount < BUILDING_COST[kind]) {
            this.selectedBuilding = null;
            this.root.classList.remove('build-mode');
          }
          this.setNotice(kind ? `${BUILDING_NAME[kind]} construida.` : 'Construcción colocada.');
          this.updateHud();
        }
      } else if (message.type === 'build-error') {
        this.setNotice(String(message.message || 'No se pudo colocar la construcción.'));
      } else if (message.type === 'room-left') {
        this.roomStatus.textContent = 'Saliste de la sala.';
      }
    });
    this.roomSocket.addEventListener('error', () => { this.roomStatus.textContent = 'No se pudo abrir conexión. Revisa la dirección y que el servidor esté encendido.'; });
    this.roomSocket.addEventListener('close', () => {
      if (!this.roomJoined) return;
      this.roomJoined = false;
      this.roomStatus.textContent = 'Se perdió la conexión con la sala.';
      this.clearRemotePlayers();
      this.roomCode = '';
      this.roomButton.textContent = 'SALA · SOLO';
      this.roomConnected.hidden = true;
    });
  }

  private leaveRoom(): void {
    if (this.roomSocket?.readyState === WebSocket.OPEN) this.roomSocket.send(JSON.stringify({ type: 'leave-room' }));
    this.roomSocket?.close();
    this.roomSocket = null;
    this.roomJoined = false;
    this.roomCode = '';
    this.clearRemotePlayers();
    this.roomConnected.hidden = true;
    this.roomButton.textContent = 'SALA · SOLO';
    this.roomStatus.textContent = 'Saliste de la sala. Crea otra o únete con un código.';
  }

  private addRemotePlayer(player: NetworkPlayer): void {
    if (this.remotePlayers.has(player.id)) return;
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.95, 4, 8), new THREE.MeshStandardMaterial({ color: 0x58c8b3, roughness: 0.7 }));
    body.position.y = 0.78;
    group.add(body);
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256; labelCanvas.height = 64;
    const context = labelCanvas.getContext('2d');
    if (context) {
      context.fillStyle = 'rgba(10,20,18,0.8)'; context.fillRect(0, 0, 256, 64);
      context.fillStyle = '#f0d99c'; context.font = 'bold 28px sans-serif'; context.textAlign = 'center';
      context.fillText(player.name.slice(0, 18), 128, 42);
    }
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
    label.position.y = 2.15; label.scale.set(2.2, 0.55, 1); group.add(label);
    group.position.set(player.x, 0, player.z);
    this.scene.add(group);
    this.remotePlayers.set(player.id, { group, target: new THREE.Vector3(player.x, 0, player.z), yaw: player.yaw });
  }

  private removeRemotePlayer(id: string): void {
    const remote = this.remotePlayers.get(id);
    if (!remote) return;
    this.scene.remove(remote.group);
    remote.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        object.material.dispose();
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      }
    });
    this.remotePlayers.delete(id);
  }

  private clearRemotePlayers(): void { [...this.remotePlayers.keys()].forEach((id) => this.removeRemotePlayer(id)); }
  private updateRoomMembers(count: number): void { this.roomMembers.textContent = `${count} ${count === 1 ? 'jugador conectado' : 'jugadores conectados'}`; }
  private updateNetwork(delta: number): void {
    this.remotePlayers.forEach((remote) => {
      remote.group.position.lerp(remote.target, Math.min(delta * 12, 1));
      remote.group.rotation.y = remote.yaw;
    });
    if (!this.roomJoined || this.roomSocket?.readyState !== WebSocket.OPEN) return;
    this.networkUpdateElapsed += delta;
    if (this.networkUpdateElapsed < 0.1) return;
    this.networkUpdateElapsed = 0;
    this.roomSocket.send(JSON.stringify({ type: 'player-state', state: {
      x: this.camera.position.x, z: this.camera.position.z, yaw: this.yaw, hp: this.playerHp, shielding: this.isShielding,
    } }));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.phase === 'ready') return;
    if (event.button === 2) {
      event.preventDefault();
      this.aiming = true;
      this.dragging = true;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      if (!this.nativePointerLock) this.renderer.domElement.setPointerCapture(event.pointerId);
      this.root.querySelector('.reticle')?.classList.add('aiming');
      return;
    }

    if (event.button === 0 && !this.pointerLocked && !this.nativePointerLock) {
      this.leftButtonHeld = true;
      this.renderer.domElement.setPointerCapture(event.pointerId);
    }
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.phase === 'ready') return;
    if (event.button !== 0) return;
    if (!this.pointerLocked) {
      if (this.selectedBuilding) {
        this.handleFire();
        return;
      }
      if (this.lockingMouse) return;
      this.lockingMouse = true;
      try {
        Promise.resolve(this.renderer.domElement.requestPointerLock())
          .catch(() => this.enterFallbackCapture());
      } catch {
        this.enterFallbackCapture();
      }
      return;
    }

    this.leftButtonHeld = true;
    this.handleFire();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) this.leftButtonHeld = false;
    if (event.button === 2) {
      this.dragging = false;
      this.aiming = false;
      this.root.querySelector('.reticle')?.classList.remove('aiming');
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerClientX = event.clientX;
    this.pointerClientY = event.clientY;
    const leftButtonDown = (event.buttons & 1) !== 0;
    if (this.pointerLocked && leftButtonDown && !this.leftButtonHeld) {
      this.leftButtonHeld = true;
      this.handleFire();
    } else if (!leftButtonDown) {
      this.leftButtonHeld = false;
    }

    if (this.pointerLocked) {
      const sensitivity = this.aiming ? 0.0025 : 0.004;
      this.yaw -= event.movementX * sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * sensitivity, -0.65, 0.42);
      this.applyCameraRotation();
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.updateHover(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return;
    }

    if (this.dragging) {
      this.yaw -= (event.clientX - this.lastPointerX) * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - this.lastPointerY) * 0.003, -0.65, 0.42);
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.applyCameraRotation();
    }
    this.updateHover(event.clientX, event.clientY);
  };

  private readonly onPointerLockChange = (): void => {
    const nativeLock = document.pointerLockElement === this.renderer.domElement;
    if (!nativeLock) {
      if (this.lockingMouse || !this.nativePointerLock) return;
      this.nativePointerLock = false;
      this.pointerLocked = false;
      this.lockingMouse = false;
      this.releaseCaptureUi();
      if (this.phase === 'defeat') return;
      this.setNotice('Mouse liberado. Haz clic izquierdo dentro del juego para capturarlo.');
      return;
    }

    this.nativePointerLock = true;
    this.pointerLocked = true;
    this.lockingMouse = false;
    this.root.classList.toggle('pointer-locked', this.pointerLocked);
    this.root.querySelector('.reticle')?.classList.add('captured');
    this.setNotice('Mueve el mouse para mirar · clic izquierdo dispara · Q protege · Esc libera.');
  };

  private readonly onPointerLockError = (): void => {
    this.enterFallbackCapture();
  };

  private enterFallbackCapture(): void {
    this.lockingMouse = false;
    this.nativePointerLock = false;
    this.pointerLocked = true;
    this.root.classList.add('pointer-locked');
    this.root.querySelector('.reticle')?.classList.add('captured');
    this.setNotice('Mueve el mouse para mirar · clic izquierdo dispara · Q protege · Esc libera.');
  }

  private releaseCaptureUi(): void {
    this.pointerLocked = false;
    this.aiming = false;
    this.dragging = false;
    this.root.classList.remove('pointer-locked');
    this.root.querySelector('.reticle')?.classList.remove('aiming', 'captured');
  }

  private readonly onContextMenu = (event: MouseEvent): void => event.preventDefault();

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.selectedBuilding) return;
    event.preventDefault();
    this.buildingRotation = (this.buildingRotation + (event.deltaY > 0 ? 1 : 3)) % 4;
    this.buildPreview.rotation.y = this.buildingRotation * Math.PI / 2;
    this.setNotice(`${BUILDING_NAME[this.selectedBuilding]} · orientación ${this.buildingRotation * 90}°. Haz clic para colocar.`);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.phase === 'ready') {
      if (event.code === 'Enter') this.startGame();
      return;
    }
    if (event.code === 'Escape' && this.selectedBuilding) {
      this.selectedBuilding = null;
      this.root.classList.remove('build-mode');
      this.buildPreview.visible = false;
      this.setNotice('Modo construcción cancelado.');
      this.updateHud();
      return;
    }
    if (event.code === 'Escape' && !this.buildPanel.hidden) {
      this.buildPanel.hidden = true;
      return;
    }
    if (event.code === 'Escape' && !this.worldMap.hidden) {
      this.closeWorldMap();
      return;
    }
    if (event.code === 'KeyM') {
      if (!event.repeat) this.toggleWorldMap();
      return;
    }
    if (event.code === 'KeyB') {
      if (!event.repeat) this.toggleBuildPanel();
      return;
    }
    if (event.code === 'KeyF') {
      if (!event.repeat) this.collectNearbyWood();
      return;
    }
    if (event.code === 'KeyE') {
      if (!event.repeat) this.toggleFlashlight();
      return;
    }
    if (event.code === 'KeyP') {
      if (!event.repeat) this.setInvulnerable(!this.invulnerable);
      return;
    }
    if (event.code === 'Escape' && this.pointerLocked) {
      if (this.nativePointerLock) {
        document.exitPointerLock();
      } else {
        this.releaseCaptureUi();
        this.lockingMouse = false;
        this.setNotice('Mouse liberado. Haz clic izquierdo dentro del juego para capturarlo.');
      }
      return;
    }

    this.keys.add(event.code);
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat && this.isGrounded && this.phase !== 'defeat') {
        this.verticalVelocity = JUMP_SPEED;
        this.isGrounded = false;
      }
    }
    if (event.code === 'KeyQ') this.setShielding(true);
    if (event.code === 'Digit1') this.selectSkill('earth');
    if (event.code === 'Digit2') this.selectSkill('wind');
    if (event.code === 'Digit3') this.selectSkill('water');
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'KeyQ') this.setShielding(false);
  };

  private toggleWorldMap(): void {
    if (this.phase === 'defeat') return;
    if (!this.worldMap.hidden) {
      this.closeWorldMap();
      return;
    }

    this.keys.clear();
    if (this.isShielding) this.setShielding(false);
    if (this.nativePointerLock) {
      document.exitPointerLock();
    } else if (this.pointerLocked) {
      this.releaseCaptureUi();
    }
    this.lockingMouse = false;
    this.worldMap.hidden = false;
  }

  private closeWorldMap(): void {
    this.worldMap.hidden = true;
  }

  private selectWorldLocation(location: WorldLocationId): void {
    const description = WORLD_LOCATION_DESCRIPTIONS[location];
    if (!description) return;
    this.destinationLocation = location === this.currentLocation ? null : location;
    this.mapLocationButtons.forEach((button, id) => {
      button.setAttribute('aria-pressed', String(id === this.destinationLocation));
      button.classList.toggle('current', id === this.currentLocation);
      button.classList.toggle('destination', id === this.destinationLocation);
    });
    this.mapLocationTitle.textContent = this.mapLocationButtons.get(location)?.textContent?.trim() ?? '';
    this.mapLocationDescription.textContent = location === this.currentLocation
      ? `Ya estás en este sector. ${description}`
      : `Destino marcado. Sigue los caminos y recorre el mundo hasta llegar. ${description}`;
    if (this.destinationLocation) {
      this.setNotice(`Destino marcado: ${this.mapLocationTitle.textContent}. Sigue el indicador y camina por las rutas.`);
    } else {
      this.setNotice(`Ya estás en ${this.mapLocationTitle.textContent}.`);
    }
    this.closeWorldMap();
  }

  private enterLocation(location: WorldLocationId, syncRoom = true): void {
    if (location === this.currentLocation) {
      return;
    }

    this.currentLocation = location;
    this.locationLabel.textContent = location === 'brumalia' ? 'EL BOSQUE DE' : this.mapLocationButtons.get(location)?.textContent?.trim().toUpperCase() ?? '';
    this.mapLocationTitle.textContent = this.mapLocationButtons.get(location)?.textContent?.trim() ?? '';
    this.mapLocationDescription.textContent = WORLD_LOCATION_DESCRIPTIONS[location];
    const encounter = WORLD_ENCOUNTERS[location];
    this.applyLocationAppearance(location);
    this.scene.background = new THREE.Color(encounter.background);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.setHex(encounter.background);
    (this.ground.material as THREE.MeshStandardMaterial).color.setHex(encounter.ground);
    if (this.phase !== 'defeat' && this.phase !== 'ready') this.phase = this.hasLivingEnemies() ? 'combat' : 'victory';
    this.destinationLocation = this.destinationLocation === location ? null : this.destinationLocation;

    this.mapLocationButtons.forEach((button, id) => {
      button.setAttribute('aria-pressed', String(id === this.destinationLocation));
      button.classList.toggle('current', id === location);
      button.classList.toggle('destination', id === this.destinationLocation);
    });
    this.setNotice(location === 'rodadero'
      ? 'Llegaste a El Rodadero. ¡Cuidado con los cangrejos!'
      : `Llegaste a ${this.mapLocationTitle.textContent}.`);
    this.updateHud();

    if (syncRoom && this.roomJoined && this.roomSocket?.readyState === WebSocket.OPEN) {
      this.roomSocket.send(JSON.stringify({ type: 'travel-to-location', location }));
    }
  }

  private clearTransientEffects(): void {
    this.effects.forEach((effect) => {
      this.scene.remove(effect.object);
      effect.object.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        const material = 'material' in object ? object.material : undefined;
        const materials = Array.isArray(material) ? material : material ? [material] : [];
        materials.forEach((entry) => {
          const map = 'map' in entry ? entry.map : null;
          map?.dispose();
          entry.dispose();
        });
      });
    });
    this.effects.length = 0;
  }

  private clearEnemies(): void {
    this.enemies.forEach((enemy) => {
      this.scene.remove(enemy.group);
      enemy.group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        const material = 'material' in object ? object.material : undefined;
        const materials = Array.isArray(material) ? material : material ? [material] : [];
        materials.forEach((entry) => {
          const map = 'map' in entry ? entry.map : null;
          map?.dispose();
          entry.dispose();
        });
      });
    });
    this.enemies.length = 0;
    this.hoverCard.hidden = true;
  }

  private handleFire(): void {
    if (this.selectedBuilding) {
      const cell = this.pickCellAtReticle();
      if (!cell) {
        this.setNotice('Apunta al suelo para elegir dónde construir.');
        return;
      }
      this.placeSelectedBuilding(cell);
      return;
    }
    if (this.phase !== 'combat') return;
    const enemy = this.pickEnemyAtReticle();

    if (this.selectedSkill) {
      if (enemy) this.castSkill(enemy);
      else if (this.selectedSkill === 'earth') this.castSkillAtGround(this.pickCellAtReticle());
      else this.setNotice('Apunta la reticula a un enemigo para usar esa habilidad.');
      return;
    }

    this.shootPlayerArrow(enemy);
  }

  private selectSkill(skill: SkillId): void {
    if (this.phase !== 'combat' || this.skillStates[skill].cooldown > 0) return;
    this.selectedSkill = skill;
    const instructions: Record<SkillId, string> = {
      earth: 'TIERRA: selecciona un enemigo para golpear el area cercana.',
      wind: 'VIENTO: selecciona un enemigo para danarlo y empujarlo.',
      water: 'AGUA: selecciona un enemigo para ralentizarlo y ganar velocidad.',
    };
    this.setNotice(instructions[skill]);
    this.updateHud();
  }

  private castSkill(enemy: EnemyState): void {
    const skill = this.selectedSkill;
    if (!skill || enemy.hp <= 0) return;

    this.skillStates[skill].cooldown = skill === 'earth' ? 4.5 : 3.5;
    this.selectedSkill = null;
    this.playSound(skill);

    if (skill === 'earth') {
      const affected = this.enemies.filter((candidate) =>
        candidate.hp > 0 && manhattanDistance(candidate.cell, enemy.cell) <= 1,
      );
      this.playEarthBurst(enemy.cell);
      affected.forEach((candidate) => {
        this.damageEnemy(candidate, 28);
        this.playImpact(candidate, '-28 PV', 0xd4a858);
      });
      this.setNotice(`Impacto de tierra: ${affected.length} enemigo(s) alcanzados.`);
    } else if (skill === 'wind') {
      this.playPlayerSlash(enemy);
      this.damageEnemy(enemy, 20);
      this.playImpact(enemy, '-20 PV', 0xb6f3d9);
      if (enemy.hp > 0) this.pushEnemy(enemy, 2);
      this.setNotice(`Viento golpea y empuja a ${enemy.name}.`);
    } else {
      this.damageEnemy(enemy, 12);
      enemy.slowTimer = 3.2;
      this.playerSpeedBoost = 3.2;
      this.playWaterShot(enemy);
      this.setNotice(`Agua ralentiza a ${enemy.name}; tu paso se acelera.`);
    }
    this.updateHud();
  }

  private castSkillAtGround(cell: Cell | null): void {
    if (this.selectedSkill !== 'earth' || !cell) return;
    const affected = this.enemies.filter((enemy) =>
      enemy.hp > 0 && manhattanDistance(enemy.cell, cell) <= 1,
    );
    if (affected.length === 0) {
      this.setNotice('El area no alcanza a ningun enemigo.');
      return;
    }
    this.skillStates.earth.cooldown = 4.5;
    this.playSound('earth');
    this.selectedSkill = null;
    this.playEarthBurst(cell);
    affected.forEach((enemy) => {
      this.damageEnemy(enemy, 28);
      this.playImpact(enemy, '-28 PV', 0xd4a858);
    });
    this.setNotice(`Impacto de tierra: ${affected.length} enemigo(s) alcanzados.`);
    this.updateHud();
  }

  private shootPlayerArrow(enemy: EnemyState | null): void {
    if (this.bowCooldown > 0 || (enemy !== null && enemy.hp <= 0)) return;
    this.bowCooldown = 0.34;
    this.setNotice(enemy ? `Flecha en camino a ${enemy.name}.` : 'Flecha disparada; apunta a un enemigo para acertar.');
    const restZ = this.playerBowString.position.z;
    const restPosition = this.playerBowVisual.position.clone();
    const restRotation = this.playerBowVisual.rotation.z;
    let released = false;
    this.playerBowArrow.visible = true;
    this.addEffect(new THREE.Object3D(), 300, (progress) => {
      const draw = progress < 0.62 ? progress / 0.62 : Math.max(0, (1 - progress) / 0.38);
      this.playerBowString.position.z = restZ - draw * 0.24;
      this.playerBowVisual.position.x = restPosition.x - draw * 0.035;
      this.playerBowVisual.rotation.z = restRotation + draw * 0.035;
      if (progress >= 0.62 && !released) {
        released = true;
        this.playerBowArrow.visible = false;
        this.launchPlayerArrow(enemy);
      }
    }, () => {
      this.playerBowString.position.z = restZ;
      this.playerBowVisual.position.copy(restPosition);
      this.playerBowVisual.rotation.z = restRotation;
      this.playerBowArrow.visible = false;
    });
  }

  private launchPlayerArrow(enemy: EnemyState | null): void {
    if (enemy && enemy.hp <= 0) enemy = null;
    this.playSound('bow');
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const start = this.camera.position.clone().add(direction.clone().multiplyScalar(0.75));
    const end = enemy
      ? enemy.group.position.clone().add(new THREE.Vector3(0, 1.2, 0))
      : start.clone().add(direction.multiplyScalar(ARROW_RANGE));
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.055, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0xf1d28c, emissive: 0x684d20, emissiveIntensity: 0.35 }),
    );
    const velocity = end.clone().sub(start);
    arrow.position.copy(start);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), velocity.clone().normalize());
    this.scene.add(arrow);
    this.addEffect(arrow, enemy ? 330 : 520, (progress) => {
      arrow.position.lerpVectors(start, end, progress);
    }, () => {
      arrow.geometry.dispose();
      (arrow.material as THREE.Material).dispose();
      if (enemy && enemy.hp > 0) {
        this.damageEnemy(enemy, 14);
        this.playImpact(enemy, '-14 PV', 0xf1d28c);
        this.setNotice(`Impacto: ${enemy.name} pierde 14 PV.`);
      }
    });
  }

  private updatePlayerMovement(delta: number): void {
    if (this.phase === 'ready') return;
    this.updateVerticalMovement(delta);
    let forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    let strafe = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    if (forward === 0 && strafe === 0) return;

    const length = Math.hypot(forward, strafe);
    forward /= length;
    strafe /= length;
    const sprinting = forward > 0 && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    const speed = PLAYER_SPEED
      * (sprinting ? SPRINT_MULTIPLIER : 1)
      * (this.isShielding ? 0.62 : 1)
      * (this.playerSpeedBoost > 0 ? 1.35 : 1);
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const dx = (forwardX * forward + rightX * strafe) * speed * delta;
    const dz = (forwardZ * forward + rightZ * strafe) * speed * delta;

    this.tryMovePlayerAxis(this.camera.position.x + dx, this.camera.position.z);
    this.tryMovePlayerAxis(this.camera.position.x, this.camera.position.z + dz);
    this.updatePlayerCell();
  }

  private updateVerticalMovement(delta: number): void {
    if (this.isGrounded) return;
    this.verticalVelocity -= GRAVITY * delta;
    this.camera.position.y += this.verticalVelocity * delta;

    if (this.camera.position.y <= PLAYER_HEIGHT) {
      this.camera.position.y = PLAYER_HEIGHT;
      this.verticalVelocity = 0;
      this.isGrounded = true;
    }
  }

  private tryMovePlayerAxis(x: number, z: number): void {
    const cell = this.worldToCell(x, z);
    if (!this.grid.isWalkable(cell.x, cell.y)) return;
    if (this.isCellBlockedByBuilding(cell)) return;
    if (this.isBlockedByWorldObject(x, z)) return;
    if (this.enemies.some((enemy) => enemy.hp > 0 && Math.hypot(enemy.group.position.x - x, enemy.group.position.z - z) < 0.8)) return;
    this.camera.position.x = x;
    this.camera.position.z = z;
  }

  private isBlockedByWorldObject(x: number, z: number): boolean {
    const playerRadius = 0.38;
    for (const tree of this.forestProps) {
      if (tree.userData.harvested) continue;
      const radius = tree.userData.woodTreeId ? 0.62 : 0.42;
      if (Math.hypot(x - tree.position.x, z - tree.position.z) < playerRadius + radius) return true;
    }
    for (const rock of this.coastalObstacleProps) {
      if (Math.hypot(x - rock.position.x, z - rock.position.z) < playerRadius + 0.72) return true;
    }
    for (let index = 0; index < this.landmarkProps.length; index++) {
      const landmark = this.landmarkProps[index];
      const radius = this.landmarkCollisionRadii[index] ?? 0;
      if (radius > 0 && Math.hypot(x - landmark.position.x, z - landmark.position.z) < playerRadius + radius) return true;
    }
    for (const building of this.builtStructures) {
      if (building.kind !== 'wall' && building.kind !== 'house') continue;
      const radius = building.kind === 'house' ? 0.94 : 0.62;
      const position = building.group.position;
      if (Math.abs(x - position.x) < radius + playerRadius && Math.abs(z - position.z) < radius + playerRadius) return true;
    }
    return false;
  }

  private updatePlayerCell(): void {
    const cell = this.worldToCell(this.camera.position.x, this.camera.position.z);
    if (this.grid.isWalkable(cell.x, cell.y)) {
      this.playerCell.x = cell.x;
      this.playerCell.y = cell.y;
      const location = this.locationAtCell(cell);
      if (location !== this.currentLocation) this.enterLocation(location);
      this.checkHealingTile(cell);
      this.checkLevelTile(cell);
    }
  }

  private worldToCell(x: number, z: number): Cell {
    return {
      x: Math.round(x / CELL_SIZE + (GRID_WIDTH - 1) / 2),
      y: Math.round(z / CELL_SIZE + (GRID_HEIGHT - 1) / 2),
    };
  }

  private setShielding(active: boolean): void {
    if (this.phase === 'defeat') active = false;
    this.isShielding = active;
    this.shieldVisual.visible = active || this.invulnerable;
    this.shieldLabel.textContent = this.invulnerable ? 'INVULNERABLE · P' : active ? 'ESCUDO ACTIVO · Q' : 'ESCUDO · MANTENER Q';
    this.shieldLabel.classList.toggle('shield-active', active || this.invulnerable);
    if (active) this.playSound('shield');
  }

  private setInvulnerable(active: boolean): void {
    this.invulnerable = active;
    this.shieldVisual.visible = active || this.isShielding;
    this.shieldLabel.textContent = active ? 'INVULNERABLE · P' : this.isShielding ? 'ESCUDO ACTIVO · Q' : 'ESCUDO · MANTENER Q';
    this.shieldLabel.classList.toggle('shield-active', active || this.isShielding);
    this.setNotice(active ? 'Invulnerabilidad activada: los enemigos no te atacarán. Pulsa P para desactivarla.' : 'Invulnerabilidad desactivada.');
    this.updateHud();
  }

  private updateEnemies(delta: number): void {
    if (this.phase !== 'combat') return;
    if (this.invulnerable) {
      this.enemies.forEach((enemy) => {
        enemy.stepTarget = null;
        enemy.coverTarget = null;
        enemy.coverPath = [];
      });
      return;
    }
    const playerPosition = this.camera.position;
    const playerCell = { ...this.playerCell };

    this.enemies.forEach((enemy) => {
      if (enemy.hp <= 0) return;
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
      enemy.slowTimer = Math.max(0, enemy.slowTimer - delta);
      enemy.replanTimer = Math.max(0, enemy.replanTimer - delta);
      enemy.coverCooldown = Math.max(0, enemy.coverCooldown - delta);
      enemy.coverTimer = Math.max(0, enemy.coverTimer - delta);

      const dx = playerPosition.x - enemy.group.position.x;
      const dz = playerPosition.z - enemy.group.position.z;
      const distance = Math.hypot(dx, dz);
      enemy.group.rotation.y = Math.atan2(dx, dz);

      if (distance > 50) return;

      const darkHunter = (enemy.model === 'shadow' || enemy.model === 'wraith') && this.nightBlend > 0.5;
      const canSeePlayer = distance <= (darkHunter ? 44 : 35) && hasLineOfSight(this.grid, enemy.cell, playerCell, 16);
      if (canSeePlayer) {
        enemy.lastKnownPlayerCell = playerCell;
        enemy.lastSeenTimer = 0;
        enemy.searchTimer = 0;
        enemy.searchTarget = null;
      } else {
        enemy.lastSeenTimer += delta;
      }

      if (enemy.model !== 'crab' && enemy.coverTarget) {
        if (
          !enemy.stepTarget
          && enemy.cell.x === enemy.coverTarget.x
          && enemy.cell.y === enemy.coverTarget.y
        ) {
          enemy.coverTarget = null;
          enemy.coverPath = [];
          enemy.needsCover = false;
          enemy.isHiding = true;
          enemy.coverTimer = 3.2;
          this.setNotice(`${enemy.name} se oculta tras un arbol.`);
          return;
        }
        this.advanceEnemyCoverPath(enemy, delta);
        return;
      }

      if (enemy.model !== 'crab' && enemy.isHiding) {
        if (!canSeePlayer && enemy.coverTimer > 0) return;
        enemy.isHiding = false;
      }

      if (enemy.model !== 'crab' && enemy.needsCover && enemy.coverCooldown === 0) {
        enemy.coverCooldown = 5;
        const path = this.findCoverPath(enemy, playerCell);
        enemy.coverTarget = path?.[path.length - 1] ?? null;
        if (enemy.coverTarget) {
          enemy.coverPath = path?.slice(1) ?? [];
          this.advanceEnemyCoverPath(enemy, delta);
          return;
        }
        enemy.needsCover = false;
      }

      if (canSeePlayer) {
        const preferredRange = enemy.model === 'crab' ? 2.2 : 8.5;
        const attackRange = enemy.model === 'crab' ? 2.8 : 12;
        if (distance > preferredRange) this.updateEnemyChase(enemy, this.cellToWorld(playerCell), delta);
        if (distance <= attackRange && enemy.attackCooldown === 0) this.launchEnemyAttack(enemy);
        return;
      }

      if (enemy.lastSeenTimer < 6) {
        if (!enemy.searchTarget) enemy.searchTarget = enemy.lastKnownPlayerCell;
        if (manhattanDistance(enemy.cell, enemy.searchTarget) <= 1) {
          enemy.searchTimer += delta;
          if (enemy.searchTimer >= 1.1) {
            enemy.searchTarget = this.chooseWanderCell(enemy, enemy.lastKnownPlayerCell, 1, 3);
            enemy.searchTimer = 0;
          }
        }
        if (enemy.searchTarget) this.updateEnemyChase(enemy, this.cellToWorld(enemy.searchTarget), delta);
        return;
      }

      if (!enemy.patrolTarget || manhattanDistance(enemy.cell, enemy.patrolTarget) <= 1) {
        enemy.patrolTarget = this.chooseWanderCell(enemy, enemy.cell, 2, 5);
      }
      this.updateEnemyChase(enemy, this.cellToWorld(enemy.patrolTarget), delta);
    });
  }

  private findCoverPath(enemy: EnemyState, playerCell: Cell): Cell[] | null {
    const blockers = this.enemies
      .filter((other) => other.hp > 0 && other !== enemy)
      .map((other) => other.cell);
    const pathGrid = this.createPathGrid(blockers);
    let bestPath: Cell[] | null = null;
    let bestPathLength = Number.POSITIVE_INFINITY;

    for (const [treeX, treeY] of OBSTACLES) {
      const playerDirection = { x: playerCell.x - treeX, y: playerCell.y - treeY };
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const candidate = { x: treeX + offsetX, y: treeY + offsetY };
        if (!this.grid.isWalkable(candidate.x, candidate.y) || this.isCellBlockedByBuilding(candidate) || this.isOccupied(candidate, enemy)) continue;

        const coverDirection = { x: candidate.x - treeX, y: candidate.y - treeY };
        const oppositeSide = playerDirection.x * coverDirection.x + playerDirection.y * coverDirection.y < 0;
        if (!oppositeSide) continue;

        const path = aStar(pathGrid, enemy.cell, candidate);
        if (path.length > 1 && path.length < bestPathLength) {
          bestPathLength = path.length;
          bestPath = path;
        }
      }
    }

    return bestPath;
  }

  private advanceEnemyCoverPath(enemy: EnemyState, delta: number): void {
    if (!enemy.stepTarget) {
      enemy.stepTarget = enemy.coverPath.shift() ?? null;
      if (!enemy.stepTarget) return;
      enemy.stepStart.copy(enemy.group.position);
      const target = this.cellToWorld(enemy.stepTarget);
      enemy.stepEnd.set(target.x, 0, target.z);
      enemy.stepElapsed = 0;
    }

    enemy.stepElapsed += delta;
    const progress = Math.min(enemy.stepElapsed / COVER_STEP_DURATION, 1);
    enemy.group.position.lerpVectors(enemy.stepStart, enemy.stepEnd, progress);
    if (progress === 1) {
      enemy.cell = enemy.stepTarget;
      enemy.stepTarget = null;
      enemy.stepElapsed = 0;
    }
  }

  private chooseWanderCell(enemy: EnemyState, center: Cell, minDistance: number, maxDistance: number): Cell {
    const candidates: Cell[] = [];
    for (let y = Math.max(0, center.y - maxDistance); y <= Math.min(GRID_HEIGHT - 1, center.y + maxDistance); y++) {
      for (let x = Math.max(0, center.x - maxDistance); x <= Math.min(GRID_WIDTH - 1, center.x + maxDistance); x++) {
        const candidate = { x, y };
        const distance = manhattanDistance(center, candidate);
        if (distance < minDistance || distance > maxDistance) continue;
        if (!this.grid.isWalkable(x, y) || this.isCellBlockedByBuilding(candidate) || this.isOccupied(candidate, enemy)) continue;
        candidates.push(candidate);
      }
    }

    return candidates[Math.floor(Math.random() * candidates.length)] ?? center;
  }

  private updateEnemyChase(enemy: EnemyState, playerOnGrid: THREE.Vector3, delta: number): void {
    if (enemy.stepTarget) {
      enemy.stepElapsed += delta;
      const stepDuration = enemy.model === 'shadow' ? ENEMY_STEP_DURATION * 0.78 : ENEMY_STEP_DURATION;
      const progress = Math.min(enemy.stepElapsed / stepDuration, 1);
      enemy.group.position.lerpVectors(enemy.stepStart, enemy.stepEnd, progress);
      if (progress === 1) {
        enemy.cell = enemy.stepTarget;
        enemy.stepTarget = null;
        enemy.stepElapsed = 0;
      }
      return;
    }

    if (enemy.replanTimer > 0 || enemy.slowTimer > 0) return;
    enemy.replanTimer = 0.75;
    const destination = this.worldToCell(playerOnGrid.x, playerOnGrid.z);
    const blockers = this.enemies
      .filter((other) => other.hp > 0 && other !== enemy)
      .map((other) => other.cell);
    const path = aStar(this.createPathGrid(blockers), enemy.cell, destination);
    if (path.length < 2) return;

    enemy.stepTarget = path[1];
    enemy.stepStart.copy(enemy.group.position);
    const target = this.cellToWorld(enemy.stepTarget);
    enemy.stepEnd.set(target.x, 0, target.z);
  }

  private launchEnemyAttack(enemy: EnemyState): void {
    if (this.invulnerable || enemy.hp <= 0 || this.phase !== 'combat' || !this.hasLivingEnemies()) return;
    if (enemy.model === 'crab') {
      this.playSound('crab');
      enemy.attackCooldown = 2.4;
      const originalScale = enemy.group.scale.clone();
      this.addEffect(enemy.group, 360, (progress) => {
        const pulse = progress < 0.5 ? 1 + progress * 0.38 : 1.19 - (progress - 0.5) * 0.38;
        enemy.group.scale.set(originalScale.x * pulse, originalScale.y * pulse, originalScale.z * pulse);
      }, () => {
        enemy.group.scale.copy(originalScale);
        if (enemy.hp <= 0 || this.phase !== 'combat') return;
        const distance = Math.hypot(this.camera.position.x - enemy.group.position.x, this.camera.position.z - enemy.group.position.z);
        if (distance > 3.1) return;
        this.playRing(this.camera.position.clone().add(new THREE.Vector3(0, -0.8, 0)), 0xef8c55);
        this.damagePlayer(12, enemy);
        this.updateHud();
      }, enemy);
      this.setNotice(`${enemy.name} ataca con sus pinzas.`);
      return;
    }
    enemy.attackCooldown = enemy.model === 'shadow' ? 2.45 : enemy.model === 'wraith' ? 3.65 : 3.2;
    this.playSound('draw');
    if (!enemy.bow || !enemy.bowString || !enemy.bowArrow) return;
    const bow = enemy.bow;
    const bowString = enemy.bowString;
    const bowArrow = enemy.bowArrow;
    const restStringZ = bowString.position.z;
    const restBowRotation = bow.rotation.y;
    let released = false;
    bowArrow.visible = true;
    this.addEffect(new THREE.Object3D(), 680, (progress) => {
      const draw = progress < 0.66 ? progress / 0.66 : Math.max(0, (1 - progress) / 0.34);
      bowString.position.z = restStringZ - draw * 0.28;
      bow.rotation.y = restBowRotation + draw * 0.08;
      enemy.group.rotation.x = -draw * 0.035;
      if (progress >= 0.66 && !released) {
        released = true;
        bowArrow.visible = false;
        this.launchEnemyArrow(enemy);
      }
    }, () => {
      bowString.position.z = restStringZ;
      bow.rotation.y = restBowRotation;
      enemy.group.rotation.x = 0;
      bowArrow.visible = false;
      if (!released && enemy.hp > 0 && this.phase === 'combat') this.launchEnemyArrow(enemy);
    }, enemy);
    this.setNotice(`${enemy.name} tensa el arco.`);
  }

  private launchEnemyArrow(enemy: EnemyState): void {
    if (this.invulnerable || enemy.hp <= 0 || this.phase !== 'combat' || !this.hasLivingEnemies()) return;
    this.playSound('enemy-bow');
    const start = enemy.group.position.clone().add(new THREE.Vector3(0, 1.55, 0));
    const end = this.camera.position.clone().add(new THREE.Vector3(0, -0.15, 0));
    const direction = end.clone().sub(start);
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.055, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0xe7d2a0, emissive: 0x4e3b1f, emissiveIntensity: 0.25 }),
    );
    arrow.position.copy(start);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    this.scene.add(arrow);
    this.addEffect(arrow, 420, (progress) => {
      arrow.position.lerpVectors(start, end, progress);
    }, () => {
      arrow.geometry.dispose();
      (arrow.material as THREE.Material).dispose();
      if (enemy.hp <= 0 || this.phase !== 'combat' || !this.hasLivingEnemies()) return;
      this.damagePlayer(9, enemy);
      this.updateHud();
    }, enemy);
    this.setNotice(`${enemy.name} suelta una flecha.`);
  }

  private damagePlayer(amount: number, attacker?: EnemyState): void {
    if (this.phase !== 'combat' || this.invulnerable || (attacker && attacker.hp <= 0)) return;
    this.playSound(this.isShielding ? 'shield' : 'player-hit');
    const damage = Math.max(1, Math.round(amount * (this.isShielding ? 0.22 : 1)));
    this.playerHp = Math.max(0, this.playerHp - damage);
    this.playPlayerImpact(`-${damage} PV`, 0xe7d2a0);
    if (this.playerHp === 0) {
      this.phase = 'defeat';
      this.setShielding(false);
      this.showDefeatMenu();
      this.setNotice('Has caido en el bosque. Recarga para volver a intentarlo.');
    } else if (this.isShielding) {
      this.setNotice(`El escudo bloquea parte del ataque: -${damage} PV.`);
    }
  }

  private pushEnemy(enemy: EnemyState, distance: number): void {
    const dx = enemy.cell.x - this.playerCell.x;
    const dy = enemy.cell.y - this.playerCell.y;
    const direction: Cell = Math.abs(dx) >= Math.abs(dy)
      ? { x: Math.sign(dx), y: 0 }
      : { x: 0, y: Math.sign(dy) };
    let destination = { ...enemy.cell };

    for (let index = 0; index < distance; index++) {
      const next = { x: destination.x + direction.x, y: destination.y + direction.y };
      if (!this.grid.isWalkable(next.x, next.y) || this.isCellBlockedByBuilding(next) || this.isOccupied(next, enemy)) break;
      destination = next;
    }

    if (destination.x === enemy.cell.x && destination.y === enemy.cell.y) return;
    enemy.cell = destination;
    const position = this.cellToWorld(destination);
    this.addEffect(enemy.group, 250, (progress) => {
      enemy.group.position.lerpVectors(enemy.stepStart, new THREE.Vector3(position.x, 0, position.z), progress);
    }, () => enemy.group.position.set(position.x, 0, position.z));
    enemy.stepStart.copy(enemy.group.position);
  }

  private playEarthBurst(cell: Cell, color = 0xd4a858): void {
    const position = this.cellToWorld(cell);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.52, 36),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(position.x, 0.12, position.z);
    this.scene.add(ring);
    this.addEffect(ring, 520, (progress) => {
      ring.scale.setScalar(0.5 + progress * 3);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - progress);
    });
  }

  private playPlayerSlash(enemy: EnemyState): void {
    const start = this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.9));
    const end = enemy.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.addSlashLine(start, end, 0xb6f3d9);
  }

  private addSlashLine(start: THREE.Vector3, end: THREE.Vector3, color: number): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const slash = new THREE.Line(geometry, material);
    this.scene.add(slash);
    this.addEffect(slash, 250, (progress) => {
      material.opacity = 0.95 * (1 - progress);
    }, () => {
      geometry.dispose();
      material.dispose();
    });
  }

  private playImpact(enemy: EnemyState, label: string, color: number): void {
    const position = enemy.group.position.clone();
    position.y += 1.6;
    this.playRing(position, color);
    this.playFloatLabel(position, label, color);
  }

  private playPlayerImpact(label: string, color: number): void {
    const position = this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2.3));
    position.y += 0.1;
    this.playRing(position, color);
    this.playFloatLabel(position, label, color);
    if (this.isShielding || this.invulnerable) this.flashShield();
  }

  private playRing(position: THREE.Vector3, color: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.2, 28),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    ring.position.copy(position);
    ring.quaternion.copy(this.camera.quaternion);
    this.scene.add(ring);
    this.addEffect(ring, 420, (progress) => {
      ring.scale.setScalar(0.6 + progress * 2.1);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - progress);
    });
  }

  private playFloatLabel(position: THREE.Vector3, label: string, color: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = 'bold 42px Trebuchet MS, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 9;
    context.strokeStyle = '#14201b';
    context.strokeText(label, 128, 48);
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.fillText(label, 128, 48);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(1.8, 0.68, 1);
    this.scene.add(sprite);
    this.addEffect(sprite, 720, (progress) => {
      sprite.position.y = position.y + progress * 0.9;
      material.opacity = 1 - progress;
    }, () => {
      texture.dispose();
      material.dispose();
    });
  }

  private playProjectile(
    start: THREE.Vector3,
    target: EnemyState | null,
    color: number,
    duration: number,
    onImpact: () => void,
  ): void {
    const end = target
      ? target.group.position.clone().add(new THREE.Vector3(0, 1.2, 0))
      : this.camera.position.clone().add(new THREE.Vector3(0, -0.2, 0));
    const direction = end.clone().sub(start);
    const projectile = new THREE.Mesh(
      target
        ? new THREE.ConeGeometry(0.055, 0.42, 6)
        : new THREE.SphereGeometry(0.12, 12, 10),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }),
    );
    projectile.position.copy(start);
    if (target) projectile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    this.scene.add(projectile);
    this.addEffect(projectile, duration, (progress) => {
      projectile.position.lerpVectors(start, end, progress);
    }, () => {
      projectile.geometry.dispose();
      (projectile.material as THREE.Material).dispose();
      onImpact();
    });
  }

  private playWaterShot(enemy: EnemyState): void {
    const start = this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.85));
    this.playProjectile(start, enemy, 0x7be6ef, 320, () => this.playImpact(enemy, 'LENTO', 0x7be6ef));
  }

  private flashShield(): void {
    this.shieldFlashTimer = 0.22;
  }

  private updateShieldPose(delta: number): void {
    const raised = this.isShielding || this.invulnerable;
    const targetPosition = raised
      ? new THREE.Vector3(-0.34, -0.08, -0.94)
      : new THREE.Vector3(-0.48, -0.18, -0.92);
    const targetRotation = raised
      ? new THREE.Euler(-0.02, -0.18, -0.2)
      : new THREE.Euler(0.04, -0.08, -0.12);
    const blend = Math.min(delta * 11, 1);
    this.shieldVisual.position.lerp(targetPosition, blend);
    this.shieldVisual.rotation.x = THREE.MathUtils.lerp(this.shieldVisual.rotation.x, targetRotation.x, blend);
    this.shieldVisual.rotation.y = THREE.MathUtils.lerp(this.shieldVisual.rotation.y, targetRotation.y, blend);
    this.shieldVisual.rotation.z = THREE.MathUtils.lerp(this.shieldVisual.rotation.z, targetRotation.z, blend);
    this.shieldFlashTimer = Math.max(0, this.shieldFlashTimer - delta);
    const hitPulse = this.shieldFlashTimer > 0 ? Math.sin((this.shieldFlashTimer / 0.22) * Math.PI) : 0;
    const targetScale = (raised ? 1.06 : 0.9) + hitPulse * 0.08;
    this.shieldVisual.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), blend);
    const boss = this.shieldVisual.getObjectByName('shield-boss');
    if (boss instanceof THREE.Mesh && boss.material instanceof THREE.MeshStandardMaterial) {
      boss.material.emissive.setHex(hitPulse > 0.05 ? 0x8a5b20 : 0x000000);
      boss.material.emissiveIntensity = hitPulse * 0.8;
    }
  }

  private addEffect(
    object: THREE.Object3D,
    duration: number,
    update: (progress: number) => void,
    finish?: () => void,
    sourceEnemy?: EnemyState,
  ): void {
    this.effects.push({ object, elapsed: 0, duration, update, finish, sourceEnemy });
  }

  private updateEffects(delta: number): void {
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
      if (effect.sourceEnemy && effect.sourceEnemy.hp <= 0) {
        this.scene.remove(effect.object);
        effect.finish?.();
        this.effects.splice(index, 1);
        continue;
      }
      effect.elapsed += delta;
      const progress = Math.min(effect.elapsed / effect.duration, 1);
      effect.update(progress);
      if (progress === 1) {
        this.scene.remove(effect.object);
        effect.finish?.();
        this.effects.splice(index, 1);
      }
    }
  }

  private updateHover(clientX: number, clientY: number): void {
    const enemy = this.pointerLocked
      ? this.pickEnemyAtReticle()
      : this.pickEnemy(clientX, clientY);
    if (!enemy) {
      this.hoverCard.hidden = true;
      return;
    }

    this.hoverName.textContent = enemy.name;
    this.hoverRole.textContent = enemy.isHiding
      ? 'Arquero enmascarado · a cubierto'
      : enemy.coverTarget
        ? 'Arquero enmascarado · buscando cobertura'
        : enemy.lastSeenTimer > 1
          ? 'Arquero enmascarado · buscando tu rastro'
          : 'Arquero enmascarado · enemigo';
    this.hoverHealth.textContent = `PV ${enemy.hp} / ${enemy.maxHp}`;
    this.hoverMove.textContent = enemy.isHiding
      ? 'A cubierto'
      : enemy.coverTarget
        ? `Buscando cobertura · ${enemy.coverPath.length + Number(enemy.stepTarget !== null)} pasos`
        : enemy.slowTimer > 0
          ? `Lento ${enemy.slowTimer.toFixed(1)} s`
          : 'Arco elemental';
    this.hoverHealthFill.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;

    const rect = this.root.getBoundingClientRect();
    const cardWidth = 218;
    const cardHeight = 104;
    const localX = this.pointerLocked ? rect.width / 2 : clientX - rect.left;
    const localY = this.pointerLocked ? rect.height / 2 : clientY - rect.top;
    this.hoverCard.style.left = `${THREE.MathUtils.clamp(localX + 18, 8, rect.width - cardWidth - 8)}px`;
    this.hoverCard.style.top = `${THREE.MathUtils.clamp(localY + 18, 8, rect.height - cardHeight - 8)}px`;
    this.hoverCard.hidden = false;
  }

  private updateHud(): void {
    this.healthLabel.textContent = `PV ${this.playerHp} / ${this.playerMaxHp}`;
    this.levelLabel.textContent = `NIVEL ${this.playerLevel} · ${this.levelTileProgress}/${this.playerLevel + 1}`;
    this.woodLabel.textContent = String(this.woodCount);
    this.buildWoodValue.textContent = String(this.woodCount);
    this.buildButtons.forEach((button, kind) => {
      button.disabled = this.woodCount < BUILDING_COST[kind];
      button.setAttribute('aria-pressed', String(this.selectedBuilding === kind));
    });
    const livingEnemies = this.enemies.filter((enemy) => enemy.hp > 0 && enemy.location === this.currentLocation).length;
    this.enemyCountLabel.textContent = `ENEMIGOS ${livingEnemies}`;
    this.turnIndicator.textContent = this.phase === 'ready'
      ? 'LISTO PARA INICIAR'
      : this.phase === 'combat'
        ? 'COMBATE ACTIVO'
        : this.phase === 'victory'
          ? 'MUNDO DESPEJADO'
          : 'DERROTA';
    this.shieldLabel.textContent = this.invulnerable ? 'INVULNERABLE · P' : this.isShielding ? 'ESCUDO ACTIVO · Q' : 'ESCUDO · MANTENER Q';
    this.shieldLabel.classList.toggle('shield-active', this.isShielding || this.invulnerable);
    this.skillButtons.forEach((button, skill) => {
      const cooldown = this.skillStates[skill].cooldown;
      const name = skill === 'earth' ? 'TIERRA' : skill === 'wind' ? 'VIENTO' : 'AGUA';
      button.disabled = this.phase !== 'combat' || cooldown > 0;
      button.setAttribute('aria-pressed', String(this.selectedSkill === skill));
      const label = button.querySelector('strong');
      if (label) label.textContent = cooldown > 0 ? `${name} · ${cooldown.toFixed(1)}s` : `${name} · ${skill === 'earth' ? '1' : skill === 'wind' ? '2' : '3'}`;
    });
  }

  private updateWaypoint(): void {
    if (!this.destinationLocation) {
      this.waypointLabel.hidden = true;
      return;
    }
    const target = this.cellToWorld(WORLD_CENTERS[this.destinationLocation]);
    const dx = target.x - this.camera.position.x;
    const dz = target.z - this.camera.position.z;
    const relative = Math.atan2(dx, -dz) - this.yaw;
    const direction = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][((Math.round(relative / (Math.PI / 4)) % 8) + 8) % 8];
    const distance = Math.round(Math.hypot(dx, dz));
    const name = this.mapLocationButtons.get(this.destinationLocation)?.textContent?.trim() ?? '';
    this.waypointLabel.textContent = `${direction} ${name} · ${distance} m`;
    this.waypointLabel.hidden = false;
  }

  private setNotice(message: string): void {
    this.notice = message;
    this.turnMessage.textContent = message;
  }

  private playSound(kind: 'bow' | 'enemy-bow' | 'draw' | 'crab' | 'player-hit' | 'enemy-hit' | 'collect' | 'build' | 'heal' | 'earth' | 'wind' | 'water' | 'shield' | 'level-up' | 'flashlight'): void {
    try {
      if (!window.AudioContext) return;
      this.audioContext ??= new window.AudioContext();
      const context = this.audioContext;
      if (context.state === 'suspended') void context.resume();
      const patterns: Record<typeof kind, [number, number, number, OscillatorType, number]> = {
        bow: [620, 260, 0.14, 'triangle', 0.12],
        'enemy-bow': [410, 190, 0.18, 'sawtooth', 0.09],
        draw: [180, 330, 0.22, 'triangle', 0.07],
        crab: [150, 75, 0.19, 'square', 0.08],
        'player-hit': [130, 55, 0.24, 'sawtooth', 0.14],
        'enemy-hit': [280, 110, 0.15, 'square', 0.09],
        collect: [520, 940, 0.2, 'sine', 0.1],
        build: [240, 390, 0.2, 'triangle', 0.11],
        heal: [430, 880, 0.42, 'sine', 0.11],
        earth: [100, 48, 0.34, 'triangle', 0.15],
        wind: [760, 290, 0.22, 'sawtooth', 0.07],
        water: [360, 680, 0.3, 'sine', 0.09],
        shield: [260, 520, 0.16, 'triangle', 0.08],
        'level-up': [520, 1040, 0.52, 'sine', 0.12],
        flashlight: [580, 440, 0.11, 'triangle', 0.055],
      };
      const [startFrequency, endFrequency, duration, wave, volume] = patterns[kind];
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(startFrequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch {
      // Audio is optional; a browser policy must not interrupt gameplay.
    }
  }

  private showDefeatMenu(): void {
    this.keys.clear();
    if (this.nativePointerLock) {
      document.exitPointerLock();
    } else {
      this.lockingMouse = false;
      this.releaseCaptureUi();
    }
    this.defeatMenu.hidden = false;
  }

  private damageEnemy(enemy: EnemyState, amount: number): void {
    if (enemy.hp <= 0) return;
    this.playSound('enemy-hit');
    amount += Math.max(0, this.playerLevel - 1) * 2;
    enemy.hp = Math.max(0, enemy.hp - amount);
    if (enemy.hp > 0 && enemy.model !== 'crab' && enemy.coverCooldown === 0) {
      enemy.needsCover = true;
      enemy.stepTarget = null;
      enemy.coverPath = [];
      enemy.stepElapsed = 0;
      enemy.replanTimer = 0;
      const currentCell = this.cellToWorld(enemy.cell);
      enemy.group.position.set(currentCell.x, 0, currentCell.z);
    }
    const healthBar = enemy.group.children.find((child) => child.userData.healthBar);
    if (healthBar instanceof THREE.Mesh) {
      const ratio = enemy.hp / enemy.maxHp;
      healthBar.scale.x = Math.max(0.001, ratio);
      healthBar.position.x = -0.45 * (1 - ratio);
    }
    if (enemy.hp === 0) {
      enemy.attackCooldown = Number.POSITIVE_INFINITY;
      enemy.stepTarget = null;
      enemy.coverTarget = null;
      enemy.coverPath = [];
      this.scene.remove(enemy.group);
      this.cancelEnemyEffects(enemy);
      if (!this.hasLivingEnemies()) {
        this.phase = 'victory';
        this.selectedSkill = null;
        this.cancelAllEnemyEffects();
      this.setNotice(`¡${this.mapLocationTitle.textContent || 'Zona'} despejada! Ya no quedan enemigos.`);
        this.updateHud();
      }
    }
    this.refreshHover();
  }

  private hasLivingEnemies(): boolean {
    return this.enemies.some((enemy) => enemy.hp > 0);
  }

  private startGame(): void {
    if (this.phase !== 'ready') return;
    this.phase = this.hasLivingEnemies() ? 'combat' : 'victory';
    this.startMenu.hidden = true;
    this.enemies.forEach((enemy) => {
      if (enemy.hp > 0) enemy.attackCooldown = Math.max(enemy.attackCooldown, 2.5);
    });
    this.setNotice('La partida comenzó. ¡Explora y mantente alerta!');
    this.updateHud();
  }

  private cancelEnemyEffects(enemy: EnemyState): void {
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
      if (effect.sourceEnemy !== enemy) continue;
      this.scene.remove(effect.object);
      effect.finish?.();
      this.effects.splice(index, 1);
    }
  }

  private cancelAllEnemyEffects(): void {
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
      if (!effect.sourceEnemy) continue;
      this.scene.remove(effect.object);
      effect.finish?.();
      this.effects.splice(index, 1);
    }
  }

  private refreshHover(): void {
    if (this.pointerLocked) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.updateHover(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return;
    }
    this.updateHover(this.pointerClientX, this.pointerClientY);
  }

  private setEnemyCombatRing(enemy: EnemyState, enabled: boolean): void {
    const existing = enemy.group.getObjectByName('combat-ring');
    if (enabled && !existing) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.68, 0.77, 32),
        new THREE.MeshBasicMaterial({ color: 0xf1cf7e, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      ring.name = 'combat-ring';
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.045;
      enemy.group.add(ring);
    } else if (!enabled && existing) {
      enemy.group.remove(existing);
    }
  }

  private createPathGrid(blockedCells: Cell[]): Grid {
    const obstacles = [...OBSTACLES];
    this.builtStructures.forEach((building) => {
      if (building.kind === 'wall' || building.kind === 'house') obstacles.push([building.cell.x, building.cell.y]);
    });
    blockedCells.forEach((cell) => obstacles.push([cell.x, cell.y]));
    return new Grid(GRID_WIDTH, GRID_HEIGHT, obstacles);
  }

  private isOccupied(cell: Cell, except?: EnemyState): boolean {
    return this.enemies.some((enemy) =>
      enemy !== except && enemy.hp > 0 && enemy.cell.x === cell.x && enemy.cell.y === cell.y,
    );
  }

  private pickEnemy(clientX: number, clientY: number): EnemyState | null {
    return this.resolveEnemyIntersections(
      this.intersect(clientX, clientY, this.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.group)),
    );
  }

  private pickEnemyAtReticle(): EnemyState | null {
    this.pointerNdc.set(0, 0);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const groups = this.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.group);
    return this.resolveEnemyIntersections(this.raycaster.intersectObjects(groups, true));
  }

  private resolveEnemyIntersections(intersections: THREE.Intersection[]): EnemyState | null {
    for (const intersection of intersections) {
      let object: THREE.Object3D | null = intersection.object;
      while (object) {
        const id = object.userData.enemyId as string | undefined;
        if (id) return this.enemies.find((enemy) => enemy.id === id && enemy.hp > 0) ?? null;
        object = object.parent;
      }
    }
    return null;
  }

  private pickCell(clientX: number, clientY: number): Cell | null {
    const intersections = this.intersect(clientX, clientY, [this.terrainMesh]);
    const instanceId = intersections[0]?.instanceId;
    return instanceId === undefined ? null : this.tiles[instanceId]?.cell ?? null;
  }

  private pickCellAtReticle(): Cell | null {
    this.pointerNdc.set(0, 0);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersections = this.raycaster.intersectObject(this.terrainMesh, false);
    const instanceId = intersections[0]?.instanceId;
    return instanceId === undefined ? null : this.tiles[instanceId]?.cell ?? null;
  }

  private intersect(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    return this.raycaster.intersectObjects(objects, true);
  }

  private cellToWorld(cell: Cell): THREE.Vector3 {
    return new THREE.Vector3(
      (cell.x - (GRID_WIDTH - 1) / 2) * CELL_SIZE,
      0,
      (cell.y - (GRID_HEIGHT - 1) / 2) * CELL_SIZE,
    );
  }

  private locationAtCell(cell: Cell): WorldLocationId {
    return WORLD_LOCATION_IDS.reduce((nearest, location) => {
      const center = WORLD_CENTERS[location];
      const currentBest = WORLD_CENTERS[nearest];
      return Math.hypot(cell.x - center.x, cell.y - center.y) < Math.hypot(cell.x - currentBest.x, cell.y - currentBest.y)
        ? location
        : nearest;
    }, WORLD_LOCATION_IDS[0]);
  }

  private applyCameraRotation(): void {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  private readonly resize = (): void => {
    const width = this.world.clientWidth;
    const height = this.world.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private animate = (time: number): void => {
    const delta = Math.min((time - (this.previousFrameTime || time)) / 1000, 0.05);
    this.previousFrameTime = time;
    this.updateDayNight(delta);

    if (!this.worldMap.hidden) {
      this.renderer.render(this.scene, this.camera);
      this.animationFrame = requestAnimationFrame(this.animate);
      return;
    }

    this.updatePlayerMovement(delta);
    this.updateShieldPose(delta);
    this.updateWaypoint();
    this.updateBuildingPreview();
    this.updateNetwork(delta);
    this.updateEnemies(delta);
    this.enemies.forEach((enemy) => {
      if (enemy.hp <= 0) return;
      if (enemy.model === 'wraith') {
        enemy.group.position.y = 0.16 + Math.sin(time * 0.0022 + enemy.cell.x) * 0.13;
        enemy.group.children.filter((child) => child.name === 'wraith-trail')
          .forEach((child, index) => { child.rotation.z = Math.sin(time * 0.0018 + index * 2) * 0.3; });
      } else if (enemy.model === 'shadow') {
        enemy.group.position.y = Math.sin(time * 0.004 + enemy.cell.y) * 0.025;
      } else if (enemy.model !== 'crab') {
        enemy.group.position.y = 0;
      }
    });
    this.updateEffects(delta * 1000);
    this.updateCooldowns(delta);
    if (!this.hoverCard.hidden) this.refreshHover();
    const targetFov = this.aiming ? 48 : 72;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(delta * 10, 1));
    this.camera.updateProjectionMatrix();
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private updateCooldowns(delta: number): void {
    this.bowCooldown = Math.max(0, this.bowCooldown - delta);
    this.playerSpeedBoost = Math.max(0, this.playerSpeedBoost - delta);
    this.healingTiles.forEach((tile) => {
      tile.glowMaterial.opacity = 0.62 + Math.sin(performance.now() * 0.004) * 0.14;
    });
    this.levelTiles.forEach((tile) => {
      tile.phase += delta;
      const crystal = tile.group.getObjectByName('level-tile-crystal');
      if (crystal) {
        crystal.position.y = 0.72 + Math.sin(tile.phase * 2.4) * 0.12;
        crystal.rotation.y += delta * 1.5;
        crystal.rotation.z = Math.sin(tile.phase * 1.3) * 0.12;
      }
      const ring = tile.group.getObjectByName('level-tile-ring');
      if (ring) ring.scale.setScalar(1 + Math.sin(tile.phase * 2) * 0.06);
    });
    Object.values(this.skillStates).forEach((state) => {
      state.cooldown = Math.max(0, state.cooldown - delta);
    });
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Falta un elemento requerido: ${selector}`);
    return element;
  }
}
