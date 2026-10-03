import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Gift, Link2Off, Play, Timer, Users } from 'lucide-react';
import { pageTitle } from '../../../shared/brand';
import { catalogImageUrl, getCatalogImage } from '../../../shared/catalog';
import { DEFAULT_ROOM_CAPACITY, imageRefUrl, normalizeShareId, SHARE_ID_PATTERN, type ShareInfo } from '../../../shared/protocol';
import { PageShell } from '../../components/layout/SiteHeader';
import { PageLoader, StateScreen } from '../../components/layout/PageLoader';
import { Button } from '../../components/ui/Button';
import { track } from '../../lib/analytics';
import { ApiError, createRoom, getShare } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import { thumbnailFromBlob } from '../../lib/images';
import { hostKeyStorageKey } from '../../net/RoomConnection';
import { loadGame, pruneGames, saveGame, saveImage, type SavedGame, type SavedImage } from '../../persistence/savedGames';

type State = { status: 'loading' } | { status: 'error'; message: string; expired: boolean } | { status: 'ready'; share: ShareInfo };

export function shareGameId(shareId: string): string {
  return `share-${shareId}`;
}

/** Creates the saved game for a shared puzzle (downloading an uploaded photo so it keeps working after the link expires). */
async function startSharedPuzzle(share: ShareInfo): Promise<string> {
  const id = shareGameId(share.id);
  const existing = await loadGame(id);
  if (existing && existing.completedAt === null) return id;
  let image: SavedImage;
  if (share.image.kind === 'catalog') {
    image = { kind: 'catalog', id: share.image.id };
  } else {
    const res = await fetch(imageRefUrl(share.image));
    if (!res.ok) throw new ApiError('The picture for this puzzle is no longer available.', res.status);
    const blob = await res.blob();
    const key = `img_${id}`;
    await saveImage(key, blob);
    image = { kind: 'local', key, thumbnail: await thumbnailFromBlob(blob) };
  }
  const now = Date.now();
  const game: SavedGame = {
    version: 1,
    id,
    title: share.title,
    image,
    spec: { seed: share.seed, cols: share.cols, rows: share.rows, width: share.width, height: share.height, rotation: share.rotation },
    groups: [],
    elapsedMs: 0,
    moves: 0,
    connected: 0,
    total: share.cols * share.rows,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    share: { id: share.id, from: share.from, challenge: share.challenge },
  };
  await saveGame(game);
  void pruneGames();
  return id;
}

export default function SharePage() {
  const { id: rawId = '' } = useParams();
  const id = normalizeShareId(rawId);
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState<'solo' | 'room' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    document.title = pageTitle('A puzzle for you');
    if (!SHARE_ID_PATTERN.test(id)) {
      setState({ status: 'error', message: 'This puzzle link is not valid. Check that it was copied completely.', expired: false });
      return;
    }
    let alive = true;
    getShare(id)
      .then((share) => alive && setState({ status: 'ready', share }))
      .catch((err) => {
        if (!alive) return;
        const expired = err instanceof ApiError && err.status === 404;
        setState({ status: 'error', message: err instanceof ApiError ? err.message : 'Could not load this puzzle.', expired });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (state.status === 'loading') return <PageLoader label="Loading puzzle" />;
  if (state.status === 'error') {
    return (
      <PageShell>
        <StateScreen
          icon={<Link2Off />}
          title={state.expired ? 'This puzzle link has expired' : 'Could not open this puzzle'}
          actions={
            <>
              <Link className="btn btn--primary" to="/daily">
                Play today's puzzle
              </Link>
              <Link className="btn" to="/puzzles">
                Browse puzzles
              </Link>
            </>
          }
        >
          <p>{state.expired ? 'Puzzle links last 30 days. Ask your friend to send a new one.' : state.message}</p>
        </StateScreen>
      </PageShell>
    );
  }

  const share = state.share;
  const pieces = share.cols * share.rows;
  const from = share.from ?? 'Someone';
  const challenge = share.challenge;
  const catalog = share.image.kind === 'catalog' ? getCatalogImage(share.image.id) : undefined;
  const src = catalog ? catalogImageUrl(catalog.id) : imageRefUrl(share.image);

  const solo = async () => {
    setBusy('solo');
    setActionError(null);
    try {
      const gameId = await startSharedPuzzle(share);
      track('share_start');
      navigate(`/play/${gameId}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not start the puzzle. Please try again.');
      setBusy(null);
    }
  };

  const together = async () => {
    setBusy('room');
    setActionError(null);
    try {
      const room = await createRoom({
        image: share.image,
        pieces,
        rotation: share.rotation,
        capacity: DEFAULT_ROOM_CAPACITY,
        aspect: window.innerWidth / Math.max(1, window.innerHeight),
      });
      try {
        sessionStorage.setItem(hostKeyStorageKey(room.code), JSON.stringify(room.hostKey));
      } catch {
        // The first player to join becomes host anyway.
      }
      navigate(`/room/${room.code}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not create the room. Please try again.');
      setBusy(null);
    }
  };

  return (
    <PageShell>
      <section className="gift" aria-labelledby="gift-title">
        <figure
          className={challenge ? 'gift__preview' : 'gift__preview is-veiled'}
          style={{ aspectRatio: `${share.width} / ${share.height}`, backgroundColor: catalog?.color, backgroundImage: catalog ? `url(${catalog.blur})` : undefined }}
        >
          <img src={src} alt={challenge ? `Preview of ${share.title}` : ''} className={imgLoaded ? 'is-loaded' : undefined} onLoad={() => setImgLoaded(true)} />
          {!challenge && (
            <figcaption className="gift__veil">
              <Gift aria-hidden="true" />
              Solve it to see the picture
            </figcaption>
          )}
        </figure>
        <div className="gift__copy">
          <p className="eyebrow">{challenge ? 'A challenge for you' : 'A puzzle for you'}</p>
          <h1 id="gift-title" className="gift__title">
            {challenge ? `${from} solved this in ${formatDuration(challenge.ms)}` : `${from} sent you a jigsaw puzzle`}
          </h1>
          {share.message && <blockquote className="gift__message">{share.message}</blockquote>}
          <p className="gift__meta">
            {challenge ? `${share.title} · ` : ''}
            {pieces} pieces{share.rotation ? ' · rotating pieces' : ''}
            {challenge ? ' · cut exactly the same way' : ''}
          </p>
          {challenge && (
            <p className="gift__target">
              <Timer aria-hidden="true" />
              Time to beat: <strong className="tabular">{formatDuration(challenge.ms)}</strong>
            </p>
          )}
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="hero__actions">
            <Button variant="primary" size="lg" loading={busy === 'solo'} disabled={busy !== null} onClick={() => void solo()}>
              <Play />
              {challenge ? 'Accept the challenge' : 'Start puzzle'}
            </Button>
            <Button size="lg" loading={busy === 'room'} disabled={busy !== null} onClick={() => void together()}>
              <Users />
              Solve it together
            </Button>
          </div>
          <p className="gift__note">Plays in your browser. No account needed.</p>
        </div>
      </section>
    </PageShell>
  );
}
