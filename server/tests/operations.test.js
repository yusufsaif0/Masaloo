import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { User } from '../models.js';
import { Sale } from '../finance-models.js';
import { BusinessContact, ExpenseRecord } from '../operations-models.js';
import { parseBillText } from '../bill-parser.js';
import { createBillReader } from '../bill-ocr.js';
import { isolateTestUploads, removeTestDirectory } from '../../scripts/test-support.mjs';
import { billImage } from '../../scripts/fixtures/bill-image.mjs';

test('bill parsing handles Hindi digits, dates, labelled totals, ambiguity, and missing fields', () => {
  const hindi = parseBillText('मसालू सप्लायर\nबिल संख्या: H-19\nदिनांक: १८/१०/२०२६\nकुल राशि: १,२५०.५०', 90);
  assert.equal(hindi.suggestions.total, 1250.5); assert.equal(hindi.suggestions.date, '2026-10-18'); assert.equal(hindi.suggestions.billNumber, 'H-19');
  const ambiguous = parseBillText('Supplier\nSubtotal 8000\nTotal 1050.00\nGrand Total 1100.00', 40);
  assert.equal(ambiguous.suggestions.total, 1100); assert.equal(ambiguous.candidateTotals.length, 2); assert.ok(ambiguous.warnings.length >= 2);
  const missing = parseBillText('Phone 9876543210\nGSTIN 29ABCDEFG1234', 80);
  assert.equal(missing.suggestions.total, ''); assert.equal(missing.suggestions.date, '');
  assert.equal(parseBillText('Bill date 31/02/2026\nTotal 500', 90).suggestions.date, '');
});

test('bill reader rejects invalid images and bounds OCR execution', { timeout: 15000 }, async () => {
  const reader = createBillReader({ timeoutMs: 10 });
  await assert.rejects(reader(Buffer.from('not an image')), error => error.status === 400);
  await assert.rejects(reader(await billImage()), error => error.status === 408);
});

