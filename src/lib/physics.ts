import { Cell, Organ } from "./types";
import { PHYSICS } from "./constants";

// Spatial hash grid for efficient collision detection
class SpatialGrid {
  private cells = new Map<string, Cell[]>();
  private cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear() {
    this.cells.clear();
  }

  private key(x: number, y: number): string {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    return `${gx},${gy}`;
  }

  insert(cell: Cell) {
    const k = this.key(cell.x, cell.y);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(cell);
    else this.cells.set(k, [cell]);
  }

  getNeighbors(cell: Cell): Cell[] {
    const gx = Math.floor(cell.x / this.cellSize);
    const gy = Math.floor(cell.y / this.cellSize);
    const neighbors: Cell[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(`${gx + dx},${gy + dy}`);
        if (bucket) {
          for (const other of bucket) {
            if (other.id !== cell.id) neighbors.push(other);
          }
        }
      }
    }
    return neighbors;
  }
}

const grid = new SpatialGrid(PHYSICS.SPATIAL_CELL_SIZE);

// Cell wobble extends rendered radius: 0.08 * (1+1/2+1/3+1/4) ≈ 0.17 → factor 1.25 with margin
const CELL_WOBBLE_FACTOR = 1.25;

// Organ wobble: 0.06 * (1+1/2+1/3+1/4) ≈ 0.125 → outer edge extends to 1.15, inner edge shrinks to 0.85
const ORGAN_OUTER_FACTOR = 1.15; // max rendered organ radius
const ORGAN_INNER_FACTOR = 0.85; // min rendered organ radius (for containment)

