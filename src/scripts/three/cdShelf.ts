import gsap from 'gsap';
import { Euler, MathUtils, Quaternion, Vector3, type MeshBasicMaterial } from 'three';
import type { Cover } from '../../data/covers';
import { Backdrop, type AuraSource } from './backdrop';
import { breakpoints } from '../../data/breakpoints';
import { AURA, CAMERA, CASE, FOCUS, MOTION, TILT } from './constants';
import { Interaction } from './interaction';
import { CaseResources, JewelCase } from './jewelCase';
import { getColumns, getFocusRect, getLayoutMode, rectOf, type LayoutMode, type Rect } from './layout';
import { Stage } from './scene';
import { Shelf } from './shelf';
import { loadCoverTexture } from './textures';

export interface CdShelfOptions {
  canvas: HTMLCanvasElement;
  /** Box the shelves are framed into */
  stageElement: HTMLElement;
  /** Info panel: the selected CD is placed where it doesn't cover it */
  panelElement: HTMLElement;
  covers: Cover[];
  fontFamily: string;
  reducedMotion: boolean;
  parallax: boolean;
  /** Pointer taps; main.ts owns the selection state */
  onTap(index: number | null): void;
  /** A cover finished loading: its three colors for the info card's glow (CSS colors) */
  onCoverColors?(index: number, colors: string[]): void;
}

// Scratch objects, reused every frame
const tmpPosition = new Vector3();
const tmpQuaternion = new Quaternion();
const focusPosition = new Vector3();
const focusQuaternion = new Quaternion();
const swing = new Quaternion();
const spin = new Quaternion();
const delta = new Quaternion();
const toCamera = new Quaternion();
const cameraUp = new Vector3();
const cameraRight = new Vector3();
const cameraForward = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const target = { x: 0, y: 0 };
const toCase = new Vector3();
const projected = new Vector3();
/**
 * How far behind the case its drop shadow sits (cm, before scaling): more
 * than half the case's diagonal (~9.5), so a tilted corner never crosses it.
 */
const DROP_SHADOW_BEHIND = 11;

/**
 * Rubber band: 1:1 up to TILT.linear of the range, then it slows down and
 * never quite reaches `max`. `unsoft` is its inverse, so grabbing a case that
 * is still moving doesn't make it jump.
 */
function soft(raw: number, max: number) {
  const k = max * TILT.linear;
  const a = Math.abs(raw);
  if (a <= k) return raw;
  return Math.sign(raw) * (k + (max - k) * Math.tanh((a - k) / (max - k)));
}

function unsoft(value: number, max: number) {
  const k = max * TILT.linear;
  const a = Math.min(Math.abs(value), max * 0.999);
  if (a <= k) return Math.sign(value) * a;
  return Math.sign(value) * (k + (max - k) * Math.atanh((a - k) / (max - k)));
}

/**
 * The 3D shelf: builds the cases, places them, and animates the selected one
 * between its slot and the focus pose in front of the camera. It doesn't own
 * the selection state (main.ts does); it just shows it.
 */
export class CdShelf {
  readonly stage: Stage;
  private readonly resources: CaseResources;
  private readonly cases: JewelCase[];
  private readonly shelf: Shelf;
  private readonly backdrop = new Backdrop();
  private readonly auraSources: AuraSource[] = [];
  private readonly interaction: Interaction;
  private readonly resizeObserver: ResizeObserver;

  private selected: number | null = null;
  private keyboardHover: number | null = null;
  private pointerHover: number | null = null;
  private mode: LayoutMode = 'side';
  private focusRect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private readonly parallaxTarget = { x: 0, y: 0 };
  private readonly parallaxCurrent = { x: 0, y: 0 };
  /** Mouse position over the canvas (client px), for the lean toward the cursor */
  private pointer: { x: number; y: number } | null = null;

