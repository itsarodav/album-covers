import { Raycaster, Vector2, type Camera, type Object3D } from 'three';
import { MOTION } from './constants';

export interface InteractionHandlers {
  /** A tap (not a drag): index of the CD under the pointer, or null for empty space */
  onTap(index: number | null): void;
  /** Mouse hover only (doesn't exist on touch) */
  onHover(index: number | null): void;
  /** Drag deltas in px, only while a CD is selected. (0, 0) on pointerdown grabs it. */
  onDrag(dx: number, dy: number): void;
  /** Release velocity in px per second; (0, 0) when held still, or after a tap */
  onDragEnd(vx: number, vy: number): void;
  isSelected(): boolean;
}

/**
 * Pointer events (one path for mouse, pen and touch) with pointer capture.
 * A pointer that moves more than MOTION.tapThreshold px between down and up is
 * a drag, never a tap: spinning a CD can't close it by accident.
 */
export class Interaction {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private pointerId: number | null = null;
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0, t: 0 };
  private velocity = { x: 0, y: 0 };
  private dragging = false;
  private hovered: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly targets: () => Object3D[],
    private readonly handlers: InteractionHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    canvas.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('pointercancel', this.handleCancel);
    canvas.addEventListener('pointerleave', this.handleLeave);
  }

  /** CD index under a client position, or null */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const [hit] = this.raycaster.intersectObjects(this.targets(), false);
    return hit ? (hit.object.userData.index as number) : null;
  }

  /** Touch: pan the page when idle; spin the CD when one is open */
  setRotateMode(enabled: boolean) {
    this.canvas.style.touchAction = enabled ? 'none' : 'pan-y';
    this.updateCursor();
  }

  private handleDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    this.start = { x: event.clientX, y: event.clientY };
    this.last = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    this.velocity = { x: 0, y: 0 };
    this.dragging = false;
    // Grab: stops the spring straight away, the case stays where it is
    if (this.handlers.isSelected()) this.handlers.onDrag(0, 0);
  };

  private handleMove = (event: PointerEvent) => {
    if (this.pointerId === null) {
      if (event.pointerType === 'mouse') this.setHovered(this.pick(event.clientX, event.clientY));
      return;
    }
    if (event.pointerId !== this.pointerId) return;

    const moved = Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y);
    if (!this.dragging && moved > MOTION.tapThreshold) this.dragging = true;

    if (this.dragging && this.handlers.isSelected()) {
      const dx = event.clientX - this.last.x;
      const dy = event.clientY - this.last.y;
      const dt = Math.max((event.timeStamp - this.last.t) / 1000, 1 / 240);
      // Smoothed velocity, used for inertia on release
      this.velocity.x = this.velocity.x * 0.6 + (dx / dt) * 0.4;
      this.velocity.y = this.velocity.y * 0.6 + (dy / dt) * 0.4;
      this.handlers.onDrag(dx, dy);
    }
    this.last = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    this.updateCursor();
  };

  private handleUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.release(event);

    if (this.dragging) {
      // Held still before letting go: no fling
      const idle = event.timeStamp - this.last.t > 80;
      if (this.handlers.isSelected()) this.handlers.onDragEnd(idle ? 0 : this.velocity.x, idle ? 0 : this.velocity.y);
    } else {
      // pointerdown grabbed the case: let go before handling the tap
      if (this.handlers.isSelected()) this.handlers.onDragEnd(0, 0);
      this.handlers.onTap(this.pick(event.clientX, event.clientY));
    }
    this.dragging = false;
    if (event.pointerType === 'mouse') this.setHovered(this.pick(event.clientX, event.clientY));
    this.updateCursor();
  };

  private handleCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.release(event);
    if (this.handlers.isSelected()) this.handlers.onDragEnd(0, 0);
    this.dragging = false;
    this.updateCursor();
  };

  private handleLeave = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && this.pointerId === null) this.setHovered(null);
  };

  private release(event: PointerEvent) {
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.pointerId = null;
  }

  private setHovered(index: number | null) {
    if (index === this.hovered) return;
    this.hovered = index;
    this.handlers.onHover(index);
    this.updateCursor();
  }

  private updateCursor() {
    let cursor = '';
    if (this.handlers.isSelected()) cursor = this.dragging ? 'grabbing' : this.hovered !== null ? 'grab' : '';
    else if (this.hovered !== null) cursor = 'pointer';
    this.canvas.dataset.cursor = cursor;
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.handleDown);
    this.canvas.removeEventListener('pointermove', this.handleMove);
    this.canvas.removeEventListener('pointerup', this.handleUp);
    this.canvas.removeEventListener('pointercancel', this.handleCancel);
    this.canvas.removeEventListener('pointerleave', this.handleLeave);
  }
}
