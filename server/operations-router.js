import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BusinessContact, ExpenseRecord } from './operations-models.js';
import { contactSchema, createContactSchema, expenseSchema, paymentSchema } from './operations-validation.js';
import { pageSchema, monthSchema } from './finance-validation.js';
import { indiaToday, toPaise } from '../shared/sales.js';
import { escapedRegex } from './finance-reports.js';
import { createImageStorage } from './image-storage.js';
import { prepareBillImage, readBill } from './bill-ocr.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fieldSize: 80000 } });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const fingerprint = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const id = req => z.uuid().parse(req.params.id);
const searchText = value => z.string().trim().max(100).default('').parse(value);
const view = value => {
  const record = value.toObject ? value.toObject() : value;
  const { imageName, imageHash, requestFingerprint, ...rest } = record;
  return { ...rest, outstandingPaise: record.totalPaise - record.paidPaise,
    overdue: record.status === 'active' && record.paidPaise < record.totalPaise && record.dueDate < indiaToday(),
    imageUrl: imageName ? `/api/admin/operations/records/${record.id}/image` : null };
};
function replay(existing, expected, res) {
  if (existing.requestFingerprint !== expected) fail(409, 'This save request was already used with different details. Check the saved record before creating another.');
  return res.json({ record: view(existing), replayed: true });
}
export function operationsRouter({ storage, reader = readBill }) {
  const router = Router(), bills = createImageStorage(path.join(storage.directory, 'private-bills'));
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/contacts', async (req, res) => {
    const type = z.enum(['all', 'customer', 'hotel', 'supplier']).default('all').parse(req.query.type);
    const status = z.enum(['active', 'archived', 'all']).default('active').parse(req.query.status);
    const search = searchText(req.query.search), page = pageSchema.parse(req.query.page), limit = 30;
    const match = { ...(type === 'all' ? {} : { type }), ...(status === 'all' ? {} : { active: status === 'active' }) };
    if (search) match.$or = ['name', 'contactPerson', 'phone', 'email', 'gstNumber'].map(key => ({ [key]: { $regex: escapedRegex(search), $options: 'i' } }));
    const [contacts, total] = await Promise.all([BusinessContact.find(match).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(), BusinessContact.countDocuments(match)]);
    res.json({ contacts, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });
  router.post('/contacts', async (req, res) => {
    const data = createContactSchema.parse(req.body), hash = fingerprint(data);
    const existing = await BusinessContact.findOne({ id: data.id });
    if (existing) {
      if (existing.requestFingerprint !== hash) fail(409, 'This contact request was already saved with different details.');
      return res.json({ contact: existing, replayed: true });
    }
    try { res.status(201).json({ contact: await BusinessContact.create({ ...data, requestFingerprint: hash, createdBy: req.user._id }) }); }
    catch (error) { if (error.code === 11000) fail(409, 'This contact was already saved. Refresh the directory.'); throw error; }
  });
  router.put('/contacts/:id', async (req, res) => {
    const contact = await BusinessContact.findOneAndUpdate({ id: id(req) }, { $set: contactSchema.parse(req.body) }, { new: true, runValidators: true });
    if (!contact) fail(404, 'Contact not found.');
    res.json({ contact });
  });

  router.post('/bills/preview', upload.single('image'), async (req, res) => {
    if (!req.file) fail(400, 'Choose a bill image.');
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    try {
      const result = await reader(req.file.buffer, { signal: controller.signal });
      if (!res.destroyed) res.json({ ...result, imageHash: createHash('sha256').update(req.file.buffer).digest('hex') });
    } finally { res.removeListener('close', cancel); }
  });

  router.get('/records', async (req, res) => {
    const kind = z.enum(['all', 'bill', 'salary', 'rent', 'running']).default('all').parse(req.query.kind);
    const state = z.enum(['all', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled']).default('all').parse(req.query.state);
    const page = pageSchema.parse(req.query.page), limit = 20, search = searchText(req.query.search);
    const match = { status: state === 'cancelled' ? 'cancelled' : 'active' };
    if (kind !== 'all') match.kind = kind === 'running' ? { $in: ['salary', 'rent'] } : kind;
    if (req.query.month) {
      const month = monthSchema.parse(req.query.month);
      match.$and = [{ $or: [
        { kind: 'bill', date: { $gte: `${month}-01`, $lte: `${month}-31` } },
        { kind: { $in: ['salary', 'rent'] }, period: month },
      ] }];
    }
    if (search) match.$or = ['title', 'payeeName', 'billNumber'].map(key => ({ [key]: { $regex: escapedRegex(search), $options: 'i' } }));
    if (state === 'unpaid') match.paidPaise = 0;
    if (state === 'partial') match.$expr = { $and: [{ $gt: ['$paidPaise', 0] }, { $lt: ['$paidPaise', '$totalPaise'] }] };
    if (state === 'paid') match.$expr = { $eq: ['$paidPaise', '$totalPaise'] };
    if (state === 'overdue') { match.dueDate = { $lt: indiaToday() }; match.$expr = { $lt: ['$paidPaise', '$totalPaise'] }; }
    const [records, total, totals] = await Promise.all([
      ExpenseRecord.find(match).sort({ dueDate: 1, createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      ExpenseRecord.countDocuments(match),
      ExpenseRecord.aggregate([{ $match: match }, { $group: { _id: null,
        totalPaise: { $sum: '$totalPaise' }, paidPaise: { $sum: '$paidPaise' },
        outstandingPaise: { $sum: { $subtract: ['$totalPaise', '$paidPaise'] } },
        overduePaise: { $sum: { $cond: [{ $lt: ['$dueDate', indiaToday()] }, { $subtract: ['$totalPaise', '$paidPaise'] }, 0] } },
      } }]),
    ]);
    res.json({ records: records.map(view), total, page, pages: Math.max(1, Math.ceil(total / limit)), summary: totals[0] || {} });
  });
  router.post('/records', upload.single('image'), async (req, res) => {
    let body = req.body;
    if (typeof req.body?.details === 'string') { try { body = JSON.parse(req.body.details); } catch { fail(400, 'Invalid bill details. Review the form and try again.'); } }
    const data = expenseSchema.parse(body), imageHash = req.file ? createHash('sha256').update(req.file.buffer).digest('hex') : '';
    const hash = fingerprint({ ...data, imageHash });
    const existing = await ExpenseRecord.findOne({ id: data.id });
    if (existing) return replay(existing, hash, res);
    if (data.kind === 'bill' && !req.file) fail(400, 'Attach the bill image before saving.');
    if (data.kind !== 'bill' && req.file) fail(400, 'Use Bills & receipts to attach and review a bill image.');
    if (data.contactId && !await BusinessContact.exists({ id: data.contactId, active: true })) fail(400, 'Choose an active contact or enter the payee without linking a contact.');
    let imageName;
    if (req.file) {
      await prepareBillImage(req.file.buffer);
      imageName = `bill-${data.id}-${imageHash.slice(0, 16)}.webp`;
      await bills.writeImage(req.file.buffer, { name: imageName, width: 2400, height: 8000, quality: 92, reuse: true });
    }
    const { total, amountPaid, paymentMethod, reviewed, ...fields } = data;
    const totalPaise = toPaise(total), paidPaise = toPaise(amountPaid);
    const normal = value => value.toLocaleLowerCase('en-IN').replace(/\s+/g, ' ').trim();
    const periodKey = data.kind !== 'bill' ? `${data.kind}:${normal(data.payeeName)}:${data.kind === 'rent' ? normal(data.title) + ':' : ''}${data.period}` : undefined;
    try {
      const record = await ExpenseRecord.create({ ...fields, requestFingerprint: hash, imageName, imageHash: imageHash || undefined,
        totalPaise, paidPaise, periodKey, status: 'active', createdBy: req.user._id,
        payments: paidPaise ? [{ id: data.id, amountPaise: paidPaise, date: data.date, method: paymentMethod, recordedBy: req.user._id }] : [] });
      res.status(201).json({ record: view(record) });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const latest = await ExpenseRecord.findOne({ id: data.id });
      if (latest) return replay(latest, hash, res);
      fail(409, 'A salary or rent record for this payee and month already exists. Open it to record a payment.');
    }
  });
  router.get('/records/:id', async (req, res) => {
    const record = await ExpenseRecord.findOne({ id: id(req) }).lean();
    if (!record) fail(404, 'Record not found.');
    res.json({ record: view(record) });
  });
  router.get('/records/:id/image', async (req, res) => {
    const record = await ExpenseRecord.findOne({ id: id(req) }).select('imageName').lean();
    if (!record?.imageName) fail(404, 'Bill image not found.');
    let file;
    try { file = await bills.existing(record.imageName); }
    catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code) || error.status === 404) fail(404, 'Bill image not found.'); throw error; }
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(file, error => { if (error && !res.headersSent) res.status(error.status === 404 ? 404 : 503).json({ error: 'Bill image is unavailable.' }); });
  });
  router.post('/records/:id/payments', async (req, res) => {
    const recordId = id(req), data = paymentSchema.parse(req.body), amountPaise = toPaise(data.amount);
    const existing = await ExpenseRecord.findOne({ id: recordId }).lean();
    if (!existing) fail(404, 'Record not found.');
    const replayPayment = record => {
      const payment = record.payments.find(item => item.id === data.id);
      if (!payment) return false;
      if (payment.amountPaise !== amountPaise || payment.date !== data.date || payment.method !== data.method || (payment.note || '') !== data.note)
        fail(409, 'This payment request was saved with different details. Check the payment history.');
      res.json({ record: view(record), replayed: true }); return true;
    };
    if (replayPayment(existing)) return;
    if (data.date < existing.date) fail(400, 'Payment date cannot precede the record date.');
    const record = await ExpenseRecord.findOneAndUpdate({ id: recordId, status: 'active', 'payments.id': { $ne: data.id },
      $expr: { $lte: [{ $add: ['$paidPaise', amountPaise] }, '$totalPaise'] } },
    { $inc: { paidPaise: amountPaise }, $push: { payments: { id: data.id, amountPaise, date: data.date, method: data.method, note: data.note, recordedBy: req.user._id } } }, { new: true, runValidators: true });
    if (!record) {
      const latest = await ExpenseRecord.findOne({ id: recordId }).lean();
      if (latest && replayPayment(latest)) return;
      fail(409, 'Payment exceeds the remaining amount or the record is cancelled. Refresh and check the balance.');
    }
    res.status(201).json({ record: view(record) });
  });
  router.post('/records/:id/cancel', async (req, res) => {
    if (req.user.role !== 'owner') fail(403, 'Only the owner can cancel an unpaid record.');
    const reason = z.string().trim().min(3).max(500).parse(req.body.reason);
    const record = await ExpenseRecord.findOneAndUpdate({ id: id(req), status: 'active', paidPaise: 0 },
      { $set: { status: 'cancelled', cancellationReason: reason, cancelledAt: new Date(), cancelledBy: req.user._id }, $unset: { periodKey: 1 } }, { new: true });
    if (!record) fail(409, 'Only an active, fully unpaid record can be cancelled.');
    res.json({ record: view(record) });
  });
  return router;
}
