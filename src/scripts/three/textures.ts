import { CanvasTexture, SRGBColorSpace, TextureLoader, type Texture, type WebGLRenderer } from 'three';
import type { Cover } from '../../data/covers';
import { CASE, COLORS } from './constants';

// Textures drawn with a 2D canvas: every case gets a spine and a back without
// designing them by hand.

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, renderer: WebGLRenderer): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

/** Shrinks the font until the text fits in maxWidth */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: number, family: string) {
  let current = size;
  do {
    ctx.font = `${weight} ${current}px ${family}`;
    current -= 2;
  } while (ctx.measureText(text).width > maxWidth && current > 10);
}

export interface SpineColors {
  background: string;
  /** Title */
  ink: string;
  /** Artist */
  muted: string;
}

/** Until the cover loads: plain white inlay */
const DEFAULT_SPINE: SpineColors = { background: COLORS.plastic, ink: COLORS.ink, muted: COLORS.muted };

/**
 * The cover's background color: the most common color along its edges
 * (colors grouped coarsely, then averaged within the winning group), so a
 * busy photo still gives one clean color instead of a muddy average.
 */
export function sampleBackground(image: CanvasImageSource): [number, number, number] {
  const size = 48;
  const band = 4;
  const { ctx } = createCanvas(size, size);
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const groups = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x >= band && x < size - band && y >= band && y < size - band) continue;
      const i = (y * size + x) * 4;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const group = groups.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      group.count++;
      group.r += r;
      group.g += g;
      group.b += b;
      groups.set(key, group);
    }
  }
  let best = { count: 0, r: 255, g: 255, b: 255 };
  for (const group of groups.values()) if (group.count > best.count) best = group;
  const n = Math.max(best.count, 1);
  return [Math.round(best.r / n), Math.round(best.g / n), Math.round(best.b / n)];
}

type Rgb = [number, number, number];

function toHsl([r, g, b]: Rgb): Rgb {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h /= 6;
  return [h, s, l];
}

function fromHsl([h, s, l]: Rgb): Rgb {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/**
 * The cover's main colors: grouped coarsely, scored by area with a bonus for
 * saturation (a small red sticker matters more than a big grey sky), then
 * picked far apart from each other. sRGB 0..255, always `count` entries,
 * strongest first. Toned for each use by pastelTones() and glowColors().
 */
export function samplePalette(image: CanvasImageSource, count: number): Rgb[] {
  const size = 40;
  const { ctx } = createCanvas(size, size);
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const groups = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const group = groups.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    group.count++;
    group.r += r;
    group.g += g;
    group.b += b;
    groups.set(key, group);
  }

  const candidates = [...groups.values()].map((group) => {
    const rgb: Rgb = [group.r / group.count, group.g / group.count, group.b / group.count];
    const [, s, l] = toHsl(rgb);
    // Saturated mid tones score best; near-black and near-white count less
    const vivid = s * (1 - Math.abs(l - 0.5) * 1.2);
    return { rgb, score: group.count * (0.3 + vivid * 1.6) };
  });
  candidates.sort((a, b) => b.score - a.score);

  const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const picked: Rgb[] = [];
  for (const minDistance of [70, 40, 0]) {
    for (const candidate of candidates) {
      if (picked.length === count) break;
      if (picked.every((rgb) => distance(rgb, candidate.rgb) > minDistance)) picked.push(candidate.rgb);
    }
  }
  while (picked.length < count) picked.push(picked[0] ?? [217, 217, 217]);
  return picked;
}

/** Light pastel versions (sRGB 0..1), for light on the wall: never dark behind the text */
export function pastelTones(colors: Rgb[], lightness: { min: number; max: number }): Rgb[] {
  return colors.map((rgb) => {
    const [h, s, l] = toHsl(rgb);
    return fromHsl([h, Math.min(1, s * 1.15), Math.min(Math.max(l, lightness.min), lightness.max)]);
  });
}

