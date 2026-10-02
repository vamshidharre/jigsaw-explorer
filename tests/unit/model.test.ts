import { describe, expect, it } from 'vitest';
import { PuzzleModel, groupTransformFor, rotateVec, type GroupState } from '../../src/shared/puzzle/model';
import { generateShapes } from '../../src/shared/puzzle/shapes';
import { gridForPieceCount, maxPiecesForImage, type PuzzleSpec } from '../../src/shared/puzzle/spec';

const spec = (over: Partial<PuzzleSpec> = {}): PuzzleSpec => ({
  seed: 12345,
  cols: 4,
  rows: 3,
  width: 400,
  height: 300,
  rotation: false,
  ...over,
});

/** Puts a piece's group so that the piece sits at its home position offset by (dx, dy). */
function placeNearHome(model: PuzzleModel, piece: number, dx: number, dy: number) {
  const g = model.groupOf(piece);
  model.moveGroup(g.id, dx, dy);
  return g.id;
}

describe('grid selection', () => {
  it('approximates the requested piece count with near-square pieces', () => {
    for (const [target, w, h] of [
      [24, 1600, 1000],
      [100, 1000, 1000],
      [300, 2400, 1600],
      [60, 900, 1600],
    ] as const) {
      const g = gridForPieceCount(target, w, h);
      const count = g.cols * g.rows;
      expect(Math.abs(count - target) / target).toBeLessThan(0.2);
      const pieceAspect = w / g.cols / (h / g.rows);
      expect(pieceAspect).toBeGreaterThan(0.7);
      expect(pieceAspect).toBeLessThan(1.45);
    }
  });

  it('limits the maximum piece count by image resolution', () => {
    expect(maxPiecesForImage(758, 600)).toBeLessThan(400);
    expect(maxPiecesForImage(4000, 3000)).toBe(1000);
  });
});

describe('shapes', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = generateShapes(spec());
    const b = generateShapes(spec());
    const c = generateShapes(spec({ seed: 999 }));
    expect(a.outlines[5]!.cubics).toEqual(b.outlines[5]!.cubics);
    expect(a.outlines[5]!.cubics).not.toEqual(c.outlines[5]!.cubics);
  });

  it('makes neighbouring pieces share the exact same cut', () => {
    const s = spec();
    const shapes = generateShapes(s);
    const pw = s.width / s.cols;
    // Each edge contributes 9 points (18 numbers). The right edge of piece 0 holds
    // points V1..V9 of the shared cut; the left edge of piece 1 holds V8..V0.
    const right = shapes.outlines[0]!.cubics.slice(18, 36);
    const left = shapes.outlines[1]!.cubics.slice(54, 72);
    const rightPts: number[][] = [];
    for (let i = 0; i < right.length; i += 2) rightPts.push([right[i]!, right[i + 1]!]);
    const leftPts: number[][] = [];
    for (let i = 0; i < left.length; i += 2) leftPts.push([left[i]! + pw, left[i + 1]!]);
    const reversed = leftPts.reverse(); // V0..V8
    for (let i = 0; i < 8; i++) {
      expect(reversed[i + 1]![0]).toBeCloseTo(rightPts[i]![0]!, 6);
      expect(reversed[i + 1]![1]).toBeCloseTo(rightPts[i]![1]!, 6);
    }
    // The cut actually has a knob (it is not a straight line).
    expect(Math.max(...rightPts.map((p) => Math.abs(p[0]! - pw)))).toBeGreaterThan(pw * 0.2);
  });

  it('keeps border edges straight', () => {
    const shapes = generateShapes(spec());
    const top = shapes.outlines[0]!.cubics.slice(0, 18);
    for (let i = 1; i < top.length; i += 2) expect(top[i]).toBeCloseTo(0, 9);
  });
});

