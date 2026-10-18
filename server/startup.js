import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { readConfig, root } from './config.js';
import { createImageStorage } from './image-storage.js';
import { Product, Post, User, Message, Subscriber, Setup } from './models.js';
import { LedgerCustomer, Sale } from './finance-models.js';
import { BusinessContact, ExpenseRecord } from './operations-models.js';
import { WholesaleBuyer, WholesaleProduct, WholesaleEnquiry } from './wholesale-models.js';
import { initialProducts, initialPosts } from '../shared/catalog.js';
import { seedWholesaleCatalog } from './wholesale-import.js';
import { createShutdown, installShutdownHandlers } from './shutdown.js';

export async function validateProductionFiles(config, { assetRoot = root } = {}) {
  if (!config.production) return;
  try {
    const files = ['dist/index.html', 'public/fonts/outfit.ttf', 'public/fonts/cormorant.ttf', 'dist/fonts/outfit.ttf', 'dist/fonts/cormorant.ttf'];
    const catalog = JSON.parse(await readFile(path.join(assetRoot, 'data/wholesale-catalog.json'), 'utf8'));
    if (!Array.isArray(catalog.products) || !catalog.products.length) throw new Error();
    for (const image of [...initialProducts.map(product => product.image), '/images/hero.webp', '/images/story.webp', ...catalog.products.map(product => product.image)]) {
      if (!/^\/images\/[\w-]+\.webp$/.test(image)) throw new Error();
      files.push(`public${image}`, `dist${image}`);
    }
    await Promise.all(files.map(file => access(path.join(assetRoot, file))));
    const html = await readFile(path.join(assetRoot, 'dist/index.html'), 'utf8');
    const scripts = [...html.matchAll(/src="(\/assets\/[\w.-]+\.js)"/g)];
    if (!scripts.length) throw new Error();
    await Promise.all(scripts.map(([,file]) => access(path.join(assetRoot, 'dist', file))));
  } catch { throw new Error('Production assets are missing or invalid. Build the frontend and include local assets and wholesale seed data.'); }
}

async function seedCatalog(config) {
  await seedWholesaleCatalog({ required: config.production });
  // Development keeps its starter catalog. Production never inserts retail sample products/posts.
  if (!config.production && !await Setup.findOne({ id: 'sample-catalog-v1' })) {
    if (await Product.countDocuments() === 0) await Product.insertMany(initialProducts);
    if (await Post.countDocuments() === 0) await Post.insertMany(initialPosts);
    await Setup.create({ id: 'sample-catalog-v1', completedAt: new Date() });
  }
}

export async function initializeDatabase(config, {
  driver = mongoose,
  initializeIndexes = () => Promise.all([Product, Post, User, Message, Subscriber, Setup, LedgerCustomer, Sale, WholesaleBuyer, WholesaleProduct, WholesaleEnquiry, BusinessContact, ExpenseRecord].map(model => model.init())),
  seed = () => seedCatalog(config),
} = {}) {
  if (!config.mongoUri) {
    if (config.production) throw new Error('Production requires a database connection.');
    return false;
  }
  try {
    await driver.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
    await initializeIndexes(); await seed(); return true;
  } catch {
    await driver.disconnect().catch(() => {});
    if (config.production) throw new Error('MongoDB initialization failed. Check database availability and required indexes.');
    return false;
  }
}

export async function startServer({ config = readConfig(), exit, log = message => console.log(message) } = {}) {
  await validateProductionFiles(config);
  const storage = createImageStorage(config.uploadDir);
  await storage.prepare();
  const connected = await initializeDatabase(config);
  log(connected ? 'MongoDB connected and initialized.' : 'Database unavailable. Development sample browsing is enabled; account and write features require MongoDB.');
  const readiness = { ready: true, shuttingDown: false };
  const app = createApp({ config, storage, readiness });
  const server = createServer(app);
  const stop = createShutdown({ server, readiness, disconnect: () => mongoose.disconnect(), timeoutMs: config.shutdownTimeoutMs, exit, log });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  } catch { readiness.ready = false; await mongoose.disconnect(); throw new Error('Could not start the HTTP listener. Check host and PORT.'); }
  const removeSignalHandlers = installShutdownHandlers(stop);
  log(`Masaloo server listening on ${config.host}:${server.address().port}`);
  return { app, server, readiness, stop, removeSignalHandlers };
}