  constructor(private readonly options: CdShelfOptions) {
    this.stage = new Stage(options.canvas);
    const { renderer, scene } = this.stage;

    this.resources = new CaseResources(renderer, this.stage.environment, this.stage.plasticEnvironment);
    this.cases = options.covers.map(
      (cover, index) => new JewelCase(cover, index, this.resources, renderer, options.fontFamily),
    );
    this.shelf = new Shelf(this.cases, renderer);
    scene.add(
      this.backdrop.mesh,
      this.shelf.group,
      ...this.cases.map((jewelCase) => jewelCase.group),
      ...this.cases.map((jewelCase) => jewelCase.dropShadow),
    );

    this.loadCovers();

    this.interaction = new Interaction(
      options.canvas,
      this.stage.camera,
      () => this.cases.map((jewelCase) => jewelCase.hitMesh),
      {
        onTap: (index) => options.onTap(index),
        onHover: (index) => {
          this.pointerHover = index;
          this.updateHoverTargets();
        },
        onDrag: (dx, dy) => this.dragSelected(dx, dy),
        onDragEnd: (vx, vy) => this.releaseSelected(vx === 0 && vy === 0),
        isSelected: () => this.selected !== null,
      },
    );

    this.stage.setFrameCallback(this.update);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(document.documentElement);
    this.resizeObserver.observe(options.stageElement);
    if (options.parallax) window.addEventListener('pointermove', this.handleParallax, { passive: true });
    options.canvas.addEventListener('pointermove', this.handlePointer, { passive: true });
    options.canvas.addEventListener('pointerleave', this.handlePointerLeave);

    this.resize();
  }

  private get selectedCase() {
    return this.selected === null ? undefined : this.cases[this.selected];
  }

  private async loadCovers() {
    await Promise.all(
      this.cases.map(async (jewelCase) => {
        try {
          jewelCase.setCoverTexture(await loadCoverTexture(jewelCase.cover.cover, this.stage.renderer));
          this.options.onCoverColors?.(jewelCase.index, jewelCase.cardColors);
          this.stage.requestRender();
        } catch (error) {
          console.warn(`Cover not found: ${jewelCase.cover.cover}`, error);
        }
      }),
    );
  }

  /** Brings a CD to the front (or puts everything back with null) */
  select(index: number | null) {
    if (index === this.selected) return;
    const previous = this.selectedCase;
    this.selected = index;

    // Selection switch goes straight from A to B, both at once
    if (previous) {
      // Its tilt springs back to rest on its own while it flies home. Ease-out:
      // it reacts the moment you close (an in-out start lagged behind the
      // card, which is already gone by then).
      previous.drag = null;
      gsap.to(previous, {
        open: 0,
        duration: this.duration(this.mode === 'stacked' ? MOTION.closeStacked : MOTION.close),
        ease: 'power3.out',
        overwrite: 'auto',
        onUpdate: this.stage.requestRender,
      });
    }

    const next = this.selectedCase;
    if (next) {
      next.hoverTarget = 0;
      if (next.open === 0) {
        next.drag = null;
        next.tilt.x = next.tilt.y = next.tiltVelocity.x = next.tiltVelocity.y = 0;
      }
      gsap.to(next, {
        open: 1,
        duration: this.duration(this.mode === 'stacked' ? MOTION.openStacked : MOTION.open),
        ease: 'power3.out',
        overwrite: 'auto',
        onUpdate: this.stage.requestRender,
      });
    }

    this.interaction.setRotateMode(index !== null);
    this.updateFocusRect();
    this.updateHoverTargets();
    this.stage.requestRender();
  }

  /** Keyboard focus on a hidden button lifts its CD, like hover */
  setKeyboardHover(index: number | null) {
    this.keyboardHover = index;
    this.updateHoverTargets();
  }

  /** Arrow keys: a little kick, then it springs back (same limits as dragging) */
  nudge(x: number, y: number) {
    const jewelCase = this.selectedCase;
    if (!jewelCase) return;
    jewelCase.tiltVelocity.x += x * TILT.keyKick;
    jewelCase.tiltVelocity.y += y * TILT.keyKick;
    this.stage.requestRender();
  }

  private duration(seconds: number) {
    return this.options.reducedMotion ? MOTION.reducedMotion : seconds;
  }

  private updateHoverTargets() {
    for (const jewelCase of this.cases) {
      const isHovered = jewelCase.index === this.pointerHover || jewelCase.index === this.keyboardHover;
      jewelCase.hoverTarget = isHovered && jewelCase.index !== this.selected ? 1 : 0;
    }
    this.stage.requestRender();
  }

  /** Drag deltas in px. The first call (pointerdown, 0/0) grabs the case where it is. */
  private dragSelected(dx: number, dy: number) {
    const jewelCase = this.selectedCase;
    if (!jewelCase) return;
    if (!jewelCase.drag) {
      jewelCase.drag = { x: unsoft(jewelCase.tilt.x, TILT.maxYaw), y: unsoft(jewelCase.tilt.y, TILT.maxPitch) };
      jewelCase.tiltVelocity.x = jewelCase.tiltVelocity.y = 0;
    }
    jewelCase.drag.x += dx * TILT.dragSpeed;
    jewelCase.drag.y += dy * TILT.dragSpeed;
    this.stage.requestRender();
  }

