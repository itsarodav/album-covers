import {
  AddEquation,
  BoxGeometry,
  CustomBlending,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  OneFactor,
  Plane,
  PlaneGeometry,
  Quaternion,
  Vector3,
  ZeroFactor,
  type Material,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Cover } from '../../data/covers';
import { AURA, CASE, COLORS, KEY_LIGHT, WALL } from './constants';
import {
  createBackTexture,
  createContactShadowTexture,
  createDropShadowTexture,
  createGripTexture,
  createLidDetailTexture,
  createSheenTexture,
  createSmudgeTexture,
  createSpineTexture,
  drawSpine,
  glowColors,
  sampleBackground,
  pastelTones,
  samplePalette,
  spineColorsFor,
} from './textures';

// Z layout (front is +Z, total depth CASE.depth centred on 0):
//   lid   [front - lidDepth, front]   clear, booklet right behind its front wall
//   base  [back, back + baseDepth]    clear, holds the clear tray and back inlay
const FRONT = CASE.depth / 2;
const BACK = -CASE.depth / 2;
const LID_Z = FRONT - CASE.lidDepth / 2;
const BASE_Z = BACK + CASE.baseDepth / 2;
const BASE_WIDTH = CASE.width - CASE.baseInset * 2;
const BASE_HEIGHT = CASE.height - CASE.baseInset * 2;
/** Hinge side stays flush: the base is inset on the right only */
const BASE_X = -CASE.baseInset;

/**
 * Ribbed grip strip on the left, between the case edge and the booklet. Opaque
 * on purpose: see-through layers there let the background show and read as a
 * broken case. Spans from just inside the left wall to the booklet's left edge.
 */
const BOOKLET_X = CASE.width / 2 - CASE.coverSize / 2 - 0.2;
const GRIP_LEFT = -CASE.width / 2 + CASE.wall;
const GRIP_RIGHT = BOOKLET_X - CASE.coverSize / 2;
const GRIP_WIDTH = GRIP_RIGHT - GRIP_LEFT;

/**
 * Additive blending that adds color but leaves alpha alone. The canvas is
 * transparent (alpha: true), and plain AdditiveBlending also adds alpha: where
 * nothing is behind the case's edges, a near-black reflection became an opaque
 * black pixel, drawing a dark frame around the case. With alpha untouched, the
 * reflection is added on top of the page background instead.
 */
const ADDITIVE_COLOR_ONLY = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: OneFactor,
} as const;

/** UV travel of the glare per unit of the front normal facing sideways */
const SHEEN_TRAVEL = 0.55;
const normal = new Vector3();
const KEY_LIGHT_DIRECTION = new Vector3(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z).normalize();
/** How much the key light hits a case facing straight ahead (+Z) */
const REST_FACING = KEY_LIGHT_DIRECTION.z;
/**
 * Print brightness: facing ahead, gained per unit of turning toward the key
 * light, and the darkest it gets. Slightly under 1 at rest: it's behind plastic.
 */
const PRINT_SHADE = { rest: 0.95, range: 0.3, min: 0.8 } as const;

/**
 * Geometry and materials shared by every case: only the cover,
 * spine and back textures change from one case to another.
 */
export class CaseResources {
  readonly lid = new RoundedBoxGeometry(CASE.width, CASE.height, CASE.lidDepth, 2, 0.08);
  readonly base = new RoundedBoxGeometry(BASE_WIDTH, BASE_HEIGHT, CASE.baseDepth, 2, 0.1);
  /** Raycast target: the whole case */
  readonly hit = new BoxGeometry(CASE.width, CASE.height, CASE.depth);
  readonly booklet = new BoxGeometry(CASE.coverSize, CASE.coverSize, CASE.bookletThickness);
  readonly tray = new BoxGeometry(BASE_WIDTH - 0.3, BASE_HEIGHT - 0.3, CASE.baseDepth - 0.14);
  /** Back inlay: fills the whole inside of the base, so nothing behind the case shows through */
  readonly back = new PlaneGeometry(BASE_WIDTH - CASE.wall * 2, BASE_HEIGHT - CASE.wall * 2);
  /** Wide plane, turned upright inside each side wall */
  readonly spine = new PlaneGeometry(BASE_HEIGHT - 0.3, CASE.spineDepth);
  readonly grip = new PlaneGeometry(GRIP_WIDTH, CASE.height - CASE.wall * 2);
  readonly knuckle = new CylinderGeometry(0.19, 0.19, 1.1, 20);
  readonly tab = new BoxGeometry(0.4, 1, 0.05);
  readonly shadow = new PlaneGeometry(CASE.width * 1.25, 3.2);
  readonly lidDetail = new PlaneGeometry(CASE.width, CASE.height);
  /** Behind the selected CD; the texture keeps a blur margin around the case */
  readonly dropShadow = new PlaneGeometry(CASE.width * 1.4, CASE.height * 1.4);

