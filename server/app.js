import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Product, Post, User, Message, Subscriber, Setup } from './models.js';
import { initialProducts, initialPosts } from '../shared/catalog.js';
import { registerSchema, adminRegisterSchema, loginSchema, productSchema, postSchema, contactSchema, emailSchema } from './validation.js';
import { financeRouter } from './finance-router.js';
import { wholesalePublicRouter, wholesaleAdminRouter } from './wholesale-router.js';
import { readConfig, root } from './config.js';
import { createImageStorage, ImageError } from './image-storage.js';
import { createHealthHandler } from './health.js';
import { limiterIdentity } from './rate-limit.js';

export { root };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const cookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 86400000 });
const localOwnerSetup = req => process.env.NODE_ENV !== 'production'
  && ['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)
  && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

export function createApp({ config = readConfig(), storage = createImageStorage(config.uploadDir), readiness = { ready: true, shuttingDown: false }, connection = mongoose.connection, frontendDir = path.join(root, 'dist') } = {}) {
  const app = express();
  const ready = () => connection.readyState === 1;
  app.disable('x-powered-by');
  // Forwarding headers do not affect request identity or block proxied API requests.
  app.set('trust proxy', false);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], fontSrc: ["'self'", 'data:'], scriptSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null } } }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if ((!readiness.ready || readiness.shuttingDown) && req.path !== '/api/health') return res.status(503).json({ error: 'The application is not ready.' });
    next();
  });
  app.use(['/api/auth', '/api/admin'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const allowed = new Set(config.production ? [config.origin] : [process.env.CLIENT_ORIGIN || config.origin, `http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`]);
      if (req.get('origin') && !allowed.has(req.get('origin'))) return res.status(403).json({ error: 'This request origin is not allowed.' });
    }
    next();
  });
  app.use('/uploads', storage.serve);
  const authLimit = rateLimit({ ...limiterIdentity, windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
  const formLimit = rateLimit({ ...limiterIdentity, windowMs: 15 * 60000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait a little before submitting again.' } });

  const requireDb = (req, res, next) => ready() ? next() : res.status(503).json({ error: 'This feature needs a database connection. Please configure MONGODB_URI in .env and restart the server.' });
  const requireAuth = async (req, res, next) => {
    if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Account access is not configured. Set JWT_SECRET on the server.' });
    try {
      const token = jwt.verify(req.cookies.masaloo_session || '', process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (token.aud !== undefined) throw new Error('This session belongs to a different service.');
      req.user = await User.findById(token.sub);
      if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    } catch { return res.status(401).json({ error: 'Please sign in to continue.' }); }
    next();
  };
  const allow = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Your role does not have access to this action.' });
  const issueSession = (res, user) => {
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: '7d', algorithm: 'HS256' });
    res.cookie('masaloo_session', token, cookieOptions());
  };

  app.get('/api/health', createHealthHandler({ connection, readiness, configured: Boolean(config.mongoUri), production: config.production, timeoutMs: config.healthTimeoutMs }));
  // Only the development catalog fallback needs an additional production guard.
  // Logout stays available during database outages so cookies can still be cleared.
  if (config.production) app.use(['/api/products', '/api/blogs'], requireDb);
  app.use('/api/wholesale', wholesalePublicRouter({ requireDb, authLimit }));
  app.get('/api/products', async (req, res) => res.json({ products: ready() ? await Product.find({ active: true }).sort({ createdAt: 1 }).lean() : initialProducts, sample: !ready() }));
  app.get('/api/blogs', async (req, res) => res.json({ posts: ready() ? await Post.find({ published: true }).sort({ createdAt: -1 }).lean() : initialPosts }));

  app.get('/api/auth/admin-registration', requireDb, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const hasOwner = Boolean(await User.exists({ role: 'owner' }));
    res.json({ firstOwner: !hasOwner, canRegister: hasOwner || localOwnerSetup(req), requiresApproval: hasOwner });
  });
  app.post('/api/auth/admin-register', authLimit, requireDb, async (req, res) => {
    if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Account registration is not configured yet.' });
    const data = adminRegisterSchema.parse(req.body);
    if (await User.exists({ email: data.email })) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    const hasOwner = Boolean(await User.exists({ role: 'owner' }));
    if (!hasOwner && !localOwnerSetup(req)) return res.status(403).json({ error: 'The first owner account must be created on the store’s local computer.' });
    const passwordHash = await bcrypt.hash(data.password, 12);
    let claim;
    if (!hasOwner) {
      try { claim = await Setup.create({ id: 'owner-registration', completedAt: new Date() }); }
      catch (error) {
        if (error.code === 11000) return res.status(409).json({ error: 'Owner setup is already in progress or complete. Try signing in, or refresh to register a team account.' });
        throw error;
      }
    }
    let user;
    try { user = await User.create({ name: data.name, email: data.email, passwordHash, role: hasOwner ? 'pending' : 'owner' }); }
    catch (error) { if (claim) await Setup.deleteOne({ _id: claim._id }); throw error; }
    issueSession(res, user);
    res.status(201).json({ user: publicUser(user), requiresApproval: hasOwner });
  });
  app.post('/api/auth/admin-login', authLimit, requireDb, async (req, res) => {
    if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Admin sign-in is not configured yet.' });
    const data = loginSchema.parse(req.body);
    const user = await User.findOne({ email: data.email }).select('+passwordHash');
    const valid = await bcrypt.compare(data.password, user?.passwordHash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
    if (!user || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' });
    if (user.role === 'customer') return res.status(403).json({ error: 'This is a customer account. Please use the store account page, or ask the owner for team access.' });
    issueSession(res, user);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/register', authLimit, requireDb, async (req, res) => {
    if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Set JWT_SECRET before enabling account creation.' });
    const data = registerSchema.parse(req.body);
    const user = await User.create({ name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 12), role: 'customer' });
    issueSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  });
  app.post('/api/auth/login', authLimit, requireDb, async (req, res) => {
    if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Set JWT_SECRET before enabling sign in.' });
    const data = loginSchema.parse(req.body);
    const user = await User.findOne({ email: data.email }).select('+passwordHash');
    const valid = await bcrypt.compare(data.password, user?.passwordHash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
    if (!user || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' });
    issueSession(res, user);
    res.json({ user: publicUser(user) });
  });
  app.post('/api/auth/logout', (req, res) => { res.clearCookie('masaloo_session', { ...cookieOptions(), maxAge: undefined }); res.json({ ok: true }); });
  app.get('/api/auth/me', requireDb, requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

  app.post('/api/contact', formLimit, requireDb, async (req, res) => {
    await Message.create(contactSchema.parse(req.body));
    res.status(201).json({ message: 'Thank you! Your message has reached our inbox.' });
  });
  app.post('/api/newsletter', formLimit, requireDb, async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    await Subscriber.updateOne({ email }, { $setOnInsert: { email } }, { upsert: true });
    res.json({ message: 'You’re on the list. Thank you for joining our kitchen!' });
  });

  app.use('/api/admin', requireDb, requireAuth, allow('owner', 'manager', 'editor'));
  app.use('/api/admin/finance', allow('owner', 'manager'), financeRouter());
  app.use('/api/admin/wholesale', allow('owner', 'manager'), wholesaleAdminRouter({ storage }));
  app.get('/api/admin/overview', async (req, res) => {
    const [products, posts, messages, subscribers] = await Promise.all([Product.countDocuments(), Post.countDocuments(), Message.countDocuments(), Subscriber.countDocuments()]);
    res.json({ products, posts, messages, subscribers });
  });
  app.get('/api/admin/products', allow('owner', 'manager'), async (req, res) => res.json({ products: await Product.find().sort({ createdAt: -1 }).lean() }));
  app.post('/api/admin/products', allow('owner', 'manager'), async (req, res) => {
    const data = productSchema.parse(req.body);
    const product = await Product.create({ ...data, id: `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}` });
    res.status(201).json({ product });
  });
  app.put('/api/admin/products/:id', allow('owner', 'manager'), async (req, res) => {
    const product = await Product.findOneAndUpdate({ id: req.params.id }, { $set: productSchema.parse(req.body) }, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product });
  });
  app.delete('/api/admin/products/:id', allow('owner', 'manager'), async (req, res) => {
    const product = await Product.findOneAndDelete({ id: req.params.id });
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json({ ok: true });
  });
  app.post('/api/admin/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WebP image up to 5 MB.' });
    res.status(201).json({ image: await storage.writeImage(req.file.buffer) });
  });
  app.get('/api/admin/blogs', async (req, res) => res.json({ posts: await Post.find().sort({ createdAt: -1 }).lean() }));
  app.post('/api/admin/blogs', async (req, res) => {
    const data = postSchema.parse(req.body);
    res.status(201).json({ post: await Post.create({ ...data, id: `${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}` }) });
  });
  app.put('/api/admin/blogs/:id', async (req, res) => {
    const post = await Post.findOneAndUpdate({ id: req.params.id }, { $set: postSchema.parse(req.body) }, { new: true, runValidators: true });
    if (!post) return res.status(404).json({ error: 'Story not found.' });
    res.json({ post });
  });
  app.delete('/api/admin/blogs/:id', async (req, res) => {
    const post = await Post.findOneAndDelete({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Story not found.' });
    res.json({ ok: true });
  });
  app.get('/api/admin/messages', allow('owner', 'manager'), async (req, res) => res.json({ messages: await Message.find().sort({ createdAt: -1 }).limit(200).lean() }));
  app.get('/api/admin/users', allow('owner'), async (req, res) => res.json({ users: (await User.find().sort({ createdAt: -1 })).map(publicUser) }));
  app.patch('/api/admin/users/:id/role', allow('owner'), async (req, res) => {
    const role = z.enum(['manager', 'editor', 'customer']).parse(req.body.role);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid account.' });
    const user = await User.findOneAndUpdate({ _id: req.params.id, role: { $ne: 'owner' } }, { $set: { role } }, { new: true });
    if (!user) return res.status(400).json({ error: 'Owner accounts cannot be changed here.' });
    res.json({ user: publicUser(user) });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  if (existsSync(path.join(frontendDir, 'index.html'))) {
    app.use(express.static(frontendDir));
    app.use(['/images', '/fonts', '/assets'], (req, res) => res.status(404).json({ error: 'Asset not found.' }));
    app.get('/{*splat}', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
  }
  app.use((err, req, res, next) => {
    if (err instanceof ImageError) return res.status(err.status).json({ error: err.message });
    if (err.name === 'Error' && err.status >= 400 && err.status < 600) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.') || 'Value'}: ${i.message}`).join(' ') });
    if (err.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Upload one image up to 5 MB.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request data.' });
    console.error('Request failed:', err.name);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
