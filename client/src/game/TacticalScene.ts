import Phaser from 'phaser';
import { Grid } from '../../../shared/src/grid/Grid';
import { aStar, getReachableCells, manhattanDistance } from '../../../shared/src/pathfinding/astar';
import type { Cell } from '../../../shared/src/types/network';

const TILE_WIDTH = 72;
const TILE_HEIGHT = 40;
const ORIGIN_X = 480;
const ORIGIN_Y = 82;
const STEP_DURATION = 180;
const MOVEMENT_PER_TURN = 5;
const SPELL_RANGE = 4;

type SkillId = 'earth' | 'wind' | 'water';
type CombatPhase = 'exploration' | 'player' | 'enemy' | 'defeat';

type EnemyState = {
  id: string;
  name: string;
  cell: Cell;
  hp: number;
  maxHp: number;
  movePoints: number;
  color: number;
  displayX?: number;
  displayY?: number;
};

const SKILL_NAMES: Record<SkillId, string> = {
  earth: 'TIERRA',
  wind: 'VIENTO',
  water: 'AGUA',
};

export class TacticalScene extends Phaser.Scene {
  private grid!: Grid;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private dynamicGraphics!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private playerCell: Cell = { x: 1, y: 1 };
  private playerX = 0;
  private playerY = 0;
  private playerHp = 100;
  private playerMovePoints = MOVEMENT_PER_TURN;
  private movementPath: Cell[] = [];
  private stepTarget: Cell | null = null;
  private stepElapsed = 0;
  private hoveredCell: Cell | null = null;
  private selectedCell: Cell | null = null;
  private phase: CombatPhase = 'exploration';
  private combatEnemies: EnemyState[] = [];
  private enemies: EnemyState[] = [];
  private selectedSkill: SkillId | null = null;
  private readonly usedSkills = new Set<SkillId>();
  private notice = '';
  private visualEffectCount = 0;
  private turnNumber = 1;
  private enemyQueue: EnemyState[] = [];
  private activeEnemy: EnemyState | null = null;
  private enemyPath: Cell[] = [];
  private enemyStepTarget: Cell | null = null;
  private enemyStepElapsed = 0;
  private readonly skillButtons = new Map<SkillId, Phaser.GameObjects.Rectangle>();

  constructor() {
    super('TacticalScene');
  }

