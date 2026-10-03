import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CalendarDays, Check, Flame, Play, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { pageTitle } from '../../../shared/brand';
import { catalogImageUrl, getCatalogImage } from '../../../shared/catalog';
import { addDays, dailyPuzzle, localDayKey } from '../../../shared/daily';
import { PageShell } from '../../components/layout/SiteHeader';
import { PuzzleArt } from '../../components/PuzzleArt';
import { Button } from '../../components/ui/Button';
import { track } from '../../lib/analytics';
import { formatDuration } from '../../lib/format';
import { shareOrCopy } from '../../lib/share';
import { dailyResults, dailyShareText, dailyStats } from '../../persistence/daily';
import { loadGame, type SavedGame } from '../../persistence/savedGames';
import { dailyGameId, startDaily } from './startDaily';

/** Re-renders when the local date changes (e.g. the tab stays open past midnight). */
export function useToday(): string {
  const [today, setToday] = useState(localDayKey);
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const timer = window.setTimeout(() => setToday(localDayKey()), midnight - now.getTime() + 500);
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}

function useCountdown(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const minutes = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function shareDailyResult(key: string): void {
  const result = dailyResults()[key];
  if (!result) return;
  const text = dailyShareText(dailyPuzzle(key), result, dailyStats(key).currentStreak, `${location.origin}/daily`);
  void shareOrCopy({ text }).then((outcome) => {
    if (outcome === 'copied') toast.success('Result copied — paste it anywhere');
    else if (outcome === 'failed') toast.error('Sharing is not available here.');
    if (outcome === 'copied' || outcome === 'shared') track('result_share');
  });
}

export function DailyPage() {
  const today = useToday();
  const puzzle = useMemo(() => dailyPuzzle(today), [today]);
  const image = getCatalogImage(puzzle.imageId)!;
  const navigate = useNavigate();
  const countdown = useCountdown();
  const [game, setGame] = useState<SavedGame | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const results = dailyResults();
  const stats = dailyStats(today, results);
  const result = results[today] ?? null;
  const pieces = puzzle.spec.cols * puzzle.spec.rows;

  useEffect(() => {
    document.title = pageTitle(`Daily puzzle #${puzzle.number}`);
    let alive = true;
    void loadGame(dailyGameId(today)).then((g) => alive && setGame(g));
    return () => {
      alive = false;
    };
  }, [today, puzzle.number]);

  const play = async () => {
    setBusy(true);
    try {
      navigate(`/play/${await startDaily(today)}`);
    } catch {
      toast.error('Could not start the puzzle. Please try again.');
      setBusy(false);
    }
  };

  const progress = game && game.total ? Math.round((game.connected / game.total) * 100) : 0;
  const inProgress = !result && game && game.groups.length > 0;
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <PageShell>
      <section className="daily">
        <div className="daily__art">
          <PuzzleArt
            className="puzzle-art"
            src={catalogImageUrl(image.id)}
            width={image.width}
            height={image.height}
            cols={puzzle.spec.cols}
            rows={puzzle.spec.rows}
            seed={puzzle.spec.seed}
            lifted={[{ piece: Math.min(pieces - 1, puzzle.spec.cols + 2), dx: image.width * 0.06, dy: -image.height * 0.12, rotate: 7 }]}
          />
        </div>
        <div className="daily__copy">
          <p className="eyebrow">
            <CalendarDays aria-hidden="true" size={16} />
            {dateLabel}
          </p>
          <h1 className="daily__title">Daily puzzle #{puzzle.number}</h1>
          <p className="daily__lede">
            {image.title} · {pieces} pieces. Everyone gets the same picture, cut the same way. A new puzzle every day at midnight.
          </p>

          {result ? (
            <div className="daily__done" role="status">
              <span className="daily__done-icon" aria-hidden="true">
                <Check />
              </span>
              <div>
                <strong>Solved in {formatDuration(result.ms)}</strong>
                <span>Next puzzle in {countdown}</span>
              </div>
            </div>
          ) : null}

          <div className="hero__actions">
            {result ? (
              <>
                <Button variant="primary" size="lg" onClick={() => shareDailyResult(today)}>
                  <Share2 />
                  Share result
                </Button>
                <Button size="lg" onClick={() => void play()} loading={busy}>
                  View puzzle
                </Button>
              </>
            ) : (
              <Button variant="primary" size="lg" onClick={() => void play()} loading={busy}>
                <Play />
                {inProgress ? `Continue · ${progress}%` : "Play today's puzzle"}
              </Button>
            )}
          </div>

          <dl className="daily__stats">
            <div>
              <dt>Played</dt>
              <dd className="tabular">{stats.played}</dd>
            </div>
            <div>
              <dt>Streak</dt>
              <dd className="tabular">
                {stats.currentStreak}
                {stats.currentStreak > 1 && <Flame aria-hidden="true" className="daily__flame" />}
              </dd>
            </div>
            <div>
              <dt>Best streak</dt>
              <dd className="tabular">{stats.bestStreak}</dd>
            </div>
            <div>
              <dt>Best time</dt>
              <dd className="tabular">{stats.bestMs !== null ? formatDuration(stats.bestMs) : '—'}</dd>
            </div>
          </dl>

          <ol className="daily__week" aria-label="This week">
            {week.map((day) => {
              const done = Boolean(results[day]);
              const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
              return (
                <li key={day} className={day === today ? 'is-today' : undefined}>
                  <span className={done ? 'daily__dot is-done' : 'daily__dot'} aria-hidden="true">
                    {done && <Check />}
                  </span>
                  <span className="daily__day">{label}</span>
                  <span className="visually-hidden">{done ? 'solved' : 'not solved'}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </PageShell>
  );
}
