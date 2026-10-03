import { useEffect, useId, useState, type FormEvent } from 'react';
import { Check, Copy, Link2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_NAME_LENGTH, MAX_SHARE_MESSAGE, type ImageRef, type ShareChallenge } from '../../../shared/protocol';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { ApiError, createShare } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import { copyText, shareOrCopy } from '../../lib/share';
import { useSettings } from '../settings/settingsStore';

export interface ShareSource {
  title: string;
  cols: number;
  rows: number;
  rotation: boolean;
  /** Keeps the exact cut (challenges); omitted for a fresh random cut. */
  seed?: number;
  challenge?: ShareChallenge;
  /** True when the picture is the player's own photo and has to be uploaded first. */
  ownPhoto: boolean;
  /** Returns the picture reference, uploading the photo if needed. */
  resolveImage(): Promise<ImageRef>;
}

export function shareLink(id: string): string {
  return `${location.origin}/s/${id}`;
}

/** Creates a link to a puzzle (a gift, or a challenge carrying the sender's time) and lets the player copy or share it. */
export function ShareDialog({ open, onOpenChange, source }: { open: boolean; onOpenChange(open: boolean): void; source: ShareSource | null }) {
  const playerName = useSettings((s) => s.playerName);
  const [from, setFrom] = useState(playerName);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const nameId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!open) return;
    setFrom(playerName);
    setMessage('');
    setError(null);
    setLink(null);
    setBusy(false);
    setCopied(false);
  }, [open, playerName]);

  if (!source) return null;
  const challenge = source.challenge;
  const pieces = source.cols * source.rows;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const image = await source.resolveImage();
      const res = await createShare({
        image,
        cols: source.cols,
        rows: source.rows,
        rotation: source.rotation,
        seed: source.seed,
        title: source.title,
        from: from.trim() || undefined,
        message: message.trim() || undefined,
        challenge,
      });
      setLink({ url: shareLink(res.id), expiresAt: res.expiresAt });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the link. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    if (await copyText(link.url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error('Copying is not available here. Select the link and copy it manually.');
    }
  };

  const share = async () => {
    if (!link) return;
    const text = challenge
      ? `I solved this ${pieces}-piece jigsaw in ${formatDuration(challenge.ms)}. Can you beat me?`
      : `I made you a ${pieces}-piece jigsaw puzzle.`;
    const outcome = await shareOrCopy({ title: source.title, text, url: link.url });
    if (outcome === 'copied') toast.success('Link copied');
  };

  const expires = link ? new Date(link.expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : '';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={challenge ? 'Challenge a friend' : 'Send this puzzle'}
      description={
        challenge
          ? `They get the same ${pieces}-piece puzzle, cut exactly the same way, and see your time of ${formatDuration(challenge.ms)}.`
          : `Anyone with the link can play this ${pieces}-piece puzzle — no sign-up needed.`
      }
      width={460}
      mobileSheet
    >
      {link ? (
        <div className="share-result">
          <div className="invite__link">
            <input className="input" readOnly value={link.url} aria-label="Puzzle link" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="primary" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <div className="invite__actions">
            <Button variant="ghost" size="sm" onClick={() => void share()}>
              <Share2 />
              Share…
            </Button>
          </div>
          <p className="invite__note">The link works until {expires}.</p>
          <span className="visually-hidden" aria-live="polite">
            {copied ? 'Copied to clipboard' : ''}
          </span>
        </div>
      ) : (
        <form className="share-form" onSubmit={(e) => void create(e)}>
          <div className="field">
            <label className="field__label" htmlFor={nameId}>
              From
            </label>
            <input
              id={nameId}
              className="input"
              value={from}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name (optional)"
              autoComplete="nickname"
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={messageId}>
              Message <span className="field__optional">(optional)</span>
            </label>
            <textarea
              id={messageId}
              className="input input--multiline"
              value={message}
              maxLength={MAX_SHARE_MESSAGE}
              rows={2}
              placeholder={challenge ? 'Bet you can’t beat this!' : 'Happy birthday!'}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          {source.ownPhoto && <p className="setup__note">Your photo is uploaded so your friend can see it. The link and photo are deleted after 30 days.</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            <Link2 />
            Create link
          </Button>
        </form>
      )}
    </Dialog>
  );
}