  /**
   * Clear plastic in two cheap layers instead of MeshPhysicalMaterial with
   * transmission (pretty but slow on phones):
   * - tint: a faint haze, normal blending
   * - gloss: black, additive, so only the reflections are added on top. A
   *   plain transparent material would dim its reflections by its own opacity,
   *   which is what made plastic look flat. Fresnel brightens the edges.
   */
  // Lambert on purpose: no specular. A standard material's broad highlight
  // (roughness 0.3) covered the whole lid in milk whenever the case faced the
  // key light. Sharp highlights come from the gloss layer.
  readonly tint = new MeshLambertMaterial({
    color: COLORS.plasticTint,
    transparent: true,
    opacity: 0.045,
    depthWrite: false,
  });

  readonly smudges = createSmudgeTexture();

  readonly gloss = new MeshStandardMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: 1,
    roughnessMap: this.smudges,
    // Uses the room with capped lamps (plasticEnvironment), so this can be
    // high enough for Fresnel to light up the edges without washing the
    // artwork out when the case tilts toward a lamp.
    envMapIntensity: 0.22,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE_COLOR_ONLY,
  });

  /** Black ribbed grip on the left, like classic cases (texture set in the constructor) */
  readonly gripMaterial = new MeshStandardMaterial({ roughness: 0.7 });

  /**
   * Hinge knuckles: pale, opaque plastic. They used to be milky and
   * see-through, and looked like two holes in the corners.
   */
  readonly knuckleMaterial = new MeshStandardMaterial({
    color: COLORS.knuckle,
    roughness: 0.28,
    envMapIntensity: 0.6,
  });

  /** Booklet tabs: thin clear plastic, milkier than the shell */
  readonly hingeMaterial = new MeshStandardMaterial({
    color: COLORS.hinge,
    transparent: true,
    opacity: 0.45,
    roughness: 0.15,
    depthWrite: false,
  });

  /** Clear tray: a second, slightly frosted layer of plastic over the white inlay */
  readonly trayMaterial = new MeshStandardMaterial({
    color: COLORS.plasticTint,
    transparent: true,
    opacity: 0.16,
    roughness: 0.25,
    envMapIntensity: 0,
    depthWrite: false,
  });
  /** Edges, ledges, hinge pins, scratches: painted over the lid (texture set in the constructor) */
  readonly lidDetailMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  readonly paperMaterial = new MeshStandardMaterial({ color: COLORS.paper, roughness: 0.9 });
  readonly hitMaterial = new MeshBasicMaterial({ visible: false });
  readonly shadowTexture: Texture;
  /** Shared image; each case clones it to slide it on its own */
  readonly sheenTexture: Texture;
  readonly dropShadowTexture: Texture;

  /**
   * @param environment The room environment. Given to the case materials
   * explicitly: with only scene.environment, three ignores each material's
   * envMapIntensity and uses scene.environmentIntensity for all of them.
   * @param plasticEnvironment The same room with its lamps toned down, for
   * the lid's gloss: with the real lamps, tilting the case up reflected a
   * ceiling light that bleached the whole cover.
   */
  constructor(
    renderer: WebGLRenderer,
    readonly environment: Texture,
    plasticEnvironment: Texture,
  ) {
    this.shadowTexture = createContactShadowTexture(renderer);
    this.sheenTexture = createSheenTexture(renderer);
    this.dropShadowTexture = createDropShadowTexture(renderer);
    this.gripTexture = createGripTexture(renderer);
    this.gripMaterial.map = this.gripTexture;
    this.lidDetailTexture = createLidDetailTexture(
      {
        width: CASE.width,
        height: CASE.height,
        coverSize: CASE.coverSize,
        gripRight: GRIP_RIGHT,
        bookletRight: BOOKLET_X + CASE.coverSize / 2,
      },
      renderer,
    );
    this.lidDetailMaterial.map = this.lidDetailTexture;
    for (const material of [this.knuckleMaterial, this.hingeMaterial]) {
      material.envMap = environment;
    }
    this.gloss.envMap = plasticEnvironment;
    // Reflections only, no direct-light specular: on a flat lid a directional
    // light lights every pixel at once, so at one exact tilt the whole cover
    // turned milky. The room's lamps are finite panels that slide across.
    this.gloss.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_maps>',
        'reflectedLight.directSpecular = vec3( 0.0 );\n#include <lights_fragment_maps>',
      );
    };
    this.gloss.customProgramCacheKey = () => 'case-gloss-env-only';
  }

  readonly gripTexture: Texture;
  readonly lidDetailTexture: Texture;

  dispose() {
    const geometries = [
      this.lid, this.base, this.hit, this.booklet, this.tray, this.back,
      this.spine, this.grip, this.knuckle, this.tab, this.shadow, this.lidDetail, this.dropShadow,
    ];
    for (const geometry of geometries) geometry.dispose();
    const materials = [
      this.tint, this.gloss, this.gripMaterial, this.knuckleMaterial, this.hingeMaterial,
      this.trayMaterial, this.paperMaterial, this.hitMaterial, this.lidDetailMaterial,
    ];
    for (const material of materials) material.dispose();
    const textures = [
      this.smudges, this.shadowTexture, this.gripTexture, this.lidDetailTexture,
      this.sheenTexture, this.dropShadowTexture,
    ];
    for (const texture of textures) texture.dispose();
  }
}

