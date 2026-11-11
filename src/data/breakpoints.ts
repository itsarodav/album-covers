// Mirror of src/styles/base/_breakpoints.scss: change both together.
// JS needs them to decide CDs per shelf and where the selected CD goes.
export const breakpoints = {
  tablet: 640,
  desktop: 1024,
} as const;

export const media = {
  reducedMotion: '(prefers-reduced-motion: reduce)',
  finePointer: '(hover: hover) and (pointer: fine)',
} as const;
