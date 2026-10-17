import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { root } from '../server/config.js';
import { createImageStorage } from '../server/image-storage.js';
import { temporaryTestDirectory, removeTestDirectory } from './test-support.mjs';

const directory = await temporaryTestDirectory(), children = new Set(), databases = [];
const emptyEnv = path.join(directory, 'empty.env'); await writeFile(emptyEnv, '');
const databaseName = `masaloo_test_production_${randomUUID().replaceAll('-', '')}`;
const mongoUri = `mongodb://127.0.0.1:27017/${databaseName}`;
const uploadDir = path.join(directory, 'uploads');
const baseEnv = { ...process.env, NODE_ENV: 'production', MONGODB_URI: mongoUri, JWT_SECRET: 'production-smoke-test-only-secret-at-least-thirty-two-characters',
  CLIENT_ORIGIN: 'https://store.example', UPLOAD_DIR: uploadDir, DOTENV_CONFIG_PATH: emptyEnv };
for (const key of ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'NODE_OPTIONS', 'PROXY_MODE', 'TRUSTED_PROXY_CIDRS', 'PROXY_HEADER_VERIFIED']) delete baseEnv[key];
const railwayHeaders = { 'X-Real-IP': '198.51.100.1', 'X-Forwarded-For': '198.51.100.1', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'store.example', Forwarded: 'for=198.51.100.1;proto=https' };

