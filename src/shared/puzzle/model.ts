/**
 * Puzzle state model shared by the client (single player + prediction) and the
 * server (authoritative multiplayer state).
 *
 * Pieces live in groups. Every group has a single rigid transform that maps
 * "solved space" (where each piece sits at its home position on the board) to
 * world space:  world = R(rot) · solved + (x, y).
 *
 * A group is correctly placed on the board when rot = 0 and (x, y) = (0, 0).
 * Two neighbouring groups fit together when their transforms are (nearly)
 * equal, which turns snapping into a cheap transform comparison.
 */
import { createRng, randomInt, shuffle, type Rng } from '../rng';
import type { PuzzleSpec } from './spec';

export type Rot = 0 | 1 | 2 | 3;

export interface GroupState {
  id: number;
  pieces: number[];
  x: number;
  y: number;
  rot: Rot;
  locked: boolean;
  z: number;
}

export interface DropResult {
  kind: 'board' | 'piece' | null;
  /** Id of the group the dropped pieces ended up in. */
  groupId: number;
  /** Final state of every group that changed. */
  changed: GroupState[];
  /** Ids of groups that were merged away. */
  removed: number[];
  /** Number of pieces that joined something during this drop. */
  joined: number;
  completed: boolean;
}

export type SnapStrength = 'gentle' | 'normal' | 'strong';

export const SNAP_FACTORS: Record<SnapStrength, number> = {
  gentle: 0.13,
  normal: 0.22,
  strong: 0.34,
};

const LAYOUT_SEED_SALT = 0x85ebca6b;

export function rotateVec(x: number, y: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0:
      return [x, y];
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    default:
      return [y, -x];
  }
}

export function normalizeRot(r: number): Rot {
  return (((r % 4) + 4) % 4) as Rot;
}

export function cloneGroup(g: GroupState): GroupState {
  return { id: g.id, pieces: g.pieces.slice(), x: g.x, y: g.y, rot: g.rot, locked: g.locked, z: g.z };
}

const neighborCache = new Map<string, number[][]>();

function neighborsFor(cols: number, rows: number): number[][] {
  const key = `${cols}x${rows}`;
  let list = neighborCache.get(key);
  if (!list) {
    list = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const n: number[] = [];
        if (r > 0) n.push((r - 1) * cols + c);
        if (c < cols - 1) n.push(r * cols + c + 1);
        if (r < rows - 1) n.push((r + 1) * cols + c);
        if (c > 0) n.push(r * cols + c - 1);
        list.push(n);
      }
    }
    neighborCache.set(key, list);
  }
  return list;
}

export class InvalidPuzzleStateError extends Error {}

export class PuzzleModel {
  readonly spec: PuzzleSpec;
  readonly pieceWidth: number;
  readonly pieceHeight: number;
  readonly pieceCount: number;
  readonly groups = new Map<number, GroupState>();
  readonly pieceToGroup: Int32Array;
  private readonly neighbors: number[][];
  private zTop = 0;

  constructor(spec: PuzzleSpec, groups: Iterable<GroupState>) {
    this.spec = spec;
    this.pieceWidth = spec.width / spec.cols;
    this.pieceHeight = spec.height / spec.rows;
    this.pieceCount = spec.cols * spec.rows;
    this.neighbors = neighborsFor(spec.cols, spec.rows);
    this.pieceToGroup = new Int32Array(this.pieceCount).fill(-1);
    for (const g of groups) this.setGroup(cloneGroup(g));
    this.validate();
  }

  /** Creates a fresh puzzle with every piece scattered around the board. */
  static createInitial(spec: PuzzleSpec, aspect = 16 / 10): PuzzleModel {
    const rng = createRng((spec.seed ^ LAYOUT_SEED_SALT) >>> 0);
    const ids = Array.from({ length: spec.cols * spec.rows }, (_, i) => i);
    const placements = computeScatter(spec, ids, rng, aspect);
    const groups: GroupState[] = ids.map((id) => {
      const p = placements.get(id)!;
      return { id, pieces: [id], ...groupTransformFor(spec, id, p.cx, p.cy, p.rot), locked: false, z: 0 };
    });
    shuffle(rng, groups).forEach((g, i) => (g.z = i + 1));
    return new PuzzleModel(spec, groups);
  }

