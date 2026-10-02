import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { SnapStrength } from '../../../shared/puzzle/model';
import type { OutlineStyle } from '../../engine/PieceAtlas';

export type ThemePreference = 'system' | 'light' | 'dark';
export type TableStyle = 'slate' | 'felt' | 'walnut' | 'linen' | 'charcoal';
export type Density = 'comfortable' | 'compact';
export type MotionPreference = 'system' | 'reduced' | 'full';

export interface Settings {
  snapStrength: SnapStrength;
  showTimer: boolean;
  showProgress: boolean;
  sound: boolean;
  volume: number;
  autoPause: boolean;
  autoPan: boolean;
  guide: boolean;
  guideOpacity: number;
  theme: ThemePreference;
  table: TableStyle;
  outline: OutlineStyle;
  bevel: boolean;
  shadows: boolean;
  density: Density;
  motion: MotionPreference;
  announcements: boolean;
  playerName: string;
}

export const DEFAULT_SETTINGS: Settings = {
  snapStrength: 'normal',
  showTimer: true,
  showProgress: true,
  sound: true,
  volume: 0.6,
  autoPause: true,
  autoPan: true,
  guide: true,
  guideOpacity: 0.22,
  theme: 'system',
  table: 'slate',
  outline: 'subtle',
  bevel: true,
  shadows: true,
  density: 'comfortable',
  motion: 'system',
  announcements: true,
  playerName: '',
};

interface SettingsState extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset(): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
      reset: () => set((s) => ({ ...DEFAULT_SETTINGS, playerName: s.playerName })),
    }),
    {
      name: 'jigsaw.settings.v1',
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage()),
      // Ignore unknown/invalid persisted values rather than crashing on them.
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
    },
  ),
);

function sanitize(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Settings> = {};
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    const value = src[key];
    if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

const memory = new Map<string, string>();

/** localStorage, or an in-memory fallback when storage is blocked (private modes, embedded views). */
export function safeLocalStorage(): Storage {
  try {
    const k = '__jigsaw_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return {
      get length() {
        return memory.size;
      },
      clear: () => memory.clear(),
      getItem: (k) => memory.get(k) ?? null,
      key: (i) => Array.from(memory.keys())[i] ?? null,
      removeItem: (k) => void memory.delete(k),
      setItem: (k, v) => void memory.set(k, v),
    };
  }
}

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function resolveReducedMotion(pref: MotionPreference): boolean {
  return pref === 'reduced' || (pref === 'system' && prefersReducedMotion());
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface TableDefinition {
  id: TableStyle;
  label: string;
  /** Colours used for the board area drawn on the canvas. */
  boardFill: string;
  boardEdge: string;
  shadowAlpha: number;
  swatch: string;
}

export const TABLES: readonly TableDefinition[] = [
  { id: 'slate', label: 'Slate', boardFill: 'rgba(10,14,20,0.30)', boardEdge: 'rgba(255,255,255,0.14)', shadowAlpha: 0.55, swatch: '#39414a' },
  { id: 'felt', label: 'Green felt', boardFill: 'rgba(0,20,10,0.28)', boardEdge: 'rgba(255,255,255,0.14)', shadowAlpha: 0.55, swatch: '#2f5b45' },
  { id: 'walnut', label: 'Walnut', boardFill: 'rgba(30,14,4,0.32)', boardEdge: 'rgba(255,230,200,0.16)', shadowAlpha: 0.6, swatch: '#6b4529' },
  { id: 'linen', label: 'Linen', boardFill: 'rgba(90,70,40,0.10)', boardEdge: 'rgba(60,45,25,0.22)', shadowAlpha: 0.35, swatch: '#e6dfd1' },
  { id: 'charcoal', label: 'Charcoal', boardFill: 'rgba(255,255,255,0.04)', boardEdge: 'rgba(255,255,255,0.10)', shadowAlpha: 0.7, swatch: '#18191c' },
];

export function tableDefinition(id: TableStyle): TableDefinition {
  return TABLES.find((t) => t.id === id) ?? TABLES[0]!;
}
