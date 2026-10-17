import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WholesaleBuyer, WholesaleProduct, WholesaleEnquiry } from './wholesale-models.js';
import { wholesaleRegisterSchema, wholesaleLoginSchema, wholesaleProductSchema, wholesaleEnquirySchema } from './wholesale-validation.js';
import { refreshWholesaleSource, sourceCategoryUrl } from './wholesale-import.js';
import { escapedRegex } from './finance-reports.js';
import { indiaToday, toPaise } from '../shared/sales.js';
import { limiterIdentity } from './rate-limit.js';

const publicBuyer = buyer => ({ id: buyer.id || String(buyer._id), username: buyer.username, active: buyer.active, createdAt: buyer.createdAt });
const cookies = () => ({ httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 86400000 });
const cookieName = 'masaloo_wholesale_session';
const audience = 'masaloo-wholesale';
const project = { id: 1, name: 1, description: 1, category: 1, image: 1, unitPricePaise: 1, minOrderKg: 1, stockKg: 1, _id: 0 };
const readId = req => z.string().regex(/^[a-z0-9-]{3,100}$/).parse(req.params.id);
const pageNumber = query => z.coerce.number().int().min(1).max(100000).default(1).parse(query.page);
const term = value => z.string().trim().max(100).default('').parse(value);
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function issueSession(res, buyer) {
  const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(buyer._id), audience, issuer: audience, expiresIn: '7d', algorithm: 'HS256' });
  res.cookie(cookieName, token, cookies());
}
async function wholesaleAuth(req, res, next) {
  if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Wholesale access is not configured yet.' });
  let payload;
  try { payload = jwt.verify(req.cookies[cookieName] || '', process.env.JWT_SECRET, { audience, issuer: audience, algorithms: ['HS256'] }); }
  catch { return res.status(401).json({ error: 'Please log in to the wholesale store.' }); }
  if (!mongoose.isValidObjectId(payload.sub)) return res.status(401).json({ error: 'Please log in to the wholesale store.' });
  const buyer = await WholesaleBuyer.findById(payload.sub);
  if (!buyer) return res.status(401).json({ error: 'Please log in to the wholesale store.' });
  if (!buyer.active) { res.clearCookie(cookieName, { ...cookies(), maxAge: undefined }); return res.status(403).json({ error: 'Your wholesale account is disabled. Please contact the store team.' }); }
  req.wholesaleBuyer = buyer; next();
}
const productUpdate = data => ({ name: data.name, category: data.category, description: data.description, image: data.image, unitPricePaise: data.pricePerKg === null ? null : toPaise(data.pricePerKg), minOrderKg: data.minOrderKg, stockKg: data.stockKg, active: data.active });

