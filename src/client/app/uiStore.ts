import { create } from 'zustand';
import type { ProcessedUpload } from '../lib/images';

export type SetupTarget =
  | { kind: 'catalog'; id: string }
  | { kind: 'local'; upload: ProcessedUpload };

/** solo: start alone · room: create a new room · update: host picks a new puzzle for the current room. */
export type SetupMode = 'solo' | 'room' | 'update';

interface UiState {
  settingsOpen: boolean;
  helpOpen: boolean;
  setup: { target: SetupTarget; mode: SetupMode } | null;
  setSettingsOpen(open: boolean): void;
  setHelpOpen(open: boolean): void;
  openSetup(target: SetupTarget, mode?: SetupMode): void;
  closeSetup(): void;
}

export const useUi = create<UiState>((set) => ({
  settingsOpen: false,
  helpOpen: false,
  setup: null,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  openSetup: (target, mode = 'solo') => set({ setup: { target, mode } }),
  closeSetup: () => set({ setup: null }),
}));
