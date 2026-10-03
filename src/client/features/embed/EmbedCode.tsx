import { useId, useState } from 'react';
import { Check, Code2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogImage } from '../../../shared/catalog';
import { DIFFICULTY_PRESETS, gridForPieceCount, maxPiecesForImage } from '../../../shared/puzzle/spec';
import { Button } from '../../components/ui/Button';
import { Segmented, type SegmentOption } from '../../components/ui/Controls';
import { copyText } from '../../lib/share';

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Copy-paste iframe code so blogs, schools and newsletters can host a playable puzzle. */
export function EmbedCode({ image }: { image: CatalogImage }) {
  const max = maxPiecesForImage(image.width, image.height);
  const options: ReadonlyArray<SegmentOption<string>> = DIFFICULTY_PRESETS.slice(0, 3)
    .filter((p) => p.pieces <= max * 1.15)
    .map((p) => {
      const g = gridForPieceCount(Math.min(p.pieces, max), image.width, image.height);
      return { value: String(g.cols * g.rows), label: `${p.label} · ${g.cols * g.rows}` };
    });
  const [pieces, setPieces] = useState(options[1]?.value ?? options[0]!.value);
  const [copied, setCopied] = useState(false);
  const codeId = useId();
  const src = `${location.origin}/embed/${image.id}?pieces=${pieces}`;
  const code = `<iframe src="${attr(src)}" title="${attr(`${image.title} jigsaw puzzle`)}" width="100%" height="560" style="border:0;border-radius:12px;max-width:960px" allow="fullscreen" loading="lazy"></iframe>`;

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error('Copying is not available here. Select the code and copy it manually.');
    }
  };

  return (
    <details className="embed-box">
      <summary>
        <Code2 aria-hidden="true" />
        Put this puzzle on your website
      </summary>
      <div className="embed-box__body">
        <p className="field__hint">Free for blogs, classrooms and newsletters. Visitors play right on your page; their progress is saved in their browser.</p>
        <Segmented label="Embedded puzzle size" value={pieces} onValueChange={setPieces} options={options} />
        <label className="field__label" htmlFor={codeId}>
          Code to paste into your page
        </label>
        <textarea id={codeId} className="input input--multiline embed-box__code" readOnly rows={3} value={code} onFocus={(e) => e.currentTarget.select()} />
        <div>
          <Button onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy code'}
          </Button>
        </div>
        <span className="visually-hidden" aria-live="polite">
          {copied ? 'Code copied to clipboard' : ''}
        </span>
      </div>
    </details>
  );
}