  /** Let go: the spring takes it back to rest, keeping the fling unless it was held still */
  private releaseSelected(still: boolean) {
    const jewelCase = this.selectedCase;
    if (!jewelCase) return;
    jewelCase.drag = null;
    if (still || this.options.reducedMotion) jewelCase.tiltVelocity.x = jewelCase.tiltVelocity.y = 0;
    this.stage.requestRender();
  }

  /** Where the tilt wants to be: the drag, a lean toward the mouse, or rest */
  private tiltTarget(jewelCase: JewelCase, out: { x: number; y: number }) {
    out.x = out.y = 0;
    if (jewelCase.drag) {
      out.x = soft(jewelCase.drag.x, TILT.maxYaw);
      out.y = soft(jewelCase.drag.y, TILT.maxPitch);
      return;
    }
    if (jewelCase.index !== this.selected || !this.pointer || this.options.reducedMotion) return;
    const rect = this.focusRect;
    const nx = (this.pointer.x - (rect.x + rect.width / 2)) / (rect.width / 2);
    const ny = (this.pointer.y - (rect.y + rect.height / 2)) / (rect.height / 2);
    // Only over the case (and a little around it)
    if (Math.abs(nx) > 1.2 || Math.abs(ny) > 1.2) return;
    // The case turns to face the cursor: the side under it moves away
    out.x = MathUtils.clamp(nx, -1, 1) * TILT.hoverYaw * jewelCase.open;
    out.y = MathUtils.clamp(ny, -1, 1) * TILT.hoverPitch * jewelCase.open;
  }

  /** Per frame tilt: follow the drag, or a damped spring towards the target. True while moving. */
  private updateTilt(jewelCase: JewelCase, dt: number): boolean {
    const { tilt, tiltVelocity: velocity } = jewelCase;
    this.tiltTarget(jewelCase, target);

    if (jewelCase.drag) {
      const follow = 1 - Math.exp(-TILT.follow * dt);
      const px = tilt.x;
      const py = tilt.y;
      tilt.x += (target.x - tilt.x) * follow;
      tilt.y += (target.y - tilt.y) * follow;
      // Measured and smoothed: becomes the fling on release
      if (dt > 0) {
        velocity.x = velocity.x * 0.5 + ((tilt.x - px) / dt) * 0.5;
        velocity.y = velocity.y * 0.5 + ((tilt.y - py) / dt) * 0.5;
      }
      return Math.abs(target.x - tilt.x) + Math.abs(target.y - tilt.y) > 1e-4;
    }

    const k = TILT.stiffness;
    const c = 2 * (this.options.reducedMotion ? 1 : TILT.damping) * Math.sqrt(k);
    const step = (axis: 'x' | 'y', max: number) => {
      velocity[axis] += (k * (target[axis] - tilt[axis]) - c * velocity[axis]) * dt;
      tilt[axis] += velocity[axis] * dt;
      // Hard stop: a strong fling can't turn it past the limit
      if (Math.abs(tilt[axis]) > max) {
        tilt[axis] = Math.sign(tilt[axis]) * max;
        if (Math.sign(velocity[axis]) === Math.sign(tilt[axis])) velocity[axis] *= -0.2;
      }
    };
    step('x', TILT.maxYaw);
    step('y', TILT.maxPitch);

    const settled =
      Math.abs(velocity.x) + Math.abs(velocity.y) < 1e-3 &&
      Math.abs(target.x - tilt.x) + Math.abs(target.y - tilt.y) < 1e-4;
    if (settled) {
      tilt.x = target.x;
      tilt.y = target.y;
      velocity.x = velocity.y = 0;
    }
    return !settled;
  }

