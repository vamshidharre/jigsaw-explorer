import { useEffect, useMemo, useState } from 'react';
import type { EngineSettings } from '../../engine/GameEngine';
import { resolveReducedMotion, resolveTheme, tableDefinition, useSettings } from '../settings/settingsStore';

/** Maps user settings (plus per-session toggles) to the engine's settings object. */
export function useEngineSettings(edgesOnly: boolean): EngineSettings {
  const s = useSettings();
  const theme = resolveTheme(s.theme);
  const [systemReduced, setSystemReduced] = useState(() => resolveReducedMotion('system'));

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const reducedMotion = s.motion === 'reduced' || (s.motion === 'system' && systemReduced);

  return useMemo<EngineSettings>(() => {
    const table = tableDefinition(s.table);
    return {
      snapStrength: s.snapStrength,
      guide: s.guide,
      guideOpacity: s.guideOpacity,
      shadows: s.shadows,
      outline: s.outline,
      bevel: s.bevel,
      reducedMotion,
      autoPan: s.autoPan,
      edgesOnly,
      theme: { boardFill: table.boardFill, boardEdge: table.boardEdge, shadowAlpha: table.shadowAlpha },
      selectionColor: theme === 'dark' ? '#2cc5ad' : '#14b8a6',
    };
  }, [s.snapStrength, s.guide, s.guideOpacity, s.shadows, s.outline, s.bevel, reducedMotion, s.autoPan, edgesOnly, s.table, theme]);
}
