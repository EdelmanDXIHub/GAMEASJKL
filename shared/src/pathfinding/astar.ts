import type { Cell } from '../types/network';
import { Grid } from '../grid/Grid';

export type PathNode = {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
};

export function manhattanDistance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function aStar(grid: Grid, start: Cell, goal: Cell, maxCost?: number): Cell[] {
  const openSet = new Map<string, PathNode>();
  const closedSet = new Set<string>();
  const startKey = `${start.x},${start.y}`;
  const goalKey = `${goal.x},${goal.y}`;

  const startNode: PathNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: manhattanDistance(start, goal),
    f: manhattanDistance(start, goal),
    parent: null,
  };

  openSet.set(startKey, startNode);

  while (openSet.size > 0) {
    let currentKey = '';
    let currentNode: PathNode | null = null;

    for (const [key, node] of openSet.entries()) {
      if (!currentNode || node.f < currentNode.f || (node.f === currentNode.f && node.h < currentNode.h)) {
        currentNode = node;
        currentKey = key;
      }
    }

    if (!currentNode) break;

    if (currentKey === goalKey) {
      const path: Cell[] = [];
      let cursor: PathNode | null = currentNode;

      while (cursor) {
        path.push({ x: cursor.x, y: cursor.y });
        cursor = cursor.parent;
      }

      return path.reverse();
    }

    openSet.delete(currentKey);
    closedSet.add(currentKey);

    const neighbors = grid.neighbors(currentNode.x, currentNode.y);

    for (const [nx, ny] of neighbors) {
      const neighborKey = `${nx},${ny}`;
      if (closedSet.has(neighborKey)) continue;

      const tentativeG = currentNode.g + 1;
      const existing = openSet.get(neighborKey);

      if (!existing || tentativeG < existing.g) {
        const newNode: PathNode = {
          x: nx,
          y: ny,
          g: tentativeG,
          h: manhattanDistance({ x: nx, y: ny }, goal),
          f: tentativeG + manhattanDistance({ x: nx, y: ny }, goal),
          parent: currentNode,
        };

        if (maxCost !== undefined && newNode.g > maxCost) continue;

        openSet.set(neighborKey, newNode);
      }
    }
  }

  return [];
}

export function getReachableCells(grid: Grid, start: Cell, maxSteps: number): Cell[] {
  const queue: Array<{ x: number; y: number; steps: number }> = [{ x: start.x, y: start.y, steps: 0 }];
  const visited = new Set<string>([`${start.x},${start.y}`]);
  const result: Cell[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (current.steps > 0) {
      result.push({ x: current.x, y: current.y });
    }

    if (current.steps >= maxSteps) continue;

    for (const [nx, ny] of grid.neighbors(current.x, current.y)) {
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;

      visited.add(key);
      queue.push({ x: nx, y: ny, steps: current.steps + 1 });
    }
  }

  return result;
}

export function hasLineOfSight(
  grid: Grid,
  from: Cell,
  to: Cell,
  maxRange?: number,
): boolean {
  const distance = manhattanDistance(from, to);

  if (maxRange !== undefined && distance > maxRange) {
    return false;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.round(from.x + dx * t);
    const y = Math.round(from.y + dy * t);

    if (!grid.isWalkable(x, y)) {
      return false;
    }
  }

  return true;
}
