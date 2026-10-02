import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Grid2x2Plus, Keyboard, LogOut, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { getCatalogImage } from '../../../shared/catalog';
import {
  fromWire,
  imageRefUrl,
  isValidRoomCode,
  normalizeRoomCode,
  toWire,
  type ClockInfo,
  type PuzzleInfo,
  type RoomEvent,
  type ServerMessage,
  type WelcomeMessage,
  type WireGroup,
} from '../../../shared/protocol';
import { PuzzleModel } from '../../../shared/puzzle/model';
import { difficultyLabel } from '../../../shared/puzzle/spec';
import { Button } from '../../components/ui/Button';
import { StateScreen } from '../../components/layout/PageLoader';
import { useUi } from '../../app/uiStore';
import type { GameEngine, NetworkLink } from '../../engine/GameEngine';
import { formatDuration } from '../../lib/format';
import { ImageLoadError, loadImage } from '../../lib/images';
import { sound } from '../../lib/sound';
import { RoomConnection, type ConnectionStatus } from '../../net/RoomConnection';
import { CompletionCard } from '../game/CompletionCard';
import { GameView, type EngineSetup, type TimerSource } from '../game/GameView';
import { useSettings } from '../settings/settingsStore';
import { useRoom } from './roomStore';
import { ConnectionBanner, InviteDialog, NameDialog, PlayersButton, PuzzlePickerDialog } from './RoomUi';

export default function RoomPage() {
  const { code: raw = '' } = useParams();
  const code = normalizeRoomCode(raw);
  const playerName = useSettings((s) => s.playerName);
  const [name, setName] = useState<string | null>(playerName || null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `Room ${code} — Jigsaw Explorer`;
  }, [code]);

  if (!isValidRoomCode(code)) {
    return (
      <StateScreen
        title="That room link isn't valid"
        tone="error"
        actions={
          <>
            <Button variant="primary" onClick={() => navigate('/multiplayer')}>
              Enter a room code
            </Button>
            <Link className="btn" to="/">
              Home
            </Link>
          </>
        }
      >
        <p>Room codes are 6 letters and numbers. Check the link you were sent and try again.</p>
      </StateScreen>
    );
  }

  if (!name) {
    return (
      <div className="room-gate table-slate">
        <NameDialog open onDone={setName} />
      </div>
    );
  }

  return <RoomSession key={code} code={code} name={name} />;
}

interface Pending {
  model: PuzzleModel;
  held: Map<number, string>;
}

