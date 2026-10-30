import * as THREE from 'three';
import { Grid } from '../../../shared/src/grid/Grid';
import { aStar, getReachableCells, manhattanDistance } from '../../../shared/src/pathfinding/astar';
import type { Cell } from '../../../shared/src/types/network';

const GRID_WIDTH = 12;
const GRID_HEIGHT = 12;
const CELL_SIZE = 2.2;
const PLAYER_HEIGHT = 1.65;
const MOVEMENT_PER_TURN = 5;
const SPELL_RANGE = 4;
const STEP_DURATION = 180;
const OBSTACLES: Array<[number, number]> = [
  [3, 2], [4, 2], [5, 2], [3, 3], [5, 3],
  [7, 4], [8, 4], [7, 5], [8, 5], [2, 7],
  [3, 7], [9, 8], [10, 8], [10, 9],
];

type SkillId = 'earth' | 'wind' | 'water';
type Phase = 'exploration' | 'player' | 'enemy' | 'defeat';

type EnemyState = {
  id: string;
  name: string;
  cell: Cell;
  hp: number;
  maxHp: number;
  movePoints: number;
  color: number;
  group: THREE.Group;
};

type TileState = {
  cell: Cell;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  baseColor: THREE.Color;
};

type VisualEffect = {
  object: THREE.Object3D;
  elapsed: number;
  duration: number;
  update: (progress: number) => void;
  finish?: () => void;
};

export class FirstPersonGame {
  private readonly root: HTMLElement;
  private readonly world: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly grid = new Grid(GRID_WIDTH, GRID_HEIGHT, OBSTACLES);
  private readonly tiles: TileState[] = [];
  private readonly enemies: EnemyState[] = [];
  private readonly combatEnemies: EnemyState[] = [];
  private readonly effects: VisualEffect[] = [];
  private readonly skillButtons = new Map<SkillId, HTMLButtonElement>();
  private readonly playerCell: Cell = { x: 1, y: 1 };
  private readonly playerStats = {
    name: 'Krika, Arquera',
    hp: 100,
    maxHp: 100,
    movePoints: MOVEMENT_PER_TURN,
  };

  private phase: Phase = 'exploration';
  private selectedSkill: SkillId | null = null;
  private readonly usedSkills = new Set<SkillId>();
  private turnNumber = 1;
  private notice = '';
  private yaw = 0;
  private pitch = -0.035;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private movementPath: Cell[] = [];
  private movementTarget: Cell | null = null;
  private movementElapsed = 0;
  private movementStart = new THREE.Vector3();
  private movementEnd = new THREE.Vector3();
  private enemyQueue: EnemyState[] = [];
  private activeEnemy: EnemyState | null = null;
  private enemyPath: Cell[] = [];
  private enemyTarget: Cell | null = null;
  private enemyElapsed = 0;
  private enemyMoveStart = new THREE.Vector3();
  private enemyMoveEnd = new THREE.Vector3();
  private animationFrame = 0;
  private previousFrameTime = 0;

  private readonly hoverCard: HTMLElement;
  private readonly hoverName: HTMLElement;
  private readonly hoverRole: HTMLElement;
  private readonly hoverHealth: HTMLElement;
  private readonly hoverMove: HTMLElement;
  private readonly hoverHealthFill: HTMLElement;
  private readonly healthLabel: HTMLElement;
  private readonly movementLabel: HTMLElement;
  private readonly turnIndicator: HTMLElement;
  private readonly turnMessage: HTMLElement;
  private readonly endTurnButton: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.world = this.getElement('#world');
    this.hoverCard = this.getElement('#hover-card');
    this.hoverName = this.getElement('#hover-name');
    this.hoverRole = this.getElement('#hover-role');
    this.hoverHealth = this.getElement('#hover-health');
    this.hoverMove = this.getElement('#hover-move');
    this.hoverHealthFill = this.getElement('#hover-health-fill');
    this.healthLabel = this.getElement('#player-health');
    this.movementLabel = this.getElement('#player-move');
    this.turnIndicator = this.getElement('#turn-indicator');
    this.turnMessage = this.getElement('#turn-message');
    this.endTurnButton = this.getElement<HTMLButtonElement>('#end-turn');

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Juego en primera persona');
    this.world.appendChild(this.renderer.domElement);

