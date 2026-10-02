import { useEffect, useState } from 'react';
import { sound } from '../lib/sound';
import { resolveTheme, useSettings } from '../features/settings/settingsStore';

/** Applies theme, density and motion preferences to <html> and keeps sound in sync. */
export function useAppearance(): { theme: 'light' | 'dark' } {
  const themePref = useSettings((s) => s.theme);
  const density = useSettings((s) => s.density);
  const motion = useSettings((s) => s.motion);
  const soundOn = useSettings((s) => s.sound);
  const volume = useSettings((s) => s.volume);
  const [theme, setTheme] = useState(() => resolveTheme(themePref));

  useEffect(() => {
    const apply = () => setTheme(resolveTheme(themePref));
    apply();
    if (themePref !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themePref]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.motion = motion;
  }, [theme, density, motion]);

  useEffect(() => {
    sound.enabled = soundOn;
    sound.volume = volume;
  }, [soundOn, volume]);

  useEffect(() => {
    // Browsers only allow audio after a user gesture.
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return { theme };
}
