import test from 'node:test';
import assert from 'node:assert/strict';
import { productSchema, registerSchema, canManageProducts, canManagePosts, imageSchema } from '../validation.js';
import { initialProducts } from '../../shared/catalog.js';

test('public signup cannot assign a privileged role', () => {
  const parsed = registerSchema.parse({ name: 'New customer', email: 'USER@example.com', password: 'a-secure-password', role: 'owner' });
  assert.equal(parsed.role, undefined);
  assert.equal(parsed.email, 'user@example.com');
  assert.equal(registerSchema.safeParse({ name: 'Customer', email: ' customer@example.com ', password: 'a-secure-password' }).success, true);
  assert.equal(registerSchema.safeParse({ name: 'Customer', email: 'customer@example.com', password: '🔒'.repeat(20) }).success, false);
});

test('catalog validates monetary values, quantities and local image paths', () => {
  assert.equal(productSchema.parse(initialProducts[0]).price, 120);
  for (const overrides of [{ price: -1 }, { price: 'NaN' }, { stock: 2.5 }, { stock: -1 }, { image: 'https://example.com/image.jpg' }, { image: '/uploads/../../secret.png' }]) {
    assert.equal(productSchema.safeParse({ ...initialProducts[0], ...overrides }).success, false);
  }
  assert.equal(imageSchema.safeParse('/uploads/abc-123.webp').success, true);
});

test('role boundaries distinguish product managers and journal editors', () => {
  assert.equal(canManageProducts('editor'), false);
  assert.equal(canManageProducts('manager'), true);
  assert.equal(canManageProducts('customer'), false);
  assert.equal(canManagePosts('editor'), true);
  assert.equal(canManagePosts('customer'), false);
});