function relativeLuminance([r, g, b]: Rgb) {
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** White text keeps at least ~4.5:1 on colors at or under this luminance */
const MAX_LUMINANCE_UNDER_WHITE = 0.18;

/**
 * Deep, saturated versions (sRGB 0..1): darkened until white text keeps
 * ~4.5:1 on them. Whites, blacks and greys give no color to a gradient: they
 * take the hue of the cover's first real color instead, a shade darker each
 * (a black-and-white cover stays grey).
 */
function vividTones(colors: Rgb[]): Rgb[] {
  const hsl = colors.map(toHsl);
  const accent = hsl.find(([, s, l]) => s >= 0.12 && l > 0.08 && l < 0.94);
  return hsl.map(([h, s, l], index) => {
    let hue = h;
    let saturation = s < 0.12 ? s : Math.min(Math.max(s * 1.3, 0.55), 1);
    let lightness = Math.min(Math.max(l, 0.3), 0.55);
    const colorless = s < 0.12 || l <= 0.08 || l >= 0.94;
    if (colorless && accent) {
      hue = (accent[0] + 0.03 * index) % 1;
      saturation = Math.min(Math.max(accent[1] * 1.3, 0.55), 1);
      lightness = 0.5 - 0.07 * index;
    }
    // Dark yellow is olive: yellows lean to amber instead, which stays warm and bright
    if (hue > 0.1 && hue < 0.2) hue = 0.085;
    let out = fromHsl([hue, saturation, lightness]);
    while (relativeLuminance(out) > MAX_LUMINANCE_UNDER_WHITE && lightness > 0.15) {
      lightness -= 0.02;
      out = fromHsl([hue, saturation, lightness]);
    }
    return out;
  });
}

// OKLab / OKLCH (Björn Ottosson): the space the card's gradient blends in,
// so hues and their distances here match what the browser draws
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklch([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

/** Unclamped: channels outside 0..1 mean the color is out of the sRGB gamut */
function fromOklchRaw([L, C, h]: Rgb): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** In gamut (less chroma until it fits) and dark enough for white text */
function fromOklch([L, C, h]: Rgb): Rgb {
  let lightness = L;
  let chroma = C;
  let rgb = fromOklchRaw([lightness, chroma, h]);
  const outside = (c: Rgb) => c.some((v) => Number.isNaN(v) || v < -0.001 || v > 1.001);
  while (outside(rgb) && chroma > 0.01) {
    chroma *= 0.92;
    rgb = fromOklchRaw([lightness, chroma, h]);
  }
  rgb = rgb.map((v) => Math.min(Math.max(v || 0, 0), 1)) as Rgb;
  while (relativeLuminance(rgb) > MAX_LUMINANCE_UNDER_WHITE && lightness > 0.2) {
    lightness -= 0.02;
    rgb = fromOklchRaw([lightness, chroma, h]).map((v) => Math.min(Math.max(v || 0, 0), 1)) as Rgb;
  }
  return rgb;
}

/** Signed shortest turn from one hue to another, degrees */
const hueTurn = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/** Yellow-greens: blended through at this depth they turn olive */
const OLIVE = { from: 92, to: 128 } as const;
/** Purples and magentas (OKLCH hue) */
const PURPLE = { from: 290, to: 350 } as const;

/**
 * Colors for the info card's glow, as CSS colors (sampled colors in, sRGB
 * 0..255): the cover's main color and two companions it blends well with.
 *
 * - Main: the most colorful of the cover's strongest colors (a mostly white
 *   or black cover still has an accent that defines it).
 * - Companion: another real color of the cover (muted ones like beige or sage
 *   don't count: deepened they turn ochre or olive), if it's a neighbour on the
 *   color wheel (far apart hues blend through colors the cover doesn't have,
 *   except through purples: blue → pink looks deliberate) and the blend
 *   doesn't pass through olive.
 * - Otherwise: the main hue turned a little each way, one lighter, one deeper,
 *   never into olive.
 *
 * All deep enough for white text.
 */
export function glowColors(colors: Rgb[]): string[] {
  const source = colors.map((rgb) => toOklch(rgb.map((v) => v / 255) as Rgb));
  const tones = vividTones(colors).map(toOklch);
  let mainIndex = 0;
  source.forEach(([, chroma], i) => {
    if (chroma * (1 - 0.15 * i) > source[mainIndex][1] * (1 - 0.15 * mainIndex)) mainIndex = i;
  });
  // A quiet cover (misty, muted) gets a quiet glow: its main color, only a
  // little deeper than it is, in a tonal gradient without companions
  const muted = source[mainIndex][1] < 0.07;
  const main: Rgb = muted
    ? [tones[mainIndex][0], Math.min(tones[mainIndex][1], Math.max(source[mainIndex][1] * 2, 0.05)), tones[mainIndex][2]]
    : tones[mainIndex];
  const inOlive = (hue: number) => hue > OLIVE.from && hue < OLIVE.to;
  const blendsWell = ([, chroma, hue]: Rgb, i: number) => {
    const turn = hueTurn(main[2], hue);
    if (muted || i === mainIndex || source[i][1] < 0.05 || chroma < 0.06 || main[1] < 0.06 || Math.abs(turn) < 18) {
      return false;
    }
    const path = Array.from({ length: 11 }, (_, step) => (main[2] + (turn * step) / 10 + 360) % 360);
    const viaPurple = path.some((h) => h > PURPLE.from && h < PURPLE.to);
    if (Math.abs(turn) > (viaPurple ? 155 : 110)) return false;
    if (inOlive(main[2]) || inOlive(hue)) return true;
    return !path.some(inOlive);
  };
  const companions = tones.filter(blendsWell);
  const neighbours = (
    [
      [32, 0.06],
      [-28, -0.05],
      [58, 0.03],
      [-54, -0.03],
    ] as const
  )
    .map(([turn, lift]): Rgb => [main[0] + lift, main[1], (main[2] + turn * (muted ? 0.6 : 1) + 360) % 360])
    .filter(([, , hue]) => inOlive(main[2]) || !inOlive(hue));
  const picked = [main, companions[0] ?? neighbours.shift() ?? main, companions[1] ?? neighbours.shift() ?? main];
  return picked.map((oklch) => {
    const [r, g, b] = fromOklch(oklch).map((v) => Math.round(v * 255));
    return `rgb(${r}, ${g}, ${b})`;
  });
}

/**
 * Shadow of a board on the wall, top to bottom: a faint occlusion line above
 * the board (where it meets the wall), the hidden part behind the board, then
 * the cast shadow below it, fading as it gets further from the board. The ends
 * fade out too. Sizes are given as shares of the texture height (shelf.ts).
 */
export function createBoardShadowTexture(
  renderer: WebGLRenderer,
  layout: { boardTop: number; boardBottom: number },
): CanvasTexture {
  const width = 512;
  const height = 256;
  const { canvas, ctx } = createCanvas(width, height);
  const top = layout.boardTop * height;
  const bottom = layout.boardBottom * height;

  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  const ink = (alpha: number) => `rgba(11, 31, 58, ${alpha})`;
  vertical.addColorStop(0, ink(0));
  vertical.addColorStop((top * 0.55) / height, ink(0.04));
  vertical.addColorStop(top / height, ink(0.22));
  vertical.addColorStop(bottom / height, ink(1));
  // Cast shadow: dense near the board, long soft tail
  const tail = height - bottom;
  for (const [at, alpha] of [[0.12, 0.72], [0.3, 0.42], [0.55, 0.16], [0.8, 0.04], [1, 0]] as const) {
    vertical.addColorStop((bottom + tail * at) / height, ink(alpha));
  }
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);

  // Soft ends: keep only the middle, fading out at both sides
  ctx.globalCompositeOperation = 'destination-in';
  const horizontal = ctx.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, 'rgba(0, 0, 0, 0)');
  horizontal.addColorStop(0.06, 'rgba(0, 0, 0, 1)');
  horizontal.addColorStop(0.94, 'rgba(0, 0, 0, 1)');
  horizontal.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, width, height);
  return toTexture(canvas, renderer);
}

