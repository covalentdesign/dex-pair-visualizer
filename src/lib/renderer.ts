import { Cell, Organ, Camera } from "./types";
import { RENDER, PHYSICS } from "./constants";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 100, g: 100, b: 100 };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  phase: number,
  harmonics: number,
  amplitude: number
) {
  const points: { x: number; y: number }[] = [];
  const segments = Math.max(24, Math.floor(radius * 2));

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    let r = radius;
    for (let h = 1; h <= harmonics; h++) {
      r +=
        Math.sin(angle * h + phase * (h * 0.7 + 1)) *
        radius *
        amplitude *
        (1 / h);
    }
    points.push({
      x: x + Math.cos(angle) * r,
      y: y + Math.sin(angle) * r,
    });
  }

  ctx.beginPath();
  const first = points[0];
  const last = points[points.length - 1];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const mx = (current.x + next.x) / 2;
    const my = (current.y + next.y) / 2;
    ctx.quadraticCurveTo(current.x, current.y, mx, my);
  }

  ctx.closePath();
}

export function render(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cells: Cell[],
  organs: Map<string, Organ>,
  camera: Camera,
  time: number
) {
  // Clear
  ctx.fillStyle = RENDER.BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  const zoom = camera.zoom;
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-width / 2 - camera.x, -height / 2 - camera.y);

  // Determine visible bounds for culling (account for zoom)
  const pad = 100 / zoom;
  const vLeft = camera.x + width / 2 - width / (2 * zoom) - pad;
  const vRight = camera.x + width / 2 + width / (2 * zoom) + pad;
  const vTop = camera.y + height / 2 - height / (2 * zoom) - pad;
  const vBottom = camera.y + height / 2 + height / (2 * zoom) + pad;

  // Draw organ regions (background blobs) — radius from physics (already updated)
  for (const organ of organs.values()) {
    const r = organ.radius;

    if (
      organ.x + r < vLeft ||
      organ.x - r > vRight ||
      organ.y + r < vTop ||
      organ.y - r > vBottom
    )
      continue;

    // Static shape — only changes when a cell is added/removed
    const organPhase = organ.wobblePhase + organ.cellCount * 0.3;

    drawBlob(ctx, organ.x, organ.y, r, organPhase, 4, 0.06);
    ctx.fillStyle = rgba(organ.color, RENDER.ORGAN_FILL_ALPHA);
    ctx.fill();
    ctx.strokeStyle = rgba(organ.color, RENDER.ORGAN_STROKE_ALPHA);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw label — always prominent, lowercase
    const fontSize = Math.max(12, Math.floor(r * 0.22));
    ctx.fillStyle = RENDER.TEXT_COLOR;
    ctx.font = `${fontSize}px 'Offside', cursive`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(organ.displayName.toLowerCase(), organ.x, organ.y);
  }

  // Draw cells
  for (const cell of cells) {
    if (
      cell.x + cell.radius < vLeft ||
      cell.x - cell.radius > vRight ||
      cell.y + cell.radius < vTop ||
      cell.y - cell.radius > vBottom
    )
      continue;

    drawBlob(
      ctx,
      cell.x,
      cell.y,
      cell.radius,
      cell.wobblePhase,
      RENDER.WOBBLE_HARMONICS,
      RENDER.WOBBLE_AMPLITUDE
    );
    ctx.fillStyle = rgba(cell.color, RENDER.CELL_FILL_ALPHA);
    ctx.fill();
    ctx.strokeStyle = rgba(cell.color, RENDER.CELL_STROKE_ALPHA);
    ctx.lineWidth = RENDER.CELL_STROKE_WIDTH;
    ctx.stroke();

    // Draw pair label — fixed tiny size, never changes, lowercase
    if (cell.radius > 8) {
      ctx.fillStyle = rgba(RENDER.TEXT_COLOR, 0.6);
      ctx.font = `6px 'Offside', cursive`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label =
        cell.label.length > 12
          ? cell.label.substring(0, 12).toLowerCase()
          : cell.label.toLowerCase();
      ctx.fillText(label, cell.x, cell.y);
    }
  }

  ctx.restore();

  // --- Left HUD: stats stack ---
  const activeChains = new Set<string>();
  let totalLiquidity = 0;
  for (const cell of cells) {
    activeChains.add(cell.chain);
    totalLiquidity += cell.liquidity;
  }

  const formatCompact = (n: number): string => {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}b`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
    return `$${n.toFixed(0)}`;
  };

  const hudAlpha = 0.35;
  const hudX = 24;
  const fontSize = 20;
  const lineHeight = 28;
  const totalHeight = lineHeight * 3;
  let hudY = (height - totalHeight) / 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = rgba(RENDER.TEXT_COLOR, hudAlpha);
  ctx.font = `${fontSize}px 'Offside', cursive`;

  ctx.fillText(`${activeChains.size} chains`, hudX, hudY);
  hudY += lineHeight;
  ctx.fillText(`${cells.length} pairs`, hudX, hudY);
  hudY += lineHeight;
  ctx.fillText(`tvl ${formatCompact(totalLiquidity)}`, hudX, hudY);

  // --- Right HUD: microscope magnification scale ---
  const scaleX = width - 28;
  const scaleTop = 60;
  const scaleBottom = height - 60;
  const scaleHeight = scaleBottom - scaleTop;
  const tickCount = 40;
  const majorEvery = 10;
  const midEvery = 5;

  ctx.strokeStyle = rgba(RENDER.TEXT_COLOR, 0.18);
  ctx.lineWidth = 0.5;

  // Main vertical line
  ctx.beginPath();
  ctx.moveTo(scaleX, scaleTop);
  ctx.lineTo(scaleX, scaleBottom);
  ctx.stroke();

  // Ticks
  for (let i = 0; i <= tickCount; i++) {
    const y = scaleTop + (i / tickCount) * scaleHeight;
    let tickLen: number;

    if (i % majorEvery === 0) {
      tickLen = 12;
      ctx.strokeStyle = rgba(RENDER.TEXT_COLOR, 0.25);
      ctx.lineWidth = 0.8;
    } else if (i % midEvery === 0) {
      tickLen = 8;
      ctx.strokeStyle = rgba(RENDER.TEXT_COLOR, 0.18);
      ctx.lineWidth = 0.5;
    } else {
      tickLen = 4;
      ctx.strokeStyle = rgba(RENDER.TEXT_COLOR, 0.12);
      ctx.lineWidth = 0.5;
    }

    ctx.beginPath();
    ctx.moveTo(scaleX - tickLen, y);
    ctx.lineTo(scaleX, y);
    ctx.stroke();
  }

  // Zoom label at top of scale
  ctx.fillStyle = rgba(RENDER.TEXT_COLOR, 0.3);
  ctx.font = `9px 'Offside', cursive`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${camera.zoom.toFixed(1)}x`, scaleX - 2, scaleTop - 6);
}
