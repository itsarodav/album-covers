import { breakpoints } from '../../data/breakpoints';
import { CASE, FOCUS } from './constants';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * side: info panel on the right, CD shifted to the left (desktop, landscape tablet)
 * stacked: info panel as a bottom sheet, CD in the upper part (phones, portrait tablet)
 * Same rule as the side-panel mixin in src/styles/base/_breakpoints.scss.
 */
export type LayoutMode = 'side' | 'stacked';

export function getLayoutMode(width: number, height: number): LayoutMode {
  if (width >= breakpoints.desktop) return 'side';
  if (width >= 768 && width > height) return 'side';
  return 'stacked';
}

/** CDs per shelf: 3 on desktop and tablets, 2 on phones (6 covers → 3+3 / 2+2+2) */
export function getColumns(width: number, mode: LayoutMode): number {
  if (mode === 'side') return 3;
  return width < breakpoints.tablet ? 2 : 3;
}

export function rectOf(element: Element): Rect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

/** Exact on-screen box of the selected CD, front face, no tilt */
function caseBox(availableWidth: number, availableHeight: number): { width: number; height: number } {
  const ratio = CASE.width / CASE.height;
  const height = Math.max(
    0,
    Math.min(availableHeight * FOCUS.fill, (availableWidth * FOCUS.fill) / ratio, FOCUS.maxHeightPx),
  );
  return { width: height * ratio, height };
}

/**
 * Where the selected CD goes (its exact box), and where the panel goes.
 *
 * side: CD + gap + panel laid out like a centred `flex-direction: row` with
 * `align-items: center` inside the stage. The panel's position is written
 * to --panel-left / --panel-top (see partials/_info-panel.scss).
 *
 * stacked: the panel is a bottom sheet (CSS); the CD is centred in the space
 * left above it, like a column.
 *
 * Uses the panel's layout size (offsetWidth/Height ignore its slide-in transform).
 */
export function getFocusRect(mode: LayoutMode, viewport: Rect, stage: Rect, panel: HTMLElement): Rect {
  if (mode === 'side') {
    const panelWidth = panel.offsetWidth;
    const box = caseBox(stage.width - panelWidth - FOCUS.gap, stage.height);
    const rowWidth = box.width + FOCUS.gap + panelWidth;
    const left = stage.x + (stage.width - rowWidth) / 2;
    const centerY = stage.y + stage.height / 2;

    panel.style.setProperty('--panel-left', `${left + box.width + FOCUS.gap}px`);
    panel.style.setProperty('--panel-top', `${centerY}px`);
    return { x: left, y: centerY - box.height / 2, ...box };
  }

  const gap = 16;
  const panelTop = viewport.height - panel.offsetHeight - parseFloat(getComputedStyle(panel).bottom || '0');
  const top = stage.y + gap;
  const free = { width: viewport.width, height: Math.max(0, panelTop - gap - top) };
  const box = caseBox(free.width, free.height);
  return {
    x: (free.width - box.width) / 2,
    y: top + (free.height - box.height) / 2,
    ...box,
  };
}