export function stepPhysics(
  cells: Cell[],
  organs: Map<string, Organ>,
  dt: number
) {
  const cappedDt = Math.min(dt, 0.033);

  // Recount actual cells per organ (cellCount may be stale from evictions)
  for (const organ of organs.values()) {
    organ.cellCount = 0;
  }
  for (const cell of cells) {
    const organ = organs.get(cell.chain);
    if (organ) organ.cellCount++;
  }

  // Update organ radii — sqrt scaling so organ area grows proportional to cell count
  for (const organ of organs.values()) {
    organ.radius = PHYSICS.ORGAN_BASE_RADIUS + PHYSICS.ORGAN_GROWTH_PER_CELL * Math.sqrt(organ.cellCount);
  }

  // --- Gravity: pull all organs toward their shared centroid ---
  const organList = [...organs.values()];
  let cx = 0, cy = 0;
  for (const o of organList) { cx += o.x; cy += o.y; }
  cx /= organList.length;
  cy /= organList.length;
  for (const o of organList) {
    const dx = cx - o.x;
    const dy = cy - o.y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
    // Gentle pull toward centroid — stronger when farther away
    const pull = 0.4 * cappedDt * 60;
    o.x += (dx / dist) * Math.min(dist * 0.02, pull);
    o.y += (dy / dist) * Math.min(dist * 0.02, pull);
  }

  // --- Organ-organ repulsion: organs must never overlap ---
  for (let i = 0; i < organList.length; i++) {
    for (let j = i + 1; j < organList.length; j++) {
      const a = organList[i];
      const b = organList[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const minDist = a.radius * ORGAN_OUTER_FACTOR + b.radius * ORGAN_OUTER_FACTOR + 8;
      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        // Push both organs apart equally
        a.x += nx * overlap * 0.5;
        a.y += ny * overlap * 0.5;
        b.x -= nx * overlap * 0.5;
        b.y -= ny * overlap * 0.5;
      }
    }
  }

  // Build spatial grid
  grid.clear();
  for (const cell of cells) {
    grid.insert(cell);
  }

  for (const cell of cells) {
    const organ = organs.get(cell.chain);
    if (!organ) continue;

    // 1. Containment — cell must stay inside organ boundary
    // Organ shrinks inward at worst by ORGAN_INNER_FACTOR, cell extends outward by CELL_WOBBLE_FACTOR
    const containmentRadius = Math.max(
      0,
      organ.radius * ORGAN_INNER_FACTOR - cell.radius * CELL_WOBBLE_FACTOR
    );

    const dxo = cell.x - organ.x;
    const dyo = cell.y - organ.y;
    const distOrgan = Math.sqrt(dxo * dxo + dyo * dyo) + 0.01;

    if (distOrgan > containmentRadius) {
      // Hard clamp: snap back to boundary
      const nx = dxo / distOrgan;
      const ny = dyo / distOrgan;
      cell.x = organ.x + nx * containmentRadius;
      cell.y = organ.y + ny * containmentRadius;
      // Kill outward velocity component
      const vDot = cell.vx * nx + cell.vy * ny;
      if (vDot > 0) {
        cell.vx -= nx * vDot;
        cell.vy -= ny * vDot;
      }
    }

    // Very gentle inward pull — just enough to keep cells from piling at the edge
    const pullStrength = 0.05 * (distOrgan / (containmentRadius + 0.01));
    cell.vx += (-dxo / distOrgan) * pullStrength * cappedDt * 60;
    cell.vy += (-dyo / distOrgan) * pullStrength * cappedDt * 60;

    // 2. Cell-cell repulsion — wobble-extended radii so rendered shapes never overlap
    const neighbors = grid.getNeighbors(cell);
    for (const other of neighbors) {
      const dx = cell.x - other.x;
      const dy = cell.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const minDist = cell.radius * CELL_WOBBLE_FACTOR + other.radius * CELL_WOBBLE_FACTOR + 2;
      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;

        // Full positional correction
        cell.x += nx * overlap * 0.6;
        cell.y += ny * overlap * 0.6;

        // Velocity nudge
        cell.vx += nx * overlap * 0.3;
        cell.vy += ny * overlap * 0.3;
      }
    }

    // 3. Brownian noise — subtle organic drift
    cell.vx += (Math.random() - 0.5) * PHYSICS.BROWNIAN_STRENGTH;
    cell.vy += (Math.random() - 0.5) * PHYSICS.BROWNIAN_STRENGTH;

    // 4. Damping
    cell.vx *= PHYSICS.DAMPING;
    cell.vy *= PHYSICS.DAMPING;

    // 5. Integrate position
    cell.x += cell.vx * cappedDt * 60;
    cell.y += cell.vy * cappedDt * 60;

    // 6. Hard clamp again after integration — enforce containment
    const dxo2 = cell.x - organ.x;
    const dyo2 = cell.y - organ.y;
    const distOrgan2 = Math.sqrt(dxo2 * dxo2 + dyo2 * dyo2);
    if (distOrgan2 > containmentRadius) {
      const nx = dxo2 / (distOrgan2 + 0.01);
      const ny = dyo2 / (distOrgan2 + 0.01);
      cell.x = organ.x + nx * containmentRadius;
      cell.y = organ.y + ny * containmentRadius;
    }

    // 7. Smooth radius toward target
    cell.radius += (cell.targetRadius - cell.radius) * 0.05;

    // 8. Advance wobble phase
    cell.wobblePhase += cell.wobbleSpeed * cappedDt;
  }

  // Second pass — resolve remaining cell-cell overlaps after integration
  grid.clear();
  for (const cell of cells) {
    grid.insert(cell);
  }
  for (const cell of cells) {
    const neighbors = grid.getNeighbors(cell);
    for (const other of neighbors) {
      const dx = cell.x - other.x;
      const dy = cell.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const minDist = cell.radius * CELL_WOBBLE_FACTOR + other.radius * CELL_WOBBLE_FACTOR + 2;
      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        cell.x += nx * overlap * 0.55;
        cell.y += ny * overlap * 0.55;
      }
    }
  }
}

export function liquidityToRadius(liquidity: number): number {
  if (!liquidity || liquidity <= 0) return PHYSICS.DEFAULT_CELL_RADIUS;
  // Log scale: $100 → ~10px, $1M → ~35px, $10M → ~45px
  const log = Math.log10(Math.max(liquidity, 1));
  const normalized = (log - 2) / 5; // 2=100, 7=10M
  const clamped = Math.max(0, Math.min(1, normalized));
  return (
    PHYSICS.MIN_CELL_RADIUS +
    clamped * (PHYSICS.MAX_CELL_RADIUS - PHYSICS.MIN_CELL_RADIUS)
  );
}

export function volumeToRadiusMultiplier(volumeUsd: number): number {
  if (!volumeUsd || volumeUsd <= 0) return 1;
  // Active pairs grow: $1K vol → 1.1x, $100K → 1.5x, $1M → 2x
  const log = Math.log10(Math.max(volumeUsd, 1));
  const normalized = (log - 3) / 3; // 3=1K, 6=1M
  const clamped = Math.max(0, Math.min(1, normalized));
  return 1 + clamped;
}
