import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Grid2x2Plus, Keyboard, RotateCcw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { catalogImageUrl } from '../../../shared/catalog';
import { PuzzleModel } from '../../../shared/puzzle/model';
import { difficultyLabel } from '../../../shared/puzzle/spec';
import { randomSeed } from '../../../shared/rng';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { PageLoader, StateScreen } from '../../components/layout/PageLoader';
import { useUi } from '../../app/uiStore';
import type { GameEngine } from '../../engine/GameEngine';
import { formatDuration } from '../../lib/format';
import { decodeBlob, ImageLoadError, loadImage, type LoadedImage } from '../../lib/images';
import {
  groupsFromWire,
  groupsToWire,
  loadGame,
  loadImageBlob,
  recordTime,
  saveGame,
  getBestTime,
  type SavedGame,
} from '../../persistence/savedGames';
import { useSettings } from '../settings/settingsStore';
import { CompletionCard } from './CompletionCard';
import { GameView, type EngineSetup, type TimerSource } from './GameView';

/** Stopwatch that only runs while the player is actually playing. */
function useStopwatch(initialMs: number) {
  const state = useRef({ accumulated: initialMs, since: null as number | null });
  const timer = useMemo<TimerSource & { start(): void; stop(): void; reset(ms: number): void; running(): boolean }>(
    () => ({
      elapsed: () => state.current.accumulated + (state.current.since !== null ? performance.now() - state.current.since : 0),
      start: () => {
        if (state.current.since === null) state.current.since = performance.now();
      },
      stop: () => {
        if (state.current.since !== null) {
          state.current.accumulated += performance.now() - state.current.since;
          state.current.since = null;
        }
      },
      reset: (ms: number) => {
        state.current = { accumulated: ms, since: null };
      },
      running: () => state.current.since !== null,
    }),
    [],
  );
  return timer;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; game: SavedGame; image: LoadedImage; imageUrl: string };

