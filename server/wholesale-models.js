import mongoose from 'mongoose';
const { Schema, model } = mongoose;
export const WholesaleBuyer = model('WholesaleBuyer', new Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  active: { type: Boolean, default: true },
}, { timestamps: true }));

const referencePack = new Schema({ label: String, retailPricePaise: Number, mrpPaise: Number }, { _id: false });
export const WholesaleProduct = model('WholesaleProduct', new Schema({
  id: { type: String, required: true, unique: true }, name: { type: String, required: true },
  category: { type: String, default: 'Whole spices' }, description: String, image: String,
  unitPricePaise: { type: Number, min: 1, max: 100000000, default: null },
  minOrderKg: { type: Number, min: 1, default: 5 }, stockKg: { type: Number, min: 0, default: null },
  active: { type: Boolean, default: true },
  source: { productId: String, url: String, imageUrl: String, image: String, fetchedAt: Date, packs: [referencePack] },
}, { timestamps: true }));

const enquiryItem = new Schema({
  productId: String, name: String, quantityKg: Number, unitPricePaise: { type: Number, default: null }, totalPaise: { type: Number, default: null },
}, { _id: false });
export const WholesaleEnquiry = model('WholesaleEnquiry', new Schema({
  id: { type: String, required: true, unique: true }, reference: { type: String, required: true, unique: true },
  buyerId: { type: Schema.Types.ObjectId, ref: 'WholesaleBuyer', required: true, index: true }, username: String,
  requestFingerprint: String, contactName: String, phone: String, business: String, city: String, notes: String,
  items: [enquiryItem], pricedSubtotalPaise: Number, totalPaise: { type: Number, default: null }, hasUnpricedItems: Boolean,
  status: { type: String, enum: ['new', 'contacted', 'quoted', 'closed'], default: 'new' }, internalNotes: String,
  quotedTotalPaise: { type: Number, default: null }, buyerMessage: { type: String, default: '' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }));
