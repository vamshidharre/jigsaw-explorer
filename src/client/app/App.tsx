import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import { Tooltip } from 'radix-ui';
import { Toaster } from 'sonner';
import { mountAnnouncer } from './announcer';
import { ErrorBoundary } from './ErrorBoundary';
import { useAppearance } from './useAppearance';
import { HomePage } from '../features/home/HomePage';
import { LibraryPage } from '../features/library/LibraryPage';
import { PuzzlePage } from '../features/library/PuzzlePage';
import { DailyPage } from '../features/daily/DailyPage';
import { MultiplayerPage } from '../features/multiplayer/MultiplayerPage';
import { CreditsPage, NotFoundPage } from '../features/home/StaticPages';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { HelpDialog } from '../features/game/HelpDialog';
import { SetupDialog } from '../features/library/SetupDialog';
import { PageLoader } from '../components/layout/PageLoader';
import { trackPage } from '../lib/analytics';

// The game screens pull in the canvas engine; load them on demand to keep the home page light.
const PlayPage = lazy(() => import('../features/game/PlayPage'));
const RoomPage = lazy(() => import('../features/multiplayer/RoomPage'));
const SharePage = lazy(() => import('../features/share/SharePage'));
const StatsPage = lazy(() => import('../features/stats/StatsPage').then((m) => ({ default: m.StatsPage })));

/** Scrolls new pages to the top and counts the page view. */
function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    trackPage(pathname);
  }, [pathname]);
  return null;
}

export function App() {
  const appearance = useAppearance();
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountAnnouncer(liveRef.current);
    return () => mountAnnouncer(null);
  }, []);

  return (
    <BrowserRouter>
      <Tooltip.Provider delayDuration={450} skipDelayDuration={200}>
        <RouteEffects />
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/puzzles" element={<LibraryPage />} />
              <Route path="/puzzle/:id" element={<PuzzlePage />} />
              <Route path="/daily" element={<DailyPage />} />
              <Route path="/multiplayer" element={<MultiplayerPage />} />
              <Route path="/play/:gameId" element={<PlayPage />} />
              <Route path="/room/:code" element={<RoomPage />} />
              <Route path="/s/:id" element={<SharePage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/credits" element={<CreditsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
          <SetupDialog />
          <SettingsPanel />
          <HelpDialog />
        </ErrorBoundary>
        <Toaster
          theme={appearance.theme}
          position="top-left"
          offset={{ top: 80, left: 16 }}
          mobileOffset={{ top: 108, left: 12, right: 12 }}
          visibleToasts={3}
          duration={2600}
          closeButton={false}
          toastOptions={{ className: 'toast' }}
        />
        <div ref={liveRef} className="visually-hidden" aria-live="polite" aria-atomic="true" />
      </Tooltip.Provider>
    </BrowserRouter>
  );
}
