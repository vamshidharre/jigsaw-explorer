/**
 * IndexNow: tells Bing, Yandex, Seznam and Naver which pages exist, without
 * an account (Bing's index also feeds DuckDuckGo, Yahoo and Ecosia). Ownership
 * is proven by serving the key as a text file at `/<key>.txt`.
 * https://www.indexnow.org/documentation
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export interface IndexNowOptions {
  /** Public origin, e.g. https://jigbee.com */
  origin: string;
  key: string;
  endpoint: string;
  /** Where the "already submitted" marker is kept. */
  dataDir: string;
  /** Identifies the deployed version; a new version submits again. */
  deployId: string;
  fetchImpl?: typeof fetch;
}

export interface IndexNowResult {
  submitted: boolean;
  status?: number;
  reason?: string;
  urls: number;
}

/** Submits the page list once per deployed version (when the data directory persists). */
export async function submitToIndexNow(paths: readonly string[], opts: IndexNowOptions): Promise<IndexNowResult> {
  const urlList = paths.map((p) => `${opts.origin}${p}`);
  const fingerprint = createHash('sha256').update(`${opts.deployId}\n${urlList.join('\n')}`).digest('hex');
  const marker = path.join(opts.dataDir, 'indexnow.json');
  try {
    const previous = JSON.parse(await readFile(marker, 'utf8')) as { fingerprint?: string };
    if (previous.fingerprint === fingerprint) return { submitted: false, reason: 'already submitted', urls: urlList.length };
  } catch {
    // No marker yet.
  }

  const res = await (opts.fetchImpl ?? fetch)(opts.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(opts.origin).host, key: opts.key, keyLocation: `${opts.origin}/${opts.key}.txt`, urlList }),
    signal: AbortSignal.timeout(20_000),
  });
  // 200 = accepted, 202 = accepted while the key is being verified.
  if (res.status === 200 || res.status === 202) {
    await writeFile(marker, JSON.stringify({ fingerprint, submittedAt: new Date().toISOString(), urls: urlList.length })).catch(() => undefined);
    return { submitted: true, status: res.status, urls: urlList.length };
  }
  return { submitted: false, status: res.status, reason: 'rejected', urls: urlList.length };
}