export function wholesalePublicRouter({ requireDb, authLimit }) {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/auth/logout', (req, res) => { res.clearCookie(cookieName, { ...cookies(), maxAge: undefined }); res.json({ ok: true }); });
  router.use(requireDb);
  router.post('/auth/register', authLimit, async (req, res) => {
    if (!process.env.JWT_SECRET) fail(503, 'Wholesale registration is not configured yet.');
    const data = wholesaleRegisterSchema.parse(req.body);
    if (await WholesaleBuyer.exists({ username: data.username })) fail(409, 'This username is already taken. Try another username or log in.');
    let buyer;
    try { buyer = await WholesaleBuyer.create({ username: data.username, passwordHash: await bcrypt.hash(data.password, 12), active: true }); }
    catch (error) { if (error.code === 11000) fail(409, 'This username is already taken. Try another username or log in.'); throw error; }
    // Registration deliberately does not create a session: the next step is login.
    res.status(201).json({ username: buyer.username, message: 'Account created. Please log in to see wholesale prices.' });
  });
  router.post('/auth/login', authLimit, async (req, res) => {
    if (!process.env.JWT_SECRET) fail(503, 'Wholesale login is not configured yet.');
    const data = wholesaleLoginSchema.parse(req.body);
    const buyer = await WholesaleBuyer.findOne({ username: data.username }).select('+passwordHash');
    const valid = await bcrypt.compare(data.password, buyer?.passwordHash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
    if (!buyer || !valid) fail(401, 'Username or password is incorrect.');
    if (!buyer.active) fail(403, 'Your wholesale account is disabled. Please contact the store team.');
    issueSession(res, buyer); res.json({ buyer: publicBuyer(buyer) });
  });
  router.use(wholesaleAuth);
  router.get('/auth/me', (req, res) => res.json({ buyer: publicBuyer(req.wholesaleBuyer) }));
  router.get('/products', async (req, res) => {
    const search = term(req.query.search), category = term(req.query.category);
    const match = { active: true };
    if (search) match.$or = ['name', 'description'].map(key => ({ [key]: { $regex: escapedRegex(search), $options: 'i' } }));
    if (category && category !== 'All spices') match.category = category;
    const products = await WholesaleProduct.find(match).sort({ name: 1 }).select(project).lean();
    res.json({ products });
  });
  router.get('/products/:id', async (req, res) => {
    const product = await WholesaleProduct.findOne({ id: readId(req), active: true }).select(project).lean();
    if (!product) fail(404, 'This wholesale spice is not available.');
    res.json({ product });
  });
  router.post('/enquiries', async (req, res) => {
    const data = wholesaleEnquirySchema.parse(req.body);
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const replay = existing => {
      if (String(existing.buyerId) !== String(req.wholesaleBuyer._id) || existing.requestFingerprint !== fingerprint) fail(409, 'This request was already used for different enquiry details. Check your enquiries before submitting another.');
      const { internalNotes, updatedBy, requestFingerprint, ...enquiry } = existing;
      return res.json({ enquiry, replayed: true });
    };
    const existing = await WholesaleEnquiry.findOne({ id: data.id }).lean();
    if (existing) return replay(existing);
    const products = await WholesaleProduct.find({ id: { $in: data.items.map(i => i.productId) }, active: true }).lean();
    if (products.length !== data.items.length) fail(400, 'A product is hidden or unavailable. Update your bulk bag and try again.');
    const items = data.items.map(item => {
      const product = products.find(p => p.id === item.productId);
      if (item.quantityKg < product.minOrderKg) fail(400, `${product.name} has a minimum quantity of ${product.minOrderKg} kg.`);
      if (product.stockKg !== null && item.quantityKg > product.stockKg) fail(400, `${product.name} has only ${product.stockKg} kg available. Please adjust the quantity.`);
      return { productId: product.id, name: product.name, quantityKg: item.quantityKg, unitPricePaise: product.unitPricePaise, totalPaise: product.unitPricePaise === null ? null : product.unitPricePaise * item.quantityKg };
    });
    const pricedSubtotalPaise = items.reduce((sum, item) => sum + (item.totalPaise || 0), 0), hasUnpricedItems = items.some(item => item.unitPricePaise === null);
    if (!Number.isSafeInteger(pricedSubtotalPaise)) fail(400, 'This quantity exceeds the supported total. Contact the team directly.');
    let enquiry;
    try { enquiry = await WholesaleEnquiry.create({ ...data, items, buyerId: req.wholesaleBuyer._id, username: req.wholesaleBuyer.username, requestFingerprint: fingerprint, reference: `WQ-${indiaToday().replaceAll('-', '')}-${data.id.replaceAll('-', '').slice(0, 12).toUpperCase()}`, pricedSubtotalPaise, hasUnpricedItems, totalPaise: hasUnpricedItems ? null : pricedSubtotalPaise }); }
    catch (error) { if (error.code === 11000) { const saved = await WholesaleEnquiry.findOne({ id: data.id }).lean(); if (saved) return replay(saved); } throw error; }
    const { internalNotes, updatedBy, requestFingerprint, ...publicEnquiry } = enquiry.toObject();
    res.status(201).json({ enquiry: publicEnquiry });
  });
  router.get('/enquiries', async (req, res) => {
    const page = pageNumber(req.query), match = { buyerId: req.wholesaleBuyer._id }, limit = 15;
    const [enquiries, total] = await Promise.all([WholesaleEnquiry.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-internalNotes -updatedBy -requestFingerprint').lean(), WholesaleEnquiry.countDocuments(match)]);
    res.json({ enquiries, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });
  return router;
}

export function wholesaleAdminRouter({ storage } = {}) {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const importLimit = rateLimit({ ...limiterIdentity, windowMs: 60 * 60000, limit: 4, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'The source import has already been run several times. Please try again in an hour.' } });
  router.get('/summary', async (req, res) => {
    const [products, unpriced, buyers, enquiries] = await Promise.all([WholesaleProduct.countDocuments(), WholesaleProduct.countDocuments({ unitPricePaise: null }), WholesaleBuyer.countDocuments(), WholesaleEnquiry.countDocuments({ status: 'new' })]);
    res.json({ products, unpriced, buyers, enquiries, sourceUrl: sourceCategoryUrl });
  });
  router.get('/products', async (req, res) => res.json({ products: await WholesaleProduct.find().sort({ name: 1 }).lean() }));
  router.post('/products', async (req, res) => {
    const data = wholesaleProductSchema.parse(req.body);
    res.status(201).json({ product: await WholesaleProduct.create({ id: `ws-${randomUUID()}`, ...productUpdate(data) }) });
  });
  router.put('/products/:id', async (req, res) => {
    const data = wholesaleProductSchema.parse(req.body);
    const product = await WholesaleProduct.findOneAndUpdate({ id: readId(req) }, { $set: productUpdate(data) }, { new: true, runValidators: true });
    if (!product) fail(404, 'Wholesale product not found.');
    res.json({ product });
  });
  router.delete('/products/:id', async (req, res) => {
    const product = await WholesaleProduct.findOneAndDelete({ id: readId(req) });
    if (!product) fail(404, 'Wholesale product not found.');
    res.json({ ok: true });
  });
  router.post('/import', importLimit, async (req, res) => {
    try { res.json(await refreshWholesaleSource(storage)); }
    catch (error) { fail(502, `Source import failed: ${error.message}`); }
  });
  router.get('/buyers', async (req, res) => {
    const page = pageNumber(req.query), search = term(req.query.search), limit = 20;
    const match = search ? { username: { $regex: escapedRegex(search), $options: 'i' } } : {};
    const [buyers, total] = await Promise.all([WholesaleBuyer.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), WholesaleBuyer.countDocuments(match)]);
    res.json({ buyers: buyers.map(publicBuyer), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });
  router.patch('/buyers/:id', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) fail(400, 'Invalid buyer account.');
    const data = z.object({ active: z.boolean() }).parse(req.body);
    const buyer = await WholesaleBuyer.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
    if (!buyer) fail(404, 'Buyer not found.');
    res.json({ buyer: publicBuyer(buyer) });
  });
  router.get('/enquiries', async (req, res) => {
    const page = pageNumber(req.query), status = z.enum(['all', 'new', 'contacted', 'quoted', 'closed']).default('all').parse(req.query.status), search = term(req.query.search), limit = 20;
    const match = status === 'all' ? {} : { status };
    if (search) match.$or = ['reference', 'username', 'contactName', 'phone', 'business'].map(key => ({ [key]: { $regex: escapedRegex(search), $options: 'i' } }));
    const [enquiries, total] = await Promise.all([WholesaleEnquiry.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), WholesaleEnquiry.countDocuments(match)]);
    res.json({ enquiries, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });
  router.patch('/enquiries/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const data = z.object({ status: z.enum(['new', 'contacted', 'quoted', 'closed']), internalNotes: z.string().trim().max(3000).default(''), buyerMessage: z.string().trim().max(2000).default(''), quotedTotal: z.preprocess(v => v === '' || v === undefined || v === null ? null : v, z.coerce.number().positive().max(1000000000).multipleOf(0.01).nullable()) }).parse(req.body);
    const { quotedTotal, ...fields } = data;
    const enquiry = await WholesaleEnquiry.findOneAndUpdate({ id }, { $set: { ...fields, quotedTotalPaise: quotedTotal === null ? null : toPaise(quotedTotal), updatedBy: req.user._id } }, { new: true, runValidators: true });
    if (!enquiry) fail(404, 'Enquiry not found.');
    res.json({ enquiry });
  });
  return router;
}
