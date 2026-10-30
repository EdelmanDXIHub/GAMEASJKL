import Phaser from 'phaser';
import { Grid } from '../../../shared/src/grid/Grid';
import { aStar } from '../../../shared/src/pathfinding/astar';
import type { Cell } from '../../../shared/src/types/network';

const TILE_WIDTH = 72;
const TILE_HEIGHT = 40;
const ORIGIN_X = 480;
const ORIGIN_Y = 82;
const STEP_DURATION = 180;

export class GameScene extends Phaser.Scene {
  private grid!: Grid;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private dynamicGraphics!: Phaser.GameObjects.Graphics;
  private playerCell: Cell = { x: 1, y: 1 };
  private playerX = 0;
  private playerY = 0;
  private movementPath: Cell[] = [];
  private stepTarget: Cell | null = null;
  private stepElapsed = 0;
  private hoveredCell: Cell | null = null;
  private selectedCell: Cell | null = null;

  constructor() {
    super('GameScene');
  }

  create(): void {
    const obstacles: Array<[number, number]> = [
      [3, 2], [4, 2], [5, 2], [3, 3], [5, 3],
      [7, 4], [8, 4], [7, 5], [8, 5], [2, 7],
      [3, 7], [9, 8], [10, 8], [10, 9],
    ];

    this.grid = new Grid(12, 12, obstacles);
    this.cameras.main.setBackgroundColor('#11232a');
    this.mapGraphics = this.add.graphics();
    this.dynamicGraphics = this.add.graphics();

    this.playerX = this.toIsoX(this.playerCell.x, this.playerCell.y);
    this.playerY = this.toIsoY(this.playerCell.x, this.playerCell.y);
    this.drawMap();

    this.add.text(28, 22, 'KRIKAS  /  BOSQUE DE BRUMALIA', {
      color: '#f1d89b',
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      fontStyle: 'bold',
    });
    this.add.text(28, 48, 'Haz clic en una casilla para caminar', {
      color: '#b7c8c0',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.stepTarget) return;

      const cell = this.screenToCell(pointer.x, pointer.y);
      if (!cell || !this.grid.isWalkable(cell.x, cell.y)) return;

      const path = aStar(this.grid, this.playerCell, cell);
      if (path.length < 2) return;

      this.selectedCell = cell;
      this.movementPath = path.slice(1);
      this.stepElapsed = 0;
      this.stepTarget = this.movementPath.shift() ?? null;
    });
  }

  update(_time: number, delta: number): void {
    const pointer = this.input.activePointer;
    this.hoveredCell = this.screenToCell(pointer.x, pointer.y);

    if (this.stepTarget) {
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

    this.drawDynamicLayer();
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

        if (!cell.walkable) {
          this.drawObstacle(center.x, center.y);
        }
      }
    }
  }

  private drawDynamicLayer(): void {
    this.dynamicGraphics.clear();

    if (this.selectedCell) {
      const selected = this.cellToScreen(this.selectedCell);
      this.drawDiamond(this.dynamicGraphics, selected.x, selected.y, 0xf3d07c, 0.2, 0xf3d07c, 0.9);
    }

    if (this.hoveredCell && this.grid.isWalkable(this.hoveredCell.x, this.hoveredCell.y)) {
      const hovered = this.cellToScreen(this.hoveredCell);
      this.drawDiamond(this.dynamicGraphics, hovered.x, hovered.y, 0xbce7d2, 0.14, 0xe7fff1, 0.95);
    }

    this.drawArcher(this.playerX, this.playerY);
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

    if (x < 0 || x >= this.grid.width || y < 0 || y >= this.grid.height) {
      return null;
    }

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
