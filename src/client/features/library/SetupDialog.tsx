import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Gift, RotateCw, Users } from 'lucide-react';
import { puzzleLabel } from '../../../shared/analytics';
import { catalogImageUrl, getCatalogImage } from '../../../shared/catalog';
import { DEFAULT_ROOM_CAPACITY, MAX_ROOM_CAPACITY, MIN_ROOM_CAPACITY, type ImageRef } from '../../../shared/protocol';
import { DIFFICULTY_PRESETS, gridForPieceCount, maxPiecesForImage, MIN_PIECES, type PuzzleSpec } from '../../../shared/puzzle/spec';
import { randomSeed } from '../../../shared/rng';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Slider, Switch } from '../../components/ui/Controls';
import { useUi, type SetupMode, type SetupTarget } from '../../app/uiStore';
import { useRoom } from '../multiplayer/roomStore';
import { track } from '../../lib/analytics';
import { ApiError, createRoom, uploadImage } from '../../lib/api';
import { ShareDialog, type ShareSource } from '../share/ShareDialog';
import { hostKeyStorageKey } from '../../net/RoomConnection';
import { newGameId, pruneGames, saveGame, saveImage, type SavedGame, type SavedImage } from '../../persistence/savedGames';

const LAST_KEY = 'jigsaw.lastSetup.v1';

interface LastSetup {
  preset: string;
  custom: number;
  rotation: boolean;
  capacity: number;
}

function readLast(): LastSetup {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastSetup | null;
    if (v && typeof v.custom === 'number') return v;
  } catch {
    // ignore
  }
  return { preset: 'medium', custom: 100, rotation: false, capacity: DEFAULT_ROOM_CAPACITY };
}

function describeTarget(target: SetupTarget) {
  if (target.kind === 'catalog') {
    const img = getCatalogImage(target.id)!;
    // Artist credits read well on the preview; full photo credits live on the credits page.
    const credit = img.category === 'fine-art' && !img.credit.startsWith('Unsplash') ? img.credit : null;
    return { title: img.title, width: img.width, height: img.height, src: catalogImageUrl(img.id), credit, color: img.color, blur: img.blur };
  }
  return {
    title: target.upload.name,
    width: target.upload.width,
    height: target.upload.height,
    src: target.upload.thumbnail,
    credit: 'Your photo' as string | null,
    color: '#888',
    blur: target.upload.thumbnail,
  };
}

