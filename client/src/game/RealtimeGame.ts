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
type Phase = 'combat' | 'victory' | 'defeat';
type WorldLocationId = 'taganga' | 'centro' | 'rodadero' | 'gaira' | 'libano' | 'mamatoco' | 'bonda' | 'brumalia';
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
type EnemyModel = 'archer' | 'crab';
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
      { id: 'libano-lookout', name: 'Explorador del mirador', cell: { x: 5, y: 9 }, hp: 92, color: 0x80633f, model: 'archer' },
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
      { id: 'bonda-trail-raider', name: 'Saqueador del camino', cell: { x: 5, y: 9 }, hp: 92, color: 0x8c4f43, model: 'archer' },
    ],
  },
  brumalia: {
    background: 0x9cad94, ground: 0x304f3e, tiles: [0x466d50, 0x3d6249],
    enemies: [
      { id: 'mossling', name: 'Musguito', cell: { x: 8, y: 2 }, hp: 72, color: 0x607a4c, model: 'archer' },
      { id: 'thornling', name: 'Espinajo', cell: { x: 9, y: 2 }, hp: 82, color: 0x8c4f43, model: 'archer' },
      { id: 'mireling', name: 'Lodoso', cell: { x: 9, y: 3 }, hp: 78, color: 0x536e7e, model: 'archer' },
      { id: 'wildling', name: 'Silvestre', cell: { x: 5, y: 9 }, hp: 90, color: 0x80633f, model: 'archer' },
    ],
  },
};

