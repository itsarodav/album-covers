import data from './covers.json';

// Adding a cover = one entry in covers.json + its WebP in public/covers
// (generated from the originals with `npm run optimize:covers`).
export type CoverFormat = 'single' | 'ep' | 'album';

export interface Cover {
  /** Unique and stable: file name, accessible button id and URL hash */
  id: string;
  title: string;
  artist: string;
  year: number;
  /** One or two sentences */
  description: string;
  /** Optional: the link is hidden when missing */
  spotifyUrl?: string;
  /** Optional: secondary link, hidden when missing */
  youtubeUrl?: string;
  /** Optional: the artist's Instagram (follow button), hidden when missing */
  instagramUrl?: string;
  /** Release format, shown as the card's badge. Defaults to single. */
  format?: CoverFormat;
  /** Square WebP, max 1024px, served from /public */
  cover: string;
}

export const covers: Cover[] = data as Cover[];
