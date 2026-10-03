import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { BRAND } from '../../../shared/brand';
import { getCatalogImage } from '../../../shared/catalog';
import { gridForPieceCount, maxPiecesForImage, MIN_PIECES } from '../../../shared/puzzle/spec';
import { randomSeed } from '../../../shared/rng';
import { PageLoader, StateScreen } from '../../components/layout/PageLoader';
import { track } from '../../lib/analytics';
import { loadGame, pruneGames, saveGame, type SavedGame } from '../../persistence/savedGames';

export const EMBED_DEFAULT_PIECES = 60;

/**
 * Entry point for puzzles embedded on other sites:
 * `<iframe src="/embed/great-wave?pieces=60">`. It resumes (or starts) a puzzle
 * saved in the visitor's browser and opens the normal game screen in embed mode.
 */
export function EmbedPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const image = getCatalogImage(id);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!image) return;
    const max = maxPiecesForImage(image.width, image.height);
    const requested = Math.round(Number(params.get('pieces'))) || EMBED_DEFAULT_PIECES;
    const grid = gridForPieceCount(Math.min(max, Math.max(MIN_PIECES, requested)), image.width, image.height);
    const rotation = params.get('rotation') === '1';
    const gameId = `embed-${image.id}-${grid.cols}x${grid.rows}${rotation ? '-r' : ''}`;
    let alive = true;
    (async () => {
      const existing = await loadGame(gameId);
      if (!existing || existing.completedAt !== null) {
        const now = Date.now();
        const game: SavedGame = {
          version: 1,
          id: gameId,
          title: image.title,
          image: { kind: 'catalog', id: image.id },
          spec: { seed: randomSeed(), cols: grid.cols, rows: grid.rows, width: image.width, height: image.height, rotation },
          groups: [],
          elapsedMs: 0,
          moves: 0,
          connected: 0,
          total: grid.cols * grid.rows,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        await saveGame(game);
        void pruneGames();
        track('solo_start', image.id);
      }
      if (alive) navigate(`/play/${gameId}?embed=1`, { replace: true });
    })().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [image, params, navigate]);

  if (!image || failed) {
    return (
      <StateScreen
        title={image ? 'This puzzle could not be started' : 'Puzzle not found'}
        actions={
          <a className="btn btn--primary" href="/puzzles" target="_blank" rel="noopener">
            Open {BRAND.name}
          </a>
        }
      >
        <p>{image ? 'Please reload the page to try again.' : 'This embedded puzzle does not exist.'}</p>
      </StateScreen>
    );
  }
  return <PageLoader label="Loading puzzle" />;
}