/** Background from the cover, and dark or white type, whichever contrasts more */
export function spineColorsFor([r, g, b]: [number, number, number]): SpineColors {
  const linear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  // Contrast against white vs against the dark ink (#282B27, luminance ~0.024)
  const dark = luminance > Math.sqrt(1.05 * 0.074) - 0.05;
  return {
    background: `rgb(${r}, ${g}, ${b})`,
    ink: dark ? COLORS.ink : '#FFFFFF',
    muted: dark ? 'rgba(40, 43, 39, 0.72)' : 'rgba(255, 255, 255, 0.78)',
  };
}

/**
 * Spine: drawn horizontally (wide canvas) and laid on a plane that jewelCase.ts
 * turns upright, so the text runs along the edge like on a real inlay. The
 * canvas's left end is the top of the case: artist at the top, title at the
 * bottom, end to end, both centred across the spine.
 */
export function drawSpine(canvas: HTMLCanvasElement, cover: Cover, family: string, colors: SpineColors) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  const padding = height * 0.9;
  const maxText = (width - padding * 2) * 0.44;
  ctx.textBaseline = 'middle';

  // Artist, top end
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.muted;
  fitText(ctx, cover.artist.toUpperCase(), maxText, height * 0.42, 500, family);
  ctx.fillText(cover.artist.toUpperCase(), padding, height / 2);

  // Title, bottom end
  ctx.textAlign = 'right';
  ctx.fillStyle = colors.ink;
  fitText(ctx, cover.title.toUpperCase(), maxText, height * 0.5, 700, family);
  ctx.fillText(cover.title.toUpperCase(), width - padding, height / 2);
}

