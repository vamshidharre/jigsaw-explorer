import { useId, useMemo } from 'react';
import { generateShapes, outlineToSvgPath } from '../../shared/puzzle/shapes';

interface Lifted {
  piece: number;
  dx: number;
  dy: number;
  rotate: number;
}

/**
 * Decorative illustration built with the real piece generator: a picture cut
 * into pieces, with a few pieces lifted out of the board.
 */
export function PuzzleArt({
  src,
  width,
  height,
  cols = 5,
  rows = 4,
  seed = 7,
  lifted = [],
  className,
}: {
  src: string;
  width: number;
  height: number;
  cols?: number;
  rows?: number;
  seed?: number;
  lifted?: Lifted[];
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const shapes = useMemo(() => generateShapes({ seed, cols, rows, width, height }), [seed, cols, rows, width, height]);
  const liftedMap = new Map(lifted.map((l) => [l.piece, l]));
  const pad = Math.max(width, height) * 0.12;
  const pw = width / cols;
  const ph = height / rows;
  const order = [...shapes.outlines.keys()].sort((a, b) => Number(liftedMap.has(a)) - Number(liftedMap.has(b)));

  return (
    <svg className={className} viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`} role="img" aria-label="A jigsaw puzzle with a few pieces lifted out">
      <defs>
        <filter id={`${uid}-lift`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy={height * 0.02} stdDeviation={height * 0.018} floodColor="#000" floodOpacity="0.35" />
        </filter>
        <filter id={`${uid}-flat`} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy={height * 0.008} stdDeviation={height * 0.012} floodColor="#000" floodOpacity="0.25" />
        </filter>
      </defs>
      <rect x={0} y={0} width={width} height={height} rx={width * 0.01} className="puzzle-art__board" />
      <g filter={`url(#${uid}-flat)`}>
        {order
          .filter((i) => !liftedMap.has(i))
          .map((i) => {
            const c = i % cols;
            const r = Math.floor(i / cols);
            const d = outlineToSvgPath(shapes.outlines[i]!, c * pw, r * ph, 1);
            return <PieceImage key={i} id={`${uid}-p${i}`} d={d} src={src} width={width} height={height} />;
          })}
      </g>
      {lifted.map((l) => {
        const c = l.piece % cols;
        const r = Math.floor(l.piece / cols);
        const d = outlineToSvgPath(shapes.outlines[l.piece]!, c * pw, r * ph, 1);
        const cx = (c + 0.5) * pw;
        const cy = (r + 0.5) * ph;
        return (
          <g
            key={l.piece}
            className="puzzle-art__lifted"
            style={{ transformOrigin: `${cx}px ${cy}px` }}
            transform={`translate(${l.dx} ${l.dy}) rotate(${l.rotate} ${cx} ${cy})`}
            filter={`url(#${uid}-lift)`}
          >
            <PieceImage id={`${uid}-p${l.piece}`} d={d} src={src} width={width} height={height} />
          </g>
        );
      })}
    </svg>
  );
}

function PieceImage({ id, d, src, width, height }: { id: string; d: string; src: string; width: number; height: number }) {
  return (
    <g>
      <clipPath id={id}>
        <path d={d} />
      </clipPath>
      <image href={src} width={width} height={height} clipPath={`url(#${id})`} preserveAspectRatio="none" />
      <path d={d} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth={Math.max(width, height) * 0.0018} />
      <path d={d} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={Math.max(width, height) * 0.0012} transform={`translate(${-width * 0.001} ${-width * 0.001})`} />
    </g>
  );
}