export function SetupDialog() {
  const setup = useUi((s) => s.setup);
  const closeSetup = useUi((s) => s.closeSetup);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (setup) setOpen(true);
  }, [setup]);

  return (
    <Dialog
      open={open && setup !== null}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) window.setTimeout(closeSetup, 200);
      }}
      title={setup ? describeTarget(setup.target).title : ''}
      description={setup?.mode === 'room' ? 'Set up a puzzle to solve together' : setup?.mode === 'update' ? 'Start a new puzzle for everyone in the room' : 'Choose your difficulty'}
      width={720}
      mobileSheet
    >
      {setup && <SetupContent key={setup.target.kind === 'catalog' ? setup.target.id : setup.target.upload.thumbnail.slice(-24)} target={setup.target} mode={setup.mode} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function SetupContent({ target, mode, onDone }: { target: SetupTarget; mode: SetupMode; onDone(): void }) {
  const info = describeTarget(target);
  const navigate = useNavigate();
  const last = useMemo(readLast, []);
  const maxPieces = maxPiecesForImage(info.width, info.height);
  const presets = DIFFICULTY_PRESETS.map((p) => {
    const g = gridForPieceCount(Math.min(p.pieces, maxPieces), info.width, info.height);
    return { ...p, grid: g, count: g.cols * g.rows, available: p.pieces <= maxPieces * 1.15 };
  });
  const defaultPreset = last.preset === 'custom' || presets.some((p) => p.id === last.preset && p.available) ? last.preset : 'medium';
  const [preset, setPreset] = useState<string>(defaultPreset);
  const [custom, setCustom] = useState(Math.min(maxPieces, Math.max(MIN_PIECES, last.custom)));
  const [rotation, setRotation] = useState(last.rotation);
  const [capacity, setCapacity] = useState(last.capacity);
  const [busy, setBusy] = useState<'solo' | 'room' | 'update' | null>(null);
  const roomActions = useRoom((s) => s.actions);
  const [error, setError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const uploaded = useRef<Promise<ImageRef> | null>(null);

  const grid = preset === 'custom' ? gridForPieceCount(custom, info.width, info.height) : presets.find((p) => p.id === preset)!.grid;
  const count = grid.cols * grid.rows;

  /** Uploads the player's photo once, however many rooms or links they create from this dialog. */
  const imageRef = (): Promise<ImageRef> => {
    if (target.kind === 'catalog') return Promise.resolve({ kind: 'catalog', id: target.id });
    uploaded.current ??= uploadImage(target.upload.blob).then((u) => ({ kind: 'upload', id: u.id }) as ImageRef);
    uploaded.current.catch(() => (uploaded.current = null));
    return uploaded.current;
  };

  const shareSource: ShareSource = {
    title: info.title,
    cols: grid.cols,
    rows: grid.rows,
    rotation,
    ownPhoto: target.kind === 'local',
    resolveImage: imageRef,
  };

  const remember = () => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ preset, custom, rotation, capacity } satisfies LastSetup));
    } catch {
      // ignore
    }
  };

  const startSolo = async () => {
    setBusy('solo');
    setError(null);
    remember();
    try {
      const id = newGameId();
      let image: SavedImage;
      if (target.kind === 'catalog') image = { kind: 'catalog', id: target.id };
      else {
        const key = `img_${id}`;
        await saveImage(key, target.upload.blob);
        image = { kind: 'local', key, thumbnail: target.upload.thumbnail };
      }
      const spec: PuzzleSpec = { seed: randomSeed(), cols: grid.cols, rows: grid.rows, width: info.width, height: info.height, rotation };
      const now = Date.now();
      const game: SavedGame = {
        version: 1,
        id,
        title: info.title,
        image,
        spec,
        groups: [],
        elapsedMs: 0,
        moves: 0,
        connected: 0,
        total: count,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      await saveGame(game);
      void pruneGames();
      track('solo_start', puzzleLabel(image.kind === 'catalog' ? image : { kind: 'photo' }));
      onDone();
      navigate(`/play/${id}`);
    } catch {
      setError('Could not start the puzzle. Please try again.');
      setBusy(null);
    }
  };

  const startRoom = async () => {
    setBusy('room');
    setError(null);
    remember();
    try {
      const image = await imageRef();
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      const room = await createRoom({ image, pieces: count, rotation, capacity, aspect });
      try {
        sessionStorage.setItem(hostKeyStorageKey(room.code), JSON.stringify(room.hostKey));
      } catch {
        // Without storage the first player to join still becomes host.
      }
      onDone();
      navigate(`/room/${room.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the room. Please try again.');
      setBusy(null);
    }
  };

  const startUpdate = async () => {
    if (!roomActions) {
      setError('You are no longer connected to the room.');
      return;
    }
    setBusy('update');
    setError(null);
    remember();
    try {
      const image = await imageRef();
      roomActions.newPuzzle({ image, pieces: count, rotation, aspect: window.innerWidth / Math.max(1, window.innerHeight) });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the new puzzle. Please try again.');
      setBusy(null);
    }
  };

  const portrait = info.height > info.width;

  return (
    <div className={portrait ? 'setup setup--portrait' : 'setup'}>
      <figure className="setup__preview" style={{ backgroundColor: info.color, backgroundImage: `url(${info.blur})`, aspectRatio: `${info.width} / ${info.height}` }}>
        <img src={info.src} alt={`Preview of ${info.title}`} className={imgLoaded ? 'is-loaded' : undefined} onLoad={() => setImgLoaded(true)} />
        {info.credit && <figcaption>{info.credit}</figcaption>}
      </figure>

      <div className="setup__options">
        <div className="setup__group">
          <div className="setup__label-row">
            <span className="setup__label" id="difficulty-label">
              Difficulty
            </span>
            <span className="setup__value tabular">
              {count} pieces · {grid.cols} × {grid.rows}
            </span>
          </div>
          <div className="difficulty-grid" role="radiogroup" aria-labelledby="difficulty-label">
            {presets.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={preset === p.id}
                className="difficulty-option"
                disabled={!p.available}
                title={p.available ? p.description : 'This image is not detailed enough for that many pieces'}
                onClick={() => setPreset(p.id)}
              >
                <span className="difficulty-option__label">{p.label}</span>
                <span className="difficulty-option__count tabular">{p.available ? p.count : '—'}</span>
              </button>
            ))}
            <button role="radio" aria-checked={preset === 'custom'} className="difficulty-option" onClick={() => setPreset('custom')}>
              <span className="difficulty-option__label">Custom</span>
              <span className="difficulty-option__count tabular">{preset === 'custom' ? count : '…'}</span>
            </button>
          </div>
          {preset === 'custom' && (
            <div className="setup__slider">
              <Slider
                label="Number of pieces"
                value={custom}
                min={MIN_PIECES}
                max={maxPieces}
                step={1}
                onValueChange={setCustom}
                valueText={`${count} pieces`}
              />
              <div className="setup__slider-scale tabular" aria-hidden="true">
                <span>{MIN_PIECES}</span>
                <span>{maxPieces}</span>
              </div>
            </div>
          )}
          {maxPieces < 1000 && (
            <p className="setup__note">This image supports up to {maxPieces} pieces at full sharpness.</p>
          )}
        </div>

        <label className="setup__toggle">
          <span className="setup__toggle-icon" aria-hidden="true">
            <RotateCw />
          </span>
          <span className="setup__toggle-text">
            <span className="setup__label">Rotating pieces</span>
            <span className="setup__hint">Pieces start turned. Rotate with right-click, double-tap or R.</span>
          </span>
          <Switch checked={rotation} onCheckedChange={setRotation} label="Rotating pieces" />
        </label>

        {mode === 'room' && (
          <div className="setup__group">
            <div className="setup__label-row">
              <span className="setup__label">Room size</span>
              <span className="setup__value tabular">Up to {capacity} players</span>
            </div>
            <Slider label="Maximum players" value={capacity} min={MIN_ROOM_CAPACITY} max={MAX_ROOM_CAPACITY} step={1} onValueChange={setCapacity} valueText={`${capacity} players`} />
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="setup__actions">
          {mode === 'solo' ? (
            <>
              <Button variant="primary" size="lg" block loading={busy === 'solo'} disabled={busy !== null} onClick={() => void startSolo()}>
                Start puzzle
              </Button>
              <Button size="lg" block loading={busy === 'room'} disabled={busy !== null} onClick={() => void startRoom()}>
                <Users />
                Play with friends
              </Button>
              <Button variant="ghost" block disabled={busy !== null} onClick={() => setShareOpen(true)}>
                <Gift />
                Send to a friend
              </Button>
            </>
          ) : mode === 'room' ? (
            <Button variant="primary" size="lg" block loading={busy === 'room'} disabled={busy !== null} onClick={() => void startRoom()}>
              <Users />
              Create room
            </Button>
          ) : (
            <Button variant="primary" size="lg" block loading={busy === 'update'} disabled={busy !== null} onClick={() => void startUpdate()}>
              Start new puzzle for everyone
            </Button>
          )}
        </div>
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} source={shareSource} />
        {target.kind === 'local' && (
          <p className="setup__note">
            {mode === 'solo' ? 'Solo puzzles keep your photo on this device. ' : ''}
            Playing with friends uploads it so others can see it; it is deleted automatically within 48 hours after the room closes.
          </p>
        )}
      </div>
    </div>
  );
}
