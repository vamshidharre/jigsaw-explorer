/**
 * Maps world coordinates to screen (CSS pixel) coordinates:
 *   screen = world * zoom + pan
 */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  zoom = 1;
  panX = 0;
  panY = 0;
  viewWidth = 1;
  viewHeight = 1;
  minZoom = 0.05;
  maxZoom = 8;

  private anim: { from: [number, number, number]; to: [number, number, number]; start: number; duration: number } | null = null;

  setViewport(width: number, height: number): void {
    // Keep the centre of the view stable when the viewport resizes.
    const cx = (this.viewWidth / 2 - this.panX) / this.zoom;
    const cy = (this.viewHeight / 2 - this.panY) / this.zoom;
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
    this.panX = this.viewWidth / 2 - cx * this.zoom;
    this.panY = this.viewHeight / 2 - cy * this.zoom;
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom];
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.zoom + this.panX, wy * this.zoom + this.panY];
  }

  /** The world-space rectangle currently visible. */
  visibleWorld(margin = 0): Rect {
    const [minX, minY] = this.toWorld(-margin, -margin);
    const [maxX, maxY] = this.toWorld(this.viewWidth + margin, this.viewHeight + margin);
    return { minX, minY, maxX, maxY };
  }

  panBy(dx: number, dy: number): void {
    this.anim = null;
    this.panX += dx;
    this.panY += dy;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.anim = null;
    const next = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = next;
    this.panX = sx - wx * next;
    this.panY = sy - wy * next;
  }

  /** Zoom level that fits `rect` into the viewport with `padding` CSS pixels around it. */
  fitZoom(rect: Rect, padding: number): number {
    const w = Math.max(1, rect.maxX - rect.minX);
    const h = Math.max(1, rect.maxY - rect.minY);
    return Math.min((this.viewWidth - padding * 2) / w, (this.viewHeight - padding * 2) / h);
  }

  /** Centres `rect` in the view, optionally animating there. */
  fit(rect: Rect, padding: number, animateMs = 0, insets = { top: 0, bottom: 0 }): void {
    const availH = this.viewHeight - insets.top - insets.bottom;
    const w = Math.max(1, rect.maxX - rect.minX);
    const h = Math.max(1, rect.maxY - rect.minY);
    const zoom = clamp(Math.min((this.viewWidth - padding * 2) / w, (availH - padding * 2) / h), this.minZoom, this.maxZoom);
    const panX = this.viewWidth / 2 - ((rect.minX + rect.maxX) / 2) * zoom;
    const panY = insets.top + availH / 2 - ((rect.minY + rect.maxY) / 2) * zoom;
    this.animateTo(zoom, panX, panY, animateMs);
  }

  /** Smoothly zooms by `factor` around the view centre. */
  zoomCentered(factor: number, animateMs = 0): void {
    const zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    const [wx, wy] = this.toWorld(cx, cy);
    this.animateTo(zoom, cx - wx * zoom, cy - wy * zoom, animateMs);
  }

  /** Pans so that the world point ends up at the centre of the view. */
  centerOn(wx: number, wy: number, animateMs = 0): void {
    this.animateTo(this.zoom, this.viewWidth / 2 - wx * this.zoom, this.viewHeight / 2 - wy * this.zoom, animateMs);
  }

  animateTo(zoom: number, panX: number, panY: number, durationMs: number): void {
    if (durationMs <= 0) {
      this.anim = null;
      this.zoom = zoom;
      this.panX = panX;
      this.panY = panY;
      return;
    }
    this.anim = { from: [this.zoom, this.panX, this.panY], to: [zoom, panX, panY], start: performance.now(), duration: durationMs };
  }

  /** Advances any running animation. Returns true while still animating. */
  step(now: number): boolean {
    if (!this.anim) return false;
    const { from, to, start, duration } = this.anim;
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    // Interpolate zoom geometrically so zooming feels uniform.
    const zoom = from[0] * Math.pow(to[0] / from[0], e);
    // Interpolate the world point at the view centre to avoid swinging.
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    const fromWx = (cx - from[1]) / from[0];
    const fromWy = (cy - from[2]) / from[0];
    const toWx = (cx - to[1]) / to[0];
    const toWy = (cy - to[2]) / to[0];
    const wx = fromWx + (toWx - fromWx) * e;
    const wy = fromWy + (toWy - fromWy) * e;
    this.zoom = zoom;
    this.panX = cx - wx * zoom;
    this.panY = cy - wy * zoom;
    if (t >= 1) {
      this.zoom = to[0];
      this.panX = to[1];
      this.panY = to[2];
      this.anim = null;
      return false;
    }
    return true;
  }

  get animating(): boolean {
    return this.anim !== null;
  }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