type EnemyState = {
  id: string;
  name: string;
  cell: Cell;
  hp: number;
  maxHp: number;
  color: number;
  model: EnemyModel;
  group: THREE.Group;
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

type NetworkPlayer = { id: string; name: string; x: number; z: number; yaw: number; hp: number; shielding: boolean };
type RemotePlayer = { group: THREE.Group; target: THREE.Vector3; yaw: number };
const WORLD_LOCATION_IDS: WorldLocationId[] = ['taganga', 'centro', 'rodadero', 'gaira', 'libano', 'mamatoco', 'bonda', 'brumalia'];

function isWorldLocation(value: unknown): value is WorldLocationId {
  return typeof value === 'string' && WORLD_LOCATION_IDS.includes(value as WorldLocationId);
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
  private readonly tiles: Array<{ cell: Cell; baseColor: THREE.Color }> = [];
  private terrainMesh!: THREE.InstancedMesh;
  private readonly forestProps: THREE.Group[] = [];
  private readonly coastalObstacleProps: THREE.Group[] = [];
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
  private readonly playerMaxHp = 100;
  private playerSpeedBoost = 0;
  private bowCooldown = 0;
  private phase: Phase = 'combat';
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
  private isGrounded = true;
  private verticalVelocity = 0;
  private readonly shieldVisual: THREE.Group;
  private animationFrame = 0;
  private previousFrameTime = 0;

  private readonly hoverCard: HTMLElement;
  private readonly hoverName: HTMLElement;
  private readonly hoverRole: HTMLElement;
  private readonly hoverHealth: HTMLElement;
  private readonly hoverMove: HTMLElement;
  private readonly hoverHealthFill: HTMLElement;
  private readonly healthLabel: HTMLElement;
  private readonly shieldLabel: HTMLElement;
  private readonly enemyCountLabel: HTMLElement;
  private readonly turnIndicator: HTMLElement;
  private readonly turnMessage: HTMLElement;
  private readonly defeatMenu: HTMLElement;
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
    this.shieldLabel = this.getElement('#player-shield');
    this.enemyCountLabel = this.getElement('#enemy-count');
    this.turnIndicator = this.getElement('#turn-indicator');
    this.turnMessage = this.getElement('#turn-message');
    this.defeatMenu = this.getElement('#defeat-menu');
    this.roomLobby = this.getElement('#room-lobby');
    this.roomStatus = this.getElement('#room-status');
    this.roomConnected = this.getElement('#room-connected');
    this.roomCodeDisplay = this.getElement('#room-code-display');
    this.roomMembers = this.getElement('#room-members');
    this.roomButton = this.getElement<HTMLButtonElement>('#room-button');

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
    this.configureCamera();
    this.bindControls();
    this.resize();
    this.updateHud();
    window.addEventListener('resize', this.resize);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  private configureWorld(): void {
    const encounter = WORLD_ENCOUNTERS[this.currentLocation];
    this.scene.background = new THREE.Color(encounter.background);
    this.scene.fog = new THREE.Fog(encounter.background, 30, 64);
    this.scene.add(new THREE.HemisphereLight(0xe4f0dc, 0x344433, 2.1));

    const sunlight = new THREE.DirectionalLight(0xffe6b6, 2.5);
    sunlight.position.set(-8, 18, -10);
    this.scene.add(sunlight);

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
    this.createForestEdge();
  }

  private createTree(cell: Cell): void {
    const tree = this.createTreeModel(cell.x * 47 + cell.y * 83, true);
    const position = this.cellToWorld(cell);
    tree.position.set(position.x, 0, position.z);
    tree.userData.cell = cell;
    tree.userData.worldLocation = this.locationAtCell(cell);
    this.forestProps.push(tree);
    this.scene.add(tree);
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
    const definitions = WORLD_ENCOUNTERS[this.currentLocation].enemies;

    definitions.forEach((definition, index) => {
      const center = WORLD_CENTERS[this.currentLocation];
      const cell = { x: center.x + definition.cell.x - 1, y: center.y + definition.cell.y - 1 };
      const group = definition.model === 'crab'
        ? this.createCrab(definition.color, index)
        : this.createMaskedArcher(definition.color, index);
      const position = this.cellToWorld(cell);
      group.position.set(position.x, 0, position.z);
      group.userData.enemyId = definition.id;
      this.scene.add(group);
      this.enemies.push({
        ...definition,
        cell,
        maxHp: definition.hp,
        group,
        attackCooldown: 1.3 + index * 0.35,
        replanTimer: 0,
        stepTarget: null,
        stepElapsed: 0,
        stepStart: new THREE.Vector3(),
        stepEnd: new THREE.Vector3(),
        slowTimer: 0,
        lastKnownPlayerCell: { ...this.playerCell },
        lastSeenTimer: 0,
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
    archer.add(bow);

    const bowstring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.66, 5),
      new THREE.MeshStandardMaterial({ color: 0xe8dbc0 }),
    );
    bowstring.position.set(0.47, 1.01, 0.22);
    archer.add(bowstring);

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

  private createBow(): void {
    const bow = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xb98a4a, roughness: 0.65 });
    const string = new THREE.MeshStandardMaterial({ color: 0xf2e5c4, roughness: 0.8 });

    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.027, 8, 24, Math.PI), wood);
    arc.rotation.z = -Math.PI / 2;
    bow.add(arc);
    const bowString = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.53, 5), string);
    bowString.position.x = -0.18;
    bow.add(bowString);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.17, 8), wood);
    grip.rotation.z = Math.PI / 2;
    bow.add(grip);

    bow.position.set(0.52, -0.43, -0.86);
    bow.rotation.z = -0.12;
    this.camera.add(bow);
  }

  private createShieldVisual(): THREE.Group {
    const shield = new THREE.Group();
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.46, 6),
      new THREE.MeshBasicMaterial({ color: 0x6ee5e4, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
    );
    face.position.z = -1.08;
    shield.add(face);

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(0.43, 0.49, 6),
      new THREE.MeshBasicMaterial({ color: 0xb4ffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    rim.position.z = -1.065;
    shield.add(rim);
    shield.position.set(-0.49, -0.02, 0);
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
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    this.root.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((button) => {
      const skill = button.dataset.skill as SkillId;
      this.skillButtons.set(skill, button);
      button.addEventListener('click', () => this.selectSkill(skill));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-world-location]').forEach((button) => {
      const location = button.dataset.worldLocation as WorldLocationId;
      this.mapLocationButtons.set(location, button);
      button.addEventListener('click', () => this.selectWorldLocation(location));
    });
    this.getElement<HTMLButtonElement>('#close-map').addEventListener('click', () => this.closeWorldMap());
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
        if (isWorldLocation(message.location) && message.location !== this.currentLocation) {
          this.enterLocation(message.location, false);
        }
        const players = Array.isArray(message.players) ? message.players as NetworkPlayer[] : [];
        players.forEach((player) => {
          if (player.id === this.localPlayerId) {
            this.camera.position.set(player.x, PLAYER_HEIGHT, player.z);
            this.yaw = player.yaw;
            this.playerCell.x = this.worldToCell(player.x, player.z).x;
            this.playerCell.y = this.worldToCell(player.x, player.z).y;
            this.applyCameraRotation();
          } else this.addRemotePlayer(player);
        });
        this.updateRoomMembers(players.length);
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
    if (event.button !== 0) return;
    if (!this.pointerLocked) {
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

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && !this.worldMap.hidden) {
      this.closeWorldMap();
      return;
    }
    if (event.code === 'KeyM') {
      if (!event.repeat) this.toggleWorldMap();
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

    this.clearTransientEffects();
    this.clearEnemies();
    this.currentLocation = location;
    this.locationLabel.textContent = location === 'brumalia' ? 'EL BOSQUE DE' : this.mapLocationButtons.get(location)?.textContent?.trim().toUpperCase() ?? '';
    this.mapLocationTitle.textContent = this.mapLocationButtons.get(location)?.textContent?.trim() ?? '';
    this.mapLocationDescription.textContent = WORLD_LOCATION_DESCRIPTIONS[location];
    const encounter = WORLD_ENCOUNTERS[location];
    this.applyLocationAppearance(location);
    this.scene.background = new THREE.Color(encounter.background);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.setHex(encounter.background);
    (this.ground.material as THREE.MeshStandardMaterial).color.setHex(encounter.ground);
    this.createEnemies();
    this.enemies.forEach((enemy) => this.setEnemyCombatRing(enemy, true));
    if (this.phase !== 'defeat') this.phase = 'combat';
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
    if (this.enemies.some((enemy) => enemy.hp > 0 && Math.hypot(enemy.group.position.x - x, enemy.group.position.z - z) < 0.8)) return;
    this.camera.position.x = x;
    this.camera.position.z = z;
  }

  private updatePlayerCell(): void {
    const cell = this.worldToCell(this.camera.position.x, this.camera.position.z);
    if (this.grid.isWalkable(cell.x, cell.y)) {
      this.playerCell.x = cell.x;
      this.playerCell.y = cell.y;
      const location = this.locationAtCell(cell);
      if (location !== this.currentLocation) this.enterLocation(location);
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
    this.shieldVisual.visible = active;
    this.shieldLabel.textContent = active ? 'ESCUDO ACTIVO · Q' : 'ESCUDO · MANTENER Q';
    this.shieldLabel.classList.toggle('shield-active', active);
  }

  private updateEnemies(delta: number): void {
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

      if (this.phase !== 'combat') return;

      const canSeePlayer = distance <= 35 && hasLineOfSight(this.grid, enemy.cell, playerCell, 16);
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
        if (!this.grid.isWalkable(candidate.x, candidate.y) || this.isOccupied(candidate, enemy)) continue;

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
        if (!this.grid.isWalkable(x, y) || this.isOccupied(candidate, enemy)) continue;
        candidates.push(candidate);
      }
    }

    return candidates[Math.floor(Math.random() * candidates.length)] ?? center;
  }

  private updateEnemyChase(enemy: EnemyState, playerOnGrid: THREE.Vector3, delta: number): void {
    if (enemy.stepTarget) {
      enemy.stepElapsed += delta;
      const progress = Math.min(enemy.stepElapsed / ENEMY_STEP_DURATION, 1);
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
    if (enemy.hp <= 0 || this.phase !== 'combat' || !this.hasLivingEnemies()) return;
    if (enemy.model === 'crab') {
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
        this.damagePlayer(12);
        this.updateHud();
      }, enemy);
      this.setNotice(`${enemy.name} ataca con sus pinzas.`);
      return;
    }
    enemy.attackCooldown = 3.2;
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
      this.damagePlayer(9);
      this.updateHud();
    }, enemy);
    this.setNotice(`${enemy.name} dispara una flecha.`);
  }

  private damagePlayer(amount: number): void {
    if (this.phase !== 'combat') return;
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
      if (!this.grid.isWalkable(next.x, next.y) || this.isOccupied(next, enemy)) break;
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
    if (this.isShielding) this.flashShield();
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
    const face = this.shieldVisual.children[0] as THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
    face.material.opacity = 0.48;
    window.setTimeout(() => {
      if (this.isShielding) face.material.opacity = 0.22;
    }, 140);
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
    const livingEnemies = this.enemies.filter((enemy) => enemy.hp > 0).length;
    this.enemyCountLabel.textContent = `ENEMIGOS ${livingEnemies}`;
    this.turnIndicator.textContent = this.phase === 'combat'
      ? 'COMBATE ACTIVO'
      : this.phase === 'victory'
        ? 'BOSQUE DESPEJADO'
        : 'DERROTA';
    this.shieldLabel.textContent = this.isShielding ? 'ESCUDO ACTIVO · Q' : 'ESCUDO · MANTENER Q';
    this.shieldLabel.classList.toggle('shield-active', this.isShielding);
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

    if (!this.worldMap.hidden) {
      this.renderer.render(this.scene, this.camera);
      this.animationFrame = requestAnimationFrame(this.animate);
      return;
    }

    this.updatePlayerMovement(delta);
    this.updateWaypoint();
    this.updateNetwork(delta);
    this.updateEnemies(delta);
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
