import { breakpoints } from '../../data/breakpoints';

/**
 * Dropdown of the brand pill (shadcn/Radix-like behaviour): toggles, closes on
 * Esc, outside clicks and after picking an item; arrow keys / Home / End move
 * between items; opening from the keyboard focuses the first item.
 */
export function initMenu(root: HTMLElement | null) {
  const toggle = root?.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = root?.querySelector<HTMLElement>('[data-menu]');
  if (!root || !toggle || !menu) return;
  const items = [...menu.querySelectorAll<HTMLAnchorElement>('[data-menu-item]')];

  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

  // On phones the menu is fixed and as wide as the screen (_brand-pill.scss):
  // it sits right above the pill, wherever the pill is. On every size it
  // grows from the toggle: its origin is the toggle's centre, at its bottom.
  const phone = window.matchMedia(`(max-width: ${breakpoints.tablet - 1}px)`);
  const placeMenu = () => {
    const pill = root.getBoundingClientRect();
    menu.style.setProperty('--menu-top', `${pill.bottom}px`);
    // The box is measured scaled (closed state): undo the scale around the
    // current origin to find where its left edge really is
    const style = getComputedStyle(menu);
    const scale = style.transform === 'none' ? 1 : new DOMMatrix(style.transform).a;
    const left = menu.getBoundingClientRect().left - parseFloat(style.transformOrigin) * (1 - scale);
    const button = toggle.getBoundingClientRect();
    // Above the pill it grows up from it; on phones, below it, it grows down
    const y = phone.matches ? '0%' : '100%';
    menu.style.setProperty('--menu-origin', `${button.left + button.width / 2 - left}px ${y}`);
  };
  window.addEventListener('resize', () => {
    if (isOpen()) placeMenu();
  });

  const setOpen = (open: boolean, { focusFirst = false, restoreFocus = false } = {}) => {
    if (open) placeMenu();
    toggle.setAttribute('aria-expanded', String(open));
    menu.dataset.state = open ? 'open' : 'closed';
    menu.inert = !open;
    if (open && focusFirst) items[0]?.focus();
    if (!open && restoreFocus) toggle.focus();
  };

  // event.detail is 0 for keyboard-triggered clicks (Enter / Space)
  toggle.addEventListener('click', (event) => setOpen(!isOpen(), { focusFirst: event.detail === 0 }));

  menu.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    const moves: Record<string, number> = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      items[moves[event.key]]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false, { restoreFocus: true });
      // Handled: don't also close the selected CD
      event.stopImmediatePropagation();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (isOpen() && !root.contains(event.target as Node)) setOpen(false);
  });
}
