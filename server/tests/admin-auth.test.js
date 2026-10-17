import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApp } from '../app.js';
import { User, Setup } from '../models.js';
import { isolateTestUploads, removeTestDirectory } from '../../scripts/test-support.mjs';

test('admin registration, initial owner setup, login, and team approval', { timeout: 60000 }, async t => {
  const databaseName = `masaloo_test_auth_${randomUUID().replaceAll('-', '')}`;
  const uploadDirectory = await isolateTestUploads();
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`, { serverSelectionTimeoutMS: 5000 });
  process.env.JWT_SECRET = 'admin-auth-test-secret-with-at-least-thirty-two-characters';
  process.env.NODE_ENV = 'test';
  await Promise.all([User.init(), Setup.init()]);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, { method = 'GET', body, cookie, host } = {}) => {
    if (host) return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}${route}`, { method, headers: { Host: host, 'Content-Type': 'application/json' } }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
    const response = await fetch(`${base}${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(host ? { Host: host } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const credentials = { name: 'Store Owner', email: 'owner@masaloo.test', password: 'test-admin-password', confirmPassword: 'test-admin-password' };
  let ownerCookie;
  try {
    await t.test('production and nonlocal hostnames cannot claim the first owner', async () => {
      process.env.NODE_ENV = 'production';
      assert.equal((await request('/auth/admin-registration')).data.canRegister, false);
      assert.equal((await request('/auth/admin-register', { method: 'POST', body: credentials })).status, 403);
      process.env.NODE_ENV = 'test';
      assert.equal((await request('/auth/admin-register', { method: 'POST', host: 'store.example', body: credentials })).status, 403);
      assert.equal(await User.countDocuments(), 0);
    });
    await t.test('registration validates confirmation and reports initial setup availability', async () => {
      const status = await request('/auth/admin-registration');
      assert.deepEqual(status.data, { firstOwner: true, canRegister: true, requiresApproval: false });
      assert.equal((await request('/auth/admin-register', { method: 'POST', body: { ...credentials, confirmPassword: 'does-not-match' } })).status, 400);
      assert.equal(await Setup.countDocuments({ id: 'owner-registration' }), 0);
    });
    await t.test('concurrent initial signups create only one owner', async () => {
      const results = await Promise.all([
        request('/auth/admin-register', { method: 'POST', body: credentials }),
        request('/auth/admin-register', { method: 'POST', body: { ...credentials, name: 'Other Applicant', email: 'other@masaloo.test', role: 'owner' } }),
      ]);
      assert.equal(await User.countDocuments({ role: 'owner' }), 1);
      assert.equal(await Setup.countDocuments({ id: 'owner-registration' }), 1);
      const owner = results.find(result => result.data.user?.role === 'owner');
      assert.equal(owner.status, 201);
      ownerCookie = owner.cookie;
      assert.equal((await request('/admin/overview', { cookie: ownerCookie })).status, 200);
      assert.ok(results.every(result => result.status === 201 || result.status === 409));
    });
    let pending;
    await t.test('subsequent admin registration requires approval and ignores requested roles', async () => {
      assert.deepEqual((await request('/auth/admin-registration')).data, { firstOwner: false, canRegister: true, requiresApproval: true });
      pending = await request('/auth/admin-register', { method: 'POST', body: { ...credentials, name: 'New Staff', email: 'staff@masaloo.test', role: 'owner' } });
      assert.equal(pending.status, 201);
      assert.equal(pending.data.user.role, 'pending');
      assert.equal(pending.data.requiresApproval, true);
      assert.equal(pending.data.user.passwordHash, undefined);
      assert.equal((await request('/admin/overview', { cookie: pending.cookie })).status, 403);
      assert.equal((await request('/admin/products', { cookie: pending.cookie })).status, 403);
      assert.equal((await request('/auth/admin-register', { method: 'POST', body: { ...credentials, email: 'staff@masaloo.test' } })).status, 409);
    });
    await t.test('admin login accepts pending staff but rejects wrong passwords and customer accounts', async () => {
      assert.equal((await request('/auth/admin-login', { method: 'POST', body: { email: 'staff@masaloo.test', password: credentials.password } })).data.user.role, 'pending');
      assert.equal((await request('/auth/admin-login', { method: 'POST', body: { email: 'staff@masaloo.test', password: 'incorrect' } })).status, 401);
      await request('/auth/register', { method: 'POST', body: { name: 'Customer', email: 'customer@masaloo.test', password: credentials.password } });
      const result = await request('/auth/admin-login', { method: 'POST', body: { email: 'customer@masaloo.test', password: credentials.password } });
      assert.equal(result.status, 403);
      assert.equal(result.cookie, undefined);
    });
    await t.test('owner approval takes effect in the existing staff session', async () => {
      const result = await request(`/admin/users/${pending.data.user.id}/role`, { method: 'PATCH', cookie: ownerCookie, body: { role: 'manager' } });
      assert.equal(result.status, 200);
      assert.equal((await request('/auth/me', { cookie: pending.cookie })).data.user.role, 'manager');
      assert.equal((await request('/admin/products', { cookie: pending.cookie })).status, 200);
      assert.equal((await request('/admin/users', { cookie: pending.cookie })).status, 403);
    });
    await t.test('an approved owner can sign in again through the dedicated login', async () => {
      const owner = await User.findOne({ role: 'owner' });
      const result = await request('/auth/admin-login', { method: 'POST', body: { email: owner.email, password: credentials.password } });
      assert.equal(result.status, 200);
      assert.equal(result.data.user.role, 'owner');
    });
  } finally {
    await removeTestDirectory(uploadDirectory);
    if (!mongoose.connection.name.startsWith('masaloo_test_auth_')) throw new Error('Refusing to clean up a non-test database.');
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise(resolve => server.close(resolve));
  }
});
