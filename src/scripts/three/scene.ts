import {
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  type Mesh,
  type MeshLambertMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Box3,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAMERA, KEY_LIGHT } from './constants';
import type { Rect } from './layout';

/** Max lamp brightness in the plastic's reflections */
const PLASTIC_LAMP_CAP = 3;

/**
 * Renderer, camera, lights and the render loop. The loop renders on demand:
 * requestRender() schedules a frame, and the frame callback says whether
 * something is still moving (hover, inertia, parallax) to keep going.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA.fov, 1, 0.5, 2000);
  readonly viewport: Rect = { x: 0, y: 0, width: 1, height: 1 };

  /** Where the camera looks and from how far (set by frame()) */
  private readonly target = new Vector3();
  private distance = 100;
  private readonly parallax = new Vector2();
  readonly environment: Texture;
  /** The room with toned-down lamps, for the case's clear plastic */
  readonly plasticEnvironment: Texture;

  private frameId = 0;
  private lastTime = 0;
  private onFrame: (dt: number) => boolean = () => false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Neutral keeps the cover colors close to the artwork
    this.renderer.toneMapping = NeutralToneMapping;
    // Case shadows on the wall stop at the top of their board (jewelCase.ts)
    this.renderer.localClippingEnabled = true;

    // Reflections for the plastic, without downloading an HDR
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    // Same room with the lamps capped, for the clear plastic: the real ones
    // (intensity 17–100) turn any glancing reflection into a white sheet
    room.traverse((object) => {
      const material = (object as Mesh).material as MeshLambertMaterial | undefined;
      if (material && 'emissiveIntensity' in material) {
        material.emissiveIntensity = Math.min(material.emissiveIntensity, PLASTIC_LAMP_CAP);
      }
    });
    this.plasticEnvironment = pmrem.fromScene(room, 0.03).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.55;

    const hemisphere = new HemisphereLight(0xffffff, 0xdce8e1, 1.2);
    // Soft key from above: stronger washed out the top of the cases
    const key = new DirectionalLight(0xffffff, 0.8);
    key.position.set(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z);
    this.scene.add(hemisphere, key);

    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  setFrameCallback(callback: (dt: number) => boolean) {
    this.onFrame = callback;
  }

  requestRender = () => {
    if (this.frameId || document.hidden) return;
    this.frameId = requestAnimationFrame(this.frame);
  };

  private frame = (time: number) => {
    this.frameId = 0;
    // Clamp dt: after an idle period the first frame shouldn't jump
    const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 1 / 20) : 1 / 60;
    this.lastTime = time;
    const keepGoing = this.onFrame(dt);
    this.renderer.render(this.scene, this.camera);
    if (keepGoing) this.requestRender();
    else this.lastTime = 0;
  };

  // Pause while the tab is hidden; draw a fresh frame when it comes back
  private handleVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this.lastTime = 0;
    } else {
      this.requestRender();
    }
  };

  resize(width: number, height: number) {
    this.viewport.width = width;
    this.viewport.height = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Frames the shelves inside `stage` (a sub-area of the viewport). The camera
   * centre is moved there with setViewOffset, so the canvas can stay
   * fullscreen and the selected CD can fly over the heading.
   */
  frameBounds(bounds: Box3, stage: Rect, fill: number = CAMERA.fill) {
    const { width: W, height: H } = this.viewport;
    const size = bounds.getSize(new Vector3());
    bounds.getCenter(this.target);

    const tan = Math.tan(MathUtils.degToRad(CAMERA.fov / 2));
    const usableW = Math.max(stage.width * fill, 1);
    const usableH = Math.max(stage.height * fill, 1);
    // World units per pixel are the same on both axes: pixel size = 2·d·tan / H
    const forHeight = (size.y * H) / (2 * tan * usableH);
    const forWidth = (size.x * H) / (2 * tan * usableW);
    this.distance = Math.max(forHeight, forWidth) + size.z / 2;

    const centerX = stage.x + stage.width / 2;
    const centerY = stage.y + stage.height / 2;
    this.camera.setViewOffset(W, H, W / 2 - centerX, H / 2 - centerY, W, H);
    this.updateCamera();
  }

  /**
   * The bounds' front face on screen, in CSS px from the viewport's top left,
   * with no parallax (so the HTML can line up with it). Perspective makes the
   * top a touch wider than the bottom, so both are given.
   */
  screenEdges(bounds: Box3) {
    const parallax = this.parallax.clone();
    this.parallax.set(0, 0);
    this.updateCamera();
    const toScreen = (x: number, y: number) => {
      const p = new Vector3(x, y, bounds.max.z).project(this.camera);
      return { x: ((p.x + 1) / 2) * this.viewport.width, y: ((1 - p.y) / 2) * this.viewport.height };
    };
    const topLeft = toScreen(bounds.min.x, bounds.max.y);
    const topRight = toScreen(bounds.max.x, bounds.max.y);
    const bottomLeft = toScreen(bounds.min.x, bounds.min.y);
    const bottomRight = toScreen(bounds.max.x, bounds.min.y);
    this.parallax.copy(parallax);
    this.updateCamera();
    return {
      top: { left: topLeft.x, right: topRight.x },
      bottom: { left: bottomLeft.x, right: bottomRight.x, y: Math.max(bottomLeft.y, bottomRight.y) },
    };
  }

  /** Pointer parallax: -1..1 on both axes */
  setParallax(x: number, y: number) {
    this.parallax.set(x, y);
    this.updateCamera();
  }

  private updateCamera() {
    const elevation = MathUtils.degToRad(CAMERA.elevation);
    this.camera.position.set(
      this.target.x + this.parallax.x * CAMERA.parallax,
      this.target.y + Math.sin(elevation) * this.distance - this.parallax.y * CAMERA.parallax,
      this.target.z + Math.cos(elevation) * this.distance,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  get shelfDistance() {
    return this.distance;
  }

  /** World units per CSS pixel at a given depth in front of the camera */
  unitsPerPixel(depth: number) {
    return (2 * depth * Math.tan(MathUtils.degToRad(CAMERA.fov / 2))) / this.viewport.height;
  }

  /** Point at `depth` (along the view axis) under a viewport pixel */
  pointAt(px: number, py: number, depth: number, out = new Vector3()) {
    const ndc = new Vector2((px / this.viewport.width) * 2 - 1, -(py / this.viewport.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const forward = this.camera.getWorldDirection(new Vector3());
    const t = depth / ray.ray.direction.dot(forward);
    return out.copy(ray.ray.origin).addScaledVector(ray.ray.direction, t);
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.environment.dispose();
    this.plasticEnvironment.dispose();
    this.renderer.dispose();
  }
}
