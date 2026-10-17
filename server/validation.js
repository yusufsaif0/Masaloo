import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.');
export const registerSchema = z.object({ name: text(80), email: emailSchema, password: password.refine(value => value.length >= 10, 'Use at least 10 characters.') });
export const loginSchema = z.object({ email: emailSchema, password: password.refine(value => value.length > 0, 'Enter your password.') });
export const adminRegisterSchema = registerSchema.extend({ confirmPassword: z.string().max(72) })
  .refine(value => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });
const bool = z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean());
export const imageSchema = z.string().max(250).refine(v => /^\/(images|uploads)\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(v), 'Choose a local product image.');
export const productSchema = z.object({
  name: text(100), subtitle: z.string().trim().max(160).default(''),
  description: text(2000), category: z.enum(['Everyday essentials', 'Signature blends', 'Whole spices']),
  price: z.coerce.number().finite().min(1).max(1000000).multipleOf(0.01),
  weight: text(30), stock: z.coerce.number().int().min(0).max(1000000),
  image: imageSchema, badge: z.string().trim().max(40).default(''),
  featured: bool.default(false), active: bool.default(true),
});
export const postSchema = z.object({
  title: text(160), excerpt: text(300), category: text(50), image: imageSchema,
  content: text(30000), published: bool.default(false),
});
export const contactSchema = z.object({
  name: text(80), email: emailSchema, subject: text(120), message: text(5000),
});
export const canManageProducts = role => ['owner', 'manager'].includes(role);
export const canManagePosts = role => ['owner', 'manager', 'editor'].includes(role);
