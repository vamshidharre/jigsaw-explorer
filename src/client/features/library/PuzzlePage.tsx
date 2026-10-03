import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Play, Users } from 'lucide-react';
import { pageTitle } from '../../../shared/brand';
import { CATALOG, CATEGORIES, catalogImageUrl, getCatalogImage } from '../../../shared/catalog';
import { DIFFICULTY_PRESETS, maxPiecesForImage } from '../../../shared/puzzle/spec';
import { PageShell } from '../../components/layout/SiteHeader';
import { PuzzleCard } from '../../components/PuzzleCard';
import { Button } from '../../components/ui/Button';
import { useUi } from '../../app/uiStore';
import { NotFoundPage } from '../home/StaticPages';

/** A page per gallery picture: something to link to and for search engines to find. */
export function PuzzlePage() {
  const { id = '' } = useParams();
  const image = getCatalogImage(id);
  const openSetup = useUi((s) => s.openSetup);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (image) document.title = pageTitle(`${image.title} jigsaw puzzle`);
    setLoaded(false);
  }, [image]);

  if (!image) return <NotFoundPage />;

  const category = CATEGORIES.find((c) => c.id === image.category)!;
  const max = maxPiecesForImage(image.width, image.height);
  const related = CATALOG.filter((img) => img.category === image.category && img.id !== image.id).slice(0, 8);
  const credit = image.category === 'fine-art' && !image.credit.startsWith('Unsplash') ? image.credit : null;

  return (
    <PageShell>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/puzzles">Puzzles</Link>
        <ChevronRight aria-hidden="true" size={14} />
        <Link to={`/puzzles?category=${category.id}`}>{category.label}</Link>
      </nav>
      <section className="puzzle-detail">
        <figure
          className="puzzle-detail__preview"
          style={{ aspectRatio: `${image.width} / ${image.height}`, backgroundColor: image.color, backgroundImage: `url(${image.blur})` }}
        >
          <img src={catalogImageUrl(image.id)} alt={image.title} className={loaded ? 'is-loaded' : undefined} onLoad={() => setLoaded(true)} />
        </figure>
        <div className="puzzle-detail__copy">
          <h1 className="puzzle-detail__title">{image.title}</h1>
          {credit && <p className="puzzle-detail__credit">{credit}</p>}
          <p className="puzzle-detail__lede">
            A free online jigsaw puzzle. Play it with {DIFFICULTY_PRESETS[0]!.pieces} pieces for a quick break or up to {max} for a long session, turn on
            rotating pieces for an extra challenge, or invite friends to solve it with you in real time.
          </p>
          <div className="hero__actions">
            <Button variant="primary" size="lg" onClick={() => openSetup({ kind: 'catalog', id: image.id })}>
              <Play />
              Play this puzzle
            </Button>
            <Button size="lg" onClick={() => openSetup({ kind: 'catalog', id: image.id }, 'room')}>
              <Users />
              Play with friends
            </Button>
          </div>
          <dl className="puzzle-detail__facts">
            <div>
              <dt>Pieces</dt>
              <dd className="tabular">
                {DIFFICULTY_PRESETS[0]!.pieces}–{max}
              </dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{category.label}</dd>
            </div>
            <div>
              <dt>Licence</dt>
              <dd>{image.license.split(';')[0]}</dd>
            </div>
          </dl>
        </div>
      </section>

      {related.length > 0 && (
        <section className="section" aria-labelledby="related-heading">
          <div className="section__head">
            <h2 id="related-heading">More {category.label.toLowerCase()}</h2>
            <Link to="/puzzles" className="section__link">
              All puzzles
            </Link>
          </div>
          <div className="puzzle-grid">
            {related.map((img) => (
              <PuzzleCard key={img.id} image={img} onSelect={(i) => openSetup({ kind: 'catalog', id: i.id })} />
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}