  private resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.stage.resize(width, height);
    this.mode = getLayoutMode(width, height);
    this.shelf.layout(getColumns(width, this.mode));
    const stageRect = rectOf(this.options.stageElement);
    const phone = width < breakpoints.tablet;
    this.stage.frameBounds(this.shelf.bounds, stageRect, phone ? CAMERA.fillPhone : CAMERA.fill);
    this.backdrop.setSize(width, height, this.stage.renderer.getPixelRatio());
    // The heading and menu line up with the ends of the shelf (_page.scss):
    // with the bottom board under it, with the top board above it (phones).
    // The gap under the shelf lets the phone subtitle sit close to it.
    const edges = this.stage.screenEdges(this.shelf.bounds);
    const stageRight = stageRect.x + stageRect.width;
    const px = (value: number) => `${Math.max(0, value)}px`;
    const root = document.documentElement.style;
    root.setProperty('--shelf-inset-left', px(edges.bottom.left - stageRect.x));
    root.setProperty('--shelf-inset-right', px(stageRight - edges.bottom.right));
    root.setProperty('--shelf-top-inset-left', px(edges.top.left - stageRect.x));
    root.setProperty('--shelf-top-inset-right', px(stageRight - edges.top.right));
    root.setProperty('--shelf-gap-below', px(stageRect.y + stageRect.height - edges.bottom.y));
    this.updateFocusRect();
    // Render synchronously so there's no stretched frame while resizing
    this.update(0);
    this.stage.renderer.render(this.stage.scene, this.stage.camera);
  }

  private updateFocusRect() {
    this.focusRect = getFocusRect(
      this.mode,
      this.stage.viewport,
      rectOf(this.options.stageElement),
      this.options.panelElement,
    );
  }

  /** Pose in front of the camera, centred in the free area, scaled to fit it */
  private computeFocusPose(): number {
    const rect = this.focusRect;
    const depth = this.stage.shelfDistance * FOCUS.depth;
    this.stage.pointAt(rect.x + rect.width / 2, rect.y + rect.height / 2, depth, focusPosition);

    const unitsPerPx = this.stage.unitsPerPixel(depth);
    // The rect is already the exact box of the case (layout.ts)
    const scale = Math.max((rect.height * unitsPerPx) / CASE.height, 0.2);

    // Facing the camera, with a slight tilt (small, so it still lines up with the panel)
    focusQuaternion
      .copy(this.stage.camera.quaternion)
      .multiply(tmpQuaternion.setFromEuler(new Euler(FOCUS.tilt.x, FOCUS.tilt.y, FOCUS.tilt.z)));
    return scale;
  }

  private handlePointer = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (this.selected !== null) this.stage.requestRender();
  };

  private handlePointerLeave = () => {
    this.pointer = null;
    if (this.selected !== null) this.stage.requestRender();
  };

  private handleParallax = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    this.parallaxTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.parallaxTarget.y = (event.clientY / window.innerHeight) * 2 - 1;
    this.stage.requestRender();
  };

  /** Per frame: smooth hover/parallax, tilt, and pose every case. Returns true while moving. */
  private update = (dt: number): boolean => {
    let moving = false;
    const smoothing = 1 - Math.exp(-MOTION.smoothing * dt);

    // Parallax (desktop only, off with reduced motion)
    if (this.options.parallax) {
      this.parallaxCurrent.x += (this.parallaxTarget.x - this.parallaxCurrent.x) * smoothing;
      this.parallaxCurrent.y += (this.parallaxTarget.y - this.parallaxCurrent.y) * smoothing;
      this.stage.setParallax(this.parallaxCurrent.x, this.parallaxCurrent.y);
      if (Math.abs(this.parallaxTarget.x - this.parallaxCurrent.x) + Math.abs(this.parallaxTarget.y - this.parallaxCurrent.y) > 0.001) {
        moving = true;
      }
    }

    const focusScale = this.computeFocusPose();
    this.auraSources.length = 0;
    const camera = this.stage.camera;
    toCamera.copy(camera.quaternion).invert();
    cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    cameraForward.set(0, 0, -1).applyQuaternion(camera.quaternion);

    for (const jewelCase of this.cases) {
      if (this.updateTilt(jewelCase, dt)) moving = true;

      jewelCase.hover += (jewelCase.hoverTarget - jewelCase.hover) * smoothing;
      if (Math.abs(jewelCase.hoverTarget - jewelCase.hover) > 0.002) moving = true;
      else jewelCase.hover = jewelCase.hoverTarget;

      const { group, slot, open, hover } = jewelCase;

      // Slot pose, lifted a bit on hover
      tmpPosition.copy(slot.position);
      tmpPosition.y += hover * MOTION.hoverLift;
      tmpPosition.z += hover * MOTION.hoverLift * 0.8;

      if (open <= 0) {
        group.position.copy(tmpPosition);
        group.quaternion.copy(slot.quaternion);
        group.scale.setScalar(1);
      } else {
        group.position.lerpVectors(tmpPosition, focusPosition, open);
        // A small arc up while it flies out
        group.position.y += Math.sin(open * Math.PI) * CASE.height * 0.12;

        // Tilt around the camera's own axes, on top of the focus pose
        spin.setFromAxisAngle(cameraUp, jewelCase.tilt.x).multiply(delta.setFromAxisAngle(cameraRight, jewelCase.tilt.y));
        tmpQuaternion.copy(spin).multiply(focusQuaternion);
        group.quaternion.slerpQuaternions(slot.quaternion, tmpQuaternion, open);
        if (!this.options.reducedMotion) {
          group.quaternion.multiply(swing.setFromAxisAngle(yAxis, Math.sin(open * Math.PI) * MOTION.swing));
        }
        group.scale.setScalar(MathUtils.lerp(1, focusScale, open));
      }
      jewelCase.updateShadow();
      jewelCase.updateSurface(toCamera);
      this.updateDropShadow(jewelCase);
      if (this.updateAura(jewelCase, dt)) moving = true;
    }
    this.backdrop.setSources(this.auraSources);
    this.backdrop.setCamera(this.stage.camera);

    return moving;
  };

  /**
   * The open case's light on the wall. It morphs only as the case turns or
   * flies (flow), and blooms a little with speed (energy), so a still case
   * means a still wall and the scene can stop rendering. True while it settles.
   */
  private updateAura(jewelCase: JewelCase, dt: number): boolean {
    const { aura, tilt, open, group } = jewelCase;
    const turned = Math.abs(tilt.x - aura.lastTilt.x) + Math.abs(tilt.y - aura.lastTilt.y);
    aura.flow += turned * AURA.flowPerRadian + Math.abs(open - aura.lastOpen) * AURA.flowPerOpen;
    aura.lastTilt.x = tilt.x;
    aura.lastTilt.y = tilt.y;
    aura.lastOpen = open;
    if (dt > 0) {
      const target = Math.min(1, turned / dt / AURA.energySpeed);
      aura.energy += (target - aura.energy) * (1 - Math.exp(-AURA.energyRate * dt));
      if (aura.energy < 0.002) aura.energy = 0;
    }

    if (open <= 0.001) return false;
    // Follows the case on screen, from its slot to the front, growing with it
    const camera = this.stage.camera;
    const { width, height } = this.stage.viewport;
    projected.copy(group.position).project(camera);
    toCase.copy(group.position).sub(camera.position);
    const depth = Math.max(toCase.dot(cameraForward), 1e-3);
    this.auraSources.push({
      x: ((projected.x + 1) / 2) * width,
      y: ((1 - projected.y) / 2) * height,
      size: (CASE.height * group.scale.x) / this.stage.unitsPerPixel(depth),
      strength: open * open * (3 - 2 * open),
      tiltX: tilt.x,
      tiltY: tilt.y,
      flow: aura.flow,
      energy: aura.energy,
      palette: jewelCase.palette,
    });
    return aura.energy > 0;
  }

  /**
   * Soft shadow behind the open case, as if cast on a wall just behind it:
   * it faces the camera and doesn't turn with the tilt, so the case reads as
   * lifted off the page.
   */
  private updateDropShadow(jewelCase: JewelCase) {
    const { dropShadow, group, open } = jewelCase;
    const material = dropShadow.material as MeshBasicMaterial;
    const eased = open * open * (3 - 2 * open);
    material.opacity = 0.34 * eased;
    dropShadow.visible = material.opacity > 0.01;
    if (!dropShadow.visible) return;
    // Far enough behind that no corner of a fully tilted case reaches it:
    // when the plane sat 2 cm back, the far corner went through it and the
    // shadow painted a dark triangle on the case itself.
    const camera = this.stage.camera;
    const scale = group.scale.x;
    toCase.copy(group.position).sub(camera.position);
    const depth = toCase.dot(cameraForward);
    // Pushed back along the ray through the case's centre, and grown to
    // match, so on screen it keeps the same size and place
    const grow = (depth + DROP_SHADOW_BEHIND * scale) / depth;
    dropShadow.position
      .copy(camera.position)
      .addScaledVector(toCase, grow)
      .addScaledVector(cameraUp, -0.55 * scale * grow);
    dropShadow.quaternion.copy(camera.quaternion);
    dropShadow.scale.setScalar(scale * grow);
  }

  /** Frees GPU memory and listeners */
  dispose() {
    gsap.killTweensOf(this.cases);
    this.resizeObserver.disconnect();
    window.removeEventListener('pointermove', this.handleParallax);
    this.options.canvas.removeEventListener('pointermove', this.handlePointer);
    this.options.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.interaction.dispose();
    for (const jewelCase of this.cases) jewelCase.dispose();
    this.resources.dispose();
    this.shelf.dispose();
    this.backdrop.dispose();
    this.stage.dispose();
  }
}
