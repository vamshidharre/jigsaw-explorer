// Downloads the gallery source images listed in image-sources.json and writes
// optimized WebP renditions to public/puzzles plus the catalog metadata used by
// both the client and the server (src/shared/catalog.data.json).
//
// Usage: node scripts/prepare-images.mjs [--cache <dir>]
// Behind an HTTP proxy run with NODE_USE_ENV_PROXY=1 (Node >= 22.21).
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cacheArg = process.argv.indexOf('--cache');
const cacheDir = cacheArg > -1 ? path.resolve(process.argv[cacheArg + 1]) : path.join(root, 'data', 'image-cache');
const outDir = path.join(root, 'public', 'puzzles');

const FULL_MAX = 2400;
const THUMB_MAX = 480;

const sources = JSON.parse(await readFile(path.join(root, 'scripts', 'image-sources.json'), 'utf8'));
await mkdir(cacheDir, { recursive: true });
await mkdir(outDir, { recursive: true });

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function fetchSource(src) {
  const cached = path.join(cacheDir, `${src.id}.src`);
  if (await exists(cached)) return readFile(cached);
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`${src.id}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(cached, buf);
  return buf;
}

const catalog = [];
for (const src of sources) {
  const input = await fetchSource(src);
  const base = sharp(input, { failOn: 'error' }).rotate();

  const full = await base
    .clone()
    .resize({ width: FULL_MAX, height: FULL_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86, effort: 6 })
    .toBuffer({ resolveWithObject: true });
  await writeFile(path.join(outDir, `${src.id}.webp`), full.data);

  const thumb = await base
    .clone()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 68, effort: 6 })
    .toBuffer();
  await writeFile(path.join(outDir, `${src.id}-thumb.webp`), thumb);

  const blur = await base.clone().resize({ width: 20, height: 20, fit: 'inside' }).webp({ quality: 40 }).toBuffer();
  // Average colour, used as the placeholder background while the image loads.
  const { channels } = await base.clone().stats();
  const hex = (c) => Math.round(c.mean).toString(16).padStart(2, '0');

  catalog.push({
    id: src.id,
    title: src.title,
    category: src.category,
    width: full.info.width,
    height: full.info.height,
    color: `#${hex(channels[0])}${hex(channels[1])}${hex(channels[2])}`,
    blur: `data:image/webp;base64,${blur.toString('base64')}`,
    credit: src.credit,
    license: src.license,
  });
  console.log(`${src.id.padEnd(22)} ${full.info.width}x${full.info.height}  full ${(full.data.length / 1024).toFixed(0)}KB  thumb ${(thumb.length / 1024).toFixed(0)}KB`);
}

await writeFile(path.join(root, 'src', 'shared', 'catalog.data.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${catalog.length} catalog entries.`);