export default function PlayPage() {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const engineRef = useRef<GameEngine | null>(null);
  const gameRef = useRef<SavedGame | null>(null);
  const timer = useStopwatch(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.visibilityState === 'hidden');
  const [playing, setPlaying] = useState(false);
  const [completion, setCompletion] = useState<{ ms: number; best: number | null; isBest: boolean } | null>(null);
  const [showCompletion, setShowCompletion] = useState(true);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const autoPause = useSettings((s) => s.autoPause);
  const openSetup = useUi((s) => s.openSetup);
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  const movesRef = useRef(0);

  // Load the saved game and its image.
  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    setLoad({ status: 'loading' });
    (async () => {
      const game = await loadGame(gameId);
      if (!alive) return;
      if (!game) {
        setLoad({ status: 'missing' });
        return;
      }
      // Recover gracefully from damaged saved state by reshuffling.
      if (game.groups.length) {
        try {
          new PuzzleModel(game.spec, groupsFromWire(game.groups));
        } catch {
          game.groups = [];
          toast('Saved progress for this puzzle was damaged, so the pieces were reshuffled.');
        }
      }
      let image: LoadedImage;
      let imageUrl: string;
      try {
        if (game.image.kind === 'catalog') {
          imageUrl = catalogImageUrl(game.image.id);
          image = await loadImage(imageUrl, abort.signal);
        } else {
          const blob = await loadImageBlob(game.image.key);
          if (!blob) throw new ImageLoadError('The photo for this puzzle is no longer stored in this browser.');
          imageUrl = URL.createObjectURL(blob);
          image = await decodeBlob(blob);
        }
      } catch (err) {
        if (!alive) return;
        setLoad({ status: 'error', message: err instanceof Error ? err.message : 'The image could not be loaded.' });
        return;
      }
      if (!alive) return;
      gameRef.current = game;
      movesRef.current = game.moves;
      timer.reset(game.elapsedMs);
      setCompletion(game.completedAt ? { ms: game.elapsedMs, best: getBestTime(game.image, game.total, game.spec.rotation), isBest: false } : null);
      setShowCompletion(game.completedAt === null);
      setPlaying(false);
      setPaused(false);
      setLoad({ status: 'ready', game, image, imageUrl });
      document.title = `${game.title} — Jigsaw Explorer`;
    })().catch(() => alive && setLoad({ status: 'error', message: 'This puzzle could not be loaded.' }));
    return () => {
      alive = false;
      abort.abort();
    };
  }, [gameId, attempt, timer]);

  useEffect(() => {
    return () => {
      if (load.status === 'ready' && load.imageUrl.startsWith('blob:')) URL.revokeObjectURL(load.imageUrl);
    };
  }, [load]);

  // Persisting ------------------------------------------------------------------
  const save = useCallback(async () => {
    const game = gameRef.current;
    const engine = engineRef.current;
    if (!game || !engine) return;
    const next: SavedGame = {
      ...game,
      groups: groupsToWire(engine.snapshot()),
      elapsedMs: Math.round(timer.elapsed()),
      moves: movesRef.current,
      connected: engine.connectedCount(),
      updatedAt: Date.now(),
    };
    gameRef.current = next;
    await saveGame(next);
  }, [timer]);

  const saveTimer = useRef(0);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), 400);
  }, [save]);

  useEffect(() => {
    const flush = () => void save();
    const onVisibility = () => {
      setHidden(document.visibilityState === 'hidden');
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    const periodic = window.setInterval(() => timer.running() && flush(), 15_000);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(periodic);
      clearTimeout(saveTimer.current);
      flush();
    };
  }, [save, timer]);

  // Timer: runs only while playing, not paused, not hidden (if auto-pause) and not completed.
  const running = playing && !paused && !completion && !(autoPause && hidden);
  useEffect(() => {
    if (running) timer.start();
    else timer.stop();
  }, [running, timer]);

  const onComplete = useCallback(() => {
    timer.stop();
    const game = gameRef.current;
    if (!game) return;
    const ms = Math.round(timer.elapsed());
    const { previous, isBest } = recordTime(game.image, game.total, game.spec.rotation, ms);
    gameRef.current = { ...game, completedAt: Date.now() };
    setCompletion({ ms, best: isBest ? ms : previous, isBest: isBest && previous !== null });
    setShowCompletion(true);
    void save();
  }, [save, timer]);

  const restart = useCallback(async () => {
    const game = gameRef.current;
    if (!game) return;
    const fresh: SavedGame = {
      ...game,
      spec: { ...game.spec, seed: randomSeed() },
      groups: [],
      elapsedMs: 0,
      moves: 0,
      connected: 0,
      completedAt: null,
      updatedAt: Date.now(),
    };
    engineRef.current = null;
    gameRef.current = fresh;
    await saveGame(fresh);
    setConfirmRestart(false);
    setAttempt((a) => a + 1);
  }, []);

  const inviteFriends = useCallback(async () => {
    const game = gameRef.current;
    if (!game) return;
    if (game.image.kind === 'catalog') {
      openSetup({ kind: 'catalog', id: game.image.id }, 'room');
      return;
    }
    const blob = await loadImageBlob(game.image.key);
    if (!blob) {
      toast.error('The photo for this puzzle is no longer available.');
      return;
    }
    openSetup({ kind: 'local', upload: { blob, width: game.spec.width, height: game.spec.height, thumbnail: game.image.thumbnail, name: game.title } }, 'room');
  }, [openSetup]);

  const setup = useMemo<EngineSetup | null>(() => {
    if (load.status !== 'ready') return null;
    const g = load.game;
    return {
      key: `${g.id}:${g.spec.seed}`,
      spec: g.spec,
      groups: g.groups.length ? groupsFromWire(g.groups) : null,
      image: load.image,
      completed: g.completedAt !== null,
    };
  }, [load]);

  if (load.status === 'loading') return <PageLoader label="Loading puzzle" />;
  if (load.status === 'missing') {
    return (
      <StateScreen
        title="Puzzle not found"
        actions={
          <>
            <Button variant="primary" onClick={() => navigate('/puzzles')}>
              Choose a puzzle
            </Button>
            <Link to="/" className="btn">
              Home
            </Link>
          </>
        }
      >
        <p>This puzzle isn't saved in this browser. Saved puzzles live on the device where you started them.</p>
      </StateScreen>
    );
  }

  const game = load.status === 'ready' ? load.game : null;
  const subtitle = game ? `${game.total} pieces · ${difficultyLabel(game.total)}${game.spec.rotation ? ' · Rotation' : ''}` : '';

  return (
    <>
      <GameView
        setup={setup}
        loadingLabel="Loading image…"
        loadError={load.status === 'error' ? { message: load.message, retry: () => setAttempt((a) => a + 1) } : null}
        title={game?.title ?? 'Puzzle'}
        subtitle={subtitle}
        imageUrl={load.status === 'ready' ? load.imageUrl : ''}
        backTo={{ href: '/', label: 'Back to home' }}
        timer={timer}
        interactive={!paused}
        completed={completion !== null}
        onEngine={(e) => {
          engineRef.current = e;
          if (e && gameRef.current && gameRef.current.groups.length === 0) void save();
        }}
        events={{
          firstInteraction: () => setPlaying(true),
          pickup: () => {
            movesRef.current++;
          },
          changed: scheduleSave,
          complete: onComplete,
        }}
        pause={{ paused, toggle: () => setPaused((p) => !p) }}
        menu={[
          { label: 'Restart puzzle', icon: <RotateCcw />, onSelect: () => setConfirmRestart(true) },
          { label: 'New puzzle', icon: <Grid2x2Plus />, onSelect: () => navigate('/puzzles') },
          { label: 'Play this with friends', icon: <Users />, onSelect: () => void inviteFriends() },
          { label: '-', onSelect: () => undefined },
          { label: 'Controls & shortcuts', icon: <Keyboard />, onSelect: () => setHelpOpen(true), shortcut: '?' },
        ]}
        overlay={
          <>
            {paused && !completion && (
              <div className="pause-overlay">
                <div className="pause-overlay__card">
                  <h2>Paused</h2>
                  <p className="tabular">{formatDuration(timer.elapsed())} played</p>
                  <Button variant="primary" size="lg" onClick={() => setPaused(false)} autoFocus>
                    Resume
                  </Button>
                </div>
              </div>
            )}
            {completion && showCompletion && game && (
              <CompletionCard
                title="Puzzle complete"
                subtitle={`${game.title} · ${game.total} pieces`}
                onDismiss={() => setShowCompletion(false)}
                stats={[
                  { label: 'Time', value: formatDuration(completion.ms) },
                  { label: 'Moves', value: String(movesRef.current) },
                  completion.best !== null
                    ? { label: completion.isBest ? 'New best!' : 'Best time', value: formatDuration(completion.best), highlight: completion.isBest }
                    : { label: 'Pieces', value: String(game.total) },
                ]}
                actions={
                  <>
                    <Button variant="primary" onClick={() => navigate('/puzzles')}>
                      New puzzle
                    </Button>
                    <Button onClick={() => void restart()}>Play again</Button>
                  </>
                }
              />
            )}
          </>
        }
      />
      <Dialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Restart this puzzle?"
        description="The pieces will be reshuffled and the timer reset."
        width={420}
        footer={
          <>
            <Button onClick={() => setConfirmRestart(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void restart()}>
              Restart
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
