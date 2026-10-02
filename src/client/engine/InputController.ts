/**
 * Unified pointer handling for mouse, pen and touch.
 *
 *  - Press on a piece: drag it (the whole group moves).
 *  - Press on empty table / middle mouse / space + drag: pan.
 *  - Two fingers: pinch to zoom and pan. A second finger while dragging a
 *    piece rotates it (rotation puzzles).
 *  - Wheel: zoom around the cursor; trackpad two-finger scroll pans.
 *  - Right click or double click/tap on a piece: rotate it.
 *  - Double tap on the table: zoom in.
 */
export interface InputTarget {
  hitTest(sx: number, sy: number, pointerType: string): number | null;
  beginDrag(groupId: number, sx: number, sy: number): boolean;
  dragTo(sx: number, sy: number): void;
  endDrag(): void;
  rotateAt(groupId: number | null, sx: number, sy: number): void;
  isDragging(): boolean;
  draggedGroup(): number | null;
  panBy(dx: number, dy: number): void;
  zoomAt(sx: number, sy: number, factor: number): void;
  pointerMoved(sx: number, sy: number): void;
  pointerLeft(): void;
  autoPanTick(sx: number, sy: number): boolean;
  canInteract(): boolean;
}

interface TrackedPointer {
  id: number;
  type: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'drag'; pointer: number }
  | { kind: 'pan'; pointer: number }
  | { kind: 'pinch'; a: number; b: number; dist: number; cx: number; cy: number };

const TAP_MOVE = 8;
const TAP_TIME = 280;
const DOUBLE_TAP_TIME = 320;

