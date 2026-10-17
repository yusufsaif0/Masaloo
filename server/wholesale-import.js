import { mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WholesaleProduct } from './wholesale-models.js';
import { createImageStorage } from './image-storage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sourceCategoryUrl = 'https://www.nutsnspices.in/categories/80704/spices-whole';
export const requestedSourceUrl = 'https://www.nutsnspices.in/categories/80689/Spices';
const imageHost = 'cdn.rodeodigital.com';

export function readSourceProducts(html) {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('The source page structure has changed. No products were imported.');
  const products = JSON.parse(match[1])?.props?.pageProps?.productSearch?.products;
  if (!Array.isArray(products)) throw new Error('The source did not return a product list.');
  return products.filter(product => product.categoryIds?.includes(80704) && /^\d+$/.test(String(product.id)) && Number.isSafeInteger(Number(product.id)) && Number(product.id) > 0 && product.name && product.images?.[0]).slice(0, 50);
}
function describe(name, category) {
  if (/kasuri methi/i.test(name)) return 'Dried fenugreek leaves for savoury gravies and seasoning blends. Available for bulk enquiries; share your packing and volume requirements.';
  if (/dry ginger/i.test(name)) return 'Dried ginger for grinding, cooking, and commercial spice preparation. Enquire about bulk packing and the quantity you need.';
  if (/methi dal/i.test(name)) return 'Split fenugreek for pickling and seasoning. Discuss bulk quantities, packing, and your preferred delivery schedule with our team.';
  return `${name} in ${category === 'Seeds' ? 'seed' : 'whole spice'} form for bulk purchasing and commercial kitchens. Enquire about the quantity, grade, and packing that suits your business.`;
}
export function sourceProductData(product, image, fetchedAt = new Date().toISOString()) {
  const category = /seed|ajwain|anardana|jeera|sesame|methi dal/i.test(product.name) ? 'Seeds' : /kasuri|ginger/i.test(product.name) ? 'Dried herbs & roots' : 'Whole spices';
  return {
    id: `nns-${product.id}`, name: product.name, category, description: describe(product.name, category), image,
    unitPricePaise: null, minOrderKg: 5, stockKg: null, active: true,
    source: { productId: String(product.id), url: sourceCategoryUrl, imageUrl: product.images[0], image, fetchedAt,
      packs: (product.skus || []).map(sku => ({ label: String(sku.name || ''), retailPricePaise: Number.isFinite(sku.sp) ? Math.round(sku.sp * 100) : null, mrpPaise: Number.isFinite(sku.mrp) ? Math.round(sku.mrp * 100) : null })),
    },
  };
}

async function allowedSource() {
  const response = await fetch('https://www.nutsnspices.in/robots.txt', { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error('Could not check source crawl rules. Try again later.');
  const robots = await response.text();
  // A conservative rule check: never fetch a category if any listed rule disallows it.
  for (const line of robots.split('\n')) {
    const match = line.trim().match(/^Disallow:\s*(\S+)/i);
    if (match && new URL(sourceCategoryUrl).pathname.startsWith(match[1])) throw new Error('The source site does not allow this category to be imported.');
  }
}
export async function scrapeWholesaleCatalog({ seedAssets = false, progress = () => {}, storage = createImageStorage() } = {}) {
  await allowedSource();
  const response = await fetch(sourceCategoryUrl, { signal: AbortSignal.timeout(25000), redirect: 'error', headers: { 'User-Agent': 'MasalooCatalogImporter/1.0 (public whole-spice catalog)' } });
  if (!response.ok) throw new Error(`Source category returned HTTP ${response.status}.`);
  const products = readSourceProducts(await response.text());
  if (!products.length) throw new Error('No whole-spice products were found on the public source page.');
  const imageStorage = seedAssets ? createImageStorage(path.join(root, 'public/images')) : storage;
  await imageStorage.prepare();
  const imported = [], failures = [];
  for (const product of products) {
    try {
      const imageUrl = new URL(product.images[0]);
      if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== imageHost) throw new Error('Unsupported source image host.');
      const hash = createHash('sha256').update(imageUrl.href).digest('hex').slice(0, 10);
      const name = `wholesale-${product.id}-${hash}.webp`;
      let local = `/images/${name}`;
      try { await access(path.join(root, 'public/images', name)); }
      catch {
        local = `${seedAssets ? '/images' : '/uploads'}/${name}`;
        try { await imageStorage.existing(name); }
        catch {
          const result = await fetch(imageUrl, { signal: AbortSignal.timeout(20000), redirect: 'error' });
          if (!result.ok) throw new Error(`Image returned HTTP ${result.status}.`);
          if (Number(result.headers.get('content-length')) > 10000000) throw new Error('Source image is too large.');
          const chunks = []; let size = 0;
          for await (const chunk of result.body) { size += chunk.length; if (size > 10000000) throw new Error('Source image is too large.'); chunks.push(chunk); }
          await imageStorage.writeImage(Buffer.concat(chunks), { name, width: 1000, height: 1000, quality: 87, reuse: true });
        }
      }
      imported.push(sourceProductData(product, local)); progress(product.name);
    } catch (error) { failures.push({ name: product.name, error: error.message }); }
  }
  if (!imported.length) throw new Error('No product images could be imported. Existing products were preserved.');
  if (seedAssets) {
    await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'data/wholesale-catalog.json'), JSON.stringify({ requestedSourceUrl, sourceCategoryUrl, fetchedAt: new Date().toISOString(), products: imported, failures, scope: 'First public page of the whole-spice subcategory; not the entire retailer catalog.' }, null, 2) + '\n');
  }
  return { products: imported, failures };
}

export async function upsertWholesaleImports(products) {
  let added = 0, refreshed = 0;
  for (const product of products) {
    const existing = await WholesaleProduct.findOne({ id: product.id });
    if (!existing) {
      await WholesaleProduct.updateOne({ id: product.id }, { $setOnInsert: product }, { upsert: true, runValidators: true }); added++;
    } else {
      const update = { source: product.source };
      if (existing.image === existing.source?.image) update.image = product.image;
      await WholesaleProduct.updateOne({ id: product.id }, { $set: update }); refreshed++;
    }
  }
  return { added, refreshed };
}
let inProgress;
export function refreshWholesaleSource(storage) {
  if (!inProgress) inProgress = (async () => {
    const result = await scrapeWholesaleCatalog({ storage });
    return { ...await upsertWholesaleImports(result.products), failures: result.failures, sourceUrl: sourceCategoryUrl };
  })().finally(() => { inProgress = undefined; });
  return inProgress;
}
export async function seedWholesaleCatalog({ required = false } = {}) {
  const { Setup } = await import('./models.js');
  if (await Setup.exists({ id: 'wholesale-catalog-v1' })) return;
  const file = path.join(root, 'data/wholesale-catalog.json');
  try { await access(file); } catch { if (required) throw new Error('Wholesale seed file is missing.'); return; }
  const data = JSON.parse(await readFile(file, 'utf8'));
  for (const product of data.products) await WholesaleProduct.updateOne({ id: product.id }, { $setOnInsert: product }, { upsert: true, runValidators: true });
  await Setup.updateOne({ id: 'wholesale-catalog-v1' }, { $setOnInsert: { id: 'wholesale-catalog-v1', completedAt: new Date() } }, { upsert: true });
}
