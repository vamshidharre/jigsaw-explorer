/**
 * Product name and copy used by the client (page titles, header) and the
 * server (link previews, sitemap). Renaming the site is a change here plus
 * `index.html` and `public/manifest.webmanifest`, which are static files.
 */
export const BRAND = {
  name: 'Jigbee',
  tagline: 'Online jigsaw puzzles, solo or together',
  description:
    'Beautiful online jigsaw puzzles. Play solo or solve together with friends in real time — any piece count, your own photos, no sign-up.',
  shortDescription: 'Online jigsaw puzzles — solo or together in real time.',
} as const;

/** `"Puzzles — Jigbee"`, or the home title when no page name is given. */
export function pageTitle(page?: string): string {
  return page ? `${page} — ${BRAND.name}` : `${BRAND.name} — ${BRAND.tagline}`;
}
