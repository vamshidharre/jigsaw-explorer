import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Popover } from 'radix-ui';
import { Check, Copy, Crown, ImagePlus, LogOut, Share2, UserPlus, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { CATALOG, CATEGORIES, catalogThumbUrl } from '../../../shared/catalog';
import { MAX_NAME_LENGTH, MAX_ROOM_CAPACITY, sanitizeName } from '../../../shared/protocol';
import { Button, Spinner } from '../../components/ui/Button';
import { Slider } from '../../components/ui/Controls';
import { Dialog } from '../../components/ui/Dialog';
import { useUi } from '../../app/uiStore';
import { initials } from '../../lib/format';
import { ImageLoadError, processUpload } from '../../lib/images';
import { useSettings } from '../settings/settingsStore';
import { inviteLink, useRoom } from './roomStore';

export function Avatar({ name, color, size = 32, title }: { name: string; color: string; size?: number; title?: string }) {
  return (
    <span className="avatar" title={title} style={{ ['--avatar-color' as string]: color, ['--avatar-size' as string]: `${size}px` }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without async clipboard permission.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const code = useRoom((s) => s.code) ?? '';
  const room = useRoom((s) => s.room);
  const players = useRoom((s) => s.players);
  const link = inviteLink(code);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (what: 'link' | 'code') => {
    if (await copyText(what === 'link' ? link : code)) {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } else {
      toast.error('Copying is not available here. Select the text and copy it manually.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite players" description="Anyone with the link or code can join this room." width={440} mobileSheet>
      <div className="invite">
        <div className="invite__code" aria-label={`Room code ${code.split('').join(' ')}`}>
          {code.split('').map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </div>
        <div className="invite__link">
          <input className="input" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="primary" onClick={() => void copy('link')}>
            {copied === 'link' ? <Check /> : <Copy />}
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <div className="invite__actions">
          <Button variant="ghost" size="sm" onClick={() => void copy('code')}>
            {copied === 'code' ? <Check /> : <Copy />}
            {copied === 'code' ? 'Code copied' : 'Copy code only'}
          </Button>
          {canShare && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigator.share({ title: 'Join my jigsaw puzzle', text: 'Solve this puzzle with me!', url: link }).catch(() => undefined)}
            >
              <Share2 />
              Share…
            </Button>
          )}
        </div>
        {room && (
          <p className="invite__note">
            {players.length} of {room.capacity} seats taken.
          </p>
        )}
        <span className="visually-hidden" aria-live="polite">
          {copied ? 'Copied to clipboard' : ''}
        </span>
      </div>
    </Dialog>
  );
}

const STATUS_TEXT: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
  failed: 'Disconnected',
  closed: 'Disconnected',
};

export function PlayersButton({ onInvite }: { onInvite(): void }) {
  const players = useRoom((s) => s.players);
  const selfId = useRoom((s) => s.selfId);
  const room = useRoom((s) => s.room);
  const status = useRoom((s) => s.status);
  const latency = useRoom((s) => s.latency);
  const actions = useRoom((s) => s.actions);
  const isHost = !!selfId && room?.hostId === selfId;
  const online = players.filter((p) => p.online);
  const shown = online.slice(0, 3);
  const [capacity, setCapacity] = useState(room?.capacity ?? 8);

  useEffect(() => {
    if (room) setCapacity(room.capacity);
  }, [room]);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="players-trigger" aria-label={`${online.length} ${online.length === 1 ? 'player' : 'players'} online. Show players`}>
          <span className={`conn-dot conn-dot--${status}`} aria-hidden="true" />
          <span className="players-trigger__stack" aria-hidden="true">
            {shown.map((p) => (
              <Avatar key={p.id} name={p.name} color={p.color} size={26} />
            ))}
            {online.length > shown.length && <span className="players-trigger__more">+{online.length - shown.length}</span>}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover players-panel" align="end" sideOffset={10} collisionPadding={12}>
          <div className="players-panel__head">
            <div>
              <h2>Room {room?.code}</h2>
              <p className={`players-panel__status players-panel__status--${status}`}>
                <span className={`conn-dot conn-dot--${status}`} aria-hidden="true" />
                {STATUS_TEXT[status]}
                {status === 'connected' && latency !== null && <span className="tabular"> · {latency} ms</span>}
              </p>
            </div>
            <Button size="sm" variant="primary" onClick={onInvite}>
              <UserPlus />
              Invite
            </Button>
          </div>
          <ul className="players-list" aria-label="Players">
            {players.map((p) => (
              <li key={p.id} className={p.online ? 'players-list__item' : 'players-list__item is-offline'}>
                <Avatar name={p.name} color={p.color} size={30} />
                <span className="players-list__name">
                  <span>
                    {p.name}
                    {p.id === selfId && <span className="players-list__you"> (you)</span>}
                  </span>
                  <span className="players-list__meta">
                    {!p.online ? 'Reconnecting…' : p.idle ? 'Away' : 'Playing'}
                    {p.placed > 0 && ` · ${p.placed} placed`}
                  </span>
                </span>
                {p.isHost && (
                  <span className="players-list__host" title="Host">
                    <Crown aria-hidden="true" />
                    <span className="visually-hidden">Host</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isHost && room && (
            <div className="players-panel__capacity">
              <div className="setup__label-row">
                <span className="setup__label">Room size</span>
                <span className="setup__value tabular">{capacity} players</span>
              </div>
              <Slider
                label="Maximum players"
                value={capacity}
                min={Math.max(2, players.length)}
                max={MAX_ROOM_CAPACITY}
                step={1}
                onValueChange={setCapacity}
                valueText={`${capacity} players`}
              />
              {capacity !== room.capacity && (
                <Button size="sm" onClick={() => actions?.setCapacity(capacity)}>
                  Save room size
                </Button>
              )}
            </div>
          )}
          <div className="players-panel__foot">
            <Button size="sm" variant="danger" onClick={() => actions?.leave()}>
              <LogOut />
              Leave room
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ConnectionBanner() {
  const status = useRoom((s) => s.status);
  const attempt = useRoom((s) => s.attempt);
  const actions = useRoom((s) => s.actions);
  const [visible, setVisible] = useState(false);

  // Avoid flashing the banner for very short blips.
  useEffect(() => {
    if (status === 'reconnecting' || status === 'offline') {
      const t = window.setTimeout(() => setVisible(true), status === 'offline' ? 0 : 700);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [status]);

  if (!visible) return null;
  return (
    <div className={`conn-banner conn-banner--${status}`} role="status" aria-live="polite">
      {status === 'offline' ? <WifiOff aria-hidden="true" /> : <Spinner size={16} />}
      <span>
        {status === 'offline'
          ? "You're offline. Moves are paused until you reconnect."
          : `Connection lost. Reconnecting${attempt > 2 ? ` (attempt ${attempt})` : ''}… Your progress is safe.`}
      </span>
      {status === 'offline' && (
        <Button size="sm" onClick={() => actions?.retry()}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Asks for a display name before joining a room. */
export function NameDialog({ open, onDone }: { open: boolean; onDone(name: string): void }) {
  const saved = useSettings((s) => s.playerName);
  const set = useSettings((s) => s.set);
  const [name, setName] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = sanitizeName(name);
    if (!clean) {
      setError('Please enter a name.');
      return;
    }
    set('playerName', clean);
    onDone(clean);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={() => undefined}
      title="What should we call you?"
      description="Other players will see this name next to your cursor."
      width={400}
      dismissible={false}
      initialFocus={() => inputRef.current}
    >
      <form onSubmit={submit} className="name-form" noValidate>
        <label className="visually-hidden" htmlFor="name-input">
          Your name
        </label>
        <input
          ref={inputRef}
          id="name-input"
          className="input"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="nickname"
          placeholder="Your name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'name-error' : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p className="field__error" id="name-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block>
          Join room
        </Button>
      </form>
    </Dialog>
  );
}

/** Lets the host pick a picture for the room's next puzzle. */
export function PuzzlePickerDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const openSetup = useUi((s) => s.openSetup);
  const [category, setCategory] = useState<string>('all');
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const images = category === 'all' ? CATALOG : CATALOG.filter((i) => i.category === category);

  const pick = (id: string) => {
    onOpenChange(false);
    openSetup({ kind: 'catalog', id }, 'update');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setProcessing(true);
    try {
      const upload = await processUpload(file);
      onOpenChange(false);
      openSetup({ kind: 'local', upload }, 'update');
    } catch (err) {
      toast.error(err instanceof ImageLoadError ? err.message : 'That image could not be used.');
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New puzzle for the room" description="Everyone in the room will switch to the new puzzle." width={760} mobileSheet>
      <div className="chips" role="group" aria-label="Filter by category">
        {[{ id: 'all', label: 'All' }, ...CATEGORIES].map((c) => (
          <button key={c.id} className="chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="picker-grid">
        <button className="picker-tile picker-tile--upload" onClick={() => fileRef.current?.click()} disabled={processing}>
          {processing ? <Spinner size={20} label="Processing image" /> : <ImagePlus />}
          <span>Your photo</span>
        </button>
        {images.map((img) => (
          <button key={img.id} className="picker-tile" onClick={() => pick(img.id)} style={{ backgroundColor: img.color }} aria-label={img.title}>
            <img src={catalogThumbUrl(img.id)} alt="" loading="lazy" />
            <span>{img.title}</span>
          </button>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e.target.files?.[0])} />
    </Dialog>
  );
}
