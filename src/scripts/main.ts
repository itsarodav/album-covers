import { covers } from '../data/covers';
import { media } from '../data/breakpoints';
import { CdShelf } from './three/cdShelf';
import { InfoPanel } from './ui/infoPanel';
import { initMenu } from './ui/menu';

// Boot and selection state:
//   idle ──tap CD──▶ selected(A) ──tap CD B──▶ selected(B)
//   selected(X) ──tap outside / Esc / close button──▶ idle
// The 3D shelf and the HTML panel just reflect `selected`.

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function showFallback() {
  document.querySelector<HTMLElement>('[data-fallback]')?.removeAttribute('hidden');
  document.querySelector<HTMLElement>('[data-shelf-canvas]')?.setAttribute('hidden', '');
}

async function boot() {
  initMenu(document.querySelector('[data-brand-pill]'));

  const canvas = document.querySelector<HTMLCanvasElement>('[data-canvas]');
  const stageElement = document.querySelector<HTMLElement>('[data-stage]');
  const panelElement = document.querySelector<HTMLElement>('[data-info-panel]');
  if (!canvas || !stageElement || !panelElement || !supportsWebGL()) {
    showFallback();
    return;
  }

  // The spine and back textures are drawn with the page font: wait for it
  await document.fonts.ready;
  const fontFamily = getComputedStyle(document.body).fontFamily;

  const panel = new InfoPanel(panelElement, document.querySelector('[data-live-region]'));
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-cd-button]')];
  const reducedMotion = window.matchMedia(media.reducedMotion).matches;

  let selected: number | null = null;
  /** Each cover's colors for the card's glow, as their images load */
  const coverColors: string[][] = [];

  const select = (index: number | null, { fromKeyboard = false } = {}) => {
    if (index === selected) return;
    const previous = selected;
    selected = index;

    buttons.forEach((button, i) => button.setAttribute('aria-expanded', String(i === index)));

    if (index === null) {
      panel.close();
      // Focus goes back to the CD's button
      if (previous !== null && panelElement.contains(document.activeElement)) buttons[previous]?.focus();
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      panel.fill(covers[index]);
      panel.setColors(coverColors[index]);
      panel.open(covers[index], fromKeyboard || panelElement.contains(document.activeElement));
      history.replaceState(null, '', `#${covers[index].id}`);
    }
    shelf.select(index);
  };

  let shelf: CdShelf;
  try {
    shelf = new CdShelf({
      canvas,
      stageElement,
      panelElement,
      covers,
      fontFamily,
      reducedMotion,
      parallax: !reducedMotion && window.matchMedia(media.finePointer).matches,
      onTap: (index) => select(index),
      onCoverColors: (index, colors) => {
        coverColors[index] = colors;
        if (index === selected) panel.setColors(colors);
      },
    });
  } catch (error) {
    console.error(error);
    showFallback();
    return;
  }

  // Accessible twin: Enter / Space open the CD, focus lifts it on the shelf
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(index, { fromKeyboard: true }));
    button.addEventListener('focus', () => shelf.setKeyboardHover(index));
    button.addEventListener('blur', () => shelf.setKeyboardHover(null));
  });

  panelElement.querySelector('[data-panel-close]')?.addEventListener('click', () => select(null));

  document.addEventListener('keydown', (event) => {
    if (selected === null) return;
    if (event.key === 'Escape') {
      select(null);
      return;
    }
    // Arrow keys spin the open CD (keyboard alternative to dragging)
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const arrow = arrows[event.key];
    if (arrow && panelElement.contains(document.activeElement)) {
      event.preventDefault();
      shelf.nudge(...arrow);
    }
  });

  // Deep link: /#genuino opens that CD
  const fromHash = covers.findIndex((cover) => `#${cover.id}` === location.hash);
  if (fromHash >= 0) select(fromHash);

  document.documentElement.dataset.ready = 'true';

  // Dev: free the GPU on hot reload
  if (import.meta.hot) import.meta.hot.dispose(() => shelf.dispose());
}

boot();
