# Album covers I made so far

Estantería 3D con las portadas de disco que he diseñado. Tocas un CD, sale hacia delante, lo giras arrastrando y al lado (o debajo en móvil) aparecen sus datos. Sitio independiente del playground: allí solo hay una tarjeta con un enlace hacia aquí.

## Tecnologías

- [Astro](https://astro.build) + TypeScript
- [Three.js](https://threejs.org) vanilla (sin OrbitControls ni react-three-fiber)
- GSAP (vuelo del CD)
- SCSS con tokens

## Requisitos

- Node.js 22.12 o superior

## Uso

```sh
npm install              # instalar dependencias
npm run dev              # servidor de desarrollo en http://localhost:4321
npm run build            # versión de producción en /dist
npm run preview          # previsualizar la build
npm run check            # comprobar tipos (astro check)
npm run optimize:covers -- <carpeta>  # regenerar public/covers/*.webp desde los originales
```

## Añadir una portada

1. Deja el original (JPG/PNG cuadrado), llamado `<id>.jpg`, en tu carpeta de originales.
2. `npm run optimize:covers -- <carpeta>` → crea `public/covers/<id>.webp` (1024 px).
3. Añade su entrada en `src/data/covers.json`. Opcionales: `spotifyUrl`, `youtubeUrl`, `instagramUrl` (botón de seguir; se oculta si falta) y `format` (`single`, `ep` o `album`, el badge de la card; por defecto `single`).

Las baldas, el lomo y la contraportada se generan solos.

## Estructura

```
public/
├── covers/            # Texturas WebP de las portadas
├── favicon.svg
└── og-image.jpg
scripts/
└── optimize-covers.mjs
src/
├── components/
│   ├── layout/        # TopBar, PageHeading, BrandPill
│   └── shelf/         # ShelfCanvas, ShelfList (accesible), InfoPanel
├── data/              # covers.json, site.ts (textos y enlaces), breakpoints.ts
├── layouts/           # Layout principal (meta, OG, fuente)
├── pages/             # index.astro
├── scripts/
│   ├── main.ts        # Arranque y estado de selección
│   ├── three/
│   │   ├── cdShelf.ts     # Orquesta la escena: poses, vuelo, giro, hover
│   │   ├── scene.ts       # Renderer, cámara, luces, render bajo demanda
│   │   ├── backdrop.ts    # Pared (shader) y luz de colores del CD abierto
│   │   ├── shelf.ts       # Baldas y colocación de los CDs
│   │   ├── jewelCase.ts   # Geometría y materiales del estuche
│   │   ├── textures.ts    # Lomo, trasera y sombra con canvas 2D
│   │   ├── interaction.ts # Pointer events, tap vs arrastre, raycaster
│   │   ├── layout.ts      # Breakpoints y zona libre para el CD abierto
│   │   └── constants.ts   # Medidas, cámara, movimiento y colores 3D
│   └── ui/            # infoPanel.ts, menu.ts
└── styles/            # tokens, base, partials
```

## Interacción

- **Tap / clic** en un CD: sale al frente. Tap en otro: cambio directo. Tap fuera, `Esc` o la ✕: vuelve a su hueco exacto.
- **Arrastrar** con el CD abierto lo inclina (máx. ~34° a los lados, ~22° arriba/abajo, con efecto goma al final): nunca enseña la trasera. Al soltar vuelve a su sitio con un muelle. Con ratón, sin pulsar, se inclina un poco hacia el cursor. Más de 6 px de movimiento = arrastre, nunca cierra.
- **Teclado**: los CDs son botones ocultos (`Tab` los recorre y levanta el CD enfocado), `Enter` abre, las flechas giran el CD con el foco en el panel, `Esc` cierra y devuelve el foco.
- `/#genuino` abre ese CD directamente.
- Con `prefers-reduced-motion`: animaciones cortas, sin rebote del muelle ni inclinación hacia el cursor, sin parallax ni balanceo.
