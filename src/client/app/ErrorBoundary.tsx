import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last-resort error screen: the app never shows a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="state-screen" role="alert">
        <div className="state-screen__card">
          <h1>Something went wrong</h1>
          <p>An unexpected error interrupted the page. Your saved puzzles are safe.</p>
          <div className="state-screen__actions">
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
            <a className="btn" href="/">
              Go to home
            </a>
          </div>
        </div>
      </main>
    );
  }
}