test('private reviewed bills, salary/rent payments, and business contacts', { timeout: 120000 }, async t => {
  const directory = await isolateTestUploads(), database = `masaloo_test_operations_${randomUUID().replaceAll('-', '')}`;
  process.env.JWT_SECRET = 'operations-test-only-secret-at-least-thirty-two-characters';
  process.env.NODE_ENV = 'test';
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([User.init(), BusinessContact.init(), ExpenseRecord.init(), Sale.init()]);
  const server = createApp().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + '/api/admin/operations', cookies = {};
  const request = async (route, { method = 'GET', body, role = 'owner' } = {}) => {
    const multipart = body instanceof FormData;
    const response = await fetch(base + route, { method, headers: { ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}), ...(cookies[role] ? { Cookie: cookies[role] } : {}) }, body: body ? multipart ? body : JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  const bytes = await billImage(), supplierId = randomUUID(), billId = randomUUID();
  const details = { id: billId, kind: 'bill', title: 'Spice purchase', payeeName: 'Reviewed supplier', contactId: supplierId, billNumber: 'CORRECTED-17', date: '2025-01-01', dueDate: '2025-01-05', total: 1060.25, amountPaid: 25, reviewed: true, ocrText: 'Corrected bill text' };
  const multipart = (data = details, image = bytes) => { const body = new FormData(); body.append('details', JSON.stringify(data)); if (image) body.append('image', new Blob([image], { type: 'image/png' }), 'bill.png'); return body; };
  let salaryId, rentId;
  try {
    for (const role of ['owner', 'manager', 'editor', 'customer', 'pending']) {
      const user = await User.create({ name: role, email: `${role}@operations.test`, passwordHash: 'session-fixture-only', role });
      cookies[role] = 'masaloo_session=' + jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: '1h' });
    }
    await t.test('only owners and managers can access contacts, financial records, and OCR', async () => {
      for (const role of ['visitor', 'editor', 'customer', 'pending']) {
        const expected = role === 'visitor' ? 401 : 403;
        assert.equal((await request('/contacts', { role })).status, expected);
        assert.equal((await request('/records', { role })).status, expected);
        assert.equal((await request('/bills/preview', { role, method: 'POST' })).status, expected);
      }
      assert.equal((await request('/records', { role: 'manager' })).status, 200);
    });
    await t.test('contacts support types, retry protection, literal search, editing, and archiving', async () => {
      const contact = { id: supplierId, type: 'supplier', name: 'Spice supplier', phone: '9876543210' };
      assert.equal((await request('/contacts', { method: 'POST', body: contact })).status, 201);
      assert.equal((await request('/contacts', { method: 'POST', body: contact })).data.replayed, true);
      assert.equal((await request('/contacts', { method: 'POST', body: { ...contact, name: 'Changed retry' } })).status, 409);
      for (const type of ['customer', 'hotel']) assert.equal((await request('/contacts', { method: 'POST', body: { id: randomUUID(), name: type + ' contact', type } })).status, 201);
      assert.equal((await request('/contacts?type=supplier')).data.total, 1);
      assert.equal((await request('/contacts?search=%5B')).data.total, 0);
      assert.equal((await request('/contacts', { method: 'POST', body: { id: randomUUID(), type: 'hotel', name: 'Invalid', email: 'bad' } })).status, 400);
    });
    await t.test('real Hindi+English OCR extracts the image without persisting a record or image', async () => {
      const form = new FormData(); form.append('image', new Blob([bytes], { type: 'image/png' }), 'bill.png');
      const response = await request('/bills/preview', { method: 'POST', body: form });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal(response.data.suggestions.total, 1050); assert.equal(response.data.suggestions.billNumber, 'BILL-17');
      assert.equal(response.data.suggestions.date, '2026-10-01'); assert.match(response.data.text, /MASALOO/);
      assert.equal(await ExpenseRecord.countDocuments(), 0);
      assert.equal((await readdir(directory)).includes('private-bills'), false);
    });
    await t.test('bill submission requires review, validates the image, and preserves corrected fields', async () => {
      assert.equal((await request('/records', { method: 'POST' })).status, 400);
      assert.equal((await request('/records', { method: 'POST', body: multipart({ ...details, reviewed: false }) })).status, 400);
      assert.equal((await request('/records', { method: 'POST', body: details })).status, 400);
      assert.equal((await request('/records', { method: 'POST', body: multipart(details, Buffer.from('fake image')) })).status, 400);
      const saved = await request('/records', { method: 'POST', body: multipart() });
      assert.equal(saved.status, 201, JSON.stringify(saved.data));
      assert.equal(saved.data.record.totalPaise, 106025); assert.equal(saved.data.record.paidPaise, 2500);
      assert.equal(saved.data.record.billNumber, 'CORRECTED-17'); assert.equal(saved.data.record.ocrText, 'Corrected bill text');
      assert.equal(saved.data.record.imageName, undefined); assert.match(saved.data.record.imageUrl, /\/api\/admin\/operations\//);
      assert.equal((await request('/records', { method: 'POST', body: multipart() })).data.replayed, true);
      assert.equal((await request('/records', { method: 'POST', body: multipart({ ...details, total: 1500 }) })).status, 409);
      assert.equal(await ExpenseRecord.countDocuments({ id: billId }), 1);
    });
    await t.test('saved bill images are private and survive application recreation', async () => {
      const file = (await ExpenseRecord.findOne({ id: billId })).imageName;
      const imagePath = `/records/${billId}/image`;
      for (const [role, expected] of [['visitor', 401], ['editor', 403], ['customer', 403], ['manager', 200], ['owner', 200]]) {
        const response = await fetch(base + imagePath, { headers: cookies[role] ? { Cookie: cookies[role] } : {} });
        assert.equal(response.status, expected);
        if (expected === 200) { assert.match(response.headers.get('cache-control'), /no-store/); assert.match(response.headers.get('content-type'), /image\/webp/); }
      }
      assert.equal((await fetch(origin + '/uploads/private-bills/' + file)).status, 404);
      assert.equal((await fetch(origin + '/uploads/' + file)).status, 404);
      const restarted = createApp().listen(0, '127.0.0.1'); await new Promise(resolve => restarted.once('listening', resolve));
      try { assert.equal((await fetch(`http://127.0.0.1:${restarted.address().port}/api/admin/operations` + imagePath, { headers: { Cookie: cookies.owner } })).status, 200); }
      finally { await new Promise(resolve => restarted.close(resolve)); }
    });
    await t.test('salary and rent use paise, due dates, reference months, and duplicate-period protection', async () => {
      const salary = { id: randomUUID(), kind: 'salary', title: 'Employee salary', payeeName: 'Employee One', period: '2025-01', date: '2025-01-01', dueDate: '2025-01-05', total: 5000.55, amountPaid: 2000, reviewed: true };
      salaryId = salary.id;
      const saved = await request('/records', { method: 'POST', body: salary });
      assert.equal(saved.status, 201); assert.equal(saved.data.record.outstandingPaise, 300055); assert.equal(saved.data.record.overdue, true);
      assert.equal((await request('/records', { method: 'POST', body: { ...salary, id: randomUUID() } })).status, 409);
      assert.equal((await request('/records', { method: 'POST', body: { ...salary, id: randomUUID(), period: '2025-02', amountPaid: 9999 } })).status, 400);
      assert.equal((await request('/records', { method: 'POST', body: { ...salary, id: randomUUID(), period: undefined } })).status, 400);
      assert.equal((await request('/records', { method: 'POST', body: { ...salary, id: randomUUID(), dueDate: '2024-12-31' } })).status, 400);
      rentId = randomUUID();
      assert.equal((await request('/records', { method: 'POST', body: { ...salary, id: rentId, kind: 'rent', payeeName: 'Landlord', title: 'Main shop', total: 1000, amountPaid: 0 } })).status, 201);
      assert.equal((await request('/records?kind=running&month=2025-01')).data.total, 2);
      assert.equal((await request('/records?state=overdue')).data.total, 3);
      const summary = (await request('/records')).data.summary;
      assert.equal(summary.totalPaise, 706080); assert.equal(summary.paidPaise, 202500); assert.equal(summary.outstandingPaise, 503580);
    });
    await t.test('concurrent payments cannot overpay, retries do not duplicate payments, and dates are validated', async () => {
      const bodies = [0, 1].map(() => ({ id: randomUUID(), amount: 700, date: '2025-01-02', method: 'cash', note: '' }));
      const results = await Promise.all(bodies.map(body => request(`/records/${rentId}/payments`, { method: 'POST', body })));
      assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
      const accepted = bodies[results.findIndex(result => result.status === 201)];
      assert.equal((await request(`/records/${rentId}/payments`, { method: 'POST', body: accepted })).data.replayed, true);
      assert.equal((await request(`/records/${rentId}/payments`, { method: 'POST', body: { ...accepted, amount: 100 } })).status, 409);
      assert.equal((await request(`/records/${rentId}/payments`, { method: 'POST', body: { ...accepted, id: randomUUID(), date: '2024-12-01' } })).status, 400);
      assert.equal((await ExpenseRecord.findOne({ id: rentId })).paidPaise, 70000);
      assert.equal((await ExpenseRecord.findOne({ id: rentId })).payments.length, 1);
    });
    await t.test('unpaid cancellation preserves history and contact edits do not change saved bill snapshots', async () => {
      const body = { id: randomUUID(), kind: 'salary', title: 'Employee salary', payeeName: 'Employee Two', period: '2025-01', date: '2025-01-01', dueDate: '2025-01-05', total: 100, reviewed: true };
      assert.equal((await request('/records', { method: 'POST', body })).status, 201);
      assert.equal((await request(`/records/${body.id}/cancel`, { role: 'manager', method: 'POST', body: { reason: 'Incorrect amount' } })).status, 403);
      assert.equal((await request(`/records/${body.id}/cancel`, { method: 'POST', body: { reason: 'Incorrect amount' } })).status, 200);
      assert.equal((await request(`/records/${rentId}/cancel`, { method: 'POST', body: { reason: 'Already partly paid' } })).status, 409);
      assert.equal((await request('/contacts/' + supplierId, { method: 'PUT', body: { type: 'supplier', name: 'Changed supplier', active: false } })).status, 200);
      assert.equal((await request('/contacts?type=supplier')).data.total, 0);
      assert.equal((await request('/contacts?type=supplier&status=archived')).data.total, 1);
      assert.equal((await request('/records/' + billId)).data.record.payeeName, 'Reviewed supplier');
      assert.equal(await Sale.countDocuments(), 0);
    });
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (!mongoose.connection.name.startsWith('masaloo_test_operations_')) throw Error('Refusing cleanup of a non-test database.');
    await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await removeTestDirectory(directory);
  }
});
