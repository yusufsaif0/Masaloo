import mongoose from 'mongoose';

mongoose.set('bufferTimeoutMS', 3000);
const { Schema, model } = mongoose;

export const User = model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['owner', 'manager', 'editor', 'customer', 'pending'], default: 'customer' },
}, { timestamps: true }));

export const Product = model('Product', new Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true }, subtitle: String, description: String,
  category: String, price: { type: Number, min: 0, required: true }, weight: String,
  stock: { type: Number, min: 0, default: 0 }, image: String, badge: String,
  featured: { type: Boolean, default: false }, active: { type: Boolean, default: true },
}, { timestamps: true }));

export const Post = model('Post', new Schema({
  id: { type: String, unique: true, required: true }, title: String, excerpt: String,
  category: String, image: String, content: String, published: { type: Boolean, default: false },
}, { timestamps: true }));

export const Message = model('Message', new Schema({
  name: String, email: String, subject: String, message: String,
}, { timestamps: true }));

export const Subscriber = model('Subscriber', new Schema({
  email: { type: String, unique: true, required: true },
}, { timestamps: true }));

export const Setup = model('Setup', new Schema({ id: { type: String, unique: true }, completedAt: Date }));
