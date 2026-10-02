import { Link, NavLink } from 'react-router';
import { Settings } from 'lucide-react';
import { IconButton } from '../ui/Button';
import { useUi } from '../../app/uiStore';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-mark">
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <path
        fill="var(--accent-fg)"
        d="M18 16h10.5c-.9-1.2-1.4-2.4-1.4-3.8 0-3.2 2.4-5.2 5-5.2s5 2 5 5.2c0 1.4-.5 2.6-1.4 3.8H46v10.5c1.2-.9 2.4-1.4 3.8-1.4 3.2 0 5.2 2.4 5.2 5s-2 5-5.2 5c-1.4 0-2.6-.5-3.8-1.4V48H18z"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Jigsaw Explorer home">
      <LogoMark />
      <span className="logo__text">Jigsaw Explorer</span>
    </Link>
  );
}

export function SiteHeader() {
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Logo />
        <nav className="site-nav" aria-label="Main">
          <NavLink to="/puzzles" className="site-nav__link">
            Puzzles
          </NavLink>
          <NavLink to="/multiplayer" className="site-nav__link">
            Play together
          </NavLink>
        </nav>
        <IconButton label="Settings" shortcut="," onClick={() => setSettingsOpen(true)}>
          <Settings />
        </IconButton>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <span>Jigsaw Explorer</span>
        <nav aria-label="Footer">
          <Link to="/credits">Image credits</Link>
        </nav>
      </div>
    </footer>
  );
}

export function PageShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className={wide ? 'page page--wide' : 'page'} tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
