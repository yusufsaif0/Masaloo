import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import express from 'express';
import { readConfig, uploadDirectory, root } from '../config.js';
import { limiterIdentity } from '../rate-limit.js';
import { createImageStorage } from '../image-storage.js';
import { createHealthHandler } from '../health.js';
import { createApp } from '../app.js';
import { initializeDatabase, validateProductionFiles } from '../startup.js';
import { createShutdown, installShutdownHandlers } from '../shutdown.js';
import { scrapeWholesaleCatalog, sourceCategoryUrl } from '../wholesale-import.js';
import { temporaryTestDirectory, removeTestDirectory } from '../../scripts/test-support.mjs';

const disconnected = { readyState: 0, db: null };
const productionEnv = directory => ({ NODE_ENV: 'production', PORT: '4000', MONGODB_URI: 'mongodb://127.0.0.1:27017/masaloo_test_runtime_config', JWT_SECRET: 'runtime-test-secret-only-at-least-thirty-two-characters', CLIENT_ORIGIN: 'https://store.example/', UPLOAD_DIR: directory });
const developmentConfig = directory => readConfig({ NODE_ENV: 'test', UPLOAD_DIR: directory });
async function temporary(t) { const directory = await temporaryTestDirectory(); t.after(() => removeTestDirectory(directory)); return directory; }
async function serve(t, handler) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { base: `http://127.0.0.1:${server.address().port}`, server };
}

test('production configuration requires database, secret, HTTPS origin, absolute storage, and valid port without proxy settings', async t => {
  const directory = await temporary(t), env = productionEnv(directory);
  const config = readConfig(env);
  assert.equal(config.host, '0.0.0.0'); assert.equal(config.origin, 'https://store.example'); assert.equal(config.port, 4000);
  assert.equal(developmentConfig(directory).host, '127.0.0.1');
  assert.equal(uploadDirectory({ NODE_ENV: 'development' }), path.join(root, 'uploads'));
  for (const override of [
    { MONGODB_URI: '' }, { MONGODB_URI: 'mongodb://localhost/' }, { JWT_SECRET: 'short' }, { JWT_SECRET: '<replace-this-secret-with-something>' },
    { CLIENT_ORIGIN: '' }, { CLIENT_ORIGIN: 'http://store.example' }, { CLIENT_ORIGIN: 'https://user:password@store.example' },
    { CLIENT_ORIGIN: 'https://store.example/path' }, { CLIENT_ORIGIN: 'https://store.example/?query=1' },
    { UPLOAD_DIR: '' }, { UPLOAD_DIR: './uploads' }, { UPLOAD_DIR: root }, { UPLOAD_DIR: path.join(root, 'public/images') },
    { PORT: 'NaN' }, { PORT: '0' }, { PORT: '65536' },
  ]) assert.throws(() => readConfig({ ...env, ...override }), Error, JSON.stringify(Object.keys(override)));
  // Old host settings can remain during rollout without blocking startup.
  assert.equal(readConfig({ ...env, PROXY_MODE: 'direct', TRUSTED_PROXY_CIDRS: '<old-value>', PROXY_HEADER_VERIFIED: 'false' }).host, '0.0.0.0');
});

test('database and index initialization failures abort production without running catalog seeds', async () => {
  for (const phase of ['connect', 'index']) {
    const calls = [];
    const driver = { connect: async () => { calls.push('connect'); if (phase === 'connect') throw new Error('Sensitive connection detail'); }, disconnect: async () => { calls.push('disconnect'); } };
    await assert.rejects(initializeDatabase({ production: true, mongoUri: 'test-only' }, { driver,
      initializeIndexes: async () => { calls.push('index'); throw new Error('Sensitive index detail'); }, seed: async () => { calls.push('seed'); } }),
    error => !error.message.includes('Sensitive') && /MongoDB initialization failed/.test(error.message));
    assert.equal(calls.includes('seed'), false); assert.equal(calls.at(-1), 'disconnect');
  }
  const calls = [];
  assert.equal(await initializeDatabase({ production: true, mongoUri: 'test-only' }, {
    driver: { connect: async () => calls.push('connect') }, initializeIndexes: async () => calls.push('indexes'), seed: async () => calls.push('seed'),
  }), true);
  assert.deepEqual(calls, ['connect', 'indexes', 'seed']);
});

