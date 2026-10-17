import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const integer = { type: Number, min: 0, validate: Number.isSafeInteger, required: true };

export const LedgerCustomer = model('LedgerCustomer', new Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true }, phone: { type: String, default: '' },
  email: { type: String, default: '' }, address: { type: String, default: '' }, notes: { type: String, default: '' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }));

const lineSchema = new Schema({
  productId: { type: String, required: true }, name: { type: String, required: true }, weight: String,
  quantity: { ...integer, min: 1 }, unitPricePaise: integer, totalPaise: integer,
}, { _id: false });
const paymentSchema = new Schema({
  id: { type: String, required: true }, amountPaise: { ...integer, min: 1 },
  date: { type: String, required: true }, method: { type: String, enum: ['cash', 'upi', 'bank', 'card', 'other'] },
  kind: { type: String, enum: ['initial', 'repayment'], required: true }, note: String,
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' }, recordedAt: { type: Date, default: Date.now },
}, { _id: false });
const saleSchema = new Schema({
  id: { type: String, unique: true, required: true }, reference: { type: String, unique: true, required: true },
  requestFingerprint: String,
  kind: { type: String, enum: ['sale', 'opening_balance'], default: 'sale' },
  date: { type: String, required: true, index: true }, channel: { type: String, enum: ['online', 'shop'], required: true },
  customerId: { type: String, index: true }, customerName: String, customerPhone: String,
  externalReference: String, items: [lineSchema], totalPaise: integer, paidPaise: integer,
  dueDate: String, notes: String, payments: [paymentSchema],
  status: { type: String, enum: ['completed', 'cancelled'], default: 'completed' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }, cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date, cancellationReason: String,
}, { timestamps: true });
saleSchema.index({ channel: 1, externalReference: 1 }, { unique: true, partialFilterExpression: { externalReference: { $type: 'string' } } });
saleSchema.index({ status: 1, kind: 1, date: 1, channel: 1 });
saleSchema.index({ 'payments.date': 1, status: 1 });
export const Sale = model('Sale', saleSchema);
