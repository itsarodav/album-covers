// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // Needed for absolute URLs (canonical, og:url, og:image).
  // TODO: replace with the real subdomain once deployed.
  site: 'https://album-covers.arodav.com',
  // Self-hosted font: downloaded from Google Fonts at build time. Used through
  // $font-primary (src/styles/tokens/_typography.scss) and by the 3D spine and
  // back textures (they read the computed font-family of <body>).
  vite: {
    // three.js alone is ~600 kB minified; it's the whole point of the page
    build: { chunkSizeWarningLimit: 900 },
  },
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Geist',
      cssVariable: '--font-geist',
      weights: ['400 700'],
      styles: ['normal'],
      fallbacks: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
    },
  ],
});
