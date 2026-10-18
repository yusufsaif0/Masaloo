import { z } from 'zod';
import { daySchema, monthSchema, paymentSchema } from './finance-validation.js';
import { indiaToday, paymentMethods } from '../shared/sales.js';
export { paymentSchema };
const text = max => z.string().trim().max(max).default('');
const amount = z.coerce.number().finite().min(0).max(1000000000).multipleOf(0.01);
export const contactSchema = z.object({
  type: z.enum(['customer', 'hotel', 'supplier']), name: z.string().trim().min(1).max(150),
  contactPerson: text(100), phone: text(25).refine(v => !v || /^[+\d ()-]{7,25}$/.test(v), 'Enter a valid phone number.'),
  email: z.union([z.email(), z.literal('')]).default(''), address: text(500), gstNumber: text(30), notes: text(1500), active: z.boolean().default(true),
});
export const createContactSchema = contactSchema.extend({ id: z.uuid() });
export const expenseSchema = z.object({
  id: z.uuid(), kind: z.enum(['bill', 'salary', 'rent']), title: z.string().trim().min(1).max(150),
  payeeName: z.string().trim().min(1).max(150), contactId: z.uuid().optional(), billNumber: text(100),
  period: monthSchema.optional(), date: daySchema.refine(v => v <= indiaToday(), 'Record date cannot be in the future.'), dueDate: daySchema,
  total: amount.refine(v => v > 0, 'Enter a total greater than zero.'), amountPaid: amount.default(0),
  paymentMethod: z.enum(paymentMethods).default('cash'), notes: text(2000),
  ocrText: text(20000), ocrConfidence: z.number().min(0).max(100).optional(), reviewed: z.literal(true),
}).refine(v => v.amountPaid <= v.total, { path: ['amountPaid'], message: 'Payment cannot exceed the total.' })
  .refine(v => v.dueDate >= v.date, { path: ['dueDate'], message: 'Due date cannot precede the record date.' })
  .refine(v => v.kind === 'bill' || Boolean(v.period), { path: ['period'], message: 'Choose the salary or rent month.' });