  create(): void {
    const obstacles: Array<[number, number]> = [
      [3, 2], [4, 2], [5, 2], [3, 3], [5, 3],
      [7, 4], [8, 4], [7, 5], [8, 5], [2, 7],
      [3, 7], [9, 8], [10, 8], [10, 9],
    ];

    this.grid = new Grid(12, 12, obstacles);
    this.enemies = [
      { id: 'mossling', name: 'Musguito', cell: { x: 8, y: 2 }, hp: 55, maxHp: 55, movePoints: 5, color: 0x76a956 },
      { id: 'thornling', name: 'Espinajo', cell: { x: 9, y: 2 }, hp: 55, maxHp: 55, movePoints: 5, color: 0xc36d51 },
      { id: 'mireling', name: 'Lodoso', cell: { x: 9, y: 3 }, hp: 55, maxHp: 55, movePoints: 5, color: 0x638fa9 },
      { id: 'wildling', name: 'Silvestre', cell: { x: 5, y: 9 }, hp: 65, maxHp: 65, movePoints: 5, color: 0xb18a54 },
    ];

    this.cameras.main.setBackgroundColor('#11232a');
    this.mapGraphics = this.add.graphics();
    this.dynamicGraphics = this.add.graphics().setDepth(10);
    this.playerX = this.toIsoX(this.playerCell.x, this.playerCell.y);
    this.playerY = this.toIsoY(this.playerCell.x, this.playerCell.y);
    this.drawMap();
    this.createHud();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleWorldClick(pointer));
    this.input.keyboard?.on('keydown-ONE', () => this.selectSkill('earth'));
    this.input.keyboard?.on('keydown-TWO', () => this.selectSkill('wind'));
    this.input.keyboard?.on('keydown-THREE', () => this.selectSkill('water'));
    this.input.keyboard?.on('keydown-ENTER', () => this.endPlayerTurn());
  }

  update(_time: number, delta: number): void {
    const pointer = this.input.activePointer;
    this.hoveredCell = this.screenToCell(pointer.x, pointer.y);

    if (this.stepTarget) {
      this.updatePlayerMovement(delta);
    }

    if (this.activeEnemy && this.enemyStepTarget) {
      this.updateEnemyMovement(delta);
    }

    this.drawDynamicLayer();
    this.updateHud();
  }

  private createHud(): void {
    this.add.text(28, 20, 'KRIKAS  /  BOSQUE DE BRUMALIA', {
      color: '#f1d89b',
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      fontStyle: 'bold',
    }).setDepth(30);

    this.statusText = this.add.text(28, 48, '', {
      color: '#c4d6ca',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      maxLines: 1,
    }).setDepth(30);

    this.statsText = this.add.text(930, 20, '', {
      color: '#f3e7c7',
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(30);

    this.turnText = this.add.text(930, 44, '', {
      color: '#a9c5b4',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
    }).setOrigin(1, 0).setDepth(30);

    this.add.rectangle(0, 530, 960, 70, 0x101b20, 0.98)
      .setOrigin(0, 0)
      .setDepth(20);

    this.createSkillButton('earth', 'TIERRA  [1]', 200);
    this.createSkillButton('wind', 'VIENTO  [2]', 360);
    this.createSkillButton('water', 'AGUA  [3]', 520);

    const endTurnButton = this.add.rectangle(810, 565, 190, 46, 0x75563a)
      .setDepth(21)
      .setInteractive({ useHandCursor: true });
    this.add.text(810, 565, 'TERMINAR TURNO  [ENTER]', {
      color: '#fff3d4',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(22);
    endTurnButton.on('pointerdown', () => this.endPlayerTurn());
  }

  private createSkillButton(skill: SkillId, label: string, x: number): void {
    const button = this.add.rectangle(x, 565, 146, 46, 0x29453b)
      .setDepth(21)
      .setInteractive({ useHandCursor: true });

    this.add.text(x, 565, label, {
      color: '#e5f1e7',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(22);

    button.on('pointerdown', () => this.selectSkill(skill));
    this.skillButtons.set(skill, button);
  }

  private handleWorldClick(pointer: Phaser.Input.Pointer): void {
    if (pointer.y >= 530 || this.phase === 'enemy' || this.phase === 'defeat') return;
    if (this.stepTarget || this.enemyStepTarget || this.visualEffectCount > 0) return;

    const clickedEnemy = this.findEnemyAt(pointer.x, pointer.y);

    if (this.phase === 'exploration' && clickedEnemy) {
      this.beginCombat(clickedEnemy);
      return;
    }

    if (this.phase === 'player' && this.selectedSkill) {
      this.castSelectedSkill(clickedEnemy, this.screenToCell(pointer.x, pointer.y));
      return;
    }

    if (this.phase === 'player' && clickedEnemy) {
      this.notice = 'Elige una habilidad para atacar al enemigo.';
      return;
    }

    const cell = this.screenToCell(pointer.x, pointer.y);
    if (!cell || !this.grid.isWalkable(cell.x, cell.y)) return;

    if (this.phase === 'player' && this.isOccupiedByEnemy(cell)) {
      this.notice = 'Esa casilla está ocupada.';
      return;
    }

    this.movePlayerTo(cell);
  }

  private beginCombat(clickedEnemy: EnemyState): void {
    this.combatEnemies = this.enemies.filter((enemy) =>
      enemy.hp > 0 && manhattanDistance(enemy.cell, clickedEnemy.cell) <= 3,
    );
    this.combatEnemies.forEach((enemy) => {
      enemy.movePoints = MOVEMENT_PER_TURN;
    });
    this.phase = 'player';
    this.playerMovePoints = MOVEMENT_PER_TURN;
    this.usedSkills.clear();
    this.selectedSkill = null;
    this.notice = `¡Combate! ${this.combatEnemies.length} enemigo(s) entraron en la pelea.`;
    this.turnNumber = 1;
  }

  private movePlayerTo(cell: Cell): void {
    const blockedCells = this.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.cell);
    const path = aStar(this.createPathGrid(blockedCells), this.playerCell, cell);
    const steps = path.length - 1;

    if (steps < 1) return;

    if (this.phase === 'player' && steps > this.playerMovePoints) {
      this.notice = `Ruta de ${steps} pasos; solo te quedan ${this.playerMovePoints}.`;
      return;
    }

    if (this.phase === 'player') {
      this.playerMovePoints -= steps;
    }

    this.notice = '';
    this.selectedCell = cell;
    this.movementPath = path.slice(1);
    this.stepElapsed = 0;
    this.stepTarget = this.movementPath.shift() ?? null;
  }

  private updatePlayerMovement(delta: number): void {
    if (!this.stepTarget) return;

    this.stepElapsed += delta;
    const progress = Math.min(this.stepElapsed / STEP_DURATION, 1);
    const target = this.cellToScreen(this.stepTarget);
    const start = this.cellToScreen(this.playerCell);
    this.playerX = Phaser.Math.Linear(start.x, target.x, progress);
    this.playerY = Phaser.Math.Linear(start.y, target.y, progress);

    if (progress === 1) {
      this.playerCell = this.stepTarget;
      this.stepElapsed = 0;
      this.stepTarget = this.movementPath.shift() ?? null;

      if (!this.stepTarget) {
        this.selectedCell = null;
      }
    }
  }

  private selectSkill(skill: SkillId): void {
    if (this.phase !== 'player' || this.usedSkills.has(skill) || this.stepTarget) return;

    this.selectedSkill = skill;
    const instructions: Record<SkillId, string> = {
      earth: 'TIERRA: clic en una casilla a 4 pasos; daña en area alrededor.',
      wind: 'VIENTO: clic en un enemigo a 4 pasos; daña y lo empuja.',
      water: 'AGUA: clic en un enemigo a 4 pasos; roba hasta 2 pasos.',
    };
    this.notice = instructions[skill];
  }

  private castSelectedSkill(clickedEnemy: EnemyState | null, clickedCell: Cell | null): void {
    const skill = this.selectedSkill;
    if (!skill || this.phase !== 'player') return;

    const targetCell = clickedEnemy?.cell ?? clickedCell;
    if (!targetCell || manhattanDistance(this.playerCell, targetCell) > SPELL_RANGE) {
      this.notice = `La habilidad tiene alcance maximo de ${SPELL_RANGE} casillas.`;
      return;
    }

    if (skill === 'earth') {
      const affected = this.combatEnemies.filter((enemy) =>
        enemy.hp > 0 && manhattanDistance(enemy.cell, targetCell) <= 1,
      );
      if (affected.length === 0) {
        this.notice = 'El area de tierra debe alcanzar al menos un enemigo.';
        return;
      }

      affected.forEach((enemy) => {
        this.playImpact(enemy.cell, 0xd2a858, '-24');
        this.damageEnemy(enemy, 24);
      });
      this.consumeSkill(`Tierra golpea ${affected.length} enemigo(s) por 24 de dano.`);
      return;
    }

    const target = clickedEnemy && this.combatEnemies.includes(clickedEnemy) ? clickedEnemy : null;
    if (!target || target.hp <= 0) {
      this.notice = 'Haz clic directamente sobre un enemigo de la pelea.';
      return;
    }

    if (skill === 'wind') {
      this.playSlash(this.playerCell, target.cell, 0xb5f2d8);
      this.playImpact(target.cell, 0xa8ead2, '-16');
      this.damageEnemy(target, 16);
      if (target.hp > 0) this.pushEnemy(target, 2);
      this.consumeSkill(`Viento golpea a ${target.name} y lo empuja.`);
      return;
    }

    const stolenSteps = Math.min(2, target.movePoints);
    if (stolenSteps === 0) {
      this.notice = `${target.name} ya no tiene pasos para robar.`;
      return;
    }

    target.movePoints -= stolenSteps;
    this.playerMovePoints += stolenSteps;
  this.playProjectile(this.playerCell, target.cell, `-${stolenSteps} PM`);
  this.playImpact(this.playerCell, 0x75dff2, `+${stolenSteps} PM`);
    this.consumeSkill(`Agua roba ${stolenSteps} pasos a ${target.name}; ahora tienes ${this.playerMovePoints}.`);
  }

  private consumeSkill(message: string): void {
    if (this.selectedSkill) this.usedSkills.add(this.selectedSkill);
    this.selectedSkill = null;
    this.notice = message;
    this.checkCombatVictory();
  }

  private playImpact(cell: Cell, color: number, label: string): void {
    const center = this.cellToScreen(cell);
    const ring = this.add.circle(center.x, center.y, 7, color, 0.3)
      .setStrokeStyle(3, color, 0.95)
      .setDepth(16);
    this.visualEffectCount += 1;
    this.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 360,
      ease: 'Quad.Out',
      onComplete: () => {
        ring.destroy();
        this.visualEffectCount = Math.max(0, this.visualEffectCount - 1);
      },
    });

    const text = this.add.text(center.x, center.y - 23, label, {
      color: '#fff2ce',
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      stroke: '#15201b',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(17);
    this.visualEffectCount += 1;
    this.tweens.add({
      targets: text,
      y: center.y - 49,
      alpha: 0,
      duration: 620,
      ease: 'Quad.Out',
      onComplete: () => {
        text.destroy();
        this.visualEffectCount = Math.max(0, this.visualEffectCount - 1);
      },
    });
  }

  private playSlash(from: Cell, to: Cell, color: number): void {
    const start = this.cellToScreen(from);
    const end = this.cellToScreen(to);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const slash = this.add.rectangle(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      Math.max(34, Math.hypot(dx, dy)),
      4,
      color,
      0.95,
    ).setRotation(Math.atan2(dy, dx)).setDepth(16);

    this.visualEffectCount += 1;
    this.tweens.add({
      targets: slash,
      scaleX: 0.2,
      alpha: 0,
      duration: 220,
      ease: 'Quad.Out',
      onComplete: () => {
        slash.destroy();
        this.visualEffectCount = Math.max(0, this.visualEffectCount - 1);
      },
    });
  }

  private playProjectile(from: Cell, to: Cell, impactLabel: string): void {
    const start = this.cellToScreen(from);
    const end = this.cellToScreen(to);
    const projectile = this.add.circle(start.x, start.y, 6, 0x75dff2, 1)
      .setStrokeStyle(2, 0xe6fcff, 1)
      .setDepth(17);

    this.visualEffectCount += 1;
    this.tweens.add({
      targets: projectile,
      x: end.x,
      y: end.y,
      scale: 0.65,
      duration: 300,
      ease: 'Sine.InOut',
      onComplete: () => {
        projectile.destroy();
        this.visualEffectCount = Math.max(0, this.visualEffectCount - 1);
        this.playImpact(to, 0x75dff2, impactLabel);
      },
    });
  }

  private damageEnemy(enemy: EnemyState, damage: number): void {
    enemy.hp = Math.max(0, enemy.hp - damage);
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
      if (!this.grid.isWalkable(next.x, next.y) || this.isOccupiedByEnemy(next, enemy)) break;
      if (next.x === this.playerCell.x && next.y === this.playerCell.y) break;
      destination = next;
    }

    if (destination.x !== enemy.cell.x || destination.y !== enemy.cell.y) {
      const start = this.cellToScreen(enemy.cell);
      const end = this.cellToScreen(destination);
      enemy.cell = destination;
      enemy.displayX = start.x;
      enemy.displayY = start.y;
      this.visualEffectCount += 1;
      this.tweens.add({
        targets: enemy,
        displayX: end.x,
        displayY: end.y,
        duration: 260,
        ease: 'Quad.Out',
        onComplete: () => {
          enemy.displayX = end.x;
          enemy.displayY = end.y;
          this.visualEffectCount = Math.max(0, this.visualEffectCount - 1);
        },
      });
    }
  }

  private endPlayerTurn(): void {
    if (this.phase !== 'player' || this.stepTarget || this.enemyStepTarget || this.visualEffectCount > 0) return;

    this.phase = 'enemy';
    this.selectedSkill = null;
    this.notice = 'Turno de los enemigos.';
    this.enemyQueue = this.combatEnemies.filter((enemy) => enemy.hp > 0);
    this.startNextEnemyTurn();
  }

  private startNextEnemyTurn(): void {
    this.activeEnemy = this.enemyQueue.shift() ?? null;

    if (!this.activeEnemy) {
      this.startNextPlayerTurn();
      return;
    }

    const blockers = this.combatEnemies
      .filter((enemy) => enemy.hp > 0 && enemy !== this.activeEnemy)
      .map((enemy) => enemy.cell);
    const path = aStar(this.createPathGrid(blockers), this.activeEnemy.cell, this.playerCell);
    const approachPath = path.length > 1 ? path.slice(1, -1) : [];
    const steps = Math.min(this.activeEnemy.movePoints, approachPath.length);
    this.enemyPath = approachPath.slice(0, steps);
    this.activeEnemy.movePoints -= steps;
    this.enemyStepElapsed = 0;
    this.enemyStepTarget = this.enemyPath.shift() ?? null;

    if (!this.enemyStepTarget) {
      this.finishEnemyAction();
    }
  }

  private updateEnemyMovement(delta: number): void {
    const enemy = this.activeEnemy;
    const targetCell = this.enemyStepTarget;
    if (!enemy || !targetCell) return;

    this.enemyStepElapsed += delta;
    const progress = Math.min(this.enemyStepElapsed / STEP_DURATION, 1);
    const start = this.cellToScreen(enemy.cell);
    const target = this.cellToScreen(targetCell);
    enemy.displayX = Phaser.Math.Linear(start.x, target.x, progress);
    enemy.displayY = Phaser.Math.Linear(start.y, target.y, progress);

    if (progress === 1) {
      enemy.cell = targetCell;
      enemy.displayX = target.x;
      enemy.displayY = target.y;
      this.enemyStepElapsed = 0;
      this.enemyStepTarget = this.enemyPath.shift() ?? null;

      if (!this.enemyStepTarget) {
        this.finishEnemyAction();
      }
    }
  }

  private finishEnemyAction(): void {
    const enemy = this.activeEnemy;
    this.enemyStepTarget = null;

    if (enemy && enemy.hp > 0 && manhattanDistance(enemy.cell, this.playerCell) <= 1) {
      this.playSlash(enemy.cell, this.playerCell, 0xff786b);
      this.playImpact(this.playerCell, 0xff786b, '-9 PV');
      this.playerHp = Math.max(0, this.playerHp - 9);
      this.notice = `${enemy.name} te hace 9 de dano.`;

      if (this.playerHp === 0) {
        this.phase = 'defeat';
        this.activeEnemy = null;
        this.notice = 'Has sido derrotado. Recarga la pagina para volver a intentarlo.';
        return;
      }

      this.activeEnemy = null;
      this.time.delayedCall(260, () => this.startNextEnemyTurn());
      return;
    }

    this.activeEnemy = null;
    this.startNextEnemyTurn();
  }

  private startNextPlayerTurn(): void {
    if (this.checkCombatVictory()) return;

    this.phase = 'player';
    this.turnNumber += 1;
    this.playerMovePoints = MOVEMENT_PER_TURN;
    this.usedSkills.clear();
    this.combatEnemies.forEach((enemy) => {
      if (enemy.hp > 0) enemy.movePoints = MOVEMENT_PER_TURN;
    });
    this.notice = 'Tu turno. Puedes caminar hasta 5 casillas y usar una habilidad.';
  }

  private checkCombatVictory(): boolean {
    if (this.combatEnemies.length === 0 || this.combatEnemies.some((enemy) => enemy.hp > 0)) {
      return false;
    }

    this.phase = 'exploration';
    this.combatEnemies = [];
    this.enemyQueue = [];
    this.activeEnemy = null;
    this.enemyStepTarget = null;
    this.notice = 'Victoria. Haz clic en otro enemigo para iniciar el siguiente combate.';
    return true;
  }

  private findEnemyAt(x: number, y: number): EnemyState | null {
    return this.enemies.find((enemy) => {
      if (enemy.hp <= 0) return false;
      const center = this.cellToScreen(enemy.cell);
      return Math.hypot(x - center.x, y - (center.y - 7)) <= 22;
    }) ?? null;
  }

  private isOccupiedByEnemy(cell: Cell, except?: EnemyState): boolean {
    return this.enemies.some((enemy) =>
      enemy !== except && enemy.hp > 0 && enemy.cell.x === cell.x && enemy.cell.y === cell.y,
    );
  }

  private createPathGrid(blockedCells: Cell[]): Grid {
    const obstacles: Array<[number, number]> = [];

    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        if (!this.grid.isWalkable(x, y)) obstacles.push([x, y]);
      }
    }

    blockedCells.forEach((cell) => obstacles.push([cell.x, cell.y]));
    return new Grid(this.grid.width, this.grid.height, obstacles);
  }

  private updateHud(): void {
    const phaseText: Record<CombatPhase, string> = {
      exploration: 'Exploracion: haz clic en un enemigo para iniciar combate.',
      player: 'Tu turno: mueve hasta 5 casillas y usa una habilidad.',
      enemy: 'Turno enemigo...',
      defeat: 'Derrota.',
    };
    this.statusText.setText(this.notice || phaseText[this.phase]);
    this.statsText.setText(`PV ${this.playerHp}/100   PM ${this.playerMovePoints}`);
    this.turnText.setText(this.phase === 'player' || this.phase === 'enemy' ? `COMBATE  /  TURNO ${this.turnNumber}` : 'EXPLORACION');

    this.skillButtons.forEach((button, skill) => {
      const active = this.selectedSkill === skill;
      const enabled = this.phase === 'player' && !this.usedSkills.has(skill);
      button.setFillStyle(active ? 0x9a7441 : enabled ? 0x29453b : 0x26302d);
      button.setAlpha(enabled ? 1 : 0.55);
    });
  }

  private drawMap(): void {
    this.mapGraphics.clear();

    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const cell = this.grid.getCell(x, y);
        if (!cell) continue;
        const center = this.cellToScreen(cell);
        const color = (x + y) % 2 === 0 ? 0x386c56 : 0x32634f;
        this.drawDiamond(this.mapGraphics, center.x, center.y, color, 1, 0x91aa77, 0.55);
      }
    }

    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        if (!this.grid.isWalkable(x, y)) {
          const center = this.cellToScreen({ x, y });
          this.drawObstacle(center.x, center.y);
        }
      }
    }
  }

  private drawDynamicLayer(): void {
    this.dynamicGraphics.clear();

    if (this.phase === 'player') {
      const reachable = getReachableCells(this.grid, this.playerCell, this.playerMovePoints);
      reachable.forEach((cell) => {
        if (this.isOccupiedByEnemy(cell)) return;
        const center = this.cellToScreen(cell);
        this.drawDiamond(this.dynamicGraphics, center.x, center.y, 0x75d3ae, 0.12, 0x91edc8, 0.45);
      });
    }

    if (this.selectedCell) {
      const selected = this.cellToScreen(this.selectedCell);
      this.drawDiamond(this.dynamicGraphics, selected.x, selected.y, 0xf3d07c, 0.2, 0xf3d07c, 0.9);
    }

    if (this.hoveredCell && this.grid.isWalkable(this.hoveredCell.x, this.hoveredCell.y)) {
      const hovered = this.cellToScreen(this.hoveredCell);
      this.drawDiamond(this.dynamicGraphics, hovered.x, hovered.y, 0xbce7d2, 0.14, 0xe7fff1, 0.95);
    }

    this.enemies.forEach((enemy) => {
      if (enemy.hp > 0) this.drawEnemy(enemy);
    });
    this.drawArcher(this.playerX, this.playerY);
  }

  private drawEnemy(enemy: EnemyState): void {
    const center = this.cellToScreen(enemy.cell);
    const isActive = this.combatEnemies.includes(enemy);
    const x = enemy.displayX ?? center.x;
    const y = enemy.displayY ?? center.y;
    const graphics = this.dynamicGraphics;

    if (isActive) {
      graphics.lineStyle(2, 0xf3d07c, 0.95);
      graphics.strokeEllipse(x, y + 6, 34, 15);
    }

    graphics.fillStyle(0x07130f, 0.3);
    graphics.fillEllipse(x, y + 9, 29, 10);
    graphics.fillStyle(enemy.color, 1);
    graphics.fillEllipse(x, y - 2, 27, 23);
    graphics.fillCircle(x - 7, y - 9, 8);
    graphics.fillCircle(x + 7, y - 9, 8);
    graphics.fillStyle(0xf4eee0, 1);
    graphics.fillCircle(x - 5, y - 3, 3);
    graphics.fillCircle(x + 5, y - 3, 3);
    graphics.fillStyle(0x26302a, 1);
    graphics.fillCircle(x - 5, y - 3, 1.5);
    graphics.fillCircle(x + 5, y - 3, 1.5);

    graphics.fillStyle(0x18211d, 0.9);
    graphics.fillRect(x - 14, y - 25, 28, 4);
    graphics.fillStyle(0xe16e60, 1);
    graphics.fillRect(x - 14, y - 25, 28 * (enemy.hp / enemy.maxHp), 4);
  }

  private drawArcher(x: number, y: number): void {
    const graphics = this.dynamicGraphics;

    graphics.fillStyle(0x07130f, 0.32);
    graphics.fillEllipse(x, y + 10, 27, 11);
    graphics.fillStyle(0x276d58, 1);
    graphics.fillTriangle(x - 11, y + 8, x + 11, y + 8, x, y - 10);
    graphics.fillStyle(0x3c9b78, 1);
    graphics.fillEllipse(x, y - 1, 15, 20);
    graphics.fillStyle(0x182b27, 1);
    graphics.fillCircle(x, y - 12, 8);
    graphics.fillStyle(0xe5b995, 1);
    graphics.fillCircle(x + 2, y - 11, 4);

    graphics.lineStyle(3, 0xe9c773, 1);
    graphics.beginPath();
    graphics.moveTo(x + 9, y - 16);
    graphics.lineTo(x + 19, y - 2);
    graphics.lineTo(x + 10, y + 11);
    graphics.strokePath();
    graphics.lineStyle(1, 0xf3e7c7, 0.9);
    graphics.beginPath();
    graphics.moveTo(x + 9, y - 16);
    graphics.lineTo(x + 10, y + 11);
    graphics.strokePath();
    graphics.fillStyle(0xf0d792, 1);
    graphics.fillCircle(x - 4, y + 15, 2);
    graphics.fillCircle(x + 4, y + 15, 2);
  }

  private drawObstacle(x: number, y: number): void {
    const graphics = this.mapGraphics;
    graphics.fillStyle(0x5b412f, 1);
    graphics.fillRoundedRect(x - 5, y - 2, 10, 20, 3);
    graphics.fillStyle(0x24503e, 1);
    graphics.fillCircle(x, y - 12, 16);
    graphics.fillStyle(0x3b7550, 1);
    graphics.fillCircle(x - 7, y - 16, 9);
    graphics.fillCircle(x + 7, y - 15, 10);
    graphics.fillStyle(0x7d9670, 0.65);
    graphics.fillCircle(x - 5, y - 19, 3);
  }

  private drawDiamond(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    fillColor: number,
    fillAlpha: number,
    lineColor: number,
    lineAlpha: number,
  ): void {
    graphics.fillStyle(fillColor, fillAlpha);
    graphics.lineStyle(1, lineColor, lineAlpha);
    graphics.beginPath();
    graphics.moveTo(x, y - TILE_HEIGHT / 2);
    graphics.lineTo(x + TILE_WIDTH / 2, y);
    graphics.lineTo(x, y + TILE_HEIGHT / 2);
    graphics.lineTo(x - TILE_WIDTH / 2, y);
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
  }

  private screenToCell(screenX: number, screenY: number): Cell | null {
    const relativeX = screenX - ORIGIN_X;
    const relativeY = screenY - ORIGIN_Y;
    const x = Math.round(relativeX / TILE_WIDTH + relativeY / TILE_HEIGHT);
    const y = Math.round(relativeY / TILE_HEIGHT - relativeX / TILE_WIDTH);

    if (x < 0 || x >= this.grid.width || y < 0 || y >= this.grid.height) return null;
    return { x, y };
  }

  private cellToScreen(cell: Cell): { x: number; y: number } {
    return {
      x: this.toIsoX(cell.x, cell.y),
      y: this.toIsoY(cell.x, cell.y),
    };
  }

  private toIsoX(gridX: number, gridY: number): number {
    return ORIGIN_X + (gridX - gridY) * (TILE_WIDTH / 2);
  }

  private toIsoY(gridX: number, gridY: number): number {
    return ORIGIN_Y + (gridX + gridY) * (TILE_HEIGHT / 2);
  }
}
