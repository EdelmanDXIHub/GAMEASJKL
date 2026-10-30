export type GridCell = {
  x: number;
  y: number;
  walkable: boolean;
};

export class Grid {
  public readonly width: number;
  public readonly height: number;
  private readonly cells: GridCell[][];

  constructor(width: number, height: number, obstacles: Array<[number, number]> = []) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => ({
        x,
        y,
        walkable: !obstacles.some(([ox, oy]) => ox === x && oy === y),
      })),
    );
  }

  public getCell(x: number, y: number): GridCell | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.cells[y][x];
  }

  public isWalkable(x: number, y: number): boolean {
    const cell = this.getCell(x, y);
    return cell !== null && cell.walkable;
  }

  public neighbors(x: number, y: number): Array<[number, number]> {
    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    return offsets
      .map(([dx, dy]) => [x + dx, y + dy] as [number, number])
      .filter(([nx, ny]) => this.isWalkable(nx, ny));
  }

  public clone(): Grid {
    const obstacles: Array<[number, number]> = [];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.cells[y][x].walkable) {
          obstacles.push([x, y]);
        }
      }
    }

    return new Grid(this.width, this.height, obstacles);
  }
}
