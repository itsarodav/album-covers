// Site-wide texts and links. Every UI string lives here, so switching the
// interface language is a one-file change.
export const site = {
  name: 'Album covers I made so far',
  author: 'arodav',
  description: 'A 3D shelf with the album and single covers designed by arodav. Pick a CD, tilt it in the light and read its story.',
  ogImage: '/og-image.jpg',
  lang: 'en',
  links: {
    // TODO: real playground URL once it's deployed
    playground: 'https://arodav.com/',
    home: 'https://arodav.com/',
  },
  text: {
    topBar: 'Go to my playground',
    title: 'Album covers I made so far',
    // Word joiners (⁠) around the dash: the years never break apart
    subtitle: 'Some fun and challenging projects of design for music (2020⁠–⁠2026)',
    shelfLabel: 'Album covers',
    openCover: 'Open',
    close: 'Close',
    spotify: 'Spotify',
    youtube: 'YouTube',
    released: 'Released in',
    formats: { single: 'Single', ep: 'EP', album: 'Album' },
    follow: (artist: string) => `Follow ${artist} on Instagram`,
    menu: 'Menu',
    homeLabel: 'arodav home',
    newTab: '(opens in a new tab)',
    menuLabel: 'arodav',
    menuLinks: [
      { label: 'Playground', key: 'playground', icon: 'playground' },
      { label: 'Portfolio', key: 'home', icon: 'portfolio' },
    ],
    noWebgl: 'Your browser can’t show the 3D shelf, but here are the covers:',
  },
} as const;
