import test from 'node:test';
import { isolateTestUploads, removeTestDirectory } from '../../scripts/test-support.mjs';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { User, Product } from '../models.js';
import { Sale, LedgerCustomer } from '../finance-models.js';
import { initialProducts } from '../../shared/catalog.js';
import { indiaToday, monthBounds } from '../../shared/sales.js';

test('sales register, udhari payments, and channel reports preserve financial totals', { timeout: 60000 }, async t => {
  const uploadDirectory = await isolateTestUploads();
  const name = `masaloo_test_finance_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${name}`, { serverSelectionTimeoutMS: 5000 });
  process.env.JWT_SECRET = 'finance-test-secret-at-least-thirty-two-characters';
  await Promise.all([User.init(), Product.init(), Sale.init(), LedgerCustomer.init()]);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/finance`;
  const cookies = {};
  const request = async (route, { method = 'GET', body, role = 'owner' } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookies[role] ? { Cookie: cookies[role] } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const uuid = () => randomUUID();
  const customerId = uuid(), otherCustomer = uuid();
  const baseSale = { date: '2025-01-31', channel: 'shop', customerId, items: [{ productId: 'haldi-powder', quantity: 2, unitPrice: 200.10 }], amountPaid: 50, paymentMethod: 'cash', dueDate: '2025-02-05' };
  const shopId = uuid(), onlineId = uuid(), laterId = uuid(), openingId = uuid();
  try {
    for (const role of ['owner', 'manager', 'editor', 'customer', 'pending']) {
      const user = await User.create({ name: role, email: `${role}@finance.test`, role, passwordHash: 'not-used-in-this-session-test' });
      cookies[role] = `masaloo_session=${jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: '1h' })}`;
    }
    await Product.insertMany(initialProducts.slice(0,2));
    await t.test('only owners and managers can read or modify financial records', async () => {
      for (const role of ['editor', 'customer', 'pending', 'visitor']) {
        for (const route of ['/options', '/sales', '/customers', '/reports/monthly', '/reports/top-products']) assert.equal((await request(route, { role })).status, role === 'visitor' ? 401 : 403);
        assert.equal((await request('/sales', { method: 'POST', role, body: {} })).status, role === 'visitor' ? 401 : 403);
      }
      assert.equal((await request('/options', { role: 'manager' })).status, 200);
    });
    await t.test('customers can be saved, retried, edited, and searched literally', async () => {
      const body = { id: customerId, name: 'Ravi Store', phone: '9876543210' };
      assert.equal((await request('/customers', { method: 'POST', body })).status, 201);
      await request('/customers', { method: 'POST', body });
      assert.equal(await LedgerCustomer.countDocuments({ id: customerId }), 1);
      assert.equal((await request(`/customers/${customerId}`, { method: 'PUT', body: { name: 'Ravi Store', phone: '9876543210', notes: 'Regular buyer' } })).status, 200);
      assert.equal((await request('/customers?search=%5B')).data.total, 0);
      assert.equal((await request('/customers', { method: 'POST', body: { id: otherCustomer, name: 'Other buyer' } })).status, 201);
    });
    await t.test('sales use integer paise and preserve product snapshots', async () => {
      const result = await request('/sales', { method: 'POST', role: 'manager', body: { ...baseSale, id: shopId, totalPaise: 1, paidPaise: 999999, items: [{ ...baseSale.items[0], name: 'Forged product' }] } });
      assert.equal(result.status, 201);
      assert.equal(result.data.sale.totalPaise, 40020);
      assert.equal(result.data.sale.paidPaise, 5000);
      assert.equal(result.data.sale.outstandingPaise, 35020);
      assert.equal(result.data.sale.items[0].name, 'Haldi Powder');
      assert.equal(result.data.sale.items[0].unitPricePaise, 20010);
      await Product.updateOne({ id: 'haldi-powder' }, { $set: { price: 999, name: 'Changed catalog name' } });
      assert.equal((await request(`/sales/${shopId}`)).data.sale.items[0].name, 'Haldi Powder');
      assert.equal((await request(`/sales/${shopId}`)).data.sale.totalPaise, 40020);
      assert.equal((await Product.findOne({ id: 'haldi-powder' })).stock, initialProducts[0].stock);
    });
    await t.test('retrying a sale does not create duplicate bills or payments', async () => {
      const result = await request('/sales', { method: 'POST', body: { ...baseSale, id: shopId } });
      assert.equal(result.status, 200);
      assert.equal(result.data.replayed, true);
      assert.equal(await Sale.countDocuments({ id: shopId }), 1);
      assert.equal((await Sale.findOne({ id: shopId })).payments.length, 1);
      assert.equal((await request('/sales', { method: 'POST', body: { ...baseSale, id: shopId, amountPaid: 51 } })).status, 409);
    });
    await t.test('invalid totals, anonymous credit, invalid quantities, duplicate products, and future dates are rejected', async () => {
      const invalid = [
        { amountPaid: 500 }, { customerId: undefined }, { date: '2099-01-01' }, { date: '2025-02-30' },
        { items: [{ ...baseSale.items[0], quantity: 1.5 }] }, { items: [baseSale.items[0], baseSale.items[0]] },
        { items: [{ ...baseSale.items[0], unitPrice: 1.001 }] }, { items: [{ ...baseSale.items[0], productId: 'missing-product' }] },
      ];
      for (const change of invalid) assert.equal((await request('/sales', { method: 'POST', body: { ...baseSale, ...change, id: uuid() } })).status, 400);
    });
    await t.test('online order references prevent duplicate imported receipts', async () => {
      const body = { id: onlineId, date: '2025-02-01', channel: 'online', externalReference: 'WEB-1001', customerName: 'Online buyer', items: [{ productId: 'haldi-powder', quantity: 1, unitPrice: 150.25 }, { productId: 'mirch-powder', quantity: 3, unitPrice: 80.05 }], amountPaid: 390.40, paymentMethod: 'upi' };
      assert.equal((await request('/sales', { method: 'POST', body })).status, 201);
      assert.equal((await request('/sales', { method: 'POST', body: { ...body, id: uuid() } })).status, 409);
      assert.equal((await request('/sales', { method: 'POST', body: { id: laterId, date: '2025-02-10', channel: 'shop', customerId, items: [{ productId: 'mirch-powder', quantity: 2, unitPrice: 80.05 }], amountPaid: 0, dueDate: '2025-02-20' } })).status, 201);
    });
    await t.test('opening udhari is recorded outside sales revenue and product rankings', async () => {
      const body = { id: openingId, amount: 50.15, date: '2024-12-01', dueDate: '2024-12-31', notes: 'Old notebook balance' };
      assert.equal((await request(`/customers/${customerId}/opening-balance`, { method: 'POST', body })).status, 201);
      assert.equal((await request(`/customers/${customerId}/opening-balance`, { method: 'POST', body })).data.replayed, true);
      const result = await request('/sales?from=2024-12-01&to=2024-12-31');
      assert.equal(result.data.total, 0);
      assert.equal(result.data.summary.totalPaise, 0);
    });
    await t.test('partial repayments keep history and reject overpayment or pre-sale payment dates', async () => {
      const body = { id: uuid(), date: '2025-02-10', amount: 50.10, method: 'upi', note: 'First repayment' };
      assert.equal((await request(`/sales/${shopId}/payments`, { method: 'POST', body })).status, 201);
      assert.equal((await request(`/sales/${shopId}/payments`, { method: 'POST', body })).data.replayed, true);
      assert.equal((await request(`/sales/${shopId}/payments`, { method: 'POST', body: { ...body, amount: 51 } })).status, 409);
      const sale = (await request(`/sales/${shopId}`)).data.sale;
      assert.equal(sale.paidPaise, 10010);
      assert.equal(sale.outstandingPaise, 30010);
      assert.equal(sale.payments.length, 2);
      assert.equal(sale.payments[1].note, 'First repayment');
      assert.equal((await request(`/sales/${shopId}/payments`, { method: 'POST', body: { ...body, id: uuid(), amount: 999 } })).status, 409);
      assert.equal((await request(`/sales/${shopId}/payments`, { method: 'POST', body: { ...body, id: uuid(), date: '2025-01-30' } })).status, 400);
      assert.equal((await request(`/sales/${openingId}/payments`, { method: 'POST', body: { id: uuid(), date: '2025-02-10', amount: 10.05, method: 'cash' } })).status, 201);
    });
    await t.test('daily and monthly totals separate new sales from collections and old debts', async () => {
      const daily = (await request('/sales?from=2025-02-10&to=2025-02-10')).data;
      assert.equal(daily.summary.totalPaise, 16010);
      assert.equal(daily.summary.collectedPaise, 6015);
      assert.equal(daily.summary.saleCount, 1);
      const january = (await request('/reports/monthly?month=2025-01')).data;
      assert.equal(january.summary.totalPaise, 40020);
      assert.equal(january.summary.collectedPaise, 5000);
      assert.equal(january.summary.outstandingPaise, 30010);
      const february = (await request('/reports/monthly?month=2025-02')).data;
      assert.equal(february.summary.totalPaise, 55050);
      assert.equal(february.summary.onlinePaise, 39040);
      assert.equal(february.summary.shopPaise, 16010);
      assert.equal(february.summary.collectedPaise, 45055);
      assert.equal(february.summary.outstandingPaise, 16010);
      assert.equal(february.summary.units, 6);
      assert.equal(february.daily.length, 28);
      assert.equal(february.monthly.length, 12);
      const online = (await request('/reports/monthly?month=2025-02&channel=online')).data;
      assert.equal(online.summary.totalPaise, 39040);
      assert.equal(online.summary.shopPaise, 0);
      assert.equal(online.summary.collectedPaise, 39040);
    });
    await t.test('top products rank independently by revenue and quantity with accurate channel splits', async () => {
      const report = (await request('/reports/top-products?from=2025-01-01&to=2025-02-28')).data;
      assert.equal(report.products[0].productId, 'haldi-powder');
      assert.equal(report.products[0].totalPaise, 55045);
      assert.equal(report.products[0].quantity, 3);
      assert.equal(report.products[0].onlinePaise, 15025);
      assert.equal(report.products[0].shopPaise, 40020);
      const byQuantity = (await request('/reports/top-products?from=2025-01-01&to=2025-02-28&sort=quantity')).data;
      assert.equal(byQuantity.products[0].productId, 'mirch-powder');
      assert.equal(byQuantity.products[0].quantity, 5);
      assert.equal(byQuantity.products[0].totalPaise, 40025);
      assert.equal(report.products.reduce((sum,p) => sum + p.totalPaise, 0), report.summary.totalPaise);
    });
    await t.test('customer ledger totals, overdue balances, and filters reconcile to individual records', async () => {
      const result = (await request(`/customers/${customerId}`)).data;
      assert.equal(result.customer.outstandingPaise, 50030);
      assert.equal(result.customer.overduePaise, 50030);
      assert.equal(result.customer.billedPaise - result.customer.collectedPaise, 50030);
      assert.equal(result.total, 3);
      assert.equal((await request('/customers?status=due')).data.total, 1);
      assert.equal((await request('/customers?status=overdue')).data.summary.outstandingPaise, 50030);
      assert.equal((await request('/sales?from=2025-02-01&to=2025-02-28&payment=paid')).data.total, 1);
    });
    await t.test('simultaneous repayments cannot overpay, and identical retries only charge once', async () => {
      const id = uuid();
      await request('/sales', { method: 'POST', body: { id, date: '2025-03-01', channel: 'shop', customerId: otherCustomer, items: [{ productId: 'mirch-powder', quantity: 1, unitPrice: 100 }], amountPaid: 0 } });
      const results = await Promise.all([1,2].map(() => request(`/sales/${id}/payments`, { method: 'POST', body: { id: uuid(), date: '2025-03-01', amount: 70, method: 'cash' } })));
      assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
      const body = { id: uuid(), date: '2025-03-01', amount: 20, method: 'cash' };
      const retries = await Promise.all([1,2].map(() => request(`/sales/${id}/payments`, { method: 'POST', body })));
      assert.deepEqual(retries.map(r => r.status).sort(), [200,201]);
      const sale = (await request(`/sales/${id}`)).data.sale;
      assert.equal(sale.paidPaise, 9000);
      assert.equal(sale.payments.reduce((sum,p) => sum + p.amountPaise, 0), 9000);
      assert.equal(sale.outstandingPaise, 1000);
    });
    await t.test('only an owner may cancel an unpaid record; cancellation preserves an audit trail', async () => {
      const id = uuid();
      await request('/sales', { method: 'POST', body: { id, date: '2025-03-02', channel: 'shop', customerId: otherCustomer, items: [{ productId: 'mirch-powder', quantity: 1, unitPrice: 50 }], amountPaid: 0 } });
      assert.equal((await request(`/sales/${id}/cancel`, { method: 'POST', role: 'manager', body: { reason: 'Wrong entry' } })).status, 403);
      const result = await request(`/sales/${id}/cancel`, { method: 'POST', body: { reason: 'Wrong entry' } });
      assert.equal(result.status, 200);
      assert.equal(result.data.sale.status, 'cancelled');
      assert.equal(result.data.sale.cancellationReason, 'Wrong entry');
      assert.equal((await request('/sales?from=2025-03-02&to=2025-03-02')).data.summary.totalPaise, 0);
      assert.equal((await request(`/sales/${id}/payments`, { method: 'POST', body: { id: uuid(), date: '2025-03-02', amount: 1, method: 'cash' } })).status, 409);
      assert.equal((await request(`/sales/${shopId}/cancel`, { method: 'POST', body: { reason: 'Cannot remove received payments' } })).status, 409);
    });
    await t.test('invalid report ranges and missing records return clear errors', async () => {
      assert.equal((await request('/sales?from=2025-02-01&to=2025-01-01')).status, 400);
      assert.equal((await request('/reports/monthly?month=2025-13')).status, 400);
      assert.equal((await request('/sales?page=-1')).status, 400);
      assert.equal((await request(`/sales/${uuid()}`)).status, 404);
      await Product.deleteOne({ id: 'haldi-powder' });
      assert.equal((await request(`/sales/${shopId}`)).data.sale.items[0].name, 'Haldi Powder');
      assert.equal((await request('/reports/top-products?from=2025-01-01&to=2025-02-28')).data.products[0].productId, 'haldi-powder');
    });
  } finally {
    await removeTestDirectory(uploadDirectory);
    if (!mongoose.connection.name.startsWith('masaloo_test_finance_')) throw new Error('Refusing to clean up a non-test database.');
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
    await new Promise(resolve => server.close(resolve));
  }
});

test('sales calendar uses Indian dates and correct leap-year month boundaries', () => {
  assert.equal(indiaToday(new Date('2025-01-31T20:00:00Z')), '2025-02-01');
  assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
});