  private validate(): void {
    for (let i = 0; i < this.pieceCount; i++) {
      if (this.pieceToGroup[i] === -1) throw new InvalidPuzzleStateError(`Piece ${i} is not in any group`);
    }
    let lockedGroups = 0;
    for (const g of this.groups.values()) {
      if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) throw new InvalidPuzzleStateError('Non-finite group position');
      if (g.locked) lockedGroups++;
      if (g.z > this.zTop) this.zTop = g.z;
    }
    if (lockedGroups > 1) throw new InvalidPuzzleStateError('More than one locked group');
  }

  private setGroup(g: GroupState): void {
    if (g.pieces.length === 0) throw new InvalidPuzzleStateError('Empty group');
    for (const p of g.pieces) {
      if (!Number.isInteger(p) || p < 0 || p >= this.pieceCount) throw new InvalidPuzzleStateError(`Bad piece id ${p}`);
      const existing = this.pieceToGroup[p]!;
      if (existing !== -1 && existing !== g.id && this.groups.has(existing)) {
        throw new InvalidPuzzleStateError(`Piece ${p} belongs to two groups`);
      }
      this.pieceToGroup[p] = g.id;
    }
    this.groups.set(g.id, g);
  }

  clone(): PuzzleModel {
    return new PuzzleModel(this.spec, this.groups.values());
  }

  snapshot(): GroupState[] {
    return Array.from(this.groups.values(), cloneGroup);
  }

  /** Applies authoritative group changes (e.g. received from the server). */
  applyChanges(changed: readonly GroupState[], removed: readonly number[]): void {
    for (const id of removed) this.groups.delete(id);
    for (const g of changed) {
      const copy = cloneGroup(g);
      this.groups.set(copy.id, copy);
      for (const p of copy.pieces) this.pieceToGroup[p] = copy.id;
      if (copy.z > this.zTop) this.zTop = copy.z;
    }
  }

  /** Replaces the entire state, e.g. after a reconnect snapshot. */
  replaceAll(groups: readonly GroupState[]): void {
    this.groups.clear();
    this.pieceToGroup.fill(-1);
    this.zTop = 0;
    for (const g of groups) this.setGroup(cloneGroup(g));
    this.validate();
  }

  groupOf(pieceId: number): GroupState {
    return this.groups.get(this.pieceToGroup[pieceId]!)!;
  }

  getNeighbors(pieceId: number): readonly number[] {
    return this.neighbors[pieceId]!;
  }

  homeCenter(pieceId: number): [number, number] {
    const c = pieceId % this.spec.cols;
    const r = Math.floor(pieceId / this.spec.cols);
    return [(c + 0.5) * this.pieceWidth, (r + 0.5) * this.pieceHeight];
  }

  isEdgePiece(pieceId: number): boolean {
    const c = pieceId % this.spec.cols;
    const r = Math.floor(pieceId / this.spec.cols);
    return r === 0 || c === 0 || r === this.spec.rows - 1 || c === this.spec.cols - 1;
  }

  /** World-space centre of a piece. */
  pieceCenter(pieceId: number, group = this.groupOf(pieceId)): [number, number] {
    const [hx, hy] = this.homeCenter(pieceId);
    const [rx, ry] = rotateVec(hx, hy, group.rot);
    return [rx + group.x, ry + group.y];
  }

  /** Average of the piece centres of a group. */
  groupCenter(group: GroupState): [number, number] {
    let sx = 0;
    let sy = 0;
    for (const p of group.pieces) {
      const [x, y] = this.pieceCenter(p, group);
      sx += x;
      sy += y;
    }
    return [sx / group.pieces.length, sy / group.pieces.length];
  }

  /** Axis-aligned bounds of a group's piece cells (tabs excluded). */
  groupBounds(group: GroupState): { minX: number; minY: number; maxX: number; maxY: number } {
    const hw = (group.rot % 2 === 0 ? this.pieceWidth : this.pieceHeight) / 2;
    const hh = (group.rot % 2 === 0 ? this.pieceHeight : this.pieceWidth) / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of group.pieces) {
      const [x, y] = this.pieceCenter(p, group);
      minX = Math.min(minX, x - hw);
      minY = Math.min(minY, y - hh);
      maxX = Math.max(maxX, x + hw);
      maxY = Math.max(maxY, y + hh);
    }
    return { minX, minY, maxX, maxY };
  }

  bringToFront(groupId: number): number {
    const g = this.groups.get(groupId);
    if (!g) return 0;
    if (!g.locked && g.z !== this.zTop) g.z = ++this.zTop;
    return g.z;
  }

  moveGroup(groupId: number, x: number, y: number): void {
    const g = this.groups.get(groupId);
    if (!g || g.locked) return;
    g.x = x;
    g.y = y;
  }

  /** Rotates a group by quarter turns around a world-space pivot. */
  rotateGroup(groupId: number, pivotX: number, pivotY: number, dir: 1 | -1 = 1): GroupState | null {
    const g = this.groups.get(groupId);
    if (!g || g.locked || !this.spec.rotation) return null;
    const step = normalizeRot(dir);
    const [rx, ry] = rotateVec(g.x - pivotX, g.y - pivotY, step);
    g.x = rx + pivotX;
    g.y = ry + pivotY;
    g.rot = normalizeRot(g.rot + dir);
    return g;
  }

  snapTolerance(strength: SnapStrength = 'normal'): number {
    return SNAP_FACTORS[strength] * Math.min(this.pieceWidth, this.pieceHeight);
  }

  /**
   * Resolves snapping after a group has been released. The dropped group snaps
   * onto the board when it is close to its solved position (and upright), and
   * merges with any neighbouring group whose transform matches within the
   * tolerance. Merges cascade, so one drop can join several groups at once.
   *
   * `canJoin` lets the server skip groups that another player is holding.
   */
  drop(groupId: number, tolerance: number, canJoin: (g: GroupState) => boolean = () => true): DropResult {
    const result: DropResult = { kind: null, groupId, changed: [], removed: [], joined: 0, completed: false };
    let g = this.groups.get(groupId);
    if (!g || g.locked) return result;
    const connectedBefore = this.connectedCount();

    for (;;) {
      if (g.rot === 0 && Math.hypot(g.x, g.y) < tolerance) {
        g.x = 0;
        g.y = 0;
        g.locked = true;
        result.kind = 'board';
        let board: GroupState | undefined;
        for (const other of this.groups.values()) {
          if (other.locked && other.id !== g.id) {
            board = other;
            break;
          }
        }
        if (board) g = this.merge(board, g, result);
        break;
      }

      let best: GroupState | null = null;
      let bestDist = tolerance;
      for (const p of g.pieces) {
        for (const n of this.neighbors[p]!) {
          const other = this.groupOf(n);
          if (other.id === g.id || other.rot !== g.rot) continue;
          const d = Math.hypot(g.x - other.x, g.y - other.y);
          if (d < bestDist && canJoin(other)) {
            best = other;
            bestDist = d;
          }
        }
      }
      if (!best) break;
      if (!result.kind) result.kind = best.locked ? 'board' : 'piece';
      const intoBoard = best.locked;
      g = this.merge(best, g, result);
      if (intoBoard) break;
    }

    g.z = g.locked ? 0 : ++this.zTop;
    result.groupId = g.id;
    result.joined = this.connectedCount() - connectedBefore;
    result.completed = this.groups.size === 1;
    if (result.completed && !g.locked) {
      g.x = 0;
      g.y = 0;
      g.rot = 0;
      g.locked = true;
      g.z = 0;
    }
    result.changed = [cloneGroup(g)];
    return result;
  }

  /** Merges `from` into `into`; `from` adopts the transform of `into`. */
  private merge(into: GroupState, from: GroupState, result: DropResult): GroupState {
    for (const p of from.pieces) {
      into.pieces.push(p);
      this.pieceToGroup[p] = into.id;
    }
    into.z = Math.max(into.z, from.z);
    this.groups.delete(from.id);
    result.removed.push(from.id);
    return into;
  }

  isComplete(): boolean {
    return this.groups.size === 1;
  }

  /** Pieces that are connected to at least one other piece or placed on the board. */
  connectedCount(): number {
    let n = 0;
    for (const g of this.groups.values()) {
      if (g.locked || g.pieces.length > 1) n += g.pieces.length;
    }
    return n;
  }

  /**
   * Re-scatters all loose single pieces around the board.
   * Groups in `exclude` (e.g. held by players) are left alone.
   */
  scatterLoose(seed: number, aspect: number, exclude: ReadonlySet<number> = new Set()): GroupState[] {
    const loose = Array.from(this.groups.values()).filter((g) => !g.locked && g.pieces.length === 1 && !exclude.has(g.id));
    if (loose.length === 0) return [];
    const rng = createRng(seed >>> 0);
    const placements = computeScatter(
      this.spec,
      loose.map((g) => g.pieces[0]!),
      rng,
      aspect,
      this.pieceCount,
    );
    const changed: GroupState[] = [];
    for (const g of shuffle(rng, loose)) {
      const piece = g.pieces[0]!;
      const p = placements.get(piece)!;
      const rot = this.spec.rotation ? g.rot : 0;
      Object.assign(g, groupTransformFor(this.spec, piece, p.cx, p.cy, rot));
      g.z = ++this.zTop;
      changed.push(cloneGroup(g));
    }
    return changed;
  }

  /** Bounds of everything on the table: board plus all groups (cells only). */
  tableBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = 0;
    let minY = 0;
    let maxX = this.spec.width;
    let maxY = this.spec.height;
    const pad = Math.max(this.pieceWidth, this.pieceHeight) * 0.35;
    for (const g of this.groups.values()) {
      if (g.locked) continue;
      const b = this.groupBounds(g);
      minX = Math.min(minX, b.minX - pad);
      minY = Math.min(minY, b.minY - pad);
      maxX = Math.max(maxX, b.maxX + pad);
      maxY = Math.max(maxY, b.maxY + pad);
    }
    return { minX, minY, maxX, maxY };
  }
}

