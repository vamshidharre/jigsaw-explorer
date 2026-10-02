import { useEffect } from 'react';
import { Dialog } from '../../components/ui/Dialog';
import { Kbd } from '../../components/ui/Button';
import { useUi } from '../../app/uiStore';

const SECTIONS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Mouse & trackpad',
    rows: [
      ['Drag a piece', 'Move it (and everything joined to it)'],
      ['Drag the table', 'Pan around'],
      ['Scroll wheel / pinch', 'Zoom at the cursor'],
      ['Two-finger scroll', 'Pan (trackpad)'],
      ['Right-click or double-click', 'Rotate a piece (rotation puzzles)'],
      ['Space + drag', 'Pan, even over pieces'],
    ],
  },
  {
    title: 'Touch',
    rows: [
      ['Drag a piece', 'Move it'],
      ['Drag the table', 'Pan around'],
      ['Pinch', 'Zoom'],
      ['Double-tap a piece', 'Rotate it (rotation puzzles)'],
      ['Second finger while dragging', 'Rotate the piece you hold'],
      ['Double-tap the table', 'Zoom in'],
    ],
  },
  {
    title: 'Keyboard',
    rows: [
      ['N / Shift+N', 'Select next / previous piece'],
      ['Enter', 'Pick up or drop the selected piece'],
      ['Arrow keys', 'Move the held piece (Shift: faster), or pan'],
      ['R', 'Rotate the selected piece'],
      ['Esc', 'Cancel the move'],
      ['+ / − / 0', 'Zoom in / out / fit everything'],
      ['B', 'Fit the board'],
      ['E', 'Edge pieces only'],
      ['G', 'Faint picture on the board'],
      ['I', 'Reference image'],
      ['Shift+S', 'Shuffle loose pieces'],
      ['P', 'Pause (solo)'],
      ['F', 'Full screen'],
      [',', 'Settings'],
      ['?', 'This help'],
    ],
  },
];

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen} title="Controls & shortcuts" width={720} mobileSheet>
      <div className="help">
        {SECTIONS.map((section) => (
          <section key={section.title} className="help__section">
            <h3>{section.title}</h3>
            <dl>
              {section.rows.map(([k, v]) => (
                <div key={k} className="help__row">
                  <dt>{section.title === 'Keyboard' ? k.split(' / ').map((part, i) => <span key={part}>{i > 0 && ' / '}<Kbd>{part}</Kbd></span>) : k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="help__tip">Tip: start with the edge pieces — press E to hide everything else.</p>
      </div>
    </Dialog>
  );
}
