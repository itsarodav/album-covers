import type { Cover } from '../../data/covers';
import { site } from '../../data/site';

/** Optional links: hidden when the cover has no URL for them */
function setLink(link: HTMLAnchorElement, url?: string) {
  if (url) link.href = url;
  else link.removeAttribute('href');
  link.hidden = !url;
}

/** HTML panel with the selected CD's data (it's never drawn in the canvas) */
export class InfoPanel {
  private readonly glow: HTMLElement | null;
  private readonly fields: {
    artist: HTMLElement;
    title: HTMLElement;
    year: HTMLElement;
    description: HTMLElement;
    format: HTMLElement;
    spotify: HTMLAnchorElement;
    youtube: HTMLAnchorElement;
    instagram: HTMLAnchorElement;
  };

  constructor(
    readonly element: HTMLElement,
    private readonly liveRegion: HTMLElement | null,
  ) {
    const field = <T extends HTMLElement>(name: string) => element.querySelector<T>(`[data-field="${name}"]`)!;
    this.glow = element.querySelector('[data-glow]');
    this.fields = {
      artist: field('artist'),
      title: field('title'),
      year: field('year'),
      description: field('description'),
      format: field('format'),
      spotify: field<HTMLAnchorElement>('spotify'),
      youtube: field<HTMLAnchorElement>('youtube'),
      instagram: field<HTMLAnchorElement>('instagram'),
    };
  }

  /**
   * Fills the panel. Called before the CD flies, so its height is known.
   * If it's already open (switching CDs), the new content settles in
   * (.info-panel[data-swap] in partials/_info-panel.scss).
   */
  fill(cover: Cover) {
    if (this.element.dataset.open === 'true') {
      delete this.element.dataset.swap;
      // Restart the animation even on quick successive switches
      void this.element.offsetWidth;
      this.element.dataset.swap = '';
    }
    this.fields.artist.textContent = cover.artist;
    this.fields.title.textContent = cover.title;
    this.fields.year.textContent = String(cover.year);
    this.fields.description.textContent = cover.description;
    this.fields.format.textContent = site.text.formats[cover.format ?? 'single'];
    setLink(this.fields.spotify, cover.spotifyUrl);
    setLink(this.fields.youtube, cover.youtubeUrl);
    setLink(this.fields.instagram, cover.instagramUrl);
    this.fields.instagram.setAttribute('aria-label', `${site.text.follow(cover.artist)} ${site.text.newTab}`);
    this.fields.instagram.title = site.text.follow(cover.artist);
  }

  /**
   * The glow's colors: the cover's main color and two that blend well with
   * it, deep enough for white text (glowColors in three/textures.ts). Until its image loads (or without colors), the CSS defaults. They
   * crossfade (registered custom properties, partials/_info-panel.scss).
   */
  setColors(colors?: string[]) {
    if (!this.glow) return;
    for (let i = 0; i < 3; i++) {
      const color = colors?.[i] ?? colors?.[0];
      if (color) this.glow.style.setProperty(`--glow-${i + 1}`, color);
      else this.glow.style.removeProperty(`--glow-${i + 1}`);
    }
  }

  open(cover: Cover, moveFocus: boolean) {
    this.element.dataset.open = 'true';
    this.element.inert = false;
    if (this.liveRegion) this.liveRegion.textContent = `${cover.title}, ${cover.artist}, ${cover.year}`;
    if (moveFocus) this.element.focus({ preventScroll: true });
  }

  close() {
    delete this.element.dataset.swap;
    this.element.dataset.open = 'false';
    this.element.inert = true;
    if (this.liveRegion) this.liveRegion.textContent = '';
  }
}
