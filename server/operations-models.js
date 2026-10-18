import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const money = { type: Number, min: 0, required: true, validate: Number.isSafeInteger };

export const BusinessContact = model('BusinessContact', new Schema({
  id: { type: String, unique: true, required: true },
  requestFingerprint: String,
  type: { type: String, enum: ['customer', 'hotel', 'supplier'], required: true, index: true },
  name: { type: String, required: true }, contactPerson: String, phone: String, email: String,
  address: String, gstNumber: String, notes: String, active: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }));

const payment = new Schema({
  id: { type: String, required: true }, amountPaise: { ...money, min: 1 }, date: { type: String, required: true },
  method: { type: String, enum: ['cash', 'upi', 'bank', 'card', 'other'], required: true }, note: String,
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' }, recordedAt: { type: Date, default: Date.now },
}, { _id: false });
const schema = new Schema({
  id: { type: String, required: true, unique: true }, requestFingerprint: { type: String, required: true },
  kind: { type: String, enum: ['bill', 'salary', 'rent'], required: true, index: true },
  title: { type: String, required: true }, payeeName: { type: String, required: true },
  contactId: String, billNumber: String, period: String,
  periodKey: String, date: { type: String, required: true }, dueDate: { type: String, required: true, index: true },
  totalPaise: { ...money, min: 1 }, paidPaise: money, payments: [payment], notes: String,
  imageName: String, imageHash: String, ocrText: String, ocrConfidence: Number,
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  cancellationReason: String, cancelledAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }, cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ periodKey: 1 }, { unique: true, partialFilterExpression: { periodKey: { $type: 'string' } } });
schema.index({ kind: 1, status: 1, date: -1 });
export const ExpenseRecord = model('ExpenseRecord', schema);
