export function indiaToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function monthBounds(month) {
  const [year, number] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}` };
}
export const paymentMethods = ['cash', 'upi', 'bank', 'card', 'other'];
export const channelName = channel => channel === 'online' ? 'Online' : 'Offline / shop';
export const toPaise = rupees => Math.round(Number(rupees) * 100);
