/**
 * Puzzle specification and difficulty presets.
 *
 * A puzzle is fully described by its spec: the image's canonical dimensions
 * (which define the board size in world units), the grid and a seed. Piece
 * shapes and the initial layout are derived deterministically from it.
 */
export interface PuzzleSpec {
  seed: number;
  cols: number;
  rows: number;
  /** Board width in world units (the canonical image width). */
  width: number;
  /** Board height in world units (the canonical image height). */
  height: number;
  /** When true pieces start rotated in 90° steps and must be turned upright. */
  rotation: boolean;
}

export const MIN_PIECES = 6;
export const MAX_PIECES = 1000;
/** Smallest edge length (in source pixels) a piece may have and still look sharp. */
export const MIN_PIECE_PIXELS = 34;

export interface DifficultyPreset {
  id: 'easy' | 'medium' | 'hard' | 'expert' | 'master';
  label: string;
  pieces: number;
  description: string;
}

export const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  { id: 'easy', label: 'Easy', pieces: 24, description: 'A relaxed warm-up' },
  { id: 'medium', label: 'Medium', pieces: 60, description: 'A satisfying session' },
  { id: 'hard', label: 'Hard', pieces: 150, description: 'Takes some patience' },
  { id: 'expert', label: 'Expert', pieces: 300, description: 'For seasoned puzzlers' },
  { id: 'master', label: 'Master', pieces: 600, description: 'A true marathon' },
];

export interface Grid {
  cols: number;
  rows: number;
}

/** Maximum piece count an image of the given size supports while staying sharp. */
export function maxPiecesForImage(width: number, height: number): number {
  const cols = Math.floor(width / MIN_PIECE_PIXELS);
  const rows = Math.floor(height / MIN_PIECE_PIXELS);
  return Math.max(MIN_PIECES, Math.min(MAX_PIECES, cols * rows));
}

/**
 * Picks the grid whose piece count is closest to `target` while keeping the
 * pieces as close to square as possible for the given image aspect ratio.
 */
export function gridForPieceCount(target: number, width: number, height: number): Grid {
  const aspect = width / height;
  const clamped = Math.max(MIN_PIECES, Math.min(MAX_PIECES, Math.round(target)));
  let best: Grid = { cols: 2, rows: 3 };
  let bestScore = Infinity;
  const idealRows = Math.sqrt(clamped / aspect);
  const minRows = Math.max(2, Math.floor(idealRows * 0.6));
  const maxRows = Math.max(minRows, Math.ceil(idealRows * 1.6));
  for (let rows = minRows; rows <= maxRows; rows++) {
    for (const cols of [Math.floor(clamped / rows), Math.ceil(clamped / rows)]) {
      if (cols < 2) continue;
      const count = cols * rows;
      if (count > MAX_PIECES) continue;
      const pieceAspect = width / cols / (height / rows);
      // Penalise deviating from the requested count and from square pieces.
      const countError = Math.abs(count - clamped) / clamped;
      const shapeError = Math.abs(Math.log(pieceAspect));
      const score = countError * 3 + shapeError;
      if (score < bestScore) {
        bestScore = score;
        best = { cols, rows };
      }
    }
  }
  return best;
}

export function difficultyLabel(pieceCount: number): string {
  let label = DIFFICULTY_PRESETS[0]!.label;
  for (const preset of DIFFICULTY_PRESETS) {
    if (pieceCount >= preset.pieces * 0.8) label = preset.label;
  }
  return label;
}

export function pieceCount(spec: Pick<PuzzleSpec, 'cols' | 'rows'>): number {
  return spec.cols * spec.rows;
}

export function isValidSpec(spec: PuzzleSpec): boolean {
  return (
    Number.isInteger(spec.seed) &&
    spec.seed >= 0 &&
    spec.seed <= 0xffffffff &&
    Number.isInteger(spec.cols) &&
    Number.isInteger(spec.rows) &&
    spec.cols >= 2 &&
    spec.rows >= 2 &&
    spec.cols * spec.rows <= MAX_PIECES &&
    Number.isFinite(spec.width) &&
    Number.isFinite(spec.height) &&
    spec.width >= 64 &&
    spec.height >= 64 &&
    spec.width <= 10000 &&
    spec.height <= 10000
  );
}
