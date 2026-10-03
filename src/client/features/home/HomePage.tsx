import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Image as ImageIcon, Puzzle, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { pageTitle } from '../../../shared/brand';
import { CATALOG, catalogImageUrl, catalogThumbUrl, getCatalogImage, FEATURED_IMAGE_ID } from '../../../shared/catalog';
import { PageShell } from '../../components/layout/SiteHeader';
import { DailyCard } from '../daily/DailyCard';
import { PuzzleArt } from '../../components/PuzzleArt';
import { PuzzleCard } from '../../components/PuzzleCard';
import { Button, IconButton } from '../../components/ui/Button';
import { useUi } from '../../app/uiStore';
import { formatDuration, formatRelativeTime } from '../../lib/format';
import { deleteGame, listGames, saveGame, type SavedGame } from '../../persistence/savedGames';

const FEATURED = ['autumn-avenue', 'great-wave', 'tabby-gaze', 'misty-shoreline', 'potala-palace', 'orchid-bloom', 'the-scream', 'alpine-peaks'];

export function HomePage() {
  const featured = getCatalogImage(FEATURED_IMAGE_ID)!;
  const openSetup = useUi((s) => s.openSetup);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = pageTitle();
  }, []);

  return (
    <PageShell>
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Free online jigsaw puzzles</p>
          <h1 className="hero__title">Piece it together, on your own or with friends.</h1>
          <p className="hero__lede">
            Smooth, satisfying jigsaw puzzles in your browser. Choose any piece count, use your own photos, and invite friends to
            solve the same puzzle in real time. No account needed.
          </p>
          <div className="hero__actions">
            <Button variant="primary" size="lg" onClick={() => navigate('/puzzles')}>
              Start a puzzle
              <ArrowRight />
            </Button>
            <Button size="lg" onClick={() => navigate('/multiplayer')}>
              <Users />
              Play together
            </Button>
          </div>
        </div>
        <div className="hero__art">
          <PuzzleArt
            className="puzzle-art"
            src={catalogImageUrl(featured.id)}
            width={featured.width}
            height={featured.height}
            cols={6}
            rows={4}
            seed={11}
            lifted={[
              { piece: 4, dx: featured.width * 0.1, dy: -featured.height * 0.17, rotate: 9 },
              { piece: 12, dx: -featured.width * 0.11, dy: featured.height * 0.05, rotate: -8 },
              { piece: 21, dx: featured.width * 0.03, dy: featured.height * 0.26, rotate: 6 },
            ]}
          />
        </div>
      </section>

      <section className="section section--tight" aria-label="Daily puzzle">
        <DailyCard />
      </section>

      <ContinueSection />

      <section className="section" aria-labelledby="featured-heading">
        <div className="section__head">
          <h2 id="featured-heading">Popular puzzles</h2>
          <Link to="/puzzles" className="section__link">
            Browse all {CATALOG.length}
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="puzzle-grid">
          {FEATURED.map((id) => getCatalogImage(id))
            .filter((img) => img !== undefined)
            .map((img) => (
              <PuzzleCard key={img.id} image={img} onSelect={(i) => openSetup({ kind: 'catalog', id: i.id })} />
            ))}
        </div>
      </section>

      <section className="section features" aria-label="Features">
        <div className="feature">
          <Users className="feature__icon" aria-hidden="true" />
          <h3>Real-time co-op</h3>
          <p>Share a link and solve together. Everyone sees each other's cursors and moves as they happen.</p>
        </div>
        <div className="feature">
          <ImageIcon className="feature__icon" aria-hidden="true" />
          <h3>Your own photos</h3>
          <p>Turn any picture into a puzzle. Solo puzzles from your photos stay on your device.</p>
        </div>
        <div className="feature">
          <Puzzle className="feature__icon" aria-hidden="true" />
          <h3>6 to 1,000 pieces</h3>
          <p>From a quick break to a weekend project, with optional piece rotation for an extra challenge.</p>
        </div>
      </section>
    </PageShell>
  );
}

function ContinueSection() {
  const [games, setGames] = useState<SavedGame[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    listGames()
      .then((g) => alive && setGames(g.filter((x) => x.completedAt === null && x.groups.length > 0)))
      .catch(() => alive && setGames([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!games || games.length === 0) return null;

  const remove = async (game: SavedGame) => {
    setGames((list) => list?.filter((g) => g.id !== game.id) ?? null);
    await deleteGame(game.id);
    toast('Puzzle removed', {
      action: {
        label: 'Undo',
        onClick: () => {
          void saveGame(game).then(() => setGames((list) => [game, ...(list ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)));
        },
      },
    });
  };

  return (
    <section className="section" aria-labelledby="continue-heading">
      <div className="section__head">
        <h2 id="continue-heading">Continue where you left off</h2>
      </div>
      <ul className="continue-list">
        {games.slice(0, 6).map((g) => {
          const pct = Math.round((g.connected / Math.max(1, g.total)) * 100);
          const thumb = g.image.kind === 'catalog' ? catalogThumbUrl(g.image.id) : g.image.thumbnail;
          return (
            <li key={g.id} className="continue-card">
              <button className="continue-card__main" onClick={() => navigate(`/play/${g.id}`)} aria-label={`Continue ${g.title}, ${pct}% done`}>
                <img src={thumb} alt="" className="continue-card__thumb" loading="lazy" />
                <span className="continue-card__info">
                  <span className="continue-card__title">{g.title}</span>
                  <span className="continue-card__meta">
                    {g.total} pieces · {formatDuration(g.elapsedMs)} · {formatRelativeTime(g.updatedAt)}
                  </span>
                  <span className="progress" aria-hidden="true">
                    <span className="progress__bar" style={{ width: `${pct}%` }} />
                  </span>
                </span>
                <span className="continue-card__pct tabular">{pct}%</span>
              </button>
              <IconButton label={`Remove ${g.title}`} size="sm" onClick={() => void remove(g)} tooltipSide="left">
                <Trash2 />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
