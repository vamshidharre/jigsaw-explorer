import type { ReactNode } from 'react';
import { Trophy, X } from 'lucide-react';
import { IconButton } from '../../components/ui/Button';
import { initials } from '../../lib/format';

export interface CompletionStat {
  label: string;
  value: string;
  highlight?: boolean;
}

/**
 * Celebratory summary that slides up from the bottom, leaving the finished
 * picture visible above it.
 */
export function CompletionCard({
  title,
  subtitle,
  stats,
  players,
  actions,
  onDismiss,
}: {
  title: string;
  subtitle: string;
  stats: CompletionStat[];
  players?: Array<{ id: string; name: string; color: string; placed: number; self: boolean }>;
  actions: ReactNode;
  onDismiss(): void;
}) {
  const totalPlaced = players?.reduce((s, p) => s + p.placed, 0) ?? 0;
  return (
    <section className="completion" role="dialog" aria-modal="false" aria-labelledby="completion-title">
      <div className="completion__card">
        <IconButton label="Hide summary" size="sm" className="completion__close" onClick={onDismiss} tooltipSide="left">
          <X />
        </IconButton>
        <div className="completion__head">
          <span className="completion__badge" aria-hidden="true">
            <Trophy />
          </span>
          <div>
            <h2 id="completion-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <dl className="completion__stats">
          {stats.map((s) => (
            <div key={s.label} className={s.highlight ? 'completion__stat is-highlight' : 'completion__stat'}>
              <dt>{s.label}</dt>
              <dd className="tabular">{s.value}</dd>
            </div>
          ))}
        </dl>
        {players && players.length > 0 && (
          <div className="completion__players">
            <h3>Who placed what</h3>
            <ul>
              {players.map((p) => (
                <li key={p.id}>
                  <span className="avatar" style={{ ['--avatar-color' as string]: p.color, ['--avatar-size' as string]: '26px' }} aria-hidden="true">
                    {initials(p.name)}
                  </span>
                  <span className="completion__player-name">
                    {p.name}
                    {p.self && <span className="completion__you"> (you)</span>}
                  </span>
                  <span className="completion__bar" aria-hidden="true">
                    <span style={{ width: `${totalPlaced ? (p.placed / totalPlaced) * 100 : 0}%`, background: p.color }} />
                  </span>
                  <span className="tabular completion__count">{p.placed}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="completion__actions">{actions}</div>
      </div>
    </section>
  );
}
