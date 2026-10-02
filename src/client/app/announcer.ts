/**
 * Screen reader announcements through a single polite live region.
 */
import { useSettings } from '../features/settings/settingsStore';

let region: HTMLElement | null = null;
let timer = 0;

export function mountAnnouncer(el: HTMLElement | null): void {
  region = el;
}

export function announce(message: string, force = false): void {
  if (!region) return;
  if (!force && !useSettings.getState().announcements) return;
  clearTimeout(timer);
  // Clearing first makes repeated identical messages announce again.
  region.textContent = '';
  timer = window.setTimeout(() => {
    if (region) region.textContent = message;
  }, 60);
}