export function createSpineTexture(cover: Cover, family: string, renderer: WebGLRenderer): CanvasTexture {
  const width = 2048;
  const height = Math.round((width * CASE.spineDepth) / CASE.coverSize);
  const { canvas } = createCanvas(width, height);
  drawSpine(canvas, cover, family, DEFAULT_SPINE);
  return toTexture(canvas, renderer);
}

/** Generic back insert in the project's style, with the cover's title */
export function createBackTexture(cover: Cover, family: string, renderer: WebGLRenderer): CanvasTexture {
  const width = 1024;
  const height = Math.round(width * (CASE.height - 0.7) / (CASE.width - 0.5));
  const { canvas, ctx } = createCanvas(width, height);
  const margin = width * 0.08;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Blue band, like the shelves
  ctx.fillStyle = COLORS.shelf;
  ctx.fillRect(0, height - height * 0.16, width, height * 0.16);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.ink;
  fitText(ctx, cover.title, width - margin * 2, 96, 700, family);
  ctx.fillText(cover.title, margin, margin + 80);

  ctx.fillStyle = COLORS.muted;
  ctx.font = `400 44px ${family}`;
  ctx.fillText(`${cover.artist} · ${cover.year}`, margin, margin + 150);

  ctx.font = `400 30px ${family}`;
  ctx.fillText('Cover design by arodav', margin, height * 0.62);

  // Fake barcode
  ctx.fillStyle = COLORS.ink;
  const barcodeX = width - margin - 220;
  const barcodeY = height * 0.5;
  let x = barcodeX;
  let seed = [...cover.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  while (x < barcodeX + 220) {
    seed = (seed * 9301 + 49297) % 233280;
    const bar = 2 + (seed % 4) * 2;
    ctx.fillRect(x, barcodeY, bar, 110);
    x += bar + 3 + (seed % 3) * 2;
  }

  ctx.fillStyle = COLORS.plastic;
  ctx.font = `700 34px ${family}`;
  ctx.fillText('Album covers I made so far', margin, height - height * 0.06);

  return toTexture(canvas, renderer);
}

/** Soft elliptical blob for the cheap contact shadow under each case */
export function createContactShadowTexture(renderer: WebGLRenderer): CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(11, 31, 58, 0.55)');
  gradient.addColorStop(0.5, 'rgba(11, 31, 58, 0.22)');
  gradient.addColorStop(1, 'rgba(11, 31, 58, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, renderer);
}

/**
 * Roughness map for the clear plastic: glossy overall, with faint smudges and
 * hairline scratches that only show up in the reflections. Shared by all cases.
 */
export function createSmudgeTexture(): CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  // Base roughness ~0.07 (roughnessMap reads the green channel)
  ctx.fillStyle = 'rgb(18, 18, 18)';
  ctx.fillRect(0, 0, size, size);

  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // Fingerprint-ish soft smudges
  for (let i = 0; i < 14; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 20 + random() * 60;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(70, 70, 70, ${0.25 + random() * 0.3})`);
    gradient.addColorStop(1, 'rgba(70, 70, 70, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // Hairline scratches
  ctx.lineCap = 'round';
  for (let i = 0; i < 45; i++) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI;
    const length = 10 + random() * 70;
    ctx.strokeStyle = `rgba(150, 150, 150, ${0.2 + random() * 0.4})`;
    ctx.lineWidth = 0.5 + random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

/**
 * Black ribbed grip on the left of the tray, as on classic jewel cases: fine
 * vertical ridges painted into the color (no bump/normal tricks, which looked
 * dotted or broken). The plane is ~1.9 × 12.4 cm.
 */
export function createGripTexture(renderer: WebGLRenderer): CanvasTexture {
  const ribs = 26;
  const ribWidth = 8;
  const width = ribs * ribWidth;
  const height = 64;
  const { canvas, ctx } = createCanvas(width, height);
  ctx.fillStyle = COLORS.grip;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < ribs; i++) {
    const x = i * ribWidth;
    const gradient = ctx.createLinearGradient(x, 0, x + ribWidth, 0);
    gradient.addColorStop(0, COLORS.gripShade);
    gradient.addColorStop(0.45, COLORS.gripRidge);
    gradient.addColorStop(0.55, COLORS.gripRidge);
    gradient.addColorStop(1, COLORS.gripShade);
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 1, 0, ribWidth - 2, height);
  }
  // Where the strip meets the tray: a thin lit edge
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(width - 3, 0, 3, height);
  return toTexture(canvas, renderer);
}

/** Layout of the lid details, in case units (cm). Given by jewelCase.ts. */
export interface LidDetailLayout {
  width: number;
  height: number;
  coverSize: number;
  /** x of the grip strip's right edge */
  gripRight: number;
  /** x of the booklet's right edge */
  bookletRight: number;
}

/**
 * What makes clear plastic read as a real jewel case, painted on a plane over
 * the lid: lit
 * outer edges, the grey line of the lid walls, the ledges above and below the
 * booklet, the round hinge pins in the left corners, scratches and dust.
 * Drawn with alpha, so it works over the cover and over the page background.
 */
export function createLidDetailTexture(layout: LidDetailLayout, renderer: WebGLRenderer): CanvasTexture {
  const scale = 80; // px per cm
  const width = Math.round(layout.width * scale);
  const height = Math.round(layout.height * scale);
  const { canvas, ctx } = createCanvas(width, height);
  const px = (x: number) => (x + layout.width / 2) * scale;
  const py = (y: number) => (layout.height / 2 - y) * scale;
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, lineWidth: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const shade = (alpha: number) => `rgba(38, 44, 40, ${alpha})`;
  const light = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;

  // Rim around the booklet: a faint grey, so it reads as thick plastic, not paper
  const bookletLeft = px(layout.bookletRight - layout.coverSize);
  const bookletTop = py(layout.coverSize / 2);
  const bookletSize = layout.coverSize * scale;
  ctx.fillStyle = shade(0.1);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(bookletLeft, bookletTop, bookletSize, bookletSize);
  ctx.fill('evenodd');

  // (The glare over the lid is a separate layer that moves with the tilt:
  // createSheenTexture.)

  // Lid walls: lit outer edge (brighter on top, where the light comes from),
  // then the darker inner edge of the wall
  ctx.strokeStyle = light(0.6);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);
  line(4, 1.5, width - 4, 1.5, light(0.95), 3);
  line(1.5, 4, 1.5, height - 4, light(0.55), 2);
  line(4, height - 1.5, width - 4, height - 1.5, shade(0.28), 2.5);
  line(width - 1.5, 4, width - 1.5, height - 4, shade(0.12), 2);
  const wall = 0.16 * scale;
  ctx.strokeStyle = shade(0.32);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(wall, wall, width - wall * 2, height - wall * 2);
  ctx.strokeStyle = light(0.35);
  ctx.lineWidth = 1;
  ctx.strokeRect(wall + 2, wall + 2, width - wall * 2 - 4, height - wall * 2 - 4);

  // Ledges just above and below the booklet, and beside its right edge
  const left = px(layout.gripRight);
  const right = width - wall;
  for (const sign of [1, -1]) {
    const y = py(sign * (layout.coverSize / 2 + 0.06));
    line(left, y, right, y, shade(0.22), 1.5);
    line(left, y + sign * -2, right, y + sign * -2, light(0.4), 1);
  }
  const ledgeX = px(layout.bookletRight + 0.06);
  line(ledgeX, py(layout.coverSize / 2), ledgeX, py(-layout.coverSize / 2), shade(0.2), 1.5);

  // Edge of the black strip seen through the lid
  line(left, wall, left, height - wall, light(0.28), 1.5);

  // Hinge pins in the top and bottom left corners, in the rim above/below the booklet
  const rim = (layout.height - layout.coverSize) / 2;
  const pinRadius = rim * 0.42 * scale;
  for (const sign of [1, -1]) {
    const cx = px(layout.gripRight + 0.45);
    const cy = py(sign * (layout.height / 2 - rim / 2));
    ctx.fillStyle = light(0.28);
    ctx.beginPath();
    ctx.arc(cx, cy, pinRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shade(0.45);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = light(0.7);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, pinRadius * 0.62, Math.PI * 1.1, Math.PI * 1.75);
    ctx.stroke();
  }

  let seed = 11;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // Scratches: one long diagonal (like the reference) and a few faint ones
  ctx.lineCap = 'round';
  line(width * 0.42, height * 0.12, width * 0.82, height * 0.36, light(0.22), 1);
  for (let i = 0; i < 16; i++) {
    const x = random() * width;
    const y = random() * height;
    const angle = (random() - 0.5) * 1.2;
    const length = 30 + random() * 160;
    line(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, light(0.06 + random() * 0.12), 0.8);
  }

  // Dust
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = light(0.15 + random() * 0.3);
    ctx.beginPath();
    ctx.arc(random() * width, random() * height, 0.5 + random() * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  return toTexture(canvas, renderer);
}

/**
 * Glare on the lid, drawn black-on-white-light for additive blending (black
 * adds nothing). The canvas covers twice the lid in each direction: the lid
 * shows the middle half, and jewelCase.ts slides it as the case turns, so the
 * reflection travels across the plastic like on a real case.
 */
export function createSheenTexture(renderer: WebGLRenderer): CanvasTexture {
  const size = 1024;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // Bands run from bottom-left to top-right (light from the upper left)
  const band = (stops: [number, number][]) => {
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    for (const [at, value] of stops) gradient.addColorStop(at, `rgb(${value}, ${value}, ${value})`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  };
  // Broad soft glare, then a thin, sharper streak beside it
  band([[0.3, 0], [0.39, 14], [0.44, 26], [0.47, 16], [0.52, 0]]);
  band([[0.556, 0], [0.568, 30], [0.58, 0]]);
  // Faint wide wash so the plastic never looks perfectly dead
  band([[0, 2], [0.5, 4], [1, 2]]);

  const texture = toTexture(canvas, renderer);
  texture.repeat.set(0.5, 0.5);
  texture.offset.set(0.25, 0.25);
  return texture;
}

/** Soft rounded shadow behind the selected CD; the case fills the middle 1/1.4 of it */
export function createDropShadowTexture(renderer: WebGLRenderer): CanvasTexture {
  const width = 512;
  const height = Math.round((width * CASE.height) / CASE.width);
  const { canvas, ctx } = createCanvas(width, height);
  const inner = 1 / 1.4;
  const w = width * inner;
  const h = height * inner;
  // Draw the rect far off-canvas and keep only its blurred shadow
  ctx.shadowColor = 'rgba(11, 31, 58, 0.9)';
  ctx.shadowBlur = width * 0.09;
  ctx.shadowOffsetX = width * 4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.roundRect((width - w) / 2 - width * 4, (height - h) / 2, w, h, width * 0.02);
  ctx.fill();
  return toTexture(canvas, renderer);
}

const loader = new TextureLoader();

export async function loadCoverTexture(url: string, renderer: WebGLRenderer): Promise<Texture> {
  const texture = await loader.loadAsync(url);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}
