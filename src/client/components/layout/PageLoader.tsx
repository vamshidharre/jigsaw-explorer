import type { ReactNode } from 'react';
import { Spinner } from '../ui/Button';

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="page-loader">
      <Spinner size={22} label={label} />
    </div>
  );
}

/** Full-screen message for errors and empty states, always with a way forward. */
export function StateScreen({
  icon,
  title,
  children,
  actions,
  tone = 'neutral',
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className="state-screen" role={tone === 'error' ? 'alert' : undefined}>
      <div className="state-screen__card">
        {icon && <div className={`state-screen__icon state-screen__icon--${tone}`}>{icon}</div>}
        <h1>{title}</h1>
        {children && <div className="state-screen__body">{children}</div>}
        {actions && <div className="state-screen__actions">{actions}</div>}
      </div>
    </div>
  );
}
