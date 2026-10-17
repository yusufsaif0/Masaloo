import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { isolateTestUploads, removeTestDirectory } from '../../scripts/test-support.mjs';
import { Product, Post, User, Message, Subscriber } from '../models.js';
import { initialProducts } from '../../shared/catalog.js';

test('MongoDB accounts, role permissions, catalog writes, uploads, and customer enquiries', { timeout: 60000 }, async t => {
  // Tests always use a fresh local database, never the configured store database.
  const databaseName = `masaloo_test_${randomUUID().replaceAll('-', '')}`;
  const uploadDirectory = await isolateTestUploads();
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`, { serverSelectionTimeoutMS: 5000 });
  process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-characters';
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const uploaded = [];
  const request = async (route, { body, method = 'GET', cookie, origin } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  };
  try {
    await Promise.all([User.init(), Product.init(), Post.init(), Subscriber.init()]);
    const hash = await bcrypt.hash('test-password-only', 4);
    for (const role of ['owner', 'manager', 'editor']) await User.create({ name: `Test ${role}`, email: `${role}@masaloo.test`, passwordHash: hash, role });
    const cookies = {};
    for (const role of ['owner', 'manager', 'editor']) {
      const result = await request('/auth/login', { method: 'POST', body: { email: `${role}@masaloo.test`, password: 'test-password-only' } });
      assert.equal(result.status, 200);
      cookies[role] = result.cookie;
    }
    await t.test('customer registration uses hashed passwords and ignores role injection', async () => {
      const result = await request('/auth/register', { method: 'POST', body: { name: 'Customer', email: 'customer@masaloo.test', password: 'customer-password', role: 'owner' } });
      assert.equal(result.status, 201);
      assert.equal(result.data.user.role, 'customer');
      assert.equal(result.data.user.passwordHash, undefined);
      assert.match(result.headers.get('set-cookie'), /HttpOnly/);
      assert.match(result.headers.get('set-cookie'), /SameSite=Strict/);
      cookies.customer = result.cookie;
      const user = await User.findOne({ email: 'customer@masaloo.test' }).select('+passwordHash');
      assert.notEqual(user.passwordHash, 'customer-password');
      assert.equal((await request('/auth/me', { cookie: cookies.customer })).data.user.email, 'customer@masaloo.test');
    });
    await t.test('invalid login and duplicate registrations are rejected', async () => {
      assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'owner@masaloo.test', password: 'incorrect' } })).status, 401);
      assert.equal((await request('/auth/register', { method: 'POST', body: { name: 'Duplicate', email: 'customer@masaloo.test', password: 'customer-password' } })).status, 409);
    });
    await t.test('protected APIs reject visitors, customers, and editors editing products', async () => {
      assert.equal((await request('/admin/products')).status, 401);
      assert.equal((await request('/admin/products', { cookie: cookies.customer })).status, 403);
      assert.equal((await request('/admin/products', { cookie: cookies.editor })).status, 403);
      assert.equal((await request('/admin/users', { cookie: cookies.manager })).status, 403);
      assert.equal((await request('/admin/messages', { cookie: cookies.editor })).status, 403);
    });
    let product;
    await t.test('managers can create and update products; hidden products stay private', async () => {
      const created = await request('/admin/products', { method: 'POST', cookie: cookies.manager, body: { ...initialProducts[0], name: 'Integration spice', price: 205.5 } });
      assert.equal(created.status, 201); product = created.data.product;
      let products = (await request('/products')).data.products;
      assert.equal(products.find(p => p.id === product.id).price, 205.5);
      const updated = await request(`/admin/products/${product.id}`, { method: 'PUT', cookie: cookies.manager, body: { ...product, price: 230, active: false } });
      assert.equal(updated.status, 200);
      products = (await request('/products')).data.products;
      assert.equal(products.some(p => p.id === product.id), false);
      assert.equal((await request('/admin/products', { method: 'POST', cookie: cookies.manager, body: { ...initialProducts[0], price: -1 } })).status, 400);
    });
    await t.test('editors publish stories and drafts remain private', async () => {
      const post = { title: 'A test story', excerpt: 'A little introduction', category: 'Kitchen stories', image: '/images/story.webp', content: 'Some kitchen inspiration.\n\nA second paragraph.', published: false };
      const created = await request('/admin/blogs', { method: 'POST', cookie: cookies.editor, body: post });
      assert.equal(created.status, 201);
      assert.equal((await request('/blogs')).data.posts.length, 0);
      assert.equal((await request(`/admin/blogs/${created.data.post.id}`, { method: 'PUT', cookie: cookies.editor, body: { ...post, published: true } })).status, 200);
      assert.equal((await request('/blogs')).data.posts.length, 1);
      assert.equal((await request(`/admin/blogs/${created.data.post.id}`, { method: 'DELETE', cookie: cookies.editor })).status, 200);
    });
    await t.test('only owners can assign roles; owner accounts are protected', async () => {
      const customer = await User.findOne({ email: 'customer@masaloo.test' });
      assert.equal((await request(`/admin/users/${customer.id}/role`, { method: 'PATCH', cookie: cookies.manager, body: { role: 'manager' } })).status, 403);
      assert.equal((await request(`/admin/users/${customer.id}/role`, { method: 'PATCH', cookie: cookies.owner, body: { role: 'editor' } })).status, 200);
      const owner = await User.findOne({ role: 'owner' });
      assert.equal((await request(`/admin/users/${owner.id}/role`, { method: 'PATCH', cookie: cookies.owner, body: { role: 'customer' } })).status, 400);
      assert.equal((await request(`/admin/users/${customer.id}/role`, { method: 'PATCH', cookie: cookies.owner, body: { role: 'owner' } })).status, 400);
      assert.equal((await request('/admin/products', { cookie: cookies.customer })).status, 403);
    });
    await t.test('contact messages persist and newsletter signup is idempotent', async () => {
      assert.equal((await request('/contact', { method: 'POST', body: { name: 'Visitor', email: 'visitor@masaloo.test', subject: 'Bulk enquiry', message: 'Please send more details.' } })).status, 201);
      assert.equal(await Message.countDocuments(), 1);
      for (let i = 0; i < 2; i++) assert.equal((await request('/newsletter', { method: 'POST', body: { email: 'visitor@masaloo.test' } })).status, 200);
      assert.equal(await Subscriber.countDocuments(), 1);
      assert.equal((await request('/admin/messages', { cookie: cookies.owner })).data.messages.length, 1);
    });
    await t.test('uploads validate real image bytes and store re-encoded local images', async () => {
      const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#dba64c' } }).png().toBuffer();
      const form = new FormData(); form.append('image', new Blob([bytes], { type: 'image/png' }), 'test.png');
      const response = await fetch(`${base}/admin/upload`, { method: 'POST', headers: { Cookie: cookies.owner }, body: form });
      const data = await response.json();
      assert.equal(response.status, 201); assert.match(data.image, /^\/uploads\/[a-f0-9-]+\.webp$/); uploaded.push(data.image);
      const bad = new FormData(); bad.append('image', new Blob(['not an image'], { type: 'image/png' }), 'bad.png');
      assert.equal((await fetch(`${base}/admin/upload`, { method: 'POST', headers: { Cookie: cookies.owner }, body: bad })).status, 400);
    });
    await t.test('foreign origins cannot modify the store and logout clears the cookie', async () => {
      assert.equal((await request(`/admin/products/${product.id}`, { method: 'DELETE', cookie: cookies.owner, origin: 'https://another-site.example' })).status, 403);
      assert.equal((await request(`/admin/products/${product.id}`, { method: 'DELETE', cookie: cookies.manager })).status, 200);
      const result = await request('/auth/logout', { method: 'POST', cookie: cookies.owner });
      assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
    });
  } finally {
    await removeTestDirectory(uploadDirectory);
    if (!mongoose.connection.name.startsWith('masaloo_test_')) throw new Error('Refusing to clean up a non-test database.');
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise(resolve => server.close(resolve));
  }
});