/** Group translation that puts a piece's centre at (cx, cy) with rotation `rot`. */
export function groupTransformFor(
  spec: PuzzleSpec,
  pieceId: number,
  cx: number,
  cy: number,
  rot: Rot,
): { x: number; y: number; rot: Rot } {
  const pw = spec.width / spec.cols;
  const ph = spec.height / spec.rows;
  const hx = ((pieceId % spec.cols) + 0.5) * pw;
  const hy = (Math.floor(pieceId / spec.cols) + 0.5) * ph;
  const [rx, ry] = rotateVec(hx, hy, rot);
  return { x: cx - rx, y: cy - ry, rot };
}

interface Placement {
  cx: number;
  cy: number;
  rot: Rot;
}

/**
 * Lays pieces out in a ring of slots around the board. The ring grows on the
 * side that keeps the overall table closest to the requested aspect ratio, so
 * the scattered puzzle fits a landscape monitor and a portrait phone alike.
 */
export function computeScatter(
  spec: PuzzleSpec,
  pieceIds: readonly number[],
  rng: Rng,
  aspect: number,
  capacityFor = pieceIds.length,
): Map<number, Placement> {
  const pw = spec.width / spec.cols;
  const ph = spec.height / spec.rows;
  const size = Math.max(pw, ph);
  const sw = size * 1.34;
  const sh = size * 1.34;
  const gap = size * 0.7;
  const innerW = spec.width + gap * 2;
  const innerH = spec.height + gap * 2;
  const targetAspect = Math.min(3, Math.max(1 / 3, Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6));
  const needed = Math.ceil(capacityFor * 1.12);

  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  const totalW = () => innerW + (left + right) * sw;
  const totalH = () => innerH + (top + bottom) * sh;
  const capacity = () => {
    const colSlots = Math.floor(totalH() / sh) * (left + right);
    const rowSlots = Math.floor(innerW / sw) * (top + bottom);
    return colSlots + rowSlots;
  };
  let guard = 0;
  while (capacity() < needed && guard++ < 400) {
    const widen = Math.abs(Math.log((totalW() + sw) / totalH() / targetAspect));
    const heighten = Math.abs(Math.log(totalW() / (totalH() + sh) / targetAspect));
    if (widen <= heighten) {
      if (left <= right) left++;
      else right++;
    } else if (top <= bottom) top++;
    else bottom++;
  }

  const slots: Array<[number, number]> = [];
  const x0 = -gap - left * sw;
  const y0 = -gap - top * sh;
  const rowsTotal = Math.floor(totalH() / sh);
  const yPad = (totalH() - rowsTotal * sh) / 2;
  for (let i = 0; i < left; i++) {
    for (let j = 0; j < rowsTotal; j++) slots.push([x0 + (i + 0.5) * sw, y0 + yPad + (j + 0.5) * sh]);
  }
  for (let i = 0; i < right; i++) {
    for (let j = 0; j < rowsTotal; j++) slots.push([spec.width + gap + (i + 0.5) * sw, y0 + yPad + (j + 0.5) * sh]);
  }
  const colsInner = Math.floor(innerW / sw);
  const xPad = (innerW - colsInner * sw) / 2;
  for (let i = 0; i < top; i++) {
    for (let j = 0; j < colsInner; j++) slots.push([-gap + xPad + (j + 0.5) * sw, -gap - (i + 0.5) * sh]);
  }
  for (let i = 0; i < bottom; i++) {
    for (let j = 0; j < colsInner; j++) slots.push([-gap + xPad + (j + 0.5) * sw, spec.height + gap + (i + 0.5) * sh]);
  }

  // Prefer the slots nearest the board so small subsets don't drift far away.
  const cx = spec.width / 2;
  const cy = spec.height / 2;
  const ordered = slots
    .map((s) => ({ s, d: Math.hypot((s[0] - cx) / totalW(), (s[1] - cy) / totalH()) + rng() * 0.35 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(pieceIds.length, Math.min(slots.length, needed)))
    .map((o) => o.s);
  shuffle(rng, ordered);

  const jitterX = (sw - pw) * 0.22;
  const jitterY = (sh - ph) * 0.22;
  const result = new Map<number, Placement>();
  pieceIds.forEach((id, i) => {
    const slot = ordered[i % ordered.length]!;
    result.set(id, {
      cx: slot[0] + (rng() * 2 - 1) * jitterX,
      cy: slot[1] + (rng() * 2 - 1) * jitterY,
      rot: spec.rotation ? (randomInt(rng, 4) as Rot) : 0,
    });
  });
  return result;
}