/** A slot pose on the shelf */
export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
}

export class JewelCase {
  /** Pivot at the centre of the case: it spins on its own axis */
  readonly group = new Group();
  /** Raycast target (userData.index) */
  readonly hitMesh: Mesh;
  /** Contact shadow: lives on the board, not inside the group */
  readonly shadow: Mesh;
  /**
   * Its shadow on the wall behind (placed by shelf.ts), clipped at the top of
   * its board: below that the board itself is in the way
   */
  readonly wallShadow: Mesh;
  readonly wallShadowClip = new Plane(new Vector3(0, 1, 0), 0);
  /** Cover colors for the light on the wall, sRGB 0..1 (backdrop.ts) */
  palette: [number, number, number][] = Array.from({ length: AURA.colors }, () => [0.85, 0.85, 0.85]);
  /** The info card's glow: the main color and two that blend well with it, CSS colors (empty until loaded) */
  cardColors: string[] = [];
  /**
   * The light on the wall: `flow` grows as the case turns or flies (it drives
   * the morphing, so the light only moves when the case does); `energy` is
   * its recent speed, 0..1. Driven by cdShelf.ts.
   */
  readonly aura = { flow: 0, energy: 0, lastTilt: { x: 0, y: 0 }, lastOpen: 0 };
  readonly slot: Pose = { position: new Vector3(), quaternion: new Quaternion() };

  /** 0 on the shelf → 1 in front of the camera (tweened by GSAP) */
  open = 0;
  /** False while the placeholder color shows (no shading on it) */
  private hasCover = false;
  hover = 0;
  hoverTarget = 0;
  /** Soft shadow behind the case once it's out of the shelf (scene-level, faces the camera) */
  readonly dropShadow: Mesh;
  /**
   * Tilt while selected (radians): x turns around the camera's up axis
   * (yaw), y around its right axis (pitch). Clamped (TILT), so the back
   * never shows. Driven by cdShelf.ts.
   */
  readonly tilt = { x: 0, y: 0 };
  readonly tiltVelocity = { x: 0, y: 0 };
  /** While dragging: the raw dragged angle, before the rubber band */
  drag: { x: number; y: number } | null = null;

  private readonly sheenTexture: Texture;
  private readonly spineTexture: Texture;

  private readonly coverMaterial: MeshBasicMaterial;
  private readonly sheenMaterial: MeshBasicMaterial;
  private readonly ownMaterials: Material[];
  private readonly ownTextures: Texture[];

