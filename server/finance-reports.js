import { Sale } from './finance-models.js';
import { indiaToday } from '../shared/sales.js';

export const channelFilter = channel => channel === 'all' ? {} : { channel };
export const dueExpression = { $subtract: ['$totalPaise', '$paidPaise'] };
export const escapedRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const billMatch = (from, to, channel) => ({ status: 'completed', kind: 'sale', date: { $gte: from, $lte: to }, ...channelFilter(channel) });
export const emptyTotals = { totalPaise: 0, collectedPaise: 0, outstandingPaise: 0, saleCount: 0, units: 0, onlinePaise: 0, shopPaise: 0 };
export const saleGroup = {
  totalPaise: { $sum: '$totalPaise' }, outstandingPaise: { $sum: dueExpression }, saleCount: { $sum: 1 },
  units: { $sum: { $sum: '$items.quantity' } },
  onlinePaise: { $sum: { $cond: [{ $eq: ['$channel', 'online'] }, '$totalPaise', 0] } },
  shopPaise: { $sum: { $cond: [{ $eq: ['$channel', 'shop'] }, '$totalPaise', 0] } },
};
export async function totalsForRange(from, to, channel = 'all') {
  const [sales, receipts] = await Promise.all([
    Sale.aggregate([{ $match: billMatch(from, to, channel) }, { $group: { _id: null, ...saleGroup } }]),
    Sale.aggregate([{ $match: { status: 'completed', ...channelFilter(channel), 'payments.date': { $gte: from, $lte: to } } }, { $unwind: '$payments' }, { $match: { 'payments.date': { $gte: from, $lte: to } } }, { $group: { _id: null, collectedPaise: { $sum: '$payments.amountPaise' } } }]),
  ]);
  const { _id, ...totals } = { ...emptyTotals, ...sales[0], ...receipts[0] };
  return totals;
}
export function customerBalancePipeline() {
  return [
    { $lookup: { from: Sale.collection.name, let: { customer: '$id' }, pipeline: [
      { $match: { $expr: { $eq: ['$customerId', '$$customer'] }, status: 'completed' } },
      { $group: { _id: null, billedPaise: { $sum: '$totalPaise' }, collectedPaise: { $sum: '$paidPaise' }, outstandingPaise: { $sum: dueExpression }, overduePaise: { $sum: { $cond: [{ $and: [{ $gt: [dueExpression, 0] }, { $gt: ['$dueDate', ''] }, { $lt: ['$dueDate', indiaToday()] }] }, dueExpression, 0] } } } },
    ], as: 'balance' } },
    { $set: { billedPaise: { $ifNull: [{ $first: '$balance.billedPaise' }, 0] }, collectedPaise: { $ifNull: [{ $first: '$balance.collectedPaise' }, 0] }, outstandingPaise: { $ifNull: [{ $first: '$balance.outstandingPaise' }, 0] }, overduePaise: { $ifNull: [{ $first: '$balance.overduePaise' }, 0] } } },
    { $unset: 'balance' },
  ];
}