test('production assets must include the frontend build and required local seed/image/font files', async t => {
  const directory = await temporary(t);
  await assert.rejects(validateProductionFiles({ production: true }, { assetRoot: directory }), /Production assets/);
  const files = new Set(['dist/index.html', 'data/wholesale-catalog.json', 'public/fonts/outfit.ttf', 'public/fonts/cormorant.ttf', 'dist/fonts/outfit.ttf', 'dist/fonts/cormorant.ttf']);
  const { initialProducts } = await import('../../shared/catalog.js');
  const images = [...initialProducts.map(product => product.image), '/images/hero.webp', '/images/story.webp'];
  for (const image of images) { files.add('public' + image); files.add('dist' + image); }
  for (const file of files) { await mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await writeFile(path.join(directory, file), 'test asset'); }
  await writeFile(path.join(directory, 'data/wholesale-catalog.json'), JSON.stringify({ products: [{ image: images[0] }] }));
  await writeFile(path.join(directory, 'dist/index.html'), '<script type="module" src="/assets/main.js"></script>');
  await assert.rejects(validateProductionFiles({ production: true }, { assetRoot: directory }), /Production assets/);
  await mkdir(path.join(directory, 'dist/assets')); await writeFile(path.join(directory, 'dist/assets/main.js'), '// test asset');
  await validateProductionFiles({ production: true }, { assetRoot: directory });
});

test('health returns 200 only for database ping success and ready application; failures expose no secrets', async t => {
  const readiness = { ready: true, shuttingDown: false }, commands = [];
  const connection = { readyState: 1, db: { command: async (...args) => { commands.push(args); return { ok: 1 }; } } };
  const { base } = await serve(t, express().use(createHealthHandler({ connection, readiness, configured: true, production: true, timeoutMs: 80 })));
  let response = await fetch(base); assert.equal(response.status, 200); assert.equal((await response.json()).database, 'connected');
  assert.equal(commands[0][1].timeoutMS, 80);
  readiness.ready = false; response = await fetch(base); assert.equal(response.status, 503); assert.equal((await response.json()).database, 'connected');
  readiness.ready = true; connection.db.command = async () => { throw new Error('mongodb://private-secret@internal.example'); };
  response = await fetch(base); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|internal|mongodb:\/\//);
  connection.readyState = 0; response = await fetch(base); assert.equal(response.status, 503); assert.equal((await response.json()).catalog, 'unavailable');
});

test('health probes have a bounded timeout and coalesce concurrent database pings', async t => {
  let calls = 0;
  const connection = { readyState: 1, db: { command: () => { calls++; return new Promise(() => {}); } } };
  const { base } = await serve(t, express().use(createHealthHandler({ connection, readiness: { ready: true }, configured: true, production: true, timeoutMs: 50 })));
  const started = Date.now(), responses = await Promise.all([fetch(base), fetch(base)]);
  assert.equal(calls, 1); assert.ok(Date.now() - started < 1000); assert.ok(responses.every(response => response.status === 503));
});

test('production never serves sample catalog during a database outage and rejects noncanonical browser origins', async t => {
  const directory = await temporary(t), config = readConfig(productionEnv(directory));
  const readiness = { ready: true, shuttingDown: false };
  const { base } = await serve(t, createApp({ config, readiness, connection: disconnected }));
  for (const endpoint of ['/api/products', '/api/blogs', '/api/health']) assert.equal((await fetch(base + endpoint)).status, 503);
  assert.equal((await fetch(base + '/api/contact', { method: 'POST', headers: { Origin: 'http://localhost:4000' } })).status, 403);
  assert.equal((await fetch(base + '/api/contact', { method: 'POST', headers: { Origin: 'https://store.example' } })).status, 503);
  const response = await fetch(base + '/api/auth/me'); assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const route of ['/api/auth/logout', '/api/wholesale/auth/logout']) {
    const logout = await fetch(base + route, { method: 'POST', headers: { Origin: 'https://store.example' } });
    assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  }
  readiness.shuttingDown = true;
  assert.equal((await fetch(base + '/shop')).status, 503);
});

