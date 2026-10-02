import { useEffect, useState } from 'react';
import { Tabs } from 'radix-ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { MAX_NAME_LENGTH, sanitizeName } from '../../../shared/protocol';
import { Sheet } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Segmented, SettingRow, Slider, Switch } from '../../components/ui/Controls';
import { useUi } from '../../app/uiStore';
import { sound } from '../../lib/sound';
import { TABLES, useSettings } from './settingsStore';

export function SettingsPanel() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const s = useSettings();
  const [name, setName] = useState(s.playerName);

  useEffect(() => {
    if (open) setName(s.playerName);
  }, [open, s.playerName]);

  // "," opens settings from anywhere outside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ',' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const commitName = () => {
    const clean = sanitizeName(name);
    if (clean) s.set('playerName', clean);
    else setName(s.playerName);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen} title="Settings" description="Preferences are saved on this device.">
      <Tabs.Root defaultValue="gameplay" className="settings">
        <Tabs.List className="tabs__list" aria-label="Settings sections">
          <Tabs.Trigger value="gameplay" className="tabs__trigger">
            Gameplay
          </Tabs.Trigger>
          <Tabs.Trigger value="appearance" className="tabs__trigger">
            Appearance
          </Tabs.Trigger>
          <Tabs.Trigger value="access" className="tabs__trigger">
            Accessibility
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="gameplay" className="settings__section">
          <SettingRow label="Snapping" description="How close a piece must be before it clicks into place." stacked>
            {() => (
              <Segmented
                block
                label="Snapping"
                value={s.snapStrength}
                onValueChange={(v) => s.set('snapStrength', v)}
                options={[
                  { value: 'gentle', label: 'Precise' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'strong', label: 'Forgiving' },
                ]}
              />
            )}
          </SettingRow>
          <SettingRow label="Faint picture on the board" description="Shows the finished image under the pieces as a guide.">
            {(id) => <Switch id={id} checked={s.guide} onCheckedChange={(v) => s.set('guide', v)} />}
          </SettingRow>
          {s.guide && (
            <SettingRow label="Guide opacity" stacked>
              {() => (
                <Slider
                  label="Guide opacity"
                  value={Math.round(s.guideOpacity * 100)}
                  min={5}
                  max={70}
                  step={1}
                  onValueChange={(v) => s.set('guideOpacity', v / 100)}
                  valueText={`${Math.round(s.guideOpacity * 100)} percent`}
                />
              )}
            </SettingRow>
          )}
          <SettingRow label="Show timer">{(id) => <Switch id={id} checked={s.showTimer} onCheckedChange={(v) => s.set('showTimer', v)} />}</SettingRow>
          <SettingRow label="Show progress">{(id) => <Switch id={id} checked={s.showProgress} onCheckedChange={(v) => s.set('showProgress', v)} />}</SettingRow>
          <SettingRow label="Pause when I switch tabs" description="Solo puzzles stop the clock while the page is hidden.">
            {(id) => <Switch id={id} checked={s.autoPause} onCheckedChange={(v) => s.set('autoPause', v)} />}
          </SettingRow>
          <SettingRow label="Scroll at screen edges" description="Pan the table when you drag a piece to the edge of the screen.">
            {(id) => <Switch id={id} checked={s.autoPan} onCheckedChange={(v) => s.set('autoPan', v)} />}
          </SettingRow>
          <SettingRow label="Sound effects">
            {(id) => (
              <Switch
                id={id}
                checked={s.sound}
                onCheckedChange={(v) => {
                  s.set('sound', v);
                  if (v) {
                    sound.enabled = true;
                    sound.play('snap');
                  }
                }}
              />
            )}
          </SettingRow>
          {s.sound && (
            <SettingRow label="Volume" stacked>
              {() => (
                <Slider
                  label="Volume"
                  value={Math.round(s.volume * 100)}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(v) => s.set('volume', v / 100)}
                  valueText={`${Math.round(s.volume * 100)} percent`}
                />
              )}
            </SettingRow>
          )}
          <div className="settings__name">
            <label className="field__label" htmlFor="settings-name">
              Your name in multiplayer rooms
            </label>
            <input
              id="settings-name"
              className="input"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name"
              autoComplete="nickname"
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && commitName()}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value="appearance" className="settings__section">
          <SettingRow label="Theme" stacked>
            {() => (
              <Segmented
                block
                label="Theme"
                value={s.theme}
                onValueChange={(v) => s.set('theme', v)}
                options={[
                  { value: 'system', label: <><Monitor size={15} /> System</> },
                  { value: 'light', label: <><Sun size={15} /> Light</> },
                  { value: 'dark', label: <><Moon size={15} /> Dark</> },
                ]}
              />
            )}
          </SettingRow>
          <SettingRow label="Table" description="The surface the puzzle sits on." stacked>
            {() => (
              <div className="swatches" role="radiogroup" aria-label="Table">
                {TABLES.map((t) => (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={s.table === t.id}
                    className={`swatch table-${t.id}`}
                    onClick={() => s.set('table', t.id)}
                  >
                    <span className="swatch__label">{t.label}</span>
                  </button>
                ))}
              </div>
            )}
          </SettingRow>
          <SettingRow label="Piece outlines" description="Helps tell neighbouring pieces apart." stacked>
            {() => (
              <Segmented
                block
                label="Piece outlines"
                value={s.outline}
                onValueChange={(v) => s.set('outline', v)}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'subtle', label: 'Subtle' },
                  { value: 'bold', label: 'Bold' },
                ]}
              />
            )}
          </SettingRow>
          <SettingRow label="Bevelled edges" description="Gives pieces a slightly raised, cardboard look.">
            {(id) => <Switch id={id} checked={s.bevel} onCheckedChange={(v) => s.set('bevel', v)} />}
          </SettingRow>
          <SettingRow label="Piece shadows" description="Turn off for smoother play on slower devices.">
            {(id) => <Switch id={id} checked={s.shadows} onCheckedChange={(v) => s.set('shadows', v)} />}
          </SettingRow>
          <SettingRow label="Interface density" stacked>
            {() => (
              <Segmented
                block
                label="Interface density"
                value={s.density}
                onValueChange={(v) => s.set('density', v)}
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
              />
            )}
          </SettingRow>
        </Tabs.Content>

        <Tabs.Content value="access" className="settings__section">
          <SettingRow label="Motion" description="Reduce animations such as snapping slides, camera moves and celebrations." stacked>
            {() => (
              <Segmented
                block
                label="Motion"
                value={s.motion}
                onValueChange={(v) => s.set('motion', v)}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'reduced', label: 'Reduced' },
                  { value: 'full', label: 'Full' },
                ]}
              />
            )}
          </SettingRow>
          <SettingRow label="Screen reader announcements" description="Announce snaps and progress through a live region.">
            {(id) => <Switch id={id} checked={s.announcements} onCheckedChange={(v) => s.set('announcements', v)} />}
          </SettingRow>
          <div className="settings__note">
            <p>
              The board can be played with the keyboard: press <kbd className="kbd">N</kbd> to select a piece, <kbd className="kbd">Enter</kbd> to pick it
              up or drop it and the arrow keys to move it.
            </p>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                useUi.getState().setHelpOpen(true);
              }}
            >
              All controls & shortcuts
            </Button>
          </div>
        </Tabs.Content>
      </Tabs.Root>
      <div className="settings__footer">
        <Button variant="ghost" size="sm" onClick={() => s.reset()}>
          Reset to defaults
        </Button>
      </div>
    </Sheet>
  );
}
