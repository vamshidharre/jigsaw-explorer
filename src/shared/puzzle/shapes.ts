/**
 * Classic jigsaw piece outlines.
 *
 * Every internal cut is a chain of three cubic Béziers forming a knob. Shape
 * parameters are jittered per edge from the puzzle seed, and consecutive edges
 * along the same cut line share tangents so the cuts read as continuous lines.
 * Neighbouring pieces reference the very same curve (one forwards, one
 * reversed), so they always interlock exactly.
 */
import { createRng, uniform, type Rng } from '../rng';
import type { PuzzleSpec } from './spec';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A closed outline made of cubic segments: `start` followed by triples of
 * (control 1, control 2, end) points, in coordinates relative to the piece
 * cell's top-left corner.
 */
export interface PieceOutline {
  start: Point;
  /** Flattened [c1x, c1y, c2x, c2y, x, y] per cubic segment. */
  cubics: number[];
  bounds: Bounds;
}

/** A cut edge as 10 points: P0, then three (C1, C2, P) cubic triples. */
type EdgeCurve = Point[];

const SHAPE_SEED_SALT = 0x9e3779b9;
const JITTER = 0.045;

interface EdgeParams {
  flip: number;
  t: number;
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
}

function nextParams(rng: Rng, prev: EdgeParams | null): EdgeParams {
  const flip = rng() < 0.5 ? 1 : -1;
  const e = uniform(rng, -JITTER, JITTER);
  // Keep the tangent continuous where two edges of the same cut line meet.
  const a = prev ? (flip === prev.flip ? -prev.e : prev.e) : uniform(rng, -JITTER, JITTER);
  return {
    flip,
    t: uniform(rng, 0.088, 0.104),
    a,
    b: uniform(rng, -JITTER, JITTER),
    c: uniform(rng, -JITTER, JITTER),
    d: uniform(rng, -JITTER, JITTER),
    e,
  };
}

function buildEdge(from: Point, to: Point, p: EdgeParams): EdgeCurve {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular, scaled by the knob direction.
  const nx = -uy * p.flip;
  const ny = ux * p.flip;
  const { t, a, b, c, d, e } = p;
  const local: Array<[number, number]> = [
    [0, 0],
    [0.2, a],
    [0.5 + b + d, -t + c],
    [0.5 - t + b, t + c],
    [0.5 - 2 * t + b - d, 3 * t + c],
    [0.5 + 2 * t + b - d, 3 * t + c],
    [0.5 + t + b, t + c],
    [0.5 + b + d, -t + c],
    [0.8, e],
    [1, 0],
  ];
  return local.map(([along, across]) => ({
    x: from.x + (ux * along + nx * across) * len,
    y: from.y + (uy * along + ny * across) * len,
  }));
}

function straightEdge(from: Point, to: Point): EdgeCurve {
  const lerp = (k: number): Point => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
  // Expressed as three cubic segments so every edge has the same structure.
  return [lerp(0), lerp(1 / 9), lerp(2 / 9), lerp(1 / 3), lerp(4 / 9), lerp(5 / 9), lerp(2 / 3), lerp(7 / 9), lerp(8 / 9), lerp(1)];
}

export interface PuzzleShapes {
  pieceWidth: number;
  pieceHeight: number;
  outlines: PieceOutline[];
}

/** Generates outlines for every piece of the puzzle (index = piece id). */
export function generateShapes(spec: Pick<PuzzleSpec, 'seed' | 'cols' | 'rows' | 'width' | 'height'>): PuzzleShapes {
  const { cols, rows, width, height } = spec;
  const pw = width / cols;
  const ph = height / rows;
  const rng = createRng((spec.seed ^ SHAPE_SEED_SALT) >>> 0);

  // horizontal[r][c]: cut between row r-1 and row r, spanning column c (r = 0..rows).
  const horizontal: EdgeCurve[][] = [];
  for (let r = 0; r <= rows; r++) {
    const line: EdgeCurve[] = [];
    let prev: EdgeParams | null = null;
    for (let c = 0; c < cols; c++) {
      const from = { x: c * pw, y: r * ph };
      const to = { x: (c + 1) * pw, y: r * ph };
      if (r === 0 || r === rows) {
        line.push(straightEdge(from, to));
      } else {
        prev = nextParams(rng, prev);
        line.push(buildEdge(from, to, prev));
      }
    }
    horizontal.push(line);
  }

  // vertical[c][r]: cut between column c-1 and column c, spanning row r (c = 0..cols).
  const vertical: EdgeCurve[][] = [];
  for (let c = 0; c <= cols; c++) {
    const line: EdgeCurve[] = [];
    let prev: EdgeParams | null = null;
    for (let r = 0; r < rows; r++) {
      const from = { x: c * pw, y: r * ph };
      const to = { x: c * pw, y: (r + 1) * ph };
      if (c === 0 || c === cols) {
        line.push(straightEdge(from, to));
      } else {
        prev = nextParams(rng, prev);
        line.push(buildEdge(from, to, prev));
      }
    }
    vertical.push(line);
  }

  const outlines: PieceOutline[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = c * pw;
      const oy = r * ph;
      const top = horizontal[r]![c]!;
      const right = vertical[c + 1]![r]!;
      const bottom = horizontal[r + 1]![c]!.slice().reverse();
      const left = vertical[c]![r]!.slice().reverse();
      const cubics: number[] = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const edge of [top, right, bottom, left]) {
        for (let i = 1; i < edge.length; i++) {
          const x = edge[i]!.x - ox;
          const y = edge[i]!.y - oy;
          cubics.push(x, y);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      outlines.push({ start: { x: top[0]!.x - ox, y: top[0]!.y - oy }, cubics, bounds: { minX, minY, maxX, maxY } });
    }
  }

  return { pieceWidth: pw, pieceHeight: ph, outlines };
}

/** SVG path data for an outline, optionally translated. */
export function outlineToSvgPath(outline: PieceOutline, dx = 0, dy = 0, precision = 2): string {
  const f = (n: number) => Number(n.toFixed(precision));
  const parts = [`M${f(outline.start.x + dx)} ${f(outline.start.y + dy)}`];
  const k = outline.cubics;
  for (let i = 0; i < k.length; i += 6) {
    parts.push(
      `C${f(k[i]! + dx)} ${f(k[i + 1]! + dy)} ${f(k[i + 2]! + dx)} ${f(k[i + 3]! + dy)} ${f(k[i + 4]! + dx)} ${f(k[i + 5]! + dy)}`,
    );
  }
  parts.push('Z');
  return parts.join('');
}