test('production authentication limits cannot be bypassed with spoofed forwarding headers', async t => {
  const directory = await temporary(t), config = readConfig(productionEnv(directory));
  const { base } = await serve(t, createApp({ config, connection: disconnected }));
  for (let i = 0; i < 30; i++) {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': `192.0.2.${i+1}`, 'X-Real-IP': `198.51.100.${i+1}`, Forwarded: `for=192.0.2.${i+1}` } });
    assert.equal(response.status, 503);
  }
  assert.equal((await fetch(base + '/api/auth/admin-login', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 429);
});

test('production API accepts Railway forwarding headers without an ingress gate', async t => {
  const directory = await temporary(t), config = readConfig(productionEnv(directory));
  const previousSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = productionEnv(directory).JWT_SECRET;
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const app = createApp({ config, connection: { readyState: 1, db: { command: async () => ({ ok: 1 }) } } });
  assert.equal(app.get('trust proxy'), false);
  const { base } = await serve(t, app);
  const headers = { 'X-Real-IP': '198.51.100.1', 'X-Forwarded-For': '198.51.100.1', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'store.example', Forwarded: 'for=198.51.100.1;proto=https' };
  for (const overrides of [{}, { 'X-Real-IP': '' }, { 'X-Real-IP': 'invalid, duplicate' }]) {
    const response = await fetch(base + '/api/health', { headers: { ...headers, ...overrides } });
    assert.equal(response.status, 200); assert.equal((await response.json()).database, 'connected');
  }
  const session = await fetch(base + '/api/auth/me', { headers });
  assert.equal(session.status, 401); assert.match((await session.json()).error, /sign in/);
  assert.equal((await fetch(base + '/api/missing', { headers })).status, 404);
});

test('socket-based rate limits normalize mapped IPv4 and group IPv6 without reading headers', () => {
  const key = (remoteAddress, headers = {}) => limiterIdentity.keyGenerator({ socket: { remoteAddress }, headers });
  assert.equal(key('::ffff:192.0.2.1'), key('192.0.2.1'));
  assert.equal(key('2001:db8:11:1200::1'), key('2001:db8:11:12ff::2'));
  assert.notEqual(key('2001:db8:11:1200::1'), key('2001:db8:11:1300::1'));
  assert.equal(key('192.0.2.1', { 'x-real-ip': '198.51.100.1' }), key('192.0.2.1', { 'x-real-ip': '203.0.113.1' }));
});

test('local WebP uploads survive app restart, never overwrite existing images, and missing assets do not return SPA HTML', async t => {
  const directory = await temporary(t), storage = createImageStorage(path.join(directory, 'uploads'));
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#dba64c' } }).png().toBuffer();
  const image = await storage.writeImage(bytes, { name: 'persisted.webp' });
  const original = await readFile(path.join(storage.directory, 'persisted.webp'));
  await assert.rejects(storage.writeImage(Buffer.from('not an image')), error => error.status === 400);
  await assert.rejects(storage.writeImage(bytes, { name: '../escape.webp' }), error => error.status === 400);
  await assert.rejects(storage.writeImage(bytes, { name: 'persisted.webp' }), error => error.status === 503);
  assert.deepEqual(await readFile(path.join(storage.directory, 'persisted.webp')), original);
  await storage.writeImage(bytes, { name: 'persisted.webp', reuse: true });
  assert.deepEqual(await readFile(path.join(storage.directory, 'persisted.webp')), original);
  const frontendDir = path.join(directory, 'dist'); await mkdir(frontendDir); await writeFile(path.join(frontendDir, 'index.html'), '<!doctype html><title>SPA test</title>');
  const options = { config: developmentConfig(directory), storage, connection: disconnected, frontendDir };
  const first = await serve(t, createApp(options));
  let response = await fetch(first.base + image); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/webp/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  await new Promise(resolve => first.server.close(resolve));
  const restarted = await serve(t, createApp({ ...options, storage: createImageStorage(storage.directory) }));
  response = await fetch(restarted.base + image); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  assert.equal((await fetch(restarted.base + image, { method: 'HEAD' })).status, 200);
  for (const endpoint of ['/uploads/missing.webp', '/uploads/.hidden.webp', '/uploads/%2e%2e%2f.env', '/uploads/nested/file.webp', '/images/missing.webp', '/fonts/missing.ttf', '/assets/missing.js']) {
    response = await fetch(restarted.base + endpoint); assert.equal(response.status, 404, endpoint); assert.doesNotMatch(response.headers.get('content-type'), /text\/html/);
  }
  for (const endpoint of ['/shop', '/admin', '/wholesale/store']) {
    response = await fetch(restarted.base + endpoint); assert.equal(response.status, 200); assert.match(await response.text(), /SPA test/);
  }
  const blocked = path.join(directory, 'blocked'); await writeFile(blocked, 'not a directory');
  await assert.rejects(createImageStorage(blocked).writeImage(bytes), error => error.status === 503 && !error.message.includes(directory));
});

test('image serving refuses filesystem symlinks outside the upload directory', async t => {
  const directory = await temporary(t), storage = createImageStorage(path.join(directory, 'uploads')); await storage.prepare();
  const outside = path.join(directory, 'outside.webp'); await writeFile(outside, 'private data');
  try { await symlink(outside, path.join(storage.directory, 'linked.webp'), 'file'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip('This Windows account cannot create file symlinks.'); return; } throw error; }
  const { base } = await serve(t, createApp({ config: developmentConfig(directory), storage, connection: disconnected }));
  assert.equal((await fetch(base + '/uploads/linked.webp')).status, 404);
});

test('wholesale image import writes through the configured storage without touching bundled images or MongoDB', async t => {
  const directory = await temporary(t), storage = createImageStorage(directory);
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  const id = Date.now(), imageUrl = `https://cdn.rodeodigital.com/local-test-${id}.png`;
  const product = { id, name: 'Test cumin', categoryIds: [80704], images: [imageUrl] };
  const source = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { productSearch: { products: [product, { ...product, id: '../escape' }] } } } })}</script>`;
  const originalFetch = globalThis.fetch;
  let result;
  globalThis.fetch = async url => {
    if (String(url) === 'https://www.nutsnspices.in/robots.txt') return new Response('User-agent: *\nAllow: /');
    if (String(url) === sourceCategoryUrl) return new Response(source);
    if (String(url) === imageUrl) return new Response(bytes);
    throw new Error('Unexpected network access in the isolated importer test.');
  };
  try { result = await scrapeWholesaleCatalog({ storage }); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(result.products.length, 1); assert.deepEqual(result.failures, []);
  assert.match(result.products[0].image, /^\/uploads\/wholesale-\d+-[a-f0-9]+\.webp$/);
  const file = path.basename(result.products[0].image); assert.equal((await sharp(await readFile(path.join(directory, file))).metadata()).format, 'webp');
  assert.equal(result.products[0].unitPricePaise, null);
});

test('graceful shutdown lets an actual in-flight HTTP response finish before closing the database', async () => {
  const readiness = { ready: true }, calls = [];
  let began, finishResponse;
  const requestStarted = new Promise(resolve => { began = resolve; });
  const server = createServer((req, res) => {
    began(); finishResponse = () => { calls.push('response-finished'); res.end('completed'); };
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const stop = createShutdown({ server, readiness, disconnect: async () => calls.push('database-close'), timeoutMs: 1000, exit: code => calls.push(`exit-${code}`), log: () => {} });
  try {
    const response = fetch(`http://127.0.0.1:${server.address().port}`); await requestStarted;
    const completion = stop(); assert.equal(readiness.ready, false); assert.deepEqual(calls, []);
    finishResponse(); assert.equal(await (await response).text(), 'completed'); assert.equal(await completion, 0);
    assert.deepEqual(calls, ['response-finished', 'database-close', 'exit-0']);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('shutdown marks not-ready, drains HTTP before MongoDB, and executes once across both signals', async () => {
  const server = new EventEmitter(), signals = new EventEmitter(), readiness = { ready: true }, calls = [];
  let drained;
  server.close = callback => { calls.push('http-close'); drained = callback; };
  const stop = createShutdown({ server, readiness, disconnect: async () => calls.push('database-close'), timeoutMs: 500, exit: code => calls.push(`exit-${code}`), log: () => {} });
  const remove = installShutdownHandlers(stop, signals);
  signals.emit('SIGTERM'); const completion = stop(); signals.emit('SIGINT');
  assert.equal(readiness.ready, false); assert.equal(readiness.shuttingDown, true); assert.deepEqual(calls, ['http-close']);
  assert.equal(stop(), completion); drained(); assert.equal(await completion, 0);
  assert.deepEqual(calls, ['http-close', 'database-close', 'exit-0']); remove(); assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('shutdown deadline force-closes HTTP and exits unsuccessfully even when database close hangs', async () => {
  for (const phase of ['http', 'database']) {
    const server = new EventEmitter(), calls = [], readiness = { ready: true };
    server.close = callback => { calls.push('http-close'); if (phase === 'database') callback(); };
    server.closeAllConnections = () => calls.push('force-close');
    const stop = createShutdown({ server, readiness, timeoutMs: 30, disconnect: () => { calls.push('database-close'); return new Promise(() => {}); }, exit: code => calls.push(`exit-${code}`), log: () => {} });
    const started = Date.now(); assert.equal(await stop(), 1); assert.ok(Date.now() - started < 1000);
    assert.equal(calls.filter(value => value === 'database-close').length, 1); assert.equal(calls.at(-1), 'exit-1'); assert.ok(calls.includes('force-close'));
  }
});
