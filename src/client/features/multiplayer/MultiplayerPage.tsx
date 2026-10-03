import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Link2, Users } from 'lucide-react';
import { pageTitle } from '../../../shared/brand';
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH, sanitizeName, MAX_NAME_LENGTH } from '../../../shared/protocol';
import { PageShell } from '../../components/layout/SiteHeader';
import { Button } from '../../components/ui/Button';
import { ApiError, getRoom } from '../../lib/api';
import { useSettings } from '../settings/settingsStore';

export function MultiplayerPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const playerName = useSettings((s) => s.playerName);
  const setSetting = useSettings((s) => s.set);
  const [name, setName] = useState(playerName);

  useEffect(() => {
    document.title = pageTitle('Play together');
  }, []);

  const saveName = () => {
    const clean = sanitizeName(name);
    if (clean) setSetting('playerName', clean);
    setName(clean);
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    saveName();
    const normalized = normalizeRoomCode(code);
    if (!isValidRoomCode(normalized)) {
      setError(`Room codes are ${ROOM_CODE_LENGTH} letters and numbers, like K7QM2X.`);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const summary = await getRoom(normalized);
      if (summary.full) {
        setError(`That room is full (${summary.capacity} players). Ask the host to make room or create your own.`);
        return;
      }
      navigate(`/room/${normalized}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 404 ? 'No room with that code. It may have expired.' : err.message) : 'Could not check that room.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <PageShell>
      <header className="page-head">
        <div>
          <h1>Play together</h1>
          <p className="page-head__lede">Solve the same puzzle with friends in real time. Everyone sees every move as it happens.</p>
        </div>
      </header>

      <div className="lobby">
        <div className="field lobby__name">
          <label className="field__label" htmlFor="player-name">
            Your name
          </label>
          <input
            id="player-name"
            className="input"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="How others will see you"
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
          />
        </div>

        <div className="lobby__cards">
          <section className="card lobby-card" aria-labelledby="create-heading">
            <span className="lobby-card__icon" aria-hidden="true">
              <Users />
            </span>
            <h2 id="create-heading">Create a room</h2>
            <p>Pick a picture and difficulty, then share the link. You'll be the host.</p>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                saveName();
                navigate('/puzzles?mode=room');
              }}
            >
              Choose a puzzle
              <ArrowRight />
            </Button>
          </section>

          <section className="card lobby-card" aria-labelledby="join-heading">
            <span className="lobby-card__icon" aria-hidden="true">
              <Link2 />
            </span>
            <h2 id="join-heading">Join a room</h2>
            <p>Enter the code from your invite, or paste the whole link.</p>
            <form className="join-form" onSubmit={join} noValidate>
              <label className="visually-hidden" htmlFor="room-code">
                Room code
              </label>
              <input
                id="room-code"
                className="input input--code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
                placeholder="K7QM2X"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'join-error' : undefined}
              />
              <Button type="submit" size="lg" loading={checking} disabled={!code.trim()}>
                Join
              </Button>
            </form>
            {error && (
              <p className="field__error" id="join-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>

        <ol className="steps" aria-label="How it works">
          <li>
            <strong>Create</strong>
            <span>Choose any picture and piece count.</span>
          </li>
          <li>
            <strong>Share</strong>
            <span>Send the link or 6-letter code to friends.</span>
          </li>
          <li>
            <strong>Solve together</strong>
            <span>Pieces, cursors and progress sync instantly.</span>
          </li>
        </ol>
      </div>
    </PageShell>
  );
}