function RoomSession({ code, name }: { code: string; name: string }) {
  const navigate = useNavigate();
  const room = useRoom();
  const patch = useRoom((s) => s.patch);
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  const connRef = useRef<RoomConnection | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const puzzleKeyRef = useRef<string | null>(null);
  const loadToken = useRef(0);
  const clockRef = useRef<ClockInfo & { at: number }>({ elapsedMs: 0, running: false, at: performance.now() });
  const [setup, setSetup] = useState<EngineSetup | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showCompletion, setShowCompletion] = useState(true);
  const welcomedOnce = useRef(false);

  const timer = useMemo<TimerSource>(
    () => ({
      elapsed: () => {
        const c = clockRef.current;
        return c.elapsedMs + (c.running ? performance.now() - c.at : 0);
      },
    }),
    [],
  );

  const network = useMemo<NetworkLink>(
    () => ({
      get selfId() {
        return connRef.current?.selfId ?? '';
      },
      send: (msg) => {
        connRef.current?.send(msg);
      },
    }),
    [],
  );

  const setClock = (clock: ClockInfo) => {
    clockRef.current = { ...clock, at: performance.now() };
  };

  const preparePuzzle = useCallback(
    async (puzzle: PuzzleInfo, groups: WireGroup[], held: Array<[number, string]>, completed: boolean) => {
      const key = `${code}:${puzzle.spec.seed}:${puzzle.image.kind}:${puzzle.image.id}`;
      pendingRef.current = { model: new PuzzleModel(puzzle.spec, groups.map(fromWire)), held: new Map(held) };
      if (puzzleKeyRef.current === key) {
        // Same puzzle (e.g. after reconnecting): just resynchronise the state.
        engineRef.current?.applySnapshot(groups, held);
        return;
      }
      puzzleKeyRef.current = key;
      const token = ++loadToken.current;
      setSetup(null);
      setImageError(null);
      try {
        const image = await loadImage(imageRefUrl(puzzle.image));
        if (token !== loadToken.current) return;
        setSetup({ key, spec: puzzle.spec, groups: pendingRef.current.model.snapshot(), image, network, completed });
      } catch (err) {
        if (token !== loadToken.current) return;
        puzzleKeyRef.current = null;
        setImageError(err instanceof ImageLoadError ? err.message : 'The puzzle image could not be loaded.');
      }
    },
    [code, network],
  );

  const retryImage = useCallback(() => {
    const st = useRoom.getState();
    const pending = pendingRef.current;
    if (!st.puzzle || !pending) return;
    void preparePuzzle(
      st.puzzle,
      pending.model.snapshot().map(toWire),
      Array.from(pending.held),
      st.completion !== null,
    );
  }, [preparePuzzle]);

  // Connection lifecycle.
  useEffect(() => {
    useRoom.getState().reset(code);
    const applyToPending = (msg: ServerMessage) => {
      const p = pendingRef.current;
      if (!p) return;
      if (msg.t === 'held') p.held.set(msg.g, msg.by);
      else if (msg.t === 'update') {
        for (const g of msg.groups) p.held.delete(g.i);
        try {
          p.model.applyChanges(msg.groups.map(fromWire), msg.removed);
        } catch {
          // A full snapshot arrives on the next reconnect if anything is off.
        }
      } else if (msg.t === 'tick' && msg.m) {
        for (const [g, x, y, r] of msg.m) {
          const group = p.model.groups.get(g);
          if (group) Object.assign(group, { x, y, rot: r });
        }
      }
    };

    const describe = (e: RoomEvent, self: string | null) => {
      const you = e.playerId === self;
      switch (e.kind) {
        case 'joined':
          sound.play('join');
          return `${e.name} joined`;
        case 'rejoined':
          return `${e.name} is back`;
        case 'left':
          return `${e.name} left`;
        case 'host':
          return you ? 'You are now the host' : `${e.name} is now the host`;
        case 'scatter':
          return `${e.name} shuffled the loose pieces`;
        case 'newPuzzle':
          return `${e.name} started a new puzzle`;
        default:
          return null;
      }
    };

    const conn = new RoomConnection(code, name, {
      onWelcome: (msg: WelcomeMessage, resumed) => {
        setClock(msg.clock);
        patch({ selfId: msg.you.id, room: msg.room, players: msg.players, puzzle: msg.puzzle, completion: msg.completion, error: null });
        if (msg.completion) setShowCompletion(true);
        engineRef.current?.setPlayers(msg.players);
        void preparePuzzle(msg.puzzle, msg.groups, msg.held, msg.completion !== null);
        if (resumed && welcomedOnce.current) toast.success('Reconnected', { id: 'conn', duration: 1600 });
        welcomedOnce.current = true;
      },
      onMessage: (msg) => {
        const engine = engineRef.current;
        switch (msg.t) {
          case 'players':
            patch({ players: msg.players });
            engine?.setPlayers(msg.players);
            return;
          case 'room':
            patch({ room: msg.room });
            return;
          case 'event': {
            if (msg.event.kind === 'disconnected') return;
            const text = describe(msg.event, conn.selfId);
            if (text) toast(text, { duration: 2400 });
            return;
          }
          case 'clock':
            setClock(msg.clock);
            return;
          case 'complete':
            patch({ completion: msg.completion });
            setShowCompletion(true);
            engine?.handleServerMessage(msg);
            return;
          case 'puzzle':
            setClock(msg.clock);
            patch({ puzzle: msg.puzzle, completion: null });
            setShowCompletion(true);
            void preparePuzzle(msg.puzzle, msg.groups, [], false);
            return;
          case 'error':
            toast.error(msg.message);
            return;
          case 'held':
          case 'denied':
          case 'tick':
          case 'update':
            if (engine) engine.handleServerMessage(msg);
            else applyToPending(msg);
            if (msg.t === 'update' && pendingRef.current && engine) {
              // Keep the pending copy roughly current too, for image retries.
              try {
                pendingRef.current.model.applyChanges(msg.groups.map(fromWire), msg.removed);
              } catch {
                // ignore
              }
            }
            return;
          default:
            return;
        }
      },
      onStatus: (status: ConnectionStatus, detail) => {
        patch({ status, attempt: detail?.attempt ?? 0, ...(status === 'failed' ? { error: { code: detail?.code, message: detail?.message } } : {}) });
      },
      onLatency: (ms) => patch({ latency: ms }),
    });
    connRef.current = conn;
    patch({
      actions: {
        setCapacity: (max) => conn.send({ t: 'capacity', max }),
        newPuzzle: (req) => {
          if (!conn.send({ t: 'newPuzzle', puzzle: req })) toast.error('You are not connected right now.');
        },
        leave: () => {
          conn.leave();
          toast('You left the room');
          navigate('/multiplayer');
        },
        retry: () => conn.retry(),
      },
    });
    conn.connect();
    return () => {
      // Navigating away inside the app leaves the room; a refresh or closed tab keeps the seat
      // for the reconnect grace period because this cleanup never runs then.
      conn.leave();
      connRef.current = null;
      loadToken.current++;
      useRoom.getState().reset(null);
    };
  }, [code, name, patch, preparePuzzle, navigate]);

  // Keep the server informed about name changes made in settings.
  const currentName = useSettings((s) => s.playerName);
  useEffect(() => {
    if (currentName && currentName !== name) connRef.current?.setName(currentName);
  }, [currentName, name]);

  const onEngine = useCallback((engine: GameEngine | null) => {
    engineRef.current = engine;
    if (!engine) return;
    const st = useRoom.getState();
    engine.setPlayers(st.players);
    const pending = pendingRef.current;
    // Catch up on anything that changed while the pieces were being prepared.
    if (pending) engine.applySnapshot(pending.model.snapshot().map(toWire), Array.from(pending.held));
  }, []);

  // ---------------------------------------------------------------- render
  if (room.status === 'failed' && room.error) return <RoomError code={room.error.code} message={room.error.message} />;

  const puzzle = room.puzzle;
  const isHost = !!room.selfId && room.room?.hostId === room.selfId;
  const pieces = puzzle ? puzzle.spec.cols * puzzle.spec.rows : 0;
  const title = puzzle ? (puzzle.image.kind === 'catalog' ? (getCatalogImage(puzzle.image.id)?.title ?? puzzle.title) : puzzle.title) : `Room ${code}`;
  const connected = room.status === 'connected';
  const completion = room.completion;

  return (
    <>
      <GameView
        setup={setup}
        loadingLabel={puzzle ? 'Loading image…' : room.status === 'reconnecting' ? 'Reconnecting…' : 'Joining room…'}
        loadError={imageError ? { message: imageError, retry: retryImage } : null}
        title={title}
        subtitle={puzzle ? `Room ${code} · ${pieces} pieces · ${difficultyLabel(pieces)}${puzzle.spec.rotation ? ' · Rotation' : ''}` : `Room ${code}`}
        imageUrl={puzzle ? imageRefUrl(puzzle.image) : ''}
        backTo={{ href: '/multiplayer', label: 'Back to multiplayer' }}
        timer={timer}
        interactive={connected}
        completed={completion !== null}
        onEngine={onEngine}
        topRight={
          <>
            <PlayersButton onInvite={() => setInviteOpen(true)} />
            <Button variant="primary" size="sm" className="invite-btn" onClick={() => setInviteOpen(true)}>
              <UserPlus />
              <span className="invite-btn__label">Invite</span>
            </Button>
          </>
        }
        banner={<ConnectionBanner />}
        menu={[
          { label: 'Invite players', icon: <UserPlus />, onSelect: () => setInviteOpen(true) },
          ...(isHost ? [{ label: 'New puzzle for everyone', icon: <Grid2x2Plus />, onSelect: () => setPickerOpen(true) }] : []),
          { label: 'Controls & shortcuts', icon: <Keyboard />, onSelect: () => setHelpOpen(true), shortcut: '?' },
          { label: '-', onSelect: () => undefined },
          { label: 'Leave room', icon: <LogOut />, danger: true, onSelect: () => room.actions?.leave() },
        ]}
        overlay={
          completion && showCompletion ? (
            <CompletionCard
              title="Solved together!"
              subtitle={`${title} · ${pieces} pieces`}
              onDismiss={() => setShowCompletion(false)}
              stats={[
                { label: 'Time', value: formatDuration(completion.elapsedMs) },
                { label: 'Players', value: String(completion.contributions.length) },
                { label: 'Pieces', value: String(pieces) },
              ]}
              players={completion.contributions.map((c) => ({ id: c.playerId, name: c.name, color: c.color, placed: c.placed, self: c.playerId === room.selfId }))}
              actions={
                isHost ? (
                  <>
                    <Button variant="primary" onClick={() => setPickerOpen(true)}>
                      New puzzle for everyone
                    </Button>
                    <Button onClick={() => room.actions?.leave()}>Leave room</Button>
                  </>
                ) : (
                  <>
                    <p className="completion__waiting">Waiting for the host to start a new puzzle…</p>
                    <Button onClick={() => room.actions?.leave()}>Leave room</Button>
                  </>
                )
              }
            />
          ) : null
        }
      />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <PuzzlePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </>
  );
}