  constructor(
    readonly cover: Cover,
    readonly index: number,
    resources: CaseResources,
    renderer: WebGLRenderer,
    private readonly fontFamily: string,
  ) {
    const spineTexture = createSpineTexture(cover, fontFamily, renderer);
    const backTexture = createBackTexture(cover, fontFamily, renderer);

    // The print keeps the artwork's own colors: lit materials multiplied it by
    // more than 1 (blacks at 40 instead of 21, light colors clipped to white).
    // Unlit, not tone mapped, with a slight shading set in updateSurface().
    this.coverMaterial = new MeshBasicMaterial({ color: COLORS.placeholder, toneMapped: false });
    this.spineTexture = spineTexture;
    // Unlit like the print, so the cover's color stays true; the side away
    // from the key light (left) a bit darker
    const spineMaterial = new MeshBasicMaterial({ map: spineTexture, toneMapped: false });
    spineMaterial.color.setScalar(0.94);
    const spineShadedMaterial = new MeshBasicMaterial({ map: spineTexture, toneMapped: false });
    spineShadedMaterial.color.setScalar(0.8);
    const backMaterial = new MeshStandardMaterial({ map: backTexture, roughness: 0.8 });
    const shadowMaterial = new MeshBasicMaterial({
      map: resources.shadowTexture,
      transparent: true,
      depthWrite: false,
    });
    // Own copy of the sheen (same image) so its offset can follow this case
    this.sheenTexture = resources.sheenTexture.clone();
    this.sheenTexture.needsUpdate = true;
    // Its color is the intensity (additive): 0 on the shelf, see updateSurface()
    this.sheenMaterial = new MeshBasicMaterial({
      color: 0x000000,
      map: this.sheenTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      ...ADDITIVE_COLOR_ONLY,
    });
    const dropShadowMaterial = new MeshBasicMaterial({
      map: resources.dropShadowTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const wallShadowMaterial = new MeshBasicMaterial({
      map: resources.dropShadowTexture,
      transparent: true,
      opacity: WALL.caseShadow,
      depthWrite: false,
      clippingPlanes: [this.wallShadowClip],
    });
    this.ownMaterials = [
      this.coverMaterial, spineMaterial, spineShadedMaterial, backMaterial, shadowMaterial, this.sheenMaterial,
      dropShadowMaterial, wallShadowMaterial,
    ];
    this.ownTextures = [spineTexture, backTexture, this.sheenTexture];

    const parts: Mesh[] = [];
    const add = (mesh: Mesh, x: number, y: number, z: number, renderOrder = 0) => {
      mesh.position.set(x, y, z);
      mesh.renderOrder = renderOrder;
      parts.push(mesh);
      return mesh;
    };

    // --- Inside (opaque) ---------------------------------------------------
    // Booklet: paper block, artwork on its front face only. Right-aligned
    // behind the lid; the ribbed hinge strip takes the left.
    const paper = resources.paperMaterial;
    add(
      new Mesh(resources.booklet, [paper, paper, paper, paper, this.coverMaterial, paper]),
      BOOKLET_X,
      0,
      FRONT - CASE.wall - CASE.bookletThickness / 2 - 0.01,
    );

    // Clear tray, and the black ribbed grip on the left
    add(new Mesh(resources.tray, resources.trayMaterial), BASE_X, 0, BASE_Z + 0.04, 2);
    add(
      new Mesh(resources.grip, resources.gripMaterial),
      GRIP_LEFT + GRIP_WIDTH / 2,
      0,
      FRONT - CASE.wall - CASE.bookletThickness / 2 - 0.01,
    );

    // Back inlay, facing out the back
    // Inside of the inlay: plain paper, what the clear tray shows from the front
    add(new Mesh(resources.back, paper), BASE_X, 0, BACK + CASE.wall + 0.005);
    const back = add(new Mesh(resources.back, backMaterial), BASE_X, 0, BACK + CASE.wall);
    back.rotation.y = Math.PI;

    // Inlay spines folded inside each side wall: wide plane turned upright (Z), then out (Y).
    // Both read top to bottom from their side, so the artist is on top on both.
    const spineLeft = add(new Mesh(resources.spine, spineShadedMaterial), BASE_X - BASE_WIDTH / 2 + CASE.wall, 0, BASE_Z);
    spineLeft.rotation.set(0, -Math.PI / 2, -Math.PI / 2);
    const spineRight = add(new Mesh(resources.spine, spineMaterial), BASE_X + BASE_WIDTH / 2 - CASE.wall, 0, BASE_Z);
    spineRight.rotation.set(0, Math.PI / 2, -Math.PI / 2);

    // --- Small plastic parts -------------------------------------------------
    // Hinge knuckles at the top and bottom of the left edge, between lid and base
    const knuckleY = CASE.height / 2 - 0.75;
    const knuckleZ = FRONT - CASE.lidDepth;
    add(new Mesh(resources.knuckle, resources.knuckleMaterial), -CASE.width / 2 + 0.2, knuckleY, knuckleZ);
    add(new Mesh(resources.knuckle, resources.knuckleMaterial), -CASE.width / 2 + 0.2, -knuckleY, knuckleZ);

    // Tabs on the right of the lid that hold the booklet
    const tabX = CASE.width / 2 - 0.3;
    const tabY = CASE.coverSize / 2 - 1.3;
    const tabZ = FRONT - CASE.wall - CASE.bookletThickness - 0.04;
    add(new Mesh(resources.tab, resources.hingeMaterial), tabX, tabY, tabZ, 1);
    add(new Mesh(resources.tab, resources.hingeMaterial), tabX, -tabY, tabZ, 1);

    // --- Clear shells, drawn last: haze first, then the additive gloss -----
    add(new Mesh(resources.base, resources.tint), BASE_X, 0, BASE_Z, 2);
    add(new Mesh(resources.lid, resources.tint), 0, 0, LID_Z, 2);
    add(new Mesh(resources.base, resources.gloss), BASE_X, 0, BASE_Z, 3);
    add(new Mesh(resources.lid, resources.gloss), 0, 0, LID_Z, 3);
    add(new Mesh(resources.lidDetail, resources.lidDetailMaterial), 0, 0, FRONT + 0.004, 4);
    // Glare that slides across the lid as the case turns (updateSheen)
    add(new Mesh(resources.lidDetail, this.sheenMaterial), 0, 0, FRONT + 0.006, 5);

    this.hitMesh = new Mesh(resources.hit, resources.hitMaterial);
    this.hitMesh.userData.index = index;

    this.group.add(...parts, this.hitMesh);
    this.group.name = `cd-${cover.id}`;

    this.shadow = new Mesh(resources.shadow, shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;

    this.dropShadow = new Mesh(resources.dropShadow, dropShadowMaterial);
    this.dropShadow.renderOrder = -1;
    this.dropShadow.visible = false;

    this.wallShadow = new Mesh(resources.dropShadow, wallShadowMaterial);
  }

  setCoverTexture(texture: Texture) {
    this.coverMaterial.map = texture;
    this.hasCover = true;
    this.coverMaterial.needsUpdate = true;
    // Spines take the cover's background color
    const image = texture.image as CanvasImageSource;
    const colors = spineColorsFor(sampleBackground(image));
    const sampled = samplePalette(image, AURA.colors);
    this.palette = pastelTones(sampled, AURA.lightness);
    this.cardColors = glowColors(sampled);
    drawSpine(this.spineTexture.image as HTMLCanvasElement, this.cover, this.fontFamily, colors);
    this.spineTexture.needsUpdate = true;
    this.ownTextures.push(texture);
  }

  /** Contact shadow fades as the case lifts or leaves the shelf */
  updateShadow() {
    const material = this.shadow.material as MeshBasicMaterial;
    material.opacity = (1 - this.open) * (1 - 0.45 * this.hover);
    this.shadow.visible = material.opacity > 0.01;
    // On the wall: lighter and gone sooner (it's further from the case)
    const wall = this.wallShadow.material as MeshBasicMaterial;
    const away = Math.min(1, this.open * 2.5);
    wall.opacity = WALL.caseShadow * (1 - away) * (1 - 0.3 * this.hover);
    this.wallShadow.visible = wall.opacity > 0.005;
  }

  /**
   * Per frame, after the pose:
   * - The glare slides by how much the front faces away from the camera (the
   *   reflection of a fixed light moves the other way across the plastic).
   *   It only shows on the selected case: on the shelf, the same streak on
   *   every case, in the same spot, read as fake. There only the real
   *   environment reflections remain, which differ with each case's angle.
   * - The print darkens a little as it turns away from the key light.
   * @param toCamera inverse of the camera's world quaternion
   */
  updateSurface(toCamera: Quaternion) {
    normal.set(0, 0, 1).applyQuaternion(this.group.quaternion);
    const facingLight = normal.dot(KEY_LIGHT_DIRECTION);
    normal.applyQuaternion(toCamera);
    this.sheenTexture.offset.set(0.25 + normal.x * SHEEN_TRAVEL, 0.25 + normal.y * SHEEN_TRAVEL);

    const open = this.open;
    this.sheenMaterial.color.setScalar(open * open * (3 - 2 * open));
    this.sheenMaterial.visible = open > 0.01;

    if (this.hasCover) {
      const shade = PRINT_SHADE.rest + PRINT_SHADE.range * (facingLight - REST_FACING);
      this.coverMaterial.color.setScalar(MathUtils.clamp(shade, PRINT_SHADE.min, 1));
    }
  }

  dispose() {
    for (const material of this.ownMaterials) material.dispose();
    for (const texture of this.ownTextures) texture.dispose();
  }
}
