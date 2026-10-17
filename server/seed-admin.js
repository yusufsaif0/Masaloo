import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from './models.js';
import { registerSchema } from './validation.js';

try {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in .env first.');
  const data = registerSchema.parse({ name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await User.init();
  if (await User.findOne({ email: data.email })) throw new Error('This email is already registered. Use a new owner email; existing accounts are never promoted by this script.');
  await User.create({ name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 12), role: 'owner' });
  console.log('Owner created. Sign in at /account and open /admin. Remove ADMIN_PASSWORD from .env after setup.');
} catch (error) {
  console.error(error.name === 'ZodError' ? 'Provide ADMIN_NAME, a valid ADMIN_EMAIL, and ADMIN_PASSWORD (10–72 characters) in .env.' : error.message);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