async function freePort() {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}
function launch(file, env, ipc = false) {
  const child = spawn(process.execPath, [file], { cwd: root, env, stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child); let output = '';
  child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => { children.delete(child); resolve({ code, signal, output }); }); });
  return { child, exited };
}
async function bounded(promise, message, timeout = 15000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function rejectStartup(overrides, expected) {
  const process = launch('server/index.js', { ...baseEnv, PORT: String(await freePort()), ...overrides });
  const result = await bounded(process.exited, 'Startup rejection exceeded its deadline.');
  assert.equal(result.code, 1); assert.match(result.output, expected); assert.doesNotMatch(result.output, /server listening/);
  assert.equal(result.output.includes(baseEnv.JWT_SECRET), false);
}
async function connectTest(name) {
  if (!/^masaloo_test_production_[a-f0-9]+$/.test(name)) throw new Error('Refusing a non-test database connection.');
  const connection = await mongoose.createConnection(`mongodb://127.0.0.1:27017/${name}`, { serverSelectionTimeoutMS: 5000 }).asPromise();
  databases.push(connection); return connection;
}
async function startFixture() {
  const port = await freePort(), process = launch('scripts/fixtures/production-server.mjs', { ...baseEnv, PORT: String(port) }, true);
  const message = await bounded(Promise.race([
    new Promise(resolve => process.child.once('message', resolve)), process.exited.then(result => { throw new Error(`Production fixture exited before readiness (${result.code}).`); }),
  ]), 'Production fixture did not become ready.');
  assert.equal(message.type, 'ready'); assert.equal(message.address.address, '0.0.0.0'); assert.equal(message.address.port, port);
  return { ...process, base: `http://127.0.0.1:${port}` };
}
async function stopFixture(fixture, signal) {
  fixture.child.send(signal);
  const result = await bounded(fixture.exited, 'Graceful production shutdown exceeded its deadline.');
  assert.equal(result.code, 0); assert.match(result.output, /HTTP requests drained and database closed/);
}

try {
  await rejectStartup({ MONGODB_URI: '' }, /MONGODB_URI/);
  await rejectStartup({ CLIENT_ORIGIN: 'http://store.example' }, /HTTPS/);
  console.log('PASS: real entry point refuses a missing database and insecure origin without requiring proxy settings.');

  await rejectStartup({ MONGODB_URI: `mongodb://127.0.0.1:${await freePort()}/${databaseName}` }, /MongoDB initialization failed/);
  console.log('PASS: unavailable local MongoDB stops production startup without a listening HTTP server or sample fallback.');

  const duplicateName = `masaloo_test_production_${randomUUID().replaceAll('-', '')}`, duplicate = await connectTest(duplicateName);
  await duplicate.collection('users').insertMany([{ name: 'Test A', email: 'duplicate@test.invalid', role: 'customer', passwordHash: 'fixture-only' }, { name: 'Test B', email: 'duplicate@test.invalid', role: 'customer', passwordHash: 'fixture-only' }]);
  await rejectStartup({ MONGODB_URI: `mongodb://127.0.0.1:27017/${duplicateName}` }, /MongoDB initialization failed/);
  console.log('PASS: an actual unique-index failure aborts production startup.');

  const storage = createImageStorage(uploadDir);
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#dbac54' } }).png().toBuffer();
  const image = await storage.writeImage(bytes), database = await connectTest(databaseName);
  let fixture = await startFixture();
  const health = await fetch(fixture.base + '/api/health', { headers: railwayHeaders }); assert.equal(health.status, 200); assert.equal((await health.json()).database, 'connected');
  assert.equal(await database.collection('users').countDocuments(), 0);
  assert.equal(await database.collection('products').countDocuments(), 0);
  assert.equal(await database.collection('posts').countDocuments(), 0);
  assert.equal(await database.collection('wholesaleproducts').countDocuments(), 25);
  for (const route of ['/shop', '/admin', '/wholesale/store']) { const response = await fetch(fixture.base + route); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/); }
  assert.equal((await fetch(fixture.base + image)).status, 200);
  assert.equal((await fetch(fixture.base + '/uploads/missing.webp')).status, 404);
  console.log('PASS: production binds the configured port on 0.0.0.0, reports ready MongoDB, serves deep links/assets, and creates no owner or retail sample records.');

  const products = await fetch(fixture.base + '/api/products', { headers: railwayHeaders });
  assert.equal(products.status, 200); assert.equal((await products.json()).sample, false);
  const blogs = await fetch(fixture.base + '/api/blogs', { headers: railwayHeaders });
  assert.equal(blogs.status, 200); assert.deepEqual((await blogs.json()).posts, []);
  assert.equal((await fetch(fixture.base + '/api/auth/me', { headers: railwayHeaders })).status, 401);
  console.log('PASS: Railway-style forwarding headers reach products, blogs, session authentication, and health without an ingress 503.');

  const registration = await fetch(fixture.base + '/api/auth/register', { method: 'POST', headers: { ...railwayHeaders, Origin: baseEnv.CLIENT_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test customer', email: 'customer@production.test', password: 'test-customer-password' }) });
  assert.equal(registration.status, 201); const cookie = registration.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await registration.json()).user.role, 'customer');
  assert.equal((await fetch(fixture.base + '/api/auth/me', { headers: { ...railwayHeaders, Cookie: cookie.split(';')[0] } })).status, 200);
  assert.equal((await fetch(fixture.base + '/api/contact', { method: 'POST', headers: { Origin: 'http://localhost:4000' } })).status, 403);
  console.log('PASS: production customer sessions set Secure/HttpOnly/Strict cookies and enforce the canonical origin.');

  await stopFixture(fixture, 'SIGTERM'); fixture = await startFixture();
  assert.equal((await fetch(fixture.base + image)).status, 200);
  assert.equal(await database.collection('users').countDocuments({ role: 'owner' }), 0);
  console.log('PASS: uploaded image URLs survive a complete Node process restart.');

  const disconnected = new Promise(resolve => fixture.child.once('message', resolve)); fixture.child.send('disconnect-database');
  assert.equal((await bounded(disconnected, 'Database disconnect fixture timed out.')).type, 'disconnected');
  const unhealthy = await fetch(fixture.base + '/api/health'); assert.equal(unhealthy.status, 503); assert.equal((await unhealthy.json()).database, 'unavailable');
  const catalog = await fetch(fixture.base + '/api/products'); assert.equal(catalog.status, 503); assert.equal((await catalog.json()).products, undefined);
  for (const route of ['/api/auth/logout', '/api/wholesale/auth/logout']) {
    const logout = await fetch(fixture.base + route, { method: 'POST', headers: { Origin: baseEnv.CLIENT_ORIGIN } });
    assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/); assert.match(logout.headers.get('set-cookie'), /Secure/);
  }
  await stopFixture(fixture, 'SIGINT');
  console.log('PASS: database loss returns 503 without sample products; SIGTERM/SIGINT handlers shut down cleanly through portable local signal simulation.');
} finally {
  for (const child of children) { child.kill(); }
  await Promise.all([...children].map(child => new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve); })));
  for (const database of databases) {
    if (!/^masaloo_test_production_[a-f0-9]+$/.test(database.name)) throw new Error('Refusing cleanup of a non-test database.');
    await database.dropDatabase(); await database.close();
  }
  await removeTestDirectory(directory);
}
