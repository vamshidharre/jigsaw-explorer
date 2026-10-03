/**
 * Cookie-free usage counting. Sends an event name (and for some events a
 * label such as a page template or puzzle id) to our own server, which only
 * keeps daily totals. Nothing is sent when the browser asks not to be tracked.
 */
import { pageTemplate, referrerLabel, type ClientEvent } from '../../shared/analytics';

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

export function track(event: ClientEvent, label?: string): void {
  try {
    if (optedOut()) return;
    const body = JSON.stringify(label === undefined ? { e: event } : { e: event, l: label });
    if (navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Counting is best effort and must never break the app.
  }
}

const VISIT_KEY = 'jigsaw.visit';

/** Records a page view, and a visit (with where it came from) once per browser tab session. */
export function trackPage(pathname: string): void {
  try {
    if (!sessionStorage.getItem(VISIT_KEY)) {
      sessionStorage.setItem(VISIT_KEY, '1');
      track('visit', referrerLabel(document.referrer, location.hostname));
    }
  } catch {
    // No session storage: skip visit counting.
  }
  track('pageview', pageTemplate(pathname));
}