describe('initial layout', () => {
  it('places every piece outside the board and is deterministic', () => {
    const s = spec({ cols: 10, rows: 8, width: 1000, height: 800 });
    const a = PuzzleModel.createInitial(s, 16 / 9);
    const b = PuzzleModel.createInitial(s, 16 / 9);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.groups.size).toBe(80);
    for (const g of a.groups.values()) {
      const [x, y] = a.pieceCenter(g.pieces[0]!, g);
      const inside = x > 0 && x < s.width && y > 0 && y < s.height;
      expect(inside).toBe(false);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  it('adapts the table shape to the viewport aspect', () => {
    const s = spec({ cols: 12, rows: 10, width: 1200, height: 1000 });
    const wide = PuzzleModel.createInitial(s, 2.2).tableBounds();
    const tall = PuzzleModel.createInitial(s, 0.5).tableBounds();
    const aspect = (b: { minX: number; maxX: number; minY: number; maxY: number }) => (b.maxX - b.minX) / (b.maxY - b.minY);
    expect(aspect(wide)).toBeGreaterThan(aspect(tall) * 1.8);
  });

  it('starts rotated pieces only when rotation is enabled', () => {
    const plain = PuzzleModel.createInitial(spec({ cols: 8, rows: 8, width: 800, height: 800 }));
    expect([...plain.groups.values()].every((g) => g.rot === 0)).toBe(true);
    const rotated = PuzzleModel.createInitial(spec({ cols: 8, rows: 8, width: 800, height: 800, rotation: true }));
    expect([...rotated.groups.values()].some((g) => g.rot !== 0)).toBe(true);
  });
});

describe('snapping', () => {
  it('locks a piece onto the board within tolerance', () => {
    const m = PuzzleModel.createInitial(spec());
    const gid = placeNearHome(m, 5, 6, -4);
    const res = m.drop(gid, m.snapTolerance('normal'));
    expect(res.kind).toBe('board');
    const g = m.groupOf(5);
    expect(g.locked).toBe(true);
    expect(g.x).toBe(0);
    expect(g.y).toBe(0);
    expect(m.connectedCount()).toBe(1);
  });

  it('does not snap when too far away', () => {
    const m = PuzzleModel.createInitial(spec());
    const gid = placeNearHome(m, 5, 60, 0);
    expect(m.drop(gid, m.snapTolerance('normal')).kind).toBeNull();
    expect(m.groupOf(5).locked).toBe(false);
  });

  it('respects snap strength', () => {
    const m = PuzzleModel.createInitial(spec());
    const gid = placeNearHome(m, 5, 20, 0);
    expect(m.drop(gid, m.snapTolerance('gentle')).kind).toBeNull();
    expect(m.drop(gid, m.snapTolerance('strong')).kind).toBe('board');
  });

  it('merges neighbouring pieces off the board', () => {
    const m = PuzzleModel.createInitial(spec());
    // Piece 0 and its right neighbour 1, both shifted by the same offset far from the board.
    m.moveGroup(m.groupOf(0).id, 900, 900);
    m.moveGroup(m.groupOf(1).id, 905, 897);
    const res = m.drop(m.groupOf(1).id, m.snapTolerance());
    expect(res.kind).toBe('piece');
    expect(m.groupOf(0).id).toBe(m.groupOf(1).id);
    const g = m.groupOf(0);
    expect(g.x).toBe(900);
    expect(g.y).toBe(900);
    expect(res.removed).toHaveLength(1);
    expect(res.joined).toBe(2);
    expect(m.connectedCount()).toBe(2);
  });

  it('never merges pieces that are not neighbours', () => {
    const m = PuzzleModel.createInitial(spec());
    m.moveGroup(m.groupOf(0).id, 900, 900);
    m.moveGroup(m.groupOf(2).id, 900, 900);
    expect(m.drop(m.groupOf(2).id, m.snapTolerance()).kind).toBeNull();
  });

  it('cascades merges into several groups at once', () => {
    const m = PuzzleModel.createInitial(spec());
    m.moveGroup(m.groupOf(0).id, 700, 700);
    m.moveGroup(m.groupOf(2).id, 700, 700);
    m.moveGroup(m.groupOf(1).id, 703, 702);
    const res = m.drop(m.groupOf(1).id, m.snapTolerance());
    expect(res.kind).toBe('piece');
    expect(m.groupOf(0).pieces.sort()).toEqual([0, 1, 2]);
  });

  it('joins a group into the locked board group', () => {
    const m = PuzzleModel.createInitial(spec());
    m.drop(placeNearHome(m, 0, 2, 2), m.snapTolerance());
    m.drop(placeNearHome(m, 1, 2, -1), m.snapTolerance());
    const locked = [...m.groups.values()].filter((g) => g.locked);
    expect(locked).toHaveLength(1);
    expect(locked[0]!.pieces.sort()).toEqual([0, 1]);
  });

  it('skips groups rejected by canJoin (held by another player)', () => {
    const m = PuzzleModel.createInitial(spec());
    m.moveGroup(m.groupOf(0).id, 900, 900);
    m.moveGroup(m.groupOf(1).id, 900, 900);
    const held = m.groupOf(0).id;
    expect(m.drop(m.groupOf(1).id, m.snapTolerance(), (g) => g.id !== held).kind).toBeNull();
  });

  it('completes the puzzle when every piece is joined', () => {
    const m = PuzzleModel.createInitial(spec());
    let last;
    for (let p = 0; p < m.pieceCount; p++) last = m.drop(placeNearHome(m, p, 1, 1), m.snapTolerance());
    expect(last!.completed).toBe(true);
    expect(m.isComplete()).toBe(true);
    expect(m.connectedCount()).toBe(m.pieceCount);
  });

  it('auto-places a puzzle completed off the board', () => {
    const m = PuzzleModel.createInitial(spec({ cols: 2, rows: 2, width: 200, height: 200 }));
    for (let p = 0; p < 4; p++) m.moveGroup(m.groupOf(p).id, 500, 500);
    let res;
    for (let p = 0; p < 4; p++) {
      const g = m.groupOf(p);
      if (!g.locked) res = m.drop(g.id, m.snapTolerance());
    }
    expect(m.isComplete()).toBe(true);
    expect(res!.completed).toBe(true);
    const g = m.groupOf(0);
    expect([g.x, g.y, g.rot, g.locked]).toEqual([0, 0, 0, true]);
  });
});

describe('rotation', () => {
  it('only merges pieces that share a rotation', () => {
    const s = spec({ rotation: true });
    const m = PuzzleModel.createInitial(s);
    const a = m.groupOf(0);
    const b = m.groupOf(1);
    Object.assign(a, groupTransformFor(s, 0, 1000, 1000, 1));
    Object.assign(b, groupTransformFor(s, 1, 1000, 1100, 0));
    expect(m.drop(b.id, m.snapTolerance()).kind).toBeNull();
    // With rotation 1 (90° clockwise) the right neighbour sits below piece 0.
    Object.assign(b, groupTransformFor(s, 1, 1000, 1000 + s.width / s.cols, 1));
    expect(m.drop(b.id, m.snapTolerance()).kind).toBe('piece');
  });

  it('requires pieces to be upright before they lock to the board', () => {
    const s = spec({ rotation: true });
    const m = PuzzleModel.createInitial(s);
    const g = m.groupOf(5);
    Object.assign(g, { x: 0, y: 0, rot: 2 });
    expect(m.drop(g.id, m.snapTolerance()).kind).toBeNull();
  });

  it('rotates a group around a pivot', () => {
    const s = spec({ rotation: true });
    const m = PuzzleModel.createInitial(s);
    const g = m.groupOf(0);
    Object.assign(g, { x: 0, y: 0, rot: 0 });
    const [cx, cy] = m.pieceCenter(0);
    for (let i = 0; i < 4; i++) {
      m.rotateGroup(g.id, cx, cy, 1);
      const [x, y] = m.pieceCenter(0);
      expect(x).toBeCloseTo(cx, 9);
      expect(y).toBeCloseTo(cy, 9);
    }
    expect(g.rot).toBe(0);
    expect(rotateVec(1, 0, 1)).toEqual([-0, 1]);
  });
});

describe('state integrity', () => {
  it('rejects states where a piece is missing', () => {
    const m = PuzzleModel.createInitial(spec());
    const groups = m.snapshot().filter((g) => g.id !== 3);
    expect(() => new PuzzleModel(spec(), groups)).toThrow();
  });

  it('round-trips through snapshot and applyChanges', () => {
    const m = PuzzleModel.createInitial(spec());
    const copy = m.clone();
    m.moveGroup(m.groupOf(0).id, 900, 900);
    m.moveGroup(m.groupOf(1).id, 900, 900);
    const res = m.drop(m.groupOf(1).id, m.snapTolerance());
    copy.applyChanges(res.changed, res.removed);
    const norm = (gs: GroupState[]) => gs.map((g) => ({ ...g, pieces: [...g.pieces].sort() })).sort((a, b) => a.id - b.id);
    expect(norm(copy.snapshot())).toEqual(norm(m.snapshot()));
  });

  it('re-scatters loose pieces without touching groups', () => {
    const m = PuzzleModel.createInitial(spec({ cols: 6, rows: 5, width: 600, height: 500 }));
    m.moveGroup(m.groupOf(0).id, 2000, 2000);
    m.moveGroup(m.groupOf(1).id, 2000, 2000);
    m.drop(m.groupOf(1).id, m.snapTolerance());
    const pair = m.groupOf(0);
    const before = { x: pair.x, y: pair.y };
    const changed = m.scatterLoose(42, 1.6);
    expect(changed.length).toBe(28);
    expect({ x: pair.x, y: pair.y }).toEqual(before);
  });
});