function RoomError({ code, message }: { code?: string; message?: string }) {
  const navigate = useNavigate();
  const content: Record<string, { title: string; body: string }> = {
    ROOM_NOT_FOUND: { title: 'Room not found', body: 'This room does not exist or has expired. Rooms close after a while once everyone has left.' },
    ROOM_FULL: { title: 'This room is full', body: message ?? 'All seats are taken. Ask the host to make room, or start your own room.' },
    VERSION_MISMATCH: { title: 'A new version is available', body: 'Reload the page to get the latest version and join the room.' },
    REPLACED: { title: 'Opened in another tab', body: 'You joined this room from another tab, so this one was disconnected.' },
  };
  const c = content[code ?? ''] ?? { title: 'Could not join the room', body: message ?? 'Something went wrong while connecting.' };
  return (
    <StateScreen
      tone="error"
      title={c.title}
      actions={
        code === 'VERSION_MISMATCH' || code === 'REPLACED' ? (
          <Button variant="primary" onClick={() => window.location.reload()}>
            {code === 'REPLACED' ? 'Play in this tab' : 'Reload'}
          </Button>
        ) : (
          <>
            <Button variant="primary" onClick={() => navigate('/puzzles?mode=room')}>
              Create a new room
            </Button>
            <Button onClick={() => navigate('/multiplayer')}>Join another room</Button>
          </>
        )
      }
    >
      <p>{c.body}</p>
    </StateScreen>
  );
}