    this.configureScene();
    this.createWorld();
    this.createFirstPersonBow();
    this.configureCamera();
    this.bindControls();
    this.updateHud();
    this.updateReachableTiles();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  private readonly resize = (): void => {
    const width = this.world.clientWidth;
    const height = this.world.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private configureScene(): void {
    this.scene.background = new THREE.Color(0x91a99a);
    this.scene.fog = new THREE.Fog(0x91a99a, 25, 55);

    const hemisphere = new THREE.HemisphereLight(0xe4f0dc, 0x3a4938, 2.1);
    this.scene.add(hemisphere);

    const sunlight = new THREE.DirectionalLight(0xffe6b6, 2.4);
    sunlight.position.set(-8, 18, -10);
    this.scene.add(sunlight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({ color: 0x304f3e, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    this.scene.add(ground);
  }

  private createWorld(): void {
    const tileGeometry = new THREE.PlaneGeometry(CELL_SIZE * 0.985, CELL_SIZE * 0.985);
    const edgeGeometry = new THREE.EdgesGeometry(tileGeometry);

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = { x, y };
        const color = (x + y) % 2 === 0 ? 0x466d50 : 0x3d6249;
        const material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.95,
          transparent: true,
          opacity: 1,
        });
        const mesh = new THREE.Mesh(tileGeometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.copy(this.cellToWorld(cell));
        mesh.position.y = 0.015;
        mesh.userData.cell = cell;
        this.scene.add(mesh);
        this.tiles.push({ cell, mesh, baseColor: new THREE.Color(color) });

        const edges = new THREE.LineSegments(
          edgeGeometry,
          new THREE.LineBasicMaterial({ color: 0xb7c89a, transparent: true, opacity: 0.32 }),
        );
        edges.rotation.x = -Math.PI / 2;
        edges.position.copy(mesh.position);
        edges.position.y += 0.012;
        this.scene.add(edges);
      }
    }

    OBSTACLES.forEach(([x, y]) => this.createTree({ x, y }));
    this.createBoundaryTrees();
    this.createDistantHills();
    this.createEnemies();
  }

  private createTree(cell: Cell): void {
    const position = this.cellToWorld(cell);
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1.35, 7),
      new THREE.MeshStandardMaterial({ color: 0x69492d, roughness: 1 }),
    );
    trunk.position.y = 0.68;
    tree.add(trunk);

