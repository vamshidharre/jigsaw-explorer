import catalogData from './catalog.data.json';

export type CategoryId = 'landscapes' | 'up-close' | 'places' | 'fine-art';

export interface CatalogImage {
  id: string;
  title: string;
  category: CategoryId;
  width: number;
  height: number;
  /** Average colour, used as a loading placeholder. */
  color: string;
  /** Tiny blurred data URL preview. */
  blur: string;
  credit: string;
  license: string;
}

export const CATEGORIES: ReadonlyArray<{ id: CategoryId; label: string }> = [
  { id: 'landscapes', label: 'Landscapes' },
  { id: 'up-close', label: 'Up close' },
  { id: 'places', label: 'Places' },
  { id: 'fine-art', label: 'Fine art' },
];

export const CATALOG: readonly CatalogImage[] = catalogData as CatalogImage[];

const byId = new Map(CATALOG.map((img) => [img.id, img]));

export function getCatalogImage(id: string): CatalogImage | undefined {
  return byId.get(id);
}

export function catalogImageUrl(id: string): string {
  return `/gallery/${id}.webp`;
}

export function catalogThumbUrl(id: string): string {
  return `/gallery/${id}-thumb.webp`;
}

export const FEATURED_IMAGE_ID = 'starry-night';
