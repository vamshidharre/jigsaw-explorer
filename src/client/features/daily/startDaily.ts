import { dailyPuzzle } from '../../../shared/daily';
import { track } from '../../lib/analytics';
import { loadGame, pruneGames, saveGame, type SavedGame } from '../../persistence/savedGames';

export function dailyGameId(key: string): string {
  return `daily-${key}`;
}

/** Creates the saved game for a day's puzzle, or returns the existing one. */
export async function startDaily(key: string): Promise<string> {
  const id = dailyGameId(key);
  if (await loadGame(id)) return id;
  const puzzle = dailyPuzzle(key);
  const now = Date.now();
  const game: SavedGame = {
    version: 1,
    id,
    title: `Daily puzzle #${puzzle.number}`,
    image: { kind: 'catalog', id: puzzle.imageId },
    spec: puzzle.spec,
    groups: [],
    elapsedMs: 0,
    moves: 0,
    connected: 0,
    total: puzzle.spec.cols * puzzle.spec.rows,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    daily: key,
  };
  await saveGame(game);
  void pruneGames();
  track('daily_start');
  return id;
}