export class InputController {
  private readonly pointers = new Map<number, TrackedPointer>();
  private mode: Mode = { kind: 'idle' };
  private spaceDown = false;
  private lastTap: { time: number; x: number; y: number } | null = null;
  private hoverFrame = 0;
  private autoPanFrame = 0;
  private lastDragPos: [number, number] | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly el: HTMLElement,
    private readonly target: InputTarget,
  ) {
    const opts = { signal: this.abort.signal };
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown, opts);
    el.addEventListener('pointermove', this.onMove, opts);
    el.addEventListener('pointerup', this.onUp, opts);
    el.addEventListener('pointercancel', this.onUp, opts);
    el.addEventListener('pointerleave', this.onLeave, opts);
    el.addEventListener('wheel', this.onWheel, { passive: false, signal: this.abort.signal });
    el.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    // Safari's proprietary pinch events would otherwise zoom the page.
    el.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
    window.addEventListener('keydown', this.onKeyDown, opts);
    window.addEventListener('keyup', this.onKeyUp, opts);
    window.addEventListener('blur', () => (this.spaceDown = false), opts);
  }

  destroy(): void {
    this.abort.abort();
    cancelAnimationFrame(this.hoverFrame);
    cancelAnimationFrame(this.autoPanFrame);
  }

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const rect = this.el.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !isTypingTarget(e.target)) {
      this.spaceDown = true;
      if (this.mode.kind === 'idle') this.el.style.cursor = 'grab';
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      if (this.mode.kind === 'idle') this.el.style.cursor = '';
    }
  };

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    const [x, y] = this.local(e);
    // The browser focuses the (tabindex) canvas on press by itself, without showing a keyboard focus ring.

    if (e.button === 2) {
      // Right click rotates the piece under the cursor (or the one being dragged).
      e.preventDefault();
      if (this.target.canInteract()) this.target.rotateAt(this.target.draggedGroup() ?? this.target.hitTest(x, y, e.pointerType), x, y);
      return;
    }

    const p: TrackedPointer = { id: e.pointerId, type: e.pointerType, x, y, startX: x, startY: y, startTime: performance.now() };
    this.pointers.set(e.pointerId, p);
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic events; dragging still works within the element.
    }

    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      if (this.mode.kind === 'drag') {
        // Second finger while dragging: rotate the dragged piece.
        if (this.target.canInteract()) this.target.rotateAt(this.target.draggedGroup(), a!.x, a!.y);
        this.pointers.delete(e.pointerId);
        return;
      }
      this.mode = { kind: 'pinch', a: a!.id, b: b!.id, dist: dist(a!, b!), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;

    const wantsPan = e.button === 1 || this.spaceDown;
    if (!wantsPan && this.target.canInteract()) {
      const hit = this.target.hitTest(x, y, e.pointerType);
      if (hit !== null && this.target.beginDrag(hit, x, y)) {
        this.mode = { kind: 'drag', pointer: e.pointerId };
        this.lastDragPos = [x, y];
        this.el.style.cursor = 'grabbing';
        this.startAutoPan();
        return;
      }
    }
    this.mode = { kind: 'pan', pointer: e.pointerId };
    this.el.style.cursor = 'grabbing';
  };

  private onMove = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // Plain hover (mouse/pen without buttons).
      this.scheduleHover(x, y);
      return;
    }
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;

    switch (this.mode.kind) {
      case 'drag':
        if (this.mode.pointer === e.pointerId) {
          this.lastDragPos = [x, y];
          this.target.dragTo(x, y);
          this.target.pointerMoved(x, y);
        }
        break;
      case 'pan':
        if (this.mode.pointer === e.pointerId) {
          this.target.panBy(dx, dy);
          this.target.pointerMoved(x, y);
        }
        break;
      case 'pinch': {
        const a = this.pointers.get(this.mode.a);
        const b = this.pointers.get(this.mode.b);
        if (!a || !b) break;
        const d = dist(a, b);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        this.target.panBy(cx - this.mode.cx, cy - this.mode.cy);
        if (this.mode.dist > 0 && d > 0) this.target.zoomAt(cx, cy, d / this.mode.dist);
        this.mode = { ...this.mode, dist: d, cx, cy };
        break;
      }
      default:
        break;
    }
  };

  private onUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const moved = Math.hypot(p.x - p.startX, p.y - p.startY);
    const quick = performance.now() - p.startTime < TAP_TIME;

    if (this.mode.kind === 'drag' && this.mode.pointer === e.pointerId) {
      this.target.endDrag();
      this.mode = { kind: 'idle' };
      this.lastDragPos = null;
    } else if (this.mode.kind === 'pan' && this.mode.pointer === e.pointerId) {
      this.mode = { kind: 'idle' };
    } else if (this.mode.kind === 'pinch') {
      // Continue panning with the remaining finger.
      const remaining = Array.from(this.pointers.values())[0];
      this.mode = remaining ? { kind: 'pan', pointer: remaining.id } : { kind: 'idle' };
      return;
    }
    this.el.style.cursor = '';

    if (moved < TAP_MOVE && quick && e.type === 'pointerup') this.handleTap(p);
  };

  private handleTap(p: TrackedPointer): void {
    const now = performance.now();
    const last = this.lastTap;
    if (last && now - last.time < DOUBLE_TAP_TIME && Math.hypot(p.x - last.x, p.y - last.y) < 30) {
      this.lastTap = null;
      const hit = this.target.canInteract() ? this.target.hitTest(p.x, p.y, p.type) : null;
      if (hit !== null) this.target.rotateAt(hit, p.x, p.y);
      else this.target.zoomAt(p.x, p.y, 1.6);
      return;
    }
    this.lastTap = { time: now, x: p.x, y: p.y };
  }

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.pointers.size === 0) this.target.pointerLeft();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [x, y] = this.local(e);
    const lineScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.el.clientHeight : 1;
    const dx = e.deltaX * lineScale;
    const dy = e.deltaY * lineScale;
    // Trackpads report pinch as ctrl+wheel and two-finger scroll as fractional or horizontal deltas.
    const looksLikeTrackpadScroll = !e.ctrlKey && e.deltaMode === 0 && (Math.abs(dx) > 0.5 || !Number.isInteger(dy) || Math.abs(dy) < 4);
    if (looksLikeTrackpadScroll && !e.shiftKey) {
      this.target.panBy(-dx, -dy);
      return;
    }
    if (e.shiftKey && !e.ctrlKey) {
      this.target.panBy(-(dy || dx), 0);
      return;
    }
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
    this.target.zoomAt(x, y, Math.min(1.5, Math.max(0.66, factor)));
    if (this.mode.kind === 'drag' && this.lastDragPos) this.target.dragTo(this.lastDragPos[0], this.lastDragPos[1]);
  };

  private scheduleHover(x: number, y: number): void {
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = requestAnimationFrame(() => {
      this.target.pointerMoved(x, y);
      if (this.mode.kind !== 'idle') return;
      const hit = this.spaceDown || !this.target.canInteract() ? null : this.target.hitTest(x, y, 'mouse');
      this.el.style.cursor = this.spaceDown ? 'grab' : hit !== null ? 'grab' : '';
    });
  }

  /** While dragging near the viewport edge, keep panning so pieces can travel off-screen. */
  private startAutoPan(): void {
    const loop = () => {
      if (this.mode.kind !== 'drag' || !this.lastDragPos) return;
      const [x, y] = this.lastDragPos;
      if (this.target.autoPanTick(x, y)) this.target.dragTo(x, y);
      this.autoPanFrame = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.autoPanFrame);
    this.autoPanFrame = requestAnimationFrame(loop);
  }

  /** Cancels any interaction, e.g. when the game is paused or the connection drops. */
  reset(): void {
    if (this.mode.kind === 'drag') this.target.endDrag();
    this.mode = { kind: 'idle' };
    this.pointers.clear();
    this.lastDragPos = null;
    this.el.style.cursor = '';
  }
}

function dist(a: TrackedPointer, b: TrackedPointer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
