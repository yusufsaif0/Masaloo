import { z } from 'zod';
import { indiaToday, paymentMethods } from '../shared/sales.js';
import { emailSchema } from './validation.js';

export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '2000-01-01';
}, 'Choose a valid date from 2000 onward.');
const pastDay = daySchema.refine(value => value <= indiaToday(), 'Future-dated sales and payments are not allowed.');
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(value => value >= '2000-01' && value <= '2099-12', 'Choose a valid month.');
const amount = z.coerce.number().finite().min(0).max(1000000000).multipleOf(0.01);
const optionalText = max => z.string().trim().max(max).default('');
export const customerSchema = z.object({
  name: z.string().trim().min(1).max(100), phone: optionalText(25).refine(value => !value || /^[+\d ()-]{7,25}$/.test(value), 'Enter a valid phone number.'),
  email: z.union([emailSchema, z.literal('')]).default(''), address: optionalText(400), notes: optionalText(1500),
});
export const createCustomerSchema = customerSchema.extend({ id: z.uuid() });
export const saleSchema = z.object({
  id: z.uuid(), date: pastDay, channel: z.enum(['online', 'shop']), customerId: z.uuid().optional(),
  customerName: optionalText(100), externalReference: optionalText(100), notes: optionalText(2000),
  items: z.array(z.object({ productId: z.string().min(1).max(200), quantity: z.coerce.number().int().min(1).max(10000), unitPrice: amount.refine(value => value > 0, 'Price must be greater than zero.') })).min(1).max(50),
  amountPaid: amount.default(0), paymentMethod: z.enum(paymentMethods).default('cash'), dueDate: daySchema.optional(),
}).refine(value => !value.dueDate || value.dueDate >= value.date, { path: ['dueDate'], message: 'Due date must be on or after the sale date.' })
  .refine(value => new Set(value.items.map(item => item.productId)).size === value.items.length, { path: ['items'], message: 'Each product should appear once. Increase its quantity instead.' });
export const paymentSchema = z.object({ id: z.uuid(), date: pastDay, amount: amount.refine(value => value > 0, 'Enter a payment greater than zero.'), method: z.enum(paymentMethods), note: optionalText(500) });
export const openingSchema = z.object({ id: z.uuid(), date: pastDay, amount: amount.refine(value => value > 0, 'Enter a balance greater than zero.'), dueDate: daySchema.optional(), notes: optionalText(1500) })
  .refine(value => !value.dueDate || value.dueDate >= value.date, { path: ['dueDate'], message: 'Due date must be on or after the balance date.' });
export const rangeSchema = z.object({
  from: daySchema, to: daySchema, channel: z.enum(['all', 'online', 'shop']).default('all'),
}).refine(value => value.from <= value.to, 'Start date must be before the end date.')
  .refine(value => new Date(value.to) - new Date(value.from) <= 366 * 86400000, 'Select a date range of at most one year.');
export const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
