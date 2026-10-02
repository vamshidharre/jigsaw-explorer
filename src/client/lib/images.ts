/**
 * Image loading and client-side processing of user uploads.
 *
 * Uploaded photos are decoded, validated and downscaled in the browser so that
 * huge camera images never slow the game down. Single-player uploads never
 * leave the device; multiplayer uploads send the processed copy to the server
 * (which validates it again).
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 2400;
const MIN_DIMENSION = 200;
const MAX_ASPECT = 4;

export class ImageLoadError extends Error {}

export interface LoadedImage {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
}

/** Fetches and decodes an image, with a timeout and helpful errors. */
export async function loadImage(url: string, signal?: AbortSignal): Promise<LoadedImage> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30_000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: timeout.signal });
    if (!res.ok) {
      throw new ImageLoadError(res.status === 404 ? 'This puzzle image is no longer available.' : `The image could not be loaded (HTTP ${res.status}).`);
    }
    const blob = await res.blob();
    return await decodeBlob(blob);
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (err instanceof ImageLoadError) throw err;
    if (timeout.signal.aborted) throw new ImageLoadError('Loading the image took too long. Check your connection and try again.');
    throw new ImageLoadError('The image could not be loaded. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function decodeBlob(blob: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height };
    } catch {
      // Fall back to <img>, which supports a few more formats on some browsers (e.g. HEIC on Safari).
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    throw new ImageLoadError('That file could not be read as an image. Try a JPG, PNG or WebP.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export interface ProcessedUpload {
  blob: Blob;
  width: number;
  height: number;
  /** Small JPEG data URL for lists and previews. */
  thumbnail: string;
  name: string;
}

export async function processUpload(file: File): Promise<ProcessedUpload> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new ImageLoadError('Please choose an image file (JPG, PNG, WebP or GIF).');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageLoadError(`That image is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). The limit is 25 MB.`);
  }
  if (file.size === 0) throw new ImageLoadError('That file is empty.');
  const decoded = await decodeBlob(file);
  const { width, height } = decoded;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new ImageLoadError(`That image is too small (${width}×${height}). Use one at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`);
  }
  if (Math.max(width / height, height / width) > MAX_ASPECT) {
    throw new ImageLoadError('That image is too long and narrow for a puzzle. Try one closer to a rectangle.');
  }
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageLoadError('Your browser could not process this image.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.source, 0, 0, w, h);
  if ('close' in decoded.source) decoded.source.close();

  let blob = await canvasToBlob(canvas, 'image/webp', 0.88);
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  if (!blob) throw new ImageLoadError('Your browser could not process this image.');

  const thumbScale = Math.min(1, 320 / Math.max(w, h));
  const thumb = document.createElement('canvas');
  thumb.width = Math.round(w * thumbScale);
  thumb.height = Math.round(h * thumbScale);
  thumb.getContext('2d')!.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  const thumbnail = thumb.toDataURL('image/jpeg', 0.72);
  canvas.width = 0;
  canvas.height = 0;

  const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'My photo';
  return { blob, width: w, height: h, thumbnail, name };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
