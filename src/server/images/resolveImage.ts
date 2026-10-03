import { getCatalogImage } from '../../shared/catalog';
import type { ImageRef } from '../../shared/protocol';
import type { UploadStore } from './uploadStore';

export interface ResolvedImage {
  width: number;
  height: number;
  /** Catalogue title, or null for uploaded photos. */
  title: string | null;
}

/** Dimensions of a catalogue picture or a stored upload; null when it does not exist (anymore). */
export function resolveImage(ref: ImageRef, uploads: UploadStore): ResolvedImage | null {
  if (ref.kind === 'catalog') {
    const img = getCatalogImage(ref.id);
    return img ? { width: img.width, height: img.height, title: img.title } : null;
  }
  const upload = uploads.get(ref.id);
  return upload ? { width: upload.width, height: upload.height, title: null } : null;
}
