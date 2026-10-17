import sharp from 'sharp';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const imageDir = new URL('../public/images/', import.meta.url);
const originalDir = new URL('../assets/generated-originals/', import.meta.url);
for (const name of ['hero', 'haldi', 'mirch', 'dhaniya', 'garam', 'story', 'cumin', 'kitchen']) {
  const result = await sharp(fileURLToPath(new URL(`${name}.png`, originalDir))).resize(name === 'hero' ? 1536 : 1000, undefined, { withoutEnlargement: true }).webp({ quality: 87 }).toFile(fileURLToPath(new URL(`${name}.webp`, imageDir)));
  console.log(`${name}: ${Math.round(result.size / 1024)} KB`);
}
for (const folder of ['src', 'shared']) {
  for (const name of await readdir(folder)) {
    if (!/\.(jsx?|css)$/.test(name)) continue;
    const file = path.join(folder, name);
    const content = await readFile(file, 'utf8');
    await writeFile(file, content.replace(/\/images\/(hero|haldi|mirch|dhaniya|garam|story)\.png/g, '/images/$1.webp'));
  }
}
