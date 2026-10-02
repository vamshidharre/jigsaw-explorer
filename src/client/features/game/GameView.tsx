import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { DropdownMenu, Popover } from 'radix-ui';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Frame,
  Image as ImageIcon,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Scan,
  Settings,
  Shuffle,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { GroupState } from '../../../shared/puzzle/model';
import type { PuzzleSpec } from '../../../shared/puzzle/spec';
import { GameEngine, type EngineEvents, type NetworkLink } from '../../engine/GameEngine';
import { Button, IconButton } from '../../components/ui/Button';
import { Slider, Switch } from '../../components/ui/Controls';
import { StateScreen } from '../../components/layout/PageLoader';
import { announce } from '../../app/announcer';
import { useUi } from '../../app/uiStore';
import { formatDuration } from '../../lib/format';
import type { LoadedImage } from '../../lib/images';
import { sound } from '../../lib/sound';
import { useSettings } from '../settings/settingsStore';
import { useEngineSettings } from './useEngineSettings';

export interface EngineSetup {
  /** Changing the key rebuilds the engine (new puzzle). */
  key: string;
  spec: PuzzleSpec;
  groups: GroupState[] | null;
  image: LoadedImage;
  network?: NetworkLink;
  completed?: boolean;
}

export interface TimerSource {
  elapsed(): number;
}

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  onSelect(): void;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
}

interface GameViewProps {
  setup: EngineSetup | null;
  loadingLabel: string;
  loadError?: { message: string; retry?: () => void } | null;
  title: string;
  subtitle: string;
  imageUrl: string;
  backTo: { href: string; label: string };
  timer: TimerSource;
  interactive: boolean;
  completed: boolean;
  onEngine(engine: GameEngine | null): void;
  events?: Partial<EngineEvents>;
  topRight?: ReactNode;
  menu: MenuAction[];
  pause?: { paused: boolean; toggle(): void };
  overlay?: ReactNode;
  banner?: ReactNode;
}

type BuildState = { state: 'idle' } | { state: 'building'; progress: number } | { state: 'ready' } | { state: 'error'; message: string };

