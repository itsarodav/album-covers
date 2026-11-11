// Scene units are centimetres. Colors mirror src/styles/tokens/_colors.scss.

/**
 * Real jewel case: ~142 × 125 × 10 mm. Built like the real thing: a clear lid
 * (front) closing over a clear base that holds a clear tray and the back inlay,
 * whose folded spines show through the side walls. The ~12 × 12 cm booklet
 * sits behind the lid, held by two tabs on the right.
 */
export const CASE = {
  width: 14.2,
  height: 12.5,
  depth: 1,
  coverSize: 12,
  /** Clear lid, front part of the depth */
  lidDepth: 0.36,
  /** Base (tray + back inlay), back part of the depth */
  baseDepth: 0.6,
  /** The base is slightly smaller than the lid: visible step and seam */
  baseInset: 0.1,
  /** Plastic wall thickness */
  wall: 0.06,
  bookletThickness: 0.04,
  /** Ribbed strip on the left of the lid, in front of the hinge */
  hingeWidth: 1.3,
  /** Spine of the back inlay, folded inside each side wall of the base */
  spineDepth: 0.5,
} as const;

export const SHELF = {
  /** Horizontal gap between cases */
  gap: 1.6,
  /** Board overhang past the outer cases */
  overhang: 1.8,
  thickness: 1,
  depth: 5,
  radius: 0.45,
  /** Vertical gap between the top of a row of cases and the next board */
  rowGap: 3,
  /** Cases stand a bit towards the front edge of the board */
  caseZ: 0.9,
} as const;

export const CAMERA = {
  fov: 34,
  /** Slightly elevated, looking down at the shelves (degrees) */
  elevation: 6,
  /** Share of the stage the shelves may take */
  fill: 0.74,
  /** ...on phones: the shelf is narrow, so it can take more of the width */
  fillPhone: 0.9,
  /** Pointer parallax, in cm at the shelf (desktop only) */
  parallax: 1.1,
} as const;

/** Selected CD */
export const FOCUS = {
  /** Distance from the camera, as a share of the shelf distance */
  depth: 0.55,
  /** Share of the free area the case may take */
  fill: 0.72,
  /** Maximum on-screen height of the case, in CSS px */
  maxHeightPx: 360,
  /** Space between the CD and the panel (side layout), in CSS px */
  gap: 48,
  /** Resting tilt (radians): just a hint, so the CD still lines up with the panel */
  tilt: { x: -0.03, y: -0.08, z: 0.012 },
} as const;

export const MOTION = {
  /** Side layout (desktop). The info panel's enter matches `open` (partials/_info-panel.scss) */
  open: 0.75,
  close: 0.6,
  /** Stacked layout (phones): a hair slower than the bottom sheet (280ms) so both arrive together */
  openStacked: 0.34,
  closeStacked: 0.28,
  reducedMotion: 0.2,
  /** Swing around Y while flying out (radians) */
  swing: 0.35,
  /** Hover lift in cm */
  hoverLift: 0.45,
  /** Exponential smoothing rate for hover and parallax */
  smoothing: 10,
  /** Pixels a pointer may move and still count as a tap */
  tapThreshold: 6,
} as const;

/**
 * Turning the selected CD. It only tilts: the front always faces the viewer,
 * the back never shows. Dragging follows the pointer 1:1 at first, then a
 * rubber band slows it down before the limit; letting go springs it back to
 * rest. With a mouse over the case (no button pressed) it leans toward the
 * cursor a little, like a real object you're looking at.
 */
export const TILT = {
  /** Hard limits (radians): ~34° left/right, ~22° up/down */
  maxYaw: 0.6,
  maxPitch: 0.38,
  /** Share of the range that follows the pointer 1:1, before the rubber band */
  linear: 0.55,
  /** Radians per dragged pixel */
  dragSpeed: 0.006,
  /** How fast the case catches up with the pointer while dragging (per second) */
  follow: 24,
  /** Lean toward the mouse cursor (radians at the edge of the case) */
  hoverYaw: 0.16,
  hoverPitch: 0.11,
  /** Spring back to rest: stiffness and damping ratio (<1 = a small overshoot) */
  stiffness: 120,
  damping: 0.62,
  /** Arrow keys: kick in radians per second */
  keyKick: 3.2,
} as const;

/** Key light position (scene.ts); the print's shading follows it (jewelCase.ts) */
export const KEY_LIGHT = { x: 6, y: 12, z: 10 } as const;

/**
 * The wall the shelves hang on: flush with the back of the boards. Its shadows
 * are cast along KEY_LIGHT (shelf.ts); its color is painted in screen space by
 * the backdrop shader (backdrop.ts).
 */
export const WALL = {
  z: -SHELF.depth / 2,
  /** Notebook grid: square size (cm, on the wall) and line strength */
  gridCell: 1.7,
  gridOpacity: 0.1,
  /** Darkness of the boards' shadow right under them, and of each case's */
  boardShadow: 0.3,
  caseShadow: 0.2,
} as const;

/**
 * Colored light the open CD spills on the wall, from its own cover. It only
 * moves when the case moves (no idle loop: the scene renders on demand).
 */
export const AURA = {
  /** Colors taken from each cover */
  colors: 4,
  /** Cover colors are kept in this lightness band, so the wall stays light */
  lightness: { min: 0.64, max: 0.86 },
  /** How much the light morphs per radian the case turns */
  flowPerRadian: 2.4,
  /** ...and while it flies in or out (per unit of `open`) */
  flowPerOpen: 1.6,
  /** Angular speed (rad/s) that counts as full energy: the light blooms a little */
  energySpeed: 3.5,
  /** Energy smoothing (per second) */
  energyRate: 6,
} as const;

export const COLORS = {
  background: '#F2F7F4',
  /** Wall: the mint, a touch brighter where the light falls, deeper in the corners */
  /** Notebook grid on the wall: the slate, very faint */
  gridLine: '#859188',
  shelf: '#2853C9',
  plastic: '#FFFFFF',
  hinge: '#E9EEEB',
  /** Faint blue-grey of clear polystyrene */
  plasticTint: '#DCE6E8',
  /** Ribbed grip on the left: black, like classic jewel cases (the rest is clear) */
  grip: '#1A1B1D',
  gripRidge: '#3A3C40',
  gripShade: '#121314',
  /** Hinge knuckles: pale plastic, opaque so nothing shows through */
  knuckle: '#D5DDDA',
  paper: '#F7F5EF',
  placeholder: '#D9D9D9',
  ink: '#282B27',
  muted: '#859188',
  arodavGreen: '#22B98E',
  shadow: '#0B1F3A',
} as const;
