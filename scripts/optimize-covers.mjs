// Prepares the cover textures from the untouched originals (kept out of the
// repo): `npm run optimize:covers -- <originals folder>`.
// Every JPG/PNG there becomes public/covers/<same-name>.webp: square, max 1024px
// (GPU memory on mobile).
// Adding a cover = drop the original there, run `npm run optimize:covers`
// and add its entry to src/data/covers.json.
import sharp from 'sharp';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { extname, basename, join } from 'node:path';

const ORIGINALS = process.argv[2];
if (!ORIGINALS) {
  console.error('Usage: npm run optimize:covers -- <originals folder>');
  process.exit(1);
}
const OUTPUT = 'public/covers';
const SIZE = 1024;

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

await mkdir(OUTPUT, { recursive: true });
const files = (await readdir(ORIGINALS)).filter((file) => /\.(jpe?g|png|webp)$/i.test(file));

for (const file of files) {
  const input = join(ORIGINALS, file);
  const output = join(OUTPUT, `${basename(file, extname(file))}.webp`);
  await sharp(input)
    .rotate()
    .resize({ width: SIZE, height: SIZE, fit: 'cover' })
    .webp({ quality: 86 })
    .toFile(output);
  const [before, after] = await Promise.all([stat(input), stat(output)]);
  console.log(`${output}: ${kb(before.size)} → ${kb(after.size)}`);
}
