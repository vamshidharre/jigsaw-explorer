import { useEffect } from 'react';
import { Link } from 'react-router';
import { pageTitle } from '../../../shared/brand';
import { CATALOG, CATEGORIES, catalogThumbUrl } from '../../../shared/catalog';
import { PageShell } from '../../components/layout/SiteHeader';
import { StateScreen } from '../../components/layout/PageLoader';

export function CreditsPage() {
  useEffect(() => {
    document.title = pageTitle('Image credits');
  }, []);
  return (
    <PageShell>
      <header className="page-head">
        <div>
          <h1>Image credits</h1>
          <p className="page-head__lede">The puzzle pictures and where they come from. Thank you to the photographers and artists.</p>
        </div>
      </header>
      {CATEGORIES.map((c) => (
        <section key={c.id} className="section" aria-labelledby={`credits-${c.id}`}>
          <h2 id={`credits-${c.id}`} className="credits__heading">
            {c.label}
          </h2>
          <ul className="credits">
            {CATALOG.filter((i) => i.category === c.id).map((img) => (
              <li key={img.id} className="credits__item">
                <img src={catalogThumbUrl(img.id)} alt="" loading="lazy" style={{ backgroundColor: img.color }} />
                <div>
                  <Link to={`/puzzle/${img.id}`} className="credits__title">
                    {img.title}
                  </Link>
                  <span>{img.credit}</span>
                  <span className="credits__license">{img.license}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageShell>
  );
}

export function NotFoundPage() {
  useEffect(() => {
    document.title = pageTitle('Page not found');
  }, []);
  return (
    <PageShell>
      <StateScreen
        title="This piece doesn't fit anywhere"
        actions={
          <>
            <Link className="btn btn--primary" to="/puzzles">
              Choose a puzzle
            </Link>
            <Link className="btn" to="/">
              Home
            </Link>
          </>
        }
      >
        <p>The page you were looking for doesn't exist.</p>
      </StateScreen>
    </PageShell>
  );
}
