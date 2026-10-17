import { Router } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { Product } from './models.js';
import { LedgerCustomer, Sale } from './finance-models.js';
import { createCustomerSchema, customerSchema, saleSchema, paymentSchema, openingSchema, rangeSchema, pageSchema, monthSchema } from './finance-validation.js';
import { indiaToday, monthBounds, toPaise } from '../shared/sales.js';
import { billMatch, channelFilter, customerBalancePipeline, emptyTotals, escapedRegex, saleGroup, totalsForRange } from './finance-reports.js';

class FinanceError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new FinanceError(status, message); };
const readId = req => z.uuid().parse(req.params.id);
const textQuery = value => z.string().trim().max(100).default('').parse(value);
const range = query => rangeSchema.parse({ from: query.from || indiaToday(), to: query.to || query.from || indiaToday(), channel: query.channel || 'all' });
const reference = (id, day, prefix = 'MS') => `${prefix}-${day.replaceAll('-', '')}-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
const initialPayment = (data, userId) => toPaise(data.amountPaid) ? [{ id: data.id, amountPaise: toPaise(data.amountPaid), date: data.date, method: data.paymentMethod, kind: 'initial', recordedBy: userId }] : [];
const saleView = value => { const item = value.toObject ? value.toObject() : value; return { ...item, outstandingPaise: item.totalPaise - item.paidPaise }; };
const fingerprint = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
function replaySale(existing, expected, res) {
  if (existing.requestFingerprint !== expected) fail(409, 'This save request was already used for different details. Refresh the register to check the saved record before creating another.');
  return res.json({ sale: saleView(existing), replayed: true });
}
function replayPayment(existing, data, res) {
  const recorded = existing.payments.find(payment => payment.id === data.id);
  if (!recorded) return null;
  if (recorded.kind !== 'repayment' || recorded.amountPaise !== toPaise(data.amount) || recorded.date !== data.date || recorded.method !== data.method || (recorded.note || '') !== data.note) fail(409, 'This payment request was already saved with different details. Refresh the payment history before recording another.');
  return res.json({ sale: saleView(existing), replayed: true });
}

async function saveSale(data, res) {
  try { return res.status(201).json({ sale: saleView(await Sale.create(data)) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await Sale.findOne({ id: data.id }).lean();
    if (existing) return replaySale(existing, data.requestFingerprint, res);
    fail(409, 'A record with this channel and order reference already exists.');
  }
}

export function financeRouter() {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/options', async (req, res) => {
    const [products, customers] = await Promise.all([
      Product.find().sort({ name: 1 }).select('id name price weight active').lean(),
      LedgerCustomer.find().sort({ name: 1 }).select('id name phone').lean(),
    ]);
    res.json({ products, customers });
  });
  router.get('/sales', async (req, res) => {
    const { from, to, channel } = range(req.query);
    const page = pageSchema.parse(req.query.page), limit = 20;
    const payment = z.enum(['all', 'paid', 'partial', 'unpaid', 'cancelled']).default('all').parse(req.query.payment);
    const search = textQuery(req.query.search);
    const match = { kind: 'sale', date: { $gte: from, $lte: to }, ...channelFilter(channel) };
    if (payment !== 'cancelled') match.status = 'completed'; else match.status = 'cancelled';
    if (payment === 'paid') match.$expr = { $eq: ['$paidPaise', '$totalPaise'] };
    if (payment === 'partial') match.$expr = { $and: [{ $gt: ['$paidPaise', 0] }, { $lt: ['$paidPaise', '$totalPaise'] }] };
    if (payment === 'unpaid') match.paidPaise = 0;
    if (search) match.$or = ['reference', 'customerName', 'customerPhone', 'externalReference', 'items.name'].map(key => ({ [key]: { $regex: escapedRegex(search), $options: 'i' } }));
    const [sales, total, summary] = await Promise.all([
      Sale.find(match).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Sale.countDocuments(match), totalsForRange(from, to, channel),
    ]);
    res.json({ sales: sales.map(saleView), total, page, pages: Math.max(1, Math.ceil(total / limit)), summary, from, to });
  });
  router.post('/sales', async (req, res) => {
    const data = saleSchema.parse(req.body);
    const requestFingerprint = fingerprint({ kind: 'sale', ...data });
    const existing = await Sale.findOne({ id: data.id }).lean();
    if (existing) return replaySale(existing, requestFingerprint, res);
    const products = await Product.find({ id: { $in: data.items.map(item => item.productId) } }).lean();
    if (products.length !== data.items.length) fail(400, 'One of these products is no longer available. Reload the product list.');
    const items = data.items.map(line => {
      const product = products.find(p => p.id === line.productId);
      const unitPricePaise = toPaise(line.unitPrice);
      return { productId: product.id, name: product.name, weight: product.weight, quantity: line.quantity, unitPricePaise, totalPaise: unitPricePaise * line.quantity };
    });
    const totalPaise = items.reduce((sum, item) => sum + item.totalPaise, 0), paidPaise = toPaise(data.amountPaid);
    if (!Number.isSafeInteger(totalPaise) || totalPaise > 1000000000000) fail(400, 'This sale exceeds the supported total.');
    if (paidPaise > totalPaise) fail(400, 'Payment cannot exceed the sale total.');
    if (paidPaise < totalPaise && !data.customerId) fail(400, 'Select a saved customer to record udhari.');
    const customer = data.customerId ? await LedgerCustomer.findOne({ id: data.customerId }).lean() : null;
    if (data.customerId && !customer) fail(404, 'Customer not found.');
    return saveSale({
      id: data.id, requestFingerprint, reference: reference(data.id, data.date), kind: 'sale', date: data.date, channel: data.channel,
      customerId: customer?.id, customerName: customer?.name || data.customerName || 'Walk-in customer', customerPhone: customer?.phone || '',
      externalReference: data.externalReference || undefined, items, totalPaise, paidPaise,
      dueDate: paidPaise < totalPaise ? data.dueDate : undefined, notes: data.notes,
      payments: initialPayment(data, req.user._id), createdBy: req.user._id,
    }, res);
  });
  router.get('/sales/:id', async (req, res) => {
    const sale = await Sale.findOne({ id: readId(req) }).lean();
    if (!sale) fail(404, 'Sale not found.');
    res.json({ sale: saleView(sale) });
  });
  router.post('/sales/:id/payments', async (req, res) => {
    const id = readId(req), data = paymentSchema.parse(req.body), amountPaise = toPaise(data.amount);
    const existing = await Sale.findOne({ id }).lean();
    if (!existing) fail(404, 'Sale not found.');
    if (existing.payments.some(payment => payment.id === data.id)) return replayPayment(existing, data, res);
    if (data.date < existing.date) fail(400, 'Payment date cannot be before the original sale or opening balance.');
    const sale = await Sale.findOneAndUpdate({
      id, status: 'completed', 'payments.id': { $ne: data.id },
      $expr: { $lte: [{ $add: ['$paidPaise', amountPaise] }, '$totalPaise'] },
    }, { $inc: { paidPaise: amountPaise }, $push: { payments: { id: data.id, amountPaise, date: data.date, method: data.method, kind: 'repayment', note: data.note, recordedBy: req.user._id, recordedAt: new Date() } } }, { new: true, runValidators: true });
    if (!sale) {
      const latest = await Sale.findOne({ id }).lean();
      if (latest.payments.some(payment => payment.id === data.id)) return replayPayment(latest, data, res);
      fail(409, 'Payment exceeds the remaining balance, or this record is cancelled. Refresh the ledger and check the amount.');
    }
    res.status(201).json({ sale: saleView(sale) });
  });
  router.post('/sales/:id/cancel', async (req, res) => {
    if (req.user.role !== 'owner') fail(403, 'Only the owner can cancel a record.');
    const reason = z.string().trim().min(3).max(500).parse(req.body.reason);
    const sale = await Sale.findOneAndUpdate({ id: readId(req), paidPaise: 0, status: 'completed' }, { $set: { status: 'cancelled', cancelledBy: req.user._id, cancelledAt: new Date(), cancellationReason: reason } }, { new: true });
    if (!sale) fail(409, 'Only an unpaid, active record can be cancelled. Paid records stay in the ledger.');
    res.json({ sale: saleView(sale) });
  });

  router.get('/customers', async (req, res) => {
    const search = textQuery(req.query.search), page = pageSchema.parse(req.query.page), limit = 20;
    const status = z.enum(['all', 'due', 'overdue', 'settled']).default('all').parse(req.query.status);
    const match = search ? { $or: ['name', 'phone', 'email'].map(key => ({ [key]: { $regex: escapedRegex(search), $options: 'i' } })) } : {};
    const pipeline = [{ $match: match }, ...customerBalancePipeline()];
    if (status === 'due') pipeline.push({ $match: { outstandingPaise: { $gt: 0 } } });
    if (status === 'overdue') pipeline.push({ $match: { overduePaise: { $gt: 0 } } });
    if (status === 'settled') pipeline.push({ $match: { outstandingPaise: 0 } });
    const [result] = await LedgerCustomer.aggregate([...pipeline, { $facet: {
      customers: [{ $sort: { outstandingPaise: -1, name: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
      summary: [{ $group: { _id: null, customers: { $sum: 1 }, outstandingPaise: { $sum: '$outstandingPaise' }, overduePaise: { $sum: '$overduePaise' }, withDue: { $sum: { $cond: [{ $gt: ['$outstandingPaise', 0] }, 1, 0] } } } }],
    } }]);
    const summary = result.summary[0] || { customers: 0, outstandingPaise: 0, overduePaise: 0, withDue: 0 };
    res.json({ customers: result.customers, summary, page, total: summary.customers, pages: Math.max(1, Math.ceil(summary.customers / limit)) });
  });
  router.post('/customers', async (req, res) => {
    const data = createCustomerSchema.parse(req.body);
    const customer = await LedgerCustomer.findOneAndUpdate({ id: data.id }, { $setOnInsert: { ...data, createdBy: req.user._id } }, { upsert: true, new: true, runValidators: true });
    res.status(201).json({ customer });
  });
  router.put('/customers/:id', async (req, res) => {
    const customer = await LedgerCustomer.findOneAndUpdate({ id: readId(req) }, { $set: customerSchema.parse(req.body) }, { new: true, runValidators: true });
    if (!customer) fail(404, 'Customer not found.');
    res.json({ customer });
  });
  router.get('/customers/:id', async (req, res) => {
    const id = readId(req), page = pageSchema.parse(req.query.page), limit = 15;
    const [customers, sales, total] = await Promise.all([
      LedgerCustomer.aggregate([{ $match: { id } }, ...customerBalancePipeline()]),
      Sale.find({ customerId: id }).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Sale.countDocuments({ customerId: id }),
    ]);
    if (!customers[0]) fail(404, 'Customer not found.');
    res.json({ customer: customers[0], sales: sales.map(saleView), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });
  router.post('/customers/:id/opening-balance', async (req, res) => {
    const customer = await LedgerCustomer.findOne({ id: readId(req) }).lean();
    if (!customer) fail(404, 'Customer not found.');
    const data = openingSchema.parse(req.body);
    const requestFingerprint = fingerprint({ kind: 'opening_balance', customerId: customer.id, ...data });
    const existing = await Sale.findOne({ id: data.id }).lean();
    if (existing) return replaySale(existing, requestFingerprint, res);
    return saveSale({ id: data.id, requestFingerprint, reference: reference(data.id, data.date, 'OB'), kind: 'opening_balance', channel: 'shop', date: data.date, customerId: customer.id, customerName: customer.name, customerPhone: customer.phone, items: [], totalPaise: toPaise(data.amount), paidPaise: 0, dueDate: data.dueDate, notes: data.notes, payments: [], createdBy: req.user._id }, res);
  });

  router.get('/reports/monthly', async (req, res) => {
    const month = monthSchema.parse(req.query.month || indiaToday().slice(0, 7));
    const channel = z.enum(['all', 'online', 'shop']).default('all').parse(req.query.channel);
    const year = month.slice(0, 4), from = `${year}-01-01`, to = `${year}-12-31`;
    const [sales, receipts] = await Promise.all([
      Sale.aggregate([{ $match: billMatch(from, to, channel) }, { $group: { _id: '$date', ...saleGroup } }]),
      Sale.aggregate([{ $match: { status: 'completed', ...channelFilter(channel), 'payments.date': { $gte: from, $lte: to } } }, { $unwind: '$payments' }, { $match: { 'payments.date': { $gte: from, $lte: to } } }, { $group: { _id: '$payments.date', collectedPaise: { $sum: '$payments.amountPaise' } } }]),
    ]);
    const dailyMap = new Map();
    for (const row of [...sales, ...receipts]) { const { _id, ...values } = row; dailyMap.set(_id, { ...emptyTotals, ...dailyMap.get(_id), ...values }); }
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`, row = { month: key, ...emptyTotals };
      for (const [day, totals] of dailyMap) if (day.startsWith(key)) for (const field of Object.keys(emptyTotals)) row[field] += totals[field];
      return row;
    });
    const bounds = monthBounds(month), days = Number(bounds.to.slice(-2));
    const daily = Array.from({ length: days }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`; return { date, ...emptyTotals, ...dailyMap.get(date) }; });
    res.json({ month, channel, summary: monthly.find(row => row.month === month), monthly, daily });
  });
  router.get('/reports/top-products', async (req, res) => {
    const bounds = monthBounds(indiaToday().slice(0, 7));
    const { from, to, channel } = range({ from: req.query.from || bounds.from, to: req.query.to || bounds.to, channel: req.query.channel });
    const sort = z.enum(['revenue', 'quantity']).default('revenue').parse(req.query.sort);
    const products = await Sale.aggregate([
      { $match: billMatch(from, to, channel) }, { $sort: { date: 1, createdAt: 1 } }, { $unwind: '$items' },
      { $group: { _id: '$items.productId', name: { $last: '$items.name' }, weight: { $last: '$items.weight' }, quantity: { $sum: '$items.quantity' }, totalPaise: { $sum: '$items.totalPaise' },
        onlineQuantity: { $sum: { $cond: [{ $eq: ['$channel', 'online'] }, '$items.quantity', 0] } }, shopQuantity: { $sum: { $cond: [{ $eq: ['$channel', 'shop'] }, '$items.quantity', 0] } },
        onlinePaise: { $sum: { $cond: [{ $eq: ['$channel', 'online'] }, '$items.totalPaise', 0] } }, shopPaise: { $sum: { $cond: [{ $eq: ['$channel', 'shop'] }, '$items.totalPaise', 0] } }, sales: { $addToSet: '$id' },
      } }, { $set: { productId: '$_id', saleCount: { $size: '$sales' } } }, { $unset: ['_id', 'sales'] },
      { $sort: sort === 'quantity' ? { quantity: -1, totalPaise: -1, name: 1 } : { totalPaise: -1, quantity: -1, name: 1 } }, { $limit: 50 },
    ]);
    res.json({ products, summary: await totalsForRange(from, to, channel), from, to, sort });
  });
  return router;
}
