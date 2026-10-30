import Phaser from 'phaser';
import { Grid } from '../../../shared/src/grid/Grid';

export class GridRenderer {
  private readonly scene: Phaser.Scene;
  private readonly grid: Grid;
  private readonly cellSize: number;
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, grid: Grid, cellSize = 64) {
    this.scene = scene;
    this.grid = grid;
    this.cellSize = cellSize;
    this.graphics = scene.add.graphics();
  }

  public drawIsoGrid(originX = 200, originY = 130): void {
    this.graphics.clear();

    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const cell = this.grid.getCell(x, y);
        if (!cell) continue;

        const px = originX + (x - y) * (this.cellSize / 2);
        const py = originY + (x + y) * (this.cellSize / 4);

        this.graphics.lineStyle(1, cell.walkable ? 0x4fc3f7 : 0xff4d6d, 0.8);
        this.graphics.strokeRect(px, py, this.cellSize / 2, this.cellSize / 2);

        if (!cell.walkable) {
          this.graphics.fillStyle(0xff4d6d, 0.35);
          this.graphics.fillRect(px, py, this.cellSize / 2, this.cellSize / 2);
        }
      }
    }
  }

  public drawReachableCells(cells: Array<{ x: number; y: number }>, originX = 200, originY = 130): void {
    this.graphics.fillStyle(0x7ef0b5, 0.25);

    for (const cell of cells) {
      const px = originX + (cell.x - cell.y) * (this.cellSize / 2);
      const py = originY + (cell.x + cell.y) * (this.cellSize / 4);
      this.graphics.fillRect(px + 4, py + 4, (this.cellSize / 2) - 8, (this.cellSize / 2) - 8);
    }
  }

  public destroy(): void {
    this.graphics.destroy();
  }
}
