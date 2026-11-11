import { Matrix4, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4, type Camera } from 'three';
import { AURA, COLORS, WALL } from './constants';

/** Two lights at most: the CD flying home and the one flying out, crossfading */
const MAX_SOURCES = 2;

/** One open (or opening, or closing) CD's light on the wall */
export interface AuraSource {
  /** Centre of the case on screen, CSS px */
  x: number;
  y: number;
  /** Height of the case on screen, CSS px: the light scales with it */
  size: number;
  /** 0..1, follows how far the case is out of the shelf */
  strength: number;
  /** The case's tilt (radians): the light leans the way the cover faces */
  tiltX: number;
  tiltY: number;
  /** Grows only while the case moves: drives the morphing */
  flow: number;
  /** Recent speed, 0..1: the light blooms a little */
  energy: number;
  /** Cover colors, sRGB 0..1, strongest first */
  palette: [number, number, number][];
}

function srgb(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return new Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

const vertexShader = /* glsl */ `
  void main() {
    // Fullscreen: the plane's -1..1 corners are already clip space
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Everything here is in sRGB, written straight to the canvas (no tone mapping
// or color space chunks), so the wall's mint matches the CSS one exactly.
const fragmentShader = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform vec3 uWall;
  uniform vec3 uGridLine;
  // Camera clip space -> world, to find the wall under each pixel
  uniform mat4 uClipToWorld;
  // Per source: x, y, size, strength / tiltX, tiltY, flow, energy
  uniform vec4 uSource[${MAX_SOURCES}];
  uniform vec4 uMotion[${MAX_SOURCES}];
  uniform vec3 uColors[${MAX_SOURCES * AURA.colors}];

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // A soft light around the case. shape: angle, distance, radius (in case
  // heights) and depth: how far it slides with the tilt. Different depths
  // make the colors separate as the case turns, like layers of light.
  void blob(inout vec3 sumColor, inout float sumWeight, vec2 d, vec3 color, vec4 shape, float spin, vec4 motion, float strength) {
    float angle = shape.x + motion.z * spin;
    vec2 center = vec2(cos(angle), sin(angle)) * shape.y + motion.xy * shape.w;
    float radius = shape.z * (1.0 + 0.2 * motion.w);
    vec2 e = d - center;
    float weight = exp(-dot(e, e) / (radius * radius)) * strength;
    sumColor += color * weight;
    sumWeight += weight;
  }

  void main() {
    // CSS px, top-left origin, like the DOM
    vec2 p = vec2(gl_FragCoord.x, uResolution.y * uPixelRatio - gl_FragCoord.y) / uPixelRatio;
    vec3 color = uWall;

    vec3 sumColor = vec3(0.0);
    float sumWeight = 0.0;
    float energy = 0.0;

    for (int s = 0; s < ${MAX_SOURCES}; s++) {
      vec4 source = uSource[s];
      if (source.w < 0.001) continue;
      vec4 motion = uMotion[s];
      vec2 d = (p - source.xy) / source.z;
      // Organic warp, advanced by the flow: still while the case is still
      float t = motion.z;
      d += 0.12 * vec2(sin(d.y * 2.6 + t * 1.3), cos(d.x * 2.2 - t * 1.1));
      d += 0.05 * vec2(sin(d.y * 5.0 - t * 2.1 + 1.7), sin(d.x * 4.6 + t * 1.7));

      int c = s * ${AURA.colors};
      blob(sumColor, sumWeight, d, uColors[c], vec4(-2.3, 0.28, 0.55, 0.38), 0.35, motion, source.w);
      blob(sumColor, sumWeight, d, uColors[c + 1], vec4(0.5, 0.34, 0.44, 0.68), -0.45, motion, source.w);
      blob(sumColor, sumWeight, d, uColors[c + 2], vec4(-0.7, 0.38, 0.36, 0.9), 0.55, motion, source.w);
      blob(sumColor, sumWeight, d, uColors[c + 3], vec4(2.4, 0.37, 0.4, 0.55), -0.3, motion, source.w);
      energy = max(energy, motion.w * source.w);
    }
    // Colors mix like light (a weighted average, never muddy sums), and the
    // coverage saturates softly
    vec3 aura = sumColor / max(sumWeight, 1e-4);
    float coverage = 1.0 - exp(-sumWeight * 1.2);
    color = mix(color, aura, coverage * (0.42 + 0.12 * energy));

    // Notebook grid, drawn on the wall itself (so it keeps the perspective
    // and the parallax): the ray through this pixel meets the wall plane
    vec2 ndc = gl_FragCoord.xy / (uResolution * uPixelRatio) * 2.0 - 1.0;
    vec4 near = uClipToWorld * vec4(ndc, -1.0, 1.0);
    vec4 far = uClipToWorld * vec4(ndc, 1.0, 1.0);
    near /= near.w;
    far /= far.w;
    vec3 ray = far.xyz - near.xyz;
    vec2 wall = (near.xyz + ray * ((${WALL.z.toFixed(3)} - near.z) / ray.z)).xy / ${WALL.gridCell.toFixed(3)};
    // ~1 CSS px lines, antialiased
    vec2 grid = abs(fract(wall - 0.5) - 0.5) / (fwidth(wall) * max(uPixelRatio, 1.0));
    float line = 1.0 - min(min(grid.x, grid.y), 1.0);
    color = mix(color, uGridLine, line * ${WALL.gridOpacity.toFixed(3)});

    // Fine grain: paper-like, and no banding in the gradients
    color += (hash(gl_FragCoord.xy) - 0.5) * 0.008;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * The wall behind the shelves, drawn as a fullscreen layer before anything
 * else (no depth), so it fills the canvas whatever the camera framing. The
 * shadows on it are real planes at WALL.z (shelf.ts).
 */
export class Backdrop {
  readonly mesh: Mesh;
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly material: ShaderMaterial;
  private readonly clipToWorld = new Matrix4();
  private readonly sources = Array.from({ length: MAX_SOURCES }, () => new Vector4());
  private readonly motions = Array.from({ length: MAX_SOURCES }, () => new Vector4());
  private readonly colors = Array.from({ length: MAX_SOURCES * AURA.colors }, () => new Vector3());

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uResolution: { value: new Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uWall: { value: srgb(COLORS.background) },
        uGridLine: { value: srgb(COLORS.gridLine) },
        uClipToWorld: { value: this.clipToWorld },
        uSource: { value: this.sources },
        uMotion: { value: this.motions },
        uColors: { value: this.colors },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  setSize(width: number, height: number, pixelRatio: number) {
    (this.material.uniforms.uResolution.value as Vector2).set(width, height);
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  /** Per frame (the camera moves with the parallax): where the wall is on screen */
  setCamera(camera: Camera) {
    this.clipToWorld.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  }

  /** The strongest lights win if more are fading at once (fast switching) */
  setSources(sources: AuraSource[]) {
    const strongest = sources.sort((a, b) => b.strength - a.strength).slice(0, MAX_SOURCES);
    for (let s = 0; s < MAX_SOURCES; s++) {
      const source = strongest[s];
      if (!source) {
        this.sources[s].set(0, 0, 1, 0);
        continue;
      }
      this.sources[s].set(source.x, source.y, Math.max(source.size, 1), source.strength);
      this.motions[s].set(source.tiltX, source.tiltY, source.flow, source.energy);
      for (let i = 0; i < AURA.colors; i++) {
        const [r, g, b] = source.palette[i] ?? source.palette[0];
        this.colors[s * AURA.colors + i].set(r, g, b);
      }
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
