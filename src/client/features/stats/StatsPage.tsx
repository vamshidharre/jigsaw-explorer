import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { pageTitle } from '../../../shared/brand';
import { getCatalogImage } from '../../../shared/catalog';
import { PageShell } from '../../components/layout/SiteHeader';
import { Button } from '../../components/ui/Button';
import { Segmented, type SegmentOption } from '../../components/ui/Controls';
import { ApiError, getStats, type StatsResponse } from '../../lib/api';

const TOKEN_KEY = 'jigsaw.statsToken';

type Range = '7' | '30' | '90';
const RANGES: ReadonlyArray<SegmentOption<Range>> = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

type Counts = Record<string, number>;

function sum(counts: Counts, event: string): number {
  let total = 0;
  for (const [key, n] of Object.entries(counts)) if (key === event || key.startsWith(`${event}|`)) total += n;
  return total;
}

function labels(counts: Counts, events: string[]): Array<[string, number]> {
  const out = new Map<string, number>();
  for (const [key, n] of Object.entries(counts)) {
    const [event, label] = key.split('|') as [string, string | undefined];
    if (label && events.includes(event)) out.set(label, (out.get(label) ?? 0) + n);
  }
  return Array.from(out).sort((a, b) => b[1] - a[1]);
}

const COLUMNS: Array<{ label: string; value(c: Counts): number }> = [
  { label: 'Visits', value: (c) => sum(c, 'visit') },
  { label: 'Puzzles started', value: (c) => sum(c, 'solo_start') + sum(c, 'daily_start') + sum(c, 'share_start') + sum(c, 'room_create') },
  { label: 'Puzzles finished', value: (c) => sum(c, 'solo_complete') + sum(c, 'daily_complete') + sum(c, 'room_complete') },
  { label: 'Rooms', value: (c) => sum(c, 'room_create') },
  { label: 'Players joined', value: (c) => sum(c, 'room_join') },
  { label: 'Daily solved', value: (c) => sum(c, 'daily_complete') },
  { label: 'Links shared', value: (c) => sum(c, 'share_create') + sum(c, 'result_share') },
  { label: 'Links opened', value: (c) => sum(c, 'share_open') },
];

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Private usage dashboard for the site owner (needs the STATS_TOKEN access key). */
export function StatsPage() {
  const [token, setToken] = useState(readToken);
  const [draft, setDraft] = useState('');
  const [range, setRange] = useState<Range>('30');
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const keyId = useId();

  useEffect(() => {
    document.title = pageTitle('Usage');
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);
    getStats(token, Number(range))
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : 'Could not load the numbers.');
        if (err instanceof ApiError && err.status === 401) {
          setToken('');
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {
            // ignore
          }
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token, range]);

  const totals = useMemo(() => {
    const all: Counts = {};
    for (const d of data?.days ?? []) for (const [k, n] of Object.entries(d.counts)) all[k] = (all[k] ?? 0) + n;
    return all;
  }, [data]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      // Works for this visit only.
    }
    setToken(value);
    setDraft('');
  };

  const signOut = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
    setToken('');
    setData(null);
  };

  const referrers = labels(totals, ['visit']);
  const puzzles = labels(totals, ['solo_start', 'room_create']);
  const pages = labels(totals, ['pageview']);
  const maxVisits = Math.max(1, ...(data?.days ?? []).map((d) => sum(d.counts, 'visit')));

  return (
    <PageShell>
      <header className="page-head">
        <div>
          <h1>Usage</h1>
          <p className="page-head__lede">Daily totals counted without cookies or personal data.</p>
        </div>
        {token && (
          <Button variant="ghost" size="sm" onClick={signOut}>
            Forget access key
          </Button>
        )}
      </header>

      {!token ? (
        <form className="stats-login" onSubmit={submit}>
          <div className="field">
            <label className="field__label" htmlFor={keyId}>
              Access key
            </label>
            <input id={keyId} className="input" type="password" autoComplete="current-password" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <span className="field__hint">The STATS_TOKEN value configured on the server.</span>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary">
            Show numbers
          </Button>
        </form>
      ) : (
        <>
          <div className="stats-toolbar">
            <Segmented<Range> label="Period" value={range} onValueChange={(v) => setRange(v)} options={RANGES} />
            {loading && <span className="stats-toolbar__status">Loading…</span>}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {data && !data.collecting && <p className="setup__note">Counting is turned off on this server (ANALYTICS=off).</p>}
          {data && (
            <>
              <dl className="stats-tiles">
                {COLUMNS.map((col) => (
                  <div key={col.label}>
                    <dt>{col.label}</dt>
                    <dd className="tabular">{col.value(totals).toLocaleString()}</dd>
                  </div>
                ))}
              </dl>

              <section className="section" aria-labelledby="stats-days">
                <h2 id="stats-days" className="stats-heading">
                  By day
                </h2>
                <div className="stats-table-wrap">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        {COLUMNS.map((c) => (
                          <th key={c.label} scope="col">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.days].reverse().map((d) => (
                        <tr key={d.day}>
                          <th scope="row" className="tabular">
                            {d.day}
                            <span className="stats-bar" aria-hidden="true">
                              <span style={{ width: `${(sum(d.counts, 'visit') / maxVisits) * 100}%` }} />
                            </span>
                          </th>
                          {COLUMNS.map((c) => (
                            <td key={c.label} className="tabular">
                              {c.value(d.counts) || ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="stats-lists">
                <StatsList title="Where visits came from" rows={referrers} />
                <StatsList title="Popular pictures" rows={puzzles.map(([id, n]) => [getCatalogImage(id)?.title ?? (id === 'photo' ? 'Own photos' : id), n])} />
                <StatsList title="Pages" rows={pages} />
              </div>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

function StatsList({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <section className="stats-list">
      <h2 className="stats-heading">{title}</h2>
      {rows.length === 0 ? (
        <p className="field__hint">Nothing yet.</p>
      ) : (
        <ul>
          {rows.slice(0, 12).map(([label, n]) => (
            <li key={label}>
              <span className="stats-list__label">{label}</span>
              <span className="stats-list__value tabular">{n.toLocaleString()}</span>
              <span className="stats-bar" aria-hidden="true">
                <span style={{ width: `${(n / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
