import { useState } from 'react';
import { catalogThumbUrl, type CatalogImage } from '../../shared/catalog';

/** A gallery tile. The blurred placeholder shows instantly while the thumbnail loads. */
export function PuzzleCard({ image, onSelect }: { image: CatalogImage; onSelect(image: CatalogImage): void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const portrait = image.height > image.width * 1.05;
  return (
    <button className="puzzle-card" onClick={() => onSelect(image)} aria-label={`${image.title}. Choose difficulty and start.`}>
      <span className="puzzle-card__media" style={{ backgroundColor: image.color, backgroundImage: `url(${image.blur})` }}>
        {!failed && (
          <img
            src={catalogThumbUrl(image.id)}
            alt=""
            loading="lazy"
            decoding="async"
            width={image.width}
            height={image.height}
            className={loaded ? 'is-loaded' : undefined}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
        {portrait && <span className="puzzle-card__tag">Portrait</span>}
      </span>
      <span className="puzzle-card__title">{image.title}</span>
    </button>
  );
}