    const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x286347, roughness: 0.9 });
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.05, 7), foliageMaterial);
    crown.position.y = 1.9;
    tree.add(crown);

    const upperCrown = new THREE.Mesh(
      new THREE.ConeGeometry(0.69, 1.55, 7),
      new THREE.MeshStandardMaterial({ color: 0x39774d, roughness: 0.9 }),
    );
    upperCrown.position.y = 2.65;
    tree.add(upperCrown);
    tree.position.set(position.x, 0, position.z);
    this.scene.add(tree);
  }

  private createDistantHills(): void {
    for (let index = 0; index < 38; index++) {
      const angle = (index / 38) * Math.PI * 2;
      const radius = 15 + (index % 3) * 0.7;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.25, 1.5, 7),
        new THREE.MeshStandardMaterial({ color: 0x60442e }),
      );
      trunk.position.y = 0.75;
      tree.add(trunk);
      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(1.05, 2.6, 7),
        new THREE.MeshStandardMaterial({ color: index % 2 === 0 ? 0x28583e : 0x35694a }),
      );
      leaves.position.y = 2.2;
      tree.add(leaves);
      tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      this.scene.add(tree);
    }
  }

  private createEnemies(): void {
    const definitions: Array<Omit<EnemyState, 'group'>> = [
      { id: 'mossling', name: 'Musguito', cell: { x: 8, y: 2 }, hp: 55, maxHp: 55, movePoints: MOVEMENT_PER_TURN, color: 0x78a951 },
      { id: 'thornling', name: 'Espinajo', cell: { x: 9, y: 2 }, hp: 55, maxHp: 55, movePoints: MOVEMENT_PER_TURN, color: 0xc36d51 },
      { id: 'mireling', name: 'Lodoso', cell: { x: 9, y: 3 }, hp: 55, maxHp: 55, movePoints: MOVEMENT_PER_TURN, color: 0x648ea5 },
      { id: 'wildling', name: 'Silvestre', cell: { x: 5, y: 9 }, hp: 65, maxHp: 65, movePoints: MOVEMENT_PER_TURN, color: 0xb18a54 },
    ];

    definitions.forEach((definition) => {
      const group = this.createEnemyModel(definition.color);
      const position = this.cellToWorld(definition.cell);
      group.position.set(position.x, 0, position.z);
      group.userData.enemyId = definition.id;
      this.scene.add(group);
      this.enemies.push({ ...definition, group });
    });
  }

  private createEnemyModel(color: number): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.58, 1), bodyMaterial);
    body.position.y = 0.76;
    body.userData.selectableEnemy = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.31, 16, 12),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(1.18), roughness: 0.7 }),
    );
    head.position.set(0, 1.32, -0.04);
    head.userData.selectableEnemy = true;
    group.add(head);

    const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xf3ebd7, emissive: 0x353126 });
    for (const eyeX of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), eyeMaterial);
      eye.position.set(eyeX, 1.34, -0.31);
      eye.userData.selectableEnemy = true;
      group.add(eye);
    }

    const healthBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.075, 0.035),
      new THREE.MeshBasicMaterial({ color: 0x17221c }),
    );
    healthBack.position.set(0, 1.82, 0);
    group.add(healthBack);

    const healthFill = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.045, 0.045),
      new THREE.MeshBasicMaterial({ color: 0xe16e60 }),
    );
    healthFill.position.set(0, 1.82, -0.025);
    healthFill.userData.healthBar = true;
    group.add(healthFill);
    return group;
  }

  private createFirstPersonBow(): void {
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
    this.scene.add(this.camera);
  }

  private configureCamera(): void {
    const playerPosition = this.cellToWorld(this.playerCell);
    const enemiesCenter = new THREE.Vector3();
    const nearby = this.enemies.slice(0, 3);
    nearby.forEach((enemy) => enemiesCenter.add(this.cellToWorld(enemy.cell)));
    enemiesCenter.divideScalar(nearby.length);

    this.camera.position.set(playerPosition.x, PLAYER_HEIGHT, playerPosition.z);
    const dx = enemiesCenter.x - playerPosition.x;
    const dz = enemiesCenter.z - playerPosition.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = -0.045;
    this.applyCameraRotation();
  }

  private bindControls(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', this.onContextMenu);

    this.root.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((button) => {
      const skill = button.dataset.skill as SkillId;
      this.skillButtons.set(skill, button);
      button.addEventListener('click', () => this.selectSkill(skill));
    });
    this.endTurnButton.addEventListener('click', () => this.endPlayerTurn());

    window.addEventListener('keydown', this.onKeyDown);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      this.dragging = true;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button === 0) this.handleWorldClick(event.clientX, event.clientY);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button === 2) this.dragging = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.dragging) {
      this.yaw -= (event.clientX - this.lastPointerX) * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - this.lastPointerY) * 0.003, -0.65, 0.42);
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.applyCameraRotation();
    }

    this.updateHover(event.clientX, event.clientY);
  };

  private readonly onContextMenu = (event: MouseEvent): void => event.preventDefault();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'Digit1') this.selectSkill('earth');
    if (event.code === 'Digit2') this.selectSkill('wind');
    if (event.code === 'Digit3') this.selectSkill('water');
    if (event.code === 'Enter') this.endPlayerTurn();
  };

  private handleWorldClick(clientX: number, clientY: number): void {
    if (this.phase === 'enemy' || this.phase === 'defeat') return;
    if (this.movementTarget || this.enemyTarget || this.effects.length > 0) return;

    const enemy = this.pickEnemy(clientX, clientY);
    if (this.phase === 'exploration' && enemy) {
      this.beginCombat(enemy);
      return;
    }

    if (this.phase === 'player' && this.selectedSkill) {
      this.castSkill(enemy, this.pickCell(clientX, clientY));
      return;
    }

    if (this.phase === 'player' && enemy) {
      this.setNotice('Selecciona una habilidad para atacar.');
      return;
    }

    const targetCell = this.pickCell(clientX, clientY);
    if (!targetCell) return;
    if (this.phase === 'player' && this.isOccupied(targetCell)) {
      this.setNotice('Esa casilla esta ocupada.');
      return;
    }
    this.movePlayerTo(targetCell);
  }

  private beginCombat(clickedEnemy: EnemyState): void {
    this.combatEnemies.splice(0, this.combatEnemies.length, ...this.enemies.filter((enemy) =>
      enemy.hp > 0 && manhattanDistance(enemy.cell, clickedEnemy.cell) <= 3,
    ));
    this.combatEnemies.forEach((enemy) => {
      enemy.movePoints = MOVEMENT_PER_TURN;
      this.setEnemyCombatRing(enemy, true);
    });
    this.phase = 'player';
    this.turnNumber = 1;
    this.playerStats.movePoints = MOVEMENT_PER_TURN;
    this.usedSkills.clear();
    this.setNotice(`Combate iniciado: ${this.combatEnemies.length} enemigos. Tu turno.`);
    this.updateHud();
    this.updateReachableTiles();
  }

  private movePlayerTo(targetCell: Cell): void {
    const blocked = this.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.cell);
    const path = aStar(this.createPathGrid(blocked), this.playerCell, targetCell);
    const stepCount = path.length - 1;
    if (stepCount < 1) return;

    if (this.phase === 'player' && stepCount > this.playerStats.movePoints) {
      this.setNotice(`Ruta de ${stepCount} pasos; te quedan ${this.playerStats.movePoints}.`);
      return;
    }

    if (this.phase === 'player') this.playerStats.movePoints -= stepCount;
    this.movementPath = path.slice(1);
    this.movementElapsed = 0;
    this.setNextPlayerStep();
    this.updateHud();
    this.updateReachableTiles();
  }

  private setNextPlayerStep(): void {
    this.movementTarget = this.movementPath.shift() ?? null;
    if (!this.movementTarget) return;

    this.movementStart.copy(this.camera.position);
    const target = this.cellToWorld(this.movementTarget);
    this.movementEnd.set(target.x, PLAYER_HEIGHT, target.z);
  }

  private updatePlayerMovement(delta: number): void {
    if (!this.movementTarget) return;

    this.movementElapsed += delta;
    const progress = Math.min(this.movementElapsed / STEP_DURATION, 1);
    this.camera.position.lerpVectors(this.movementStart, this.movementEnd, progress);

    if (progress === 1) {
      this.playerCell.x = this.movementTarget.x;
      this.playerCell.y = this.movementTarget.y;
      this.movementElapsed = 0;
      this.setNextPlayerStep();
      this.updateReachableTiles();
    }
  }

  private selectSkill(skill: SkillId): void {
    if (this.phase !== 'player' || this.usedSkills.has(skill) || this.movementTarget) return;
    this.selectedSkill = skill;
    const instructions: Record<SkillId, string> = {
      earth: 'TIERRA: haz clic en una casilla a 4 pasos; el impacto afecta el area cercana.',
      wind: 'VIENTO: haz clic en un enemigo a 4 pasos para danarlo y empujarlo.',
      water: 'AGUA: haz clic en un enemigo a 4 pasos para robar hasta 2 PM.',
    };
    this.setNotice(instructions[skill]);
    this.updateHud();
  }

  private castSkill(enemy: EnemyState | null, cell: Cell | null): void {
    const skill = this.selectedSkill;
    if (!skill) return;
    const target = enemy?.cell ?? cell;

    if (!target || manhattanDistance(this.playerCell, target) > SPELL_RANGE) {
      this.setNotice(`La habilidad tiene alcance maximo de ${SPELL_RANGE} casillas.`);
      return;
    }

    if (skill === 'earth') {
      const affected = this.combatEnemies.filter((candidate) =>
        candidate.hp > 0 && manhattanDistance(candidate.cell, target) <= 1,
      );
      if (affected.length === 0) {
        this.setNotice('El area debe alcanzar al menos un enemigo.');
        return;
      }
      this.playEarthBurst(target);
      affected.forEach((candidate) => {
        this.damageEnemy(candidate, 24);
        this.playImpact(candidate, '-24 PV', 0xd4a858);
      });
      this.consumeSkill(`Tierra dano a ${affected.length} enemigo(s).`);
      return;
    }

    const combatTarget = enemy && this.combatEnemies.includes(enemy) ? enemy : null;
    if (!combatTarget || combatTarget.hp <= 0) {
      this.setNotice('Apunta a un enemigo activo del combate.');
      return;
    }

    if (skill === 'wind') {
      this.playSlash(this.playerCell, combatTarget.cell, 0xb6f3d9);
      this.damageEnemy(combatTarget, 16);
      this.playImpact(combatTarget, '-16 PV', 0xb6f3d9);
      if (combatTarget.hp > 0) this.pushEnemy(combatTarget, 2);
      this.consumeSkill(`Viento golpea y empuja a ${combatTarget.name}.`);
      return;
    }

    const stolen = Math.min(2, combatTarget.movePoints);
    if (stolen === 0) {
      this.setNotice(`${combatTarget.name} no tiene PM disponibles.`);
      return;
    }
    combatTarget.movePoints -= stolen;
    this.playerStats.movePoints += stolen;
    this.playWaterShot(combatTarget, stolen);
    this.consumeSkill(`Agua roba ${stolen} PM a ${combatTarget.name}.`);
  }

  private consumeSkill(message: string): void {
    if (this.selectedSkill) this.usedSkills.add(this.selectedSkill);
    this.selectedSkill = null;
    this.setNotice(message);
    this.updateHud();
    this.updateReachableTiles();
    this.checkVictory();
  }

  private endPlayerTurn(): void {
    if (this.phase !== 'player' || this.movementTarget || this.effects.length > 0) return;
    this.phase = 'enemy';
    this.selectedSkill = null;
    this.enemyQueue = this.combatEnemies.filter((enemy) => enemy.hp > 0);
    this.setNotice('Turno de los enemigos.');
    this.updateHud();
    this.startNextEnemyTurn();
  }

  private startNextEnemyTurn(): void {
    if (this.phase !== 'enemy') return;
    this.activeEnemy = this.enemyQueue.shift() ?? null;

    if (!this.activeEnemy) {
      this.startPlayerTurn();
      return;
    }

    const blockers = this.combatEnemies
      .filter((enemy) => enemy.hp > 0 && enemy !== this.activeEnemy)
      .map((enemy) => enemy.cell);
    const path = aStar(this.createPathGrid(blockers), this.activeEnemy.cell, this.playerCell);
    const approach = path.length > 1 ? path.slice(1, -1) : [];
    const steps = Math.min(this.activeEnemy.movePoints, approach.length);
    this.enemyPath = approach.slice(0, steps);
    this.activeEnemy.movePoints -= steps;
    this.setNextEnemyStep();
  }

  private setNextEnemyStep(): void {
    if (!this.activeEnemy) return;
    this.enemyTarget = this.enemyPath.shift() ?? null;
    if (!this.enemyTarget) {
      this.finishEnemyAction();
      return;
    }

    this.enemyElapsed = 0;
    this.enemyMoveStart.copy(this.activeEnemy.group.position);
    const target = this.cellToWorld(this.enemyTarget);
    this.enemyMoveEnd.set(target.x, 0, target.z);
  }

  private updateEnemyMovement(delta: number): void {
    if (!this.activeEnemy || !this.enemyTarget) return;
    this.enemyElapsed += delta;
    const progress = Math.min(this.enemyElapsed / STEP_DURATION, 1);
    this.activeEnemy.group.position.lerpVectors(this.enemyMoveStart, this.enemyMoveEnd, progress);

    if (progress === 1) {
      this.activeEnemy.cell = this.enemyTarget;
      this.enemyElapsed = 0;
      this.setNextEnemyStep();
    }
  }

  private finishEnemyAction(): void {
    const enemy = this.activeEnemy;
    this.enemyTarget = null;
    if (!enemy) return;

    if (enemy.hp > 0 && manhattanDistance(enemy.cell, this.playerCell) <= 1) {
      this.playSlash(enemy.cell, this.playerCell, 0xff786b);
      this.playerStats.hp = Math.max(0, this.playerStats.hp - 9);
      this.playPlayerImpact('-9 PV');
      this.updateHud();
      if (this.playerStats.hp === 0) {
        this.phase = 'defeat';
        this.activeEnemy = null;
        this.setNotice('Has caido en el bosque. Recarga para volver a intentarlo.');
        return;
      }
      this.setNotice(`${enemy.name} te hace 9 de dano.`);
      this.activeEnemy = null;
      window.setTimeout(() => this.startNextEnemyTurn(), 420);
      return;
    }

    this.activeEnemy = null;
    this.startNextEnemyTurn();
  }

  private startPlayerTurn(): void {
    if (this.checkVictory()) return;
    this.phase = 'player';
    this.turnNumber += 1;
    this.playerStats.movePoints = MOVEMENT_PER_TURN;
    this.usedSkills.clear();
    this.combatEnemies.forEach((enemy) => {
      if (enemy.hp > 0) enemy.movePoints = MOVEMENT_PER_TURN;
    });
    this.setNotice('Tu turno: camina hasta 5 casillas y usa tus habilidades.');
    this.updateHud();
    this.updateReachableTiles();
  }

  private checkVictory(): boolean {
    if (this.combatEnemies.length === 0 || this.combatEnemies.some((enemy) => enemy.hp > 0)) return false;
    this.combatEnemies.forEach((enemy) => this.setEnemyCombatRing(enemy, false));
    this.combatEnemies.length = 0;
    this.enemyQueue = [];
    this.activeEnemy = null;
    this.phase = 'exploration';
    this.setNotice('Victoria. Busca otro enemigo en el bosque.');
    this.updateHud();
    return true;
  }

  private pushEnemy(enemy: EnemyState, distance: number): void {
    const dx = enemy.cell.x - this.playerCell.x;
    const dy = enemy.cell.y - this.playerCell.y;
    const direction: Cell = Math.abs(dx) >= Math.abs(dy)
      ? { x: Math.sign(dx), y: 0 }
      : { x: 0, y: Math.sign(dy) };
    let destination = { ...enemy.cell };

    for (let step = 0; step < distance; step++) {
      const next = { x: destination.x + direction.x, y: destination.y + direction.y };
      if (!this.grid.isWalkable(next.x, next.y) || this.isOccupied(next, enemy)) break;
      if (next.x === this.playerCell.x && next.y === this.playerCell.y) break;
      destination = next;
    }

    if (destination.x === enemy.cell.x && destination.y === enemy.cell.y) return;
    const start = enemy.group.position.clone();
    const worldTarget = this.cellToWorld(destination);
    enemy.cell = destination;
    this.addEffect(enemy.group, 280, (progress) => {
      enemy.group.position.lerpVectors(start, new THREE.Vector3(worldTarget.x, 0, worldTarget.z), progress);
    }, () => enemy.group.position.set(worldTarget.x, 0, worldTarget.z));
  }

  private damageEnemy(enemy: EnemyState, damage: number): void {
    enemy.hp = Math.max(0, enemy.hp - damage);
    const health = enemy.group.children.find((child) => child.userData.healthBar);
    if (health instanceof THREE.Mesh) {
      const ratio = enemy.hp / enemy.maxHp;
      health.scale.x = Math.max(0.001, ratio);
      health.position.x = -0.45 * (1 - ratio);
    }
    if (enemy.hp === 0) {
      this.scene.remove(enemy.group);
      this.setEnemyCombatRing(enemy, false);
    }
  }

  private playEarthBurst(cell: Cell): void {
    const center = this.cellToWorld(cell);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.52, 36),
      new THREE.MeshBasicMaterial({ color: 0xd4a858, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, 0.12, center.z);
    this.scene.add(ring);
    this.addEffect(ring, 520, (progress) => {
      ring.scale.setScalar(0.5 + progress * 2.8);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - progress);
    });
  }

  private playSlash(from: Cell, to: Cell, color: number): void {
    const startCell = this.cellToWorld(from);
    const endCell = this.cellToWorld(to);
    const start = new THREE.Vector3(startCell.x, from.x === this.playerCell.x && from.y === this.playerCell.y ? PLAYER_HEIGHT - 0.4 : 1.25, startCell.z);
    const end = new THREE.Vector3(endCell.x, to.x === this.playerCell.x && to.y === this.playerCell.y ? PLAYER_HEIGHT - 0.25 : 1.15, endCell.z);
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, linewidth: 3 });
    const slash = new THREE.Line(geometry, material);
    this.scene.add(slash);
    this.addEffect(slash, 260, (progress) => {
      material.opacity = 0.95 * (1 - progress);
    }, () => {
      geometry.dispose();
      material.dispose();
    });
  }

  private playImpact(enemy: EnemyState, label: string, color: number): void {
    const position = enemy.group.position.clone();
    position.y += 1.2;
    this.playRing(position, color);
    this.playFloatLabel(position, label, color);
  }

  private playPlayerImpact(label: string): void {
    const position = this.camera.position.clone();
    position.add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2.2));
    position.y += 0.12;
    this.playRing(position, 0xff786b);
    this.playFloatLabel(position, label, 0xffb0a5);
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

  private playWaterShot(enemy: EnemyState, stolen: number): void {
    const start = this.camera.position.clone();
    start.add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.85));
    const enemyPosition = enemy.group.position.clone();
    const end = enemyPosition.add(new THREE.Vector3(0, 1.1, 0));
    const projectile = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x7be6ef }),
    );
    projectile.position.copy(start);
    this.scene.add(projectile);
    this.addEffect(projectile, 340, (progress) => {
      projectile.position.lerpVectors(start, end, progress);
    }, () => {
      projectile.geometry.dispose();
      (projectile.material as THREE.Material).dispose();
      this.playImpact(enemy, `-${stolen} PM`, 0x7be6ef);
      this.playPlayerImpact(`+${stolen} PM`);
    });
  }

  private addEffect(
    object: THREE.Object3D,
    duration: number,
    update: (progress: number) => void,
    finish?: () => void,
  ): void {
    this.effects.push({ object, elapsed: 0, duration, update, finish });
  }

  private updateEffects(delta: number): void {
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
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
    const intersections = this.intersect(clientX, clientY, this.enemies.map((enemy) => enemy.group));
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
    const intersections = this.intersect(clientX, clientY, this.tiles.map((tile) => tile.mesh));
    const cell = intersections[0]?.object.userData.cell as Cell | undefined;
    return cell ?? null;
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

  private updateHover(clientX: number, clientY: number): void {
    const enemy = this.pickEnemy(clientX, clientY);
    if (!enemy) {
      this.hoverCard.hidden = true;
      return;
    }

    this.hoverName.textContent = enemy.name;
    this.hoverRole.textContent = this.combatEnemies.includes(enemy) ? 'Enemigo en combate' : 'Criatura del bosque';
    this.hoverHealth.textContent = `PV ${enemy.hp} / ${enemy.maxHp}`;
    this.hoverMove.textContent = `PM ${enemy.movePoints}`;
    (this.hoverHealthFill as HTMLElement).style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;

    const rootRect = this.root.getBoundingClientRect();
    const cardWidth = 218;
    const cardHeight = 104;
    const localX = clientX - rootRect.left;
    const localY = clientY - rootRect.top;
    this.hoverCard.style.left = `${THREE.MathUtils.clamp(localX + 18, 8, rootRect.width - cardWidth - 8)}px`;
    this.hoverCard.style.top = `${THREE.MathUtils.clamp(localY + 18, 8, rootRect.height - cardHeight - 8)}px`;
    this.hoverCard.hidden = false;
  }

  private updateHud(): void {
    this.healthLabel.textContent = `PV ${this.playerStats.hp} / ${this.playerStats.maxHp}`;
    this.movementLabel.textContent = `PM ${this.playerStats.movePoints}`;
    this.turnIndicator.textContent = this.phase === 'exploration'
      ? 'EXPLORACION'
      : this.phase === 'defeat'
        ? 'DERROTA'
        : `TURNO ${this.turnNumber} · ${this.phase === 'player' ? 'TUYO' : 'ENEMIGO'}`;
    this.endTurnButton.disabled = this.phase !== 'player' || this.movementTarget !== null || this.effects.length > 0;

    const phaseMessage: Record<Phase, string> = {
      exploration: 'Clic en el suelo para caminar · Clic en una criatura para iniciar combate',
      player: 'Tu turno · hasta 5 pasos · apunta con una habilidad y haz clic en el objetivo',
      enemy: 'Los enemigos se mueven y atacan...',
      defeat: 'Has caido en el bosque.',
    };
    if (!this.notice) this.turnMessage.textContent = phaseMessage[this.phase];

    this.skillButtons.forEach((button, skill) => {
      button.disabled = this.phase !== 'player' || this.usedSkills.has(skill);
      button.setAttribute('aria-pressed', String(this.selectedSkill === skill));
    });
  }

  private setNotice(message: string): void {
    this.notice = message;
    this.turnMessage.textContent = message;
  }

  private updateReachableTiles(): void {
    const reachable = this.phase === 'player'
      ? new Set(getReachableCells(this.grid, this.playerCell, this.playerStats.movePoints).map((cell) => `${cell.x},${cell.y}`))
      : new Set<string>();

    this.tiles.forEach((tile) => {
      const key = `${tile.cell.x},${tile.cell.y}`;
      const isReachable = reachable.has(key) && !this.isOccupied(tile.cell);
      const color = isReachable ? new THREE.Color(0x72c59b) : tile.baseColor;
      tile.mesh.material.color.copy(color);
      tile.mesh.material.opacity = isReachable ? 0.82 : 1;
    });
  }

  private setEnemyCombatRing(enemy: EnemyState, enabled: boolean): void {
    if (enabled) {
      if (enemy.group.getObjectByName('combat-ring')) return;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.68, 0.77, 32),
        new THREE.MeshBasicMaterial({ color: 0xf1cf7e, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      ring.name = 'combat-ring';
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.045;
      enemy.group.add(ring);
      return;
    }
    const ring = enemy.group.getObjectByName('combat-ring');
    if (ring) enemy.group.remove(ring);
  }

  private cellToWorld(cell: Cell): THREE.Vector3 {
    return new THREE.Vector3(
      (cell.x - (GRID_WIDTH - 1) / 2) * CELL_SIZE,
      0,
      (cell.y - (GRID_HEIGHT - 1) / 2) * CELL_SIZE,
    );
  }

  private createBoundaryTrees(): void {
    const mountainGeometry = new THREE.ConeGeometry(5, 11, 7);
    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x687d68, roughness: 1 });
    for (let index = 0; index < 10; index++) {
      const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
      const angle = (index / 10) * Math.PI * 2;
      mountain.position.set(Math.cos(angle) * 31, 4.7, Math.sin(angle) * 31);
      this.scene.add(mountain);
    }
  }

  private applyCameraRotation(): void {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  private readonly animate = (time: number): void => {
    const delta = Math.min(time - (this.previousFrameTime || time), 50);
    this.previousFrameTime = time;

    this.updatePlayerMovement(delta);
    this.updateEnemyMovement(delta);
    this.updateEffects(delta);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Falta un elemento requerido: ${selector}`);
    return element;
  }
}
