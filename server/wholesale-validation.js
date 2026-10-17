import { z } from 'zod';
import { registerSchema, loginSchema, imageSchema } from './validation.js';

export const usernameSchema = z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use letters, numbers, dots, underscores, or hyphens.');
export const wholesaleRegisterSchema = z.object({ username: usernameSchema, password: registerSchema.shape.password });
export const wholesaleLoginSchema = z.object({ username: usernameSchema, password: loginSchema.shape.password });
const optionalPrice = z.preprocess(v => v === '' || v === undefined || v === null ? null : v, z.coerce.number().finite().positive().max(1000000).multipleOf(0.01).nullable());
const optionalStock = z.preprocess(v => v === '' || v === undefined || v === null ? null : v, z.coerce.number().int().min(0).max(1000000).nullable());
export const wholesaleProductSchema = z.object({
  name: z.string().trim().min(1).max(120), category: z.enum(['Whole spices', 'Seeds', 'Dried herbs & roots']),
  description: z.string().trim().min(1).max(2500), image: imageSchema,
  pricePerKg: optionalPrice, minOrderKg: z.coerce.number().int().min(1).max(100000), stockKg: optionalStock,
  active: z.boolean().default(true),
});
export const wholesaleEnquirySchema = z.object({
  id: z.uuid(), contactName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(25).regex(/^[+\d ()-]+$/, 'Enter a valid contact phone number.'),
  business: z.string().trim().max(150).default(''), city: z.string().trim().max(100).default(''), notes: z.string().trim().max(2000).default(''),
  items: z.array(z.object({ productId: z.string().regex(/^[a-z0-9-]{3,100}$/), quantityKg: z.coerce.number().int().min(1).max(100000) })).min(1).max(50),
}).refine(value => new Set(value.items.map(i => i.productId)).size === value.items.length, { path: ['items'], message: 'Each spice should appear once. Increase its quantity instead.' });