export function GameView(props: GameViewProps) {
  const { setup, onEngine } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [build, setBuild] = useState<BuildState>({ state: 'idle' });
  const [progress, setProgress] = useState({ connected: 0, total: 0 });
  const [edgesOnly, setEdgesOnly] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [buildAttempt, setBuildAttempt] = useState(0);
  const engineSettings = useEngineSettings(edgesOnly);
  const settingsRef = useRef(engineSettings);
  settingsRef.current = engineSettings;
  const eventsRef = useRef(props.events);
  eventsRef.current = props.events;
  const tableClass = `table-${useSettings((s) => s.table)}`;

  const overlayWrapRef = useRef<HTMLDivElement>(null);
  const insets = useCallback(() => {
    const top = topRef.current?.getBoundingClientRect().height ?? 0;
    const bottom = bottomRef.current?.getBoundingClientRect().height ?? 0;
    // Cards anchored to the bottom (e.g. the completion summary) also take space away from the view.
    let card = 0;
    overlayWrapRef.current?.querySelectorAll<HTMLElement>('[data-bottom-card]').forEach((el) => {
      card = Math.max(card, window.innerHeight - el.getBoundingClientRect().top);
    });
    return { top: top + 8, bottom: Math.max(bottom + 16, card + 12) };
  }, []);

  // Build (and tear down) the engine whenever the puzzle changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!setup || !canvas || !overlay) return;
    const abort = new AbortController();
    let engine: GameEngine | null = null;
    let lastReport = 0;
    setBuild({ state: 'building', progress: 0 });
    const ev = (): Partial<EngineEvents> => eventsRef.current ?? {};
    GameEngine.create({
      canvas,
      overlay,
      spec: setup.spec,
      groups: setup.groups,
      image: setup.image.source,
      imageWidth: setup.image.width,
      imageHeight: setup.image.height,
      settings: settingsRef.current,
      network: setup.network,
      completed: setup.completed,
      insets: insets(),
      signal: abort.signal,
      onProgress: (p) => {
        const now = performance.now();
        if (now - lastReport > 80 || p === 1) {
          lastReport = now;
          setBuild({ state: 'building', progress: p });
        }
      },
      events: {
        progress: (connected, total) => {
          setProgress({ connected, total });
          ev().progress?.(connected, total);
        },
        snap: (info) => {
          if (info.mine) sound.play(info.kind === 'board' ? 'place' : 'snap');
          if (info.mine) announce(`Connected. ${info.connected} of ${info.total} pieces in place.`);
          ev().snap?.(info);
        },
        pickup: () => {
          sound.play('pickup');
          ev().pickup?.();
        },
        complete: (local) => {
          sound.play('complete');
          announce('Puzzle complete!', true);
          ev().complete?.(local);
        },
        firstInteraction: () => ev().firstInteraction?.(),
        changed: () => ev().changed?.(),
        zoom: (percent) => {
          if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${percent}%`;
          ev().zoom?.(percent);
        },
        announce: (m) => announce(m),
        notice: (m) => {
          toast(m, { id: 'notice', duration: 1800 });
          ev().notice?.(m);
        },
      },
    })
      .then((e) => {
        if (abort.signal.aborted) {
          e.destroy();
          return;
        }
        engine = e;
        engineRef.current = e;
        exposeForTests(e);
        onEngine(e);
        setBuild({ state: 'ready' });
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        console.error(err);
        setBuild({
          state: 'error',
          message: 'Your browser could not prepare this puzzle. It may be too large for this device — try fewer pieces or close other tabs.',
        });
      });
    return () => {
      abort.abort();
      if (engine) {
        engine.destroy();
        engineRef.current = null;
        onEngine(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup?.key, buildAttempt]);

  useEffect(() => {
    engineRef.current?.updateSettings(engineSettings);
  }, [engineSettings, build.state]);

  useEffect(() => {
    engineRef.current?.setInteractive(props.interactive);
  }, [props.interactive, build.state]);

  useLayoutEffect(() => {
    const update = () => engineRef.current?.setInsets(insets());
    update();
    const ro = new ResizeObserver(update);
    if (topRef.current) ro.observe(topRef.current);
    if (bottomRef.current) ro.observe(bottomRef.current);
    overlayWrapRef.current?.querySelectorAll('[data-bottom-card]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [insets, build.state, props.overlay]);

  // Global shortcuts while the game screen is shown.
  const settings = useSettings();
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const fullscreen = useFullscreen();
  const pause = props.pause;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
      const engine = engineRef.current;
      switch (e.key) {
        case '+':
        case '=':
          engine?.zoomBy(1.25);
          break;
        case '-':
        case '_':
          engine?.zoomBy(0.8);
          break;
        case '0':
          engine?.fitView();
          break;
        case 'b':
          engine?.fitBoard();
          break;
        case 'e':
          setEdgesOnly((v) => !v);
          break;
        case 'g':
          settings.set('guide', !settings.guide);
          break;
        case 'i':
          setShowReference((v) => !v);
          break;
        case 'f':
          if (fullscreen.supported) fullscreen.toggle();
          break;
        case 'S':
          engine?.scatter();
          break;
        case 'p':
          pause?.toggle();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings, fullscreen, pause]);

  useEffect(() => {
    if (edgesOnly) announce('Showing edge pieces only');
  }, [edgesOnly]);

  const pct = progress.total ? Math.round((progress.connected / progress.total) * 100) : 0;
  const building = build.state === 'building' || (build.state === 'idle' && !props.loadError);

  return (
    <div className={`game ${tableClass}`}>
      <div className="game__stage">
        <canvas
          ref={canvasRef}
          className="game__canvas"
          tabIndex={0}
          role="application"
          aria-roledescription="jigsaw puzzle board"
          aria-label={`${props.title} puzzle board`}
          aria-describedby="board-instructions"
        />
        <div ref={overlayRef} className="game__overlay" aria-hidden="true" />
        <p id="board-instructions" className="visually-hidden">
          Drag pieces with the mouse or your finger. With the keyboard, press N to select the next piece, Enter to pick it up or drop it,
          arrow keys to move it, R to rotate and Escape to cancel. Press question mark for all shortcuts.
        </p>
      </div>

      <header ref={topRef} className="game-top">
        <div className="game-top__left">
          <Link to={props.backTo.href} className="btn btn--ghost btn--icon game-top__back" aria-label={props.backTo.label}>
            <ArrowLeft />
          </Link>
          <div className="game-top__title">
            <h1>{props.title}</h1>
            <p>{props.subtitle}</p>
          </div>
        </div>

        <div className="game-top__stats">
          {settings.showTimer && <TimerDisplay timer={props.timer} />}
          {settings.showProgress && (
            <div className="stat stat--progress" title={`${progress.connected} of ${progress.total} pieces connected`}>
              <span className="progress progress--inline" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Puzzle progress">
                <span className="progress__bar" style={{ width: `${pct}%` }} />
              </span>
              <span className="stat__value tabular">{pct}%</span>
            </div>
          )}
        </div>

        <div className="game-top__right">
          {props.topRight}
          <IconButton label="Settings" shortcut="," onClick={() => setSettingsOpen(true)}>
            <Settings />
          </IconButton>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button icon variant="ghost" aria-label="More options">
                <MoreHorizontal />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" align="end" sideOffset={8}>
                {props.menu.map((m, i) =>
                  m.label === '-' ? (
                    <DropdownMenu.Separator key={i} className="menu__separator" />
                  ) : (
                    <DropdownMenu.Item key={m.label} className={m.danger ? 'menu__item menu__item--danger' : 'menu__item'} onSelect={m.onSelect} disabled={m.disabled}>
                      {m.icon}
                      {m.label}
                      {m.shortcut && <span className="menu__shortcut">{m.shortcut}</span>}
                    </DropdownMenu.Item>
                  ),
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {props.banner}

      <div ref={bottomRef} className="game-toolbar" role="toolbar" aria-label="Puzzle tools">
        <div className="game-toolbar__group game-toolbar__zoom">
          <IconButton label="Zoom out" shortcut="-" tooltipSide="top" onClick={() => engineRef.current?.zoomBy(0.8)}>
            <Minus />
          </IconButton>
          <button className="game-toolbar__zoom-label tabular" onClick={() => engineRef.current?.fitView()} aria-label="Fit everything in view">
            <span ref={zoomLabelRef}>100%</span>
          </button>
          <IconButton label="Zoom in" shortcut="+" tooltipSide="top" onClick={() => engineRef.current?.zoomBy(1.25)}>
            <Plus />
          </IconButton>
        </div>
        <span className="game-toolbar__divider" aria-hidden="true" />
        <div className="game-toolbar__group">
          <IconButton label="Fit board" shortcut="B" tooltipSide="top" onClick={() => engineRef.current?.fitBoard()}>
            <Scan />
          </IconButton>
          <IconButton
            label={edgesOnly ? 'Show all pieces' : 'Show edge pieces only'}
            shortcut="E"
            tooltipSide="top"
            aria-pressed={edgesOnly}
            className={edgesOnly ? 'is-active' : undefined}
            onClick={() => setEdgesOnly((v) => !v)}
          >
            <Frame />
          </IconButton>
          <GuideControl />
          <IconButton
            label={showReference ? 'Hide reference image' : 'Show reference image'}
            shortcut="I"
            tooltipSide="top"
            aria-pressed={showReference}
            className={showReference ? 'is-active' : undefined}
            onClick={() => setShowReference((v) => !v)}
          >
            <ImageIcon />
          </IconButton>
          <IconButton label="Shuffle loose pieces" shortcut="Shift+S" tooltipSide="top" disabled={props.completed} onClick={() => engineRef.current?.scatter()}>
            <Shuffle />
          </IconButton>
        </div>
        <span className="game-toolbar__divider" aria-hidden="true" />
        <div className="game-toolbar__group">
          {pause && (
            <IconButton label={pause.paused ? 'Resume' : 'Pause'} shortcut="P" tooltipSide="top" disabled={props.completed} onClick={pause.toggle}>
              {pause.paused ? <Play /> : <Pause />}
            </IconButton>
          )}
          {fullscreen.supported && (
            <IconButton label={fullscreen.active ? 'Exit full screen' : 'Full screen'} shortcut="F" tooltipSide="top" onClick={fullscreen.toggle}>
              {fullscreen.active ? <Minimize /> : <Maximize />}
            </IconButton>
          )}
        </div>
      </div>

      {showReference && <ReferencePanel src={props.imageUrl} title={props.title} onClose={() => setShowReference(false)} />}

      {building && (
        <div className="game-loading" role="status" aria-live="polite">
          <div className="game-loading__card">
            <span className="game-loading__label">{build.state === 'building' ? 'Cutting the pieces…' : props.loadingLabel}</span>
            <span className="progress" aria-hidden="true">
              <span className="progress__bar" style={{ width: `${build.state === 'building' ? Math.round(build.progress * 100) : 8}%` }} />
            </span>
          </div>
        </div>
      )}

      {(build.state === 'error' || props.loadError) && (
        <div className="game-error">
          <StateScreen
            tone="error"
            title="This puzzle could not be opened"
            actions={
              <>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (props.loadError?.retry) props.loadError.retry();
                    else setBuildAttempt((n) => n + 1);
                  }}
                >
                  Try again
                </Button>
                <Link className="btn" to={props.backTo.href}>
                  {props.backTo.label}
                </Link>
              </>
            }
          >
            <p>{props.loadError?.message ?? (build.state === 'error' ? build.message : '')}</p>
          </StateScreen>
        </div>
      )}

      <div ref={overlayWrapRef} className="game__cards">
        {build.state === 'ready' && props.overlay}
      </div>
    </div>
  );
}

function TimerDisplay({ timer }: { timer: TimerSource }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let last = '';
    const tick = () => {
      const text = formatDuration(timer.elapsed());
      if (text !== last && ref.current) {
        ref.current.textContent = text;
        last = text;
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => clearInterval(id);
  }, [timer]);
  return (
    <div className="stat" title="Time">
      <span className="stat__value tabular" ref={ref} role="timer" aria-label="Elapsed time">
        0:00
      </span>
    </div>
  );
}

function GuideControl() {
  const guide = useSettings((s) => s.guide);
  const opacity = useSettings((s) => s.guideOpacity);
  const set = useSettings((s) => s.set);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button icon variant="ghost" aria-label="Guide image on the board" className={guide ? 'is-active' : undefined}>
          {guide ? <Eye /> : <EyeOff />}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover guide-popover" side="top" sideOffset={10}>
          <label className="guide-popover__row">
            <span>Show faint picture on the board</span>
            <Switch checked={guide} onCheckedChange={(v) => set('guide', v)} label="Guide image" />
          </label>
          <div className="guide-popover__slider">
            <span>Opacity</span>
            <Slider
              label="Guide image opacity"
              value={Math.round(opacity * 100)}
              min={5}
              max={70}
              step={1}
              disabled={!guide}
              onValueChange={(v) => set('guideOpacity', v / 100)}
              valueText={`${Math.round(opacity * 100)} percent`}
            />
            <span className="tabular">{Math.round(opacity * 100)}%</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ReferencePanel({ src, title, onClose }: { src: string; title: string; onClose(): void }) {
  const [large, setLarge] = useState(false);
  return (
    <aside className={large ? 'reference reference--large' : 'reference'} aria-label="Reference image">
      <button className="reference__image" onClick={() => setLarge((v) => !v)} aria-label={large ? 'Make reference image smaller' : 'Enlarge reference image'}>
        <img src={src} alt={`The finished picture: ${title}`} />
      </button>
      <button className="reference__close" onClick={onClose} aria-label="Close reference image">
        <X size={16} />
      </button>
    </aside>
  );
}

function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const [active, setActive] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => toast.error('Full screen is not available here.'));
  }, []);
  return { supported, active, toggle };
}

/** Automated end-to-end tests read piece positions through this hook (opt-in via localStorage). */
function exposeForTests(engine: GameEngine) {
  try {
    if (import.meta.env.DEV || localStorage.getItem('jigsaw.e2e') === '1') {
      (window as unknown as { __jigsaw?: { engine: GameEngine } }).__jigsaw = { engine };
    }
  } catch {
    // storage unavailable
  }
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}
