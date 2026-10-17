import { useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Trash2, IndianRupee, XCircle } from 'lucide-react';
import { Dialog } from './components';
import { api } from './api';
import { useStore } from './store';
import { cash, dayLabel, FinanceState, PaymentStatus, useFinance } from './finance-ui';
import { indiaToday, toPaise, paymentMethods, channelName } from '../shared/sales';

const blankLine = () => ({ productId: '', quantity: 1, unitPrice: '' });
function MethodSelect({ value, onChange }) {
  return <label>Payment method<select aria-label="Payment method" value={value} onChange={e => onChange(e.target.value)}>{paymentMethods.map(method => <option key={method} value={method}>{method === 'upi' ? 'UPI' : method.charAt(0).toUpperCase() + method.slice(1)}</option>)}</select></label>;
}

export function SaleForm({ onClose, onSaved }) {
  const options = useFinance('/options');
  const [id] = useState(() => crypto.randomUUID());
  const [customerRequestId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ date: indiaToday(), channel: 'shop', customerId: '', customerName: '', newCustomerName: '', newCustomerPhone: '', paymentType: 'full', amountPaid: '0', paymentMethod: 'cash', dueDate: '', externalReference: '', notes: '' });
  const [items, setItems] = useState([blankLine()]);
  const [state, setState] = useState({ busy: false, error: '' });
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const lineTotal = line => Number.isFinite(Number(line.unitPrice)) ? toPaise(line.unitPrice) * (Number(line.quantity) || 0) : 0;
  const total = items.reduce((sum, line) => sum + lineTotal(line), 0);
  const paid = form.paymentType === 'full' ? total : form.paymentType === 'credit' ? 0 : toPaise(form.amountPaid);
  const due = Math.max(0, total - (Number.isFinite(paid) ? paid : 0));
  const updateLine = (index, key, value) => setItems(lines => lines.map((line, i) => {
    if (i !== index) return line;
    if (key === 'productId') return { ...line, productId: value, unitPrice: String(options.data.products.find(p => p.id === value)?.price || '') };
    return { ...line, [key]: value };
  }));
  async function submit(e) {
    e.preventDefault(); setState({ busy: true, error: '' });
    try {
      if (paid > total) throw new Error('Payment cannot exceed the sale total.');
      if (due && !form.customerId) throw new Error('Select or add a saved customer for udhari.');
      let customerId = form.customerId;
      if (customerId === 'new') {
        const result = await api('/admin/finance/customers', { method: 'POST', body: { id: customerRequestId, name: form.newCustomerName, phone: form.newCustomerPhone } });
        customerId = result.customer.id;
      }
      await api('/admin/finance/sales', { method: 'POST', body: { id, date: form.date, channel: form.channel, customerId: customerId || undefined, customerName: form.customerName, externalReference: form.externalReference, notes: form.notes, items: items.map(line => ({ ...line, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) })), amountPaid: paid / 100, paymentMethod: form.paymentMethod, dueDate: due && form.dueDate ? form.dueDate : undefined } });
      onSaved();
    } catch (e) { setState({ busy: false, error: e.message }); }
  }
  return <Dialog title="Record a sale" onClose={() => !state.busy && onClose()} className="finance-sale-dialog"><FinanceState {...options}>{options.data && <form onSubmit={submit} className="finance-form"><p className="muted finance-intro">Record online orders and counter sales here. Online checkout will connect in a later phase.</p><div className="form-row"><label>Sale date<input type="date" max={indiaToday()} required value={form.date} onChange={e => set('date', e.target.value)} /></label><label>Sales channel<select aria-label="Sales channel" value={form.channel} onChange={e => set('channel', e.target.value)}><option value="shop">Offline / shop</option><option value="online">Online</option></select></label></div><label>Customer<select aria-label="Customer" value={form.customerId} onChange={e => set('customerId', e.target.value)}><option value="">Walk-in / no saved customer</option>{options.data.customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}<option value="new">+ Add a new customer</option></select></label>{form.customerId === 'new' ? <div className="form-row finance-inline-customer"><label>Customer name<input required maxLength={100} value={form.newCustomerName} onChange={e => set('newCustomerName', e.target.value)} /></label><label>Customer phone<input type="tel" maxLength={25} value={form.newCustomerPhone} onChange={e => set('newCustomerPhone', e.target.value)} /></label></div> : !form.customerId && <label>Buyer name (optional)<input maxLength={100} value={form.customerName} onChange={e => set('customerName', e.target.value)} placeholder="Walk-in customer" /></label>}
    <div className="finance-line-heading"><h3>Products sold</h3><span>Price per pack</span></div>{!options.data.products.length && <p className="notice">Add products in the Products module before recording a sale.</p>}<div className="finance-sale-lines">{items.map((line, index) => <div className="finance-sale-line" key={index}><label>Product {index + 1}<select required aria-label={`Product ${index + 1}`} value={line.productId} onChange={e => updateLine(index, 'productId', e.target.value)}><option value="">Select a spice</option>{options.data.products.map(p => <option value={p.id} key={p.id} disabled={items.some((l, i) => i !== index && l.productId === p.id)}>{p.name} · {p.weight}{!p.active ? ' (hidden)' : ''}</option>)}</select></label><label>Quantity<input type="number" aria-label={`Quantity ${index + 1}`} required min={1} max={10000} step={1} value={line.quantity} onChange={e => updateLine(index, 'quantity', e.target.value)} /></label><label>Unit price (₹)<input type="number" aria-label={`Unit price ${index + 1}`} required min="0.01" max="1000000000" step="0.01" value={line.unitPrice} onChange={e => updateLine(index, 'unitPrice', e.target.value)} /></label><div className="finance-line-total"><span>{cash(lineTotal(line))}</span><button type="button" className="icon-button danger" disabled={items.length === 1} onClick={() => setItems(lines => lines.filter((_, i) => i !== index))} aria-label={`Remove product ${index + 1}`}><Trash2 size={15} /></button></div></div>)}</div><button className="text-link" type="button" onClick={() => setItems(lines => [...lines, blankLine()])} disabled={items.length >= 50}><Plus size={13} />Add another product</button>
    <div className="finance-bill-total"><span>Sale total</span><strong>{cash(total)}</strong></div><div className="form-row"><label>Payment status<select aria-label="Payment status" value={form.paymentType} onChange={e => set('paymentType', e.target.value)}><option value="full">Paid in full</option><option value="partial">Part paid / some udhari</option><option value="credit">Full udhari / pay later</option></select></label>{form.paymentType !== 'credit' && <MethodSelect value={form.paymentMethod} onChange={value => set('paymentMethod', value)} />}</div>{form.paymentType === 'partial' && <label>Amount received (₹)<input type="number" required min="0.01" max={total / 100} step="0.01" value={form.amountPaid} onChange={e => set('amountPaid', e.target.value)} /></label>}{due > 0 && <><div className="finance-due-preview"><span>Added to customer’s udhari</span><strong>{cash(due)}</strong></div><label>Due date (optional)<input type="date" min={form.date} value={form.dueDate} onChange={e => set('dueDate', e.target.value)} /></label></>}
    <label>Order / receipt reference (optional)<input maxLength={100} value={form.externalReference} onChange={e => set('externalReference', e.target.value)} placeholder={form.channel === 'online' ? 'Your online order ID' : 'Your shop receipt number'} /></label><label>Notes (optional)<textarea rows={2} maxLength={2000} value={form.notes} onChange={e => set('notes', e.target.value)} /></label><p className="finance-note">This register tracks sales and payments. Available stock is managed in Products.</p>{state.error && <p className="form-error" role="alert">{state.error}</p>}<div className="dialog-buttons"><button type="button" className="button outline" disabled={state.busy} onClick={onClose}>Cancel</button><button className="button gold" disabled={state.busy || !options.data.products.length}>{state.busy ? 'Saving…' : 'Save sale'}<ArrowRight size={15} /></button></div></form>}</FinanceState></Dialog>;
}

export function CustomerForm({ customer, onClose, onSaved }) {
  const [id] = useState(() => crypto.randomUUID());
  const [state, setState] = useState({ busy: false, error: '' });
  async function submit(e) {
    e.preventDefault(); const body = { id, ...Object.fromEntries(new FormData(e.currentTarget)) };
    setState({ busy: true, error: '' });
    try { const result = await api(`/admin/finance/customers${customer ? `/${customer.id}` : ''}`, { method: customer ? 'PUT' : 'POST', body }); onSaved(result.customer); }
    catch (e) { setState({ busy: false, error: e.message }); }
  }
  return <Dialog title={customer ? 'Edit customer' : 'Add a customer'} onClose={() => !state.busy && onClose()}><form className="finance-form" onSubmit={submit}><label>Customer name<input name="name" maxLength={100} required defaultValue={customer?.name || ''} autoComplete="name" /></label><div className="form-row"><label>Phone number<input name="phone" type="tel" maxLength={25} defaultValue={customer?.phone || ''} autoComplete="tel" /></label><label>Email (optional)<input name="email" type="email" maxLength={254} defaultValue={customer?.email || ''} autoComplete="email" /></label></div><label>Address (optional)<textarea name="address" rows={2} maxLength={400} defaultValue={customer?.address || ''} /></label><label>Notes (optional)<textarea name="notes" rows={2} maxLength={1500} defaultValue={customer?.notes || ''} /></label>{state.error && <p className="form-error" role="alert">{state.error}</p>}<div className="dialog-buttons"><button className="button outline" type="button" disabled={state.busy} onClick={onClose}>Cancel</button><button className="button gold" disabled={state.busy}>{state.busy ? 'Saving…' : 'Save customer'}<ArrowRight size={15} /></button></div></form></Dialog>;
}

export function OpeningForm({ customer, onClose, onSaved }) {
  const [id] = useState(() => crypto.randomUUID());
  const [state, setState] = useState({ busy: false, error: '' });
  const [date, setDate] = useState(indiaToday());
  async function submit(e) {
    e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget));
    setState({ busy: true, error: '' });
    try { await api(`/admin/finance/customers/${customer.id}/opening-balance`, { method: 'POST', body: { ...data, id, dueDate: data.dueDate || undefined } }); onSaved(); }
    catch (e) { setState({ busy: false, error: e.message }); }
  }
  return <Dialog title="Add previous udhari" onClose={() => !state.busy && onClose()}><form className="finance-form" onSubmit={submit}><p className="muted finance-intro">Bring an old unpaid balance for {customer.name} into the ledger. This will not be counted as a new sale.</p><label>Outstanding amount (₹)<input name="amount" type="number" min="0.01" max="1000000000" step="0.01" required /></label><div className="form-row"><label>Balance date<input name="date" type="date" max={indiaToday()} value={date} onChange={e => setDate(e.target.value)} required /></label><label>Due date (optional)<input name="dueDate" type="date" min={date} /></label></div><label>Notes (optional)<textarea name="notes" rows={3} maxLength={1500} placeholder="Previous bill or notebook reference" /></label>{state.error && <p className="form-error" role="alert">{state.error}</p>}<div className="dialog-buttons"><button className="button outline" type="button" disabled={state.busy} onClick={onClose}>Cancel</button><button className="button gold" disabled={state.busy}>{state.busy ? 'Saving…' : 'Add balance'}<ArrowRight size={15} /></button></div></form></Dialog>;
}

export function SaleDetails({ id, onClose, onChanged }) {
  const report = useFinance(`/sales/${id}`);
  const { user, notify } = useStore();
  const [mode, setMode] = useState('details');
  const [paymentId, setPaymentId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState({ busy: false, error: '' });
  const sale = report.data?.sale;
  async function submit(e) {
    e.preventDefault(); const form = Object.fromEntries(new FormData(e.currentTarget));
    setState({ busy: true, error: '' });
    try {
      await api(`/admin/finance/sales/${id}/${mode === 'payment' ? 'payments' : 'cancel'}`, { method: 'POST', body: mode === 'payment' ? { ...form, id: paymentId } : form });
      notify(mode === 'payment' ? 'Payment recorded in the ledger.' : 'Unpaid record cancelled.');
      setMode('details'); setState({ busy: false, error: '' }); setPaymentId(crypto.randomUUID()); report.refresh(); onChanged();
    } catch (e) { setState({ busy: false, error: e.message }); }
  }
  const title = mode === 'payment' ? 'Record a repayment' : mode === 'cancel' ? 'Cancel unpaid record' : 'Sale & payment history';
  return <Dialog title={title} className="finance-details-dialog" onClose={() => !state.busy && onClose()}><FinanceState {...report}>{sale && <>{mode === 'details' ? <><div className="finance-detail-meta"><div><p className="eyebrow">{sale.kind === 'opening_balance' ? 'OPENING BALANCE' : channelName(sale.channel)}</p><h3>{sale.customerName}</h3><p>{sale.customerPhone}</p><small>{sale.reference}</small></div><PaymentStatus sale={sale} /></div><div className="finance-detail-dates"><span>{dayLabel(sale.date)}</span>{sale.dueDate && <span>Due {dayLabel(sale.dueDate)}</span>}</div>{sale.items.length > 0 && <div className="table-wrap"><table><thead><tr><th>Product</th><th>Packs</th><th>Price</th><th>Total</th></tr></thead><tbody>{sale.items.map(item => <tr key={item.productId}><td>{item.name}<small className="finance-cell-sub">{item.weight}</small></td><td>{item.quantity}</td><td>{cash(item.unitPricePaise)}</td><td>{cash(item.totalPaise)}</td></tr>)}</tbody></table></div>}<div className="finance-detail-totals"><div><span>Total</span><strong>{cash(sale.totalPaise)}</strong></div><div><span>Collected</span><strong>{cash(sale.paidPaise)}</strong></div><div><span>Remaining udhari</span><strong>{cash(sale.status === 'cancelled' ? 0 : sale.outstandingPaise)}</strong></div></div>{sale.notes && <p className="finance-record-note">{sale.notes}</p>}{sale.externalReference && <p className="finance-note">Order / receipt: {sale.externalReference}</p>}<h3 className="finance-history-title">Payment history</h3>{sale.payments.length ? <div className="finance-payment-history">{sale.payments.map(payment => <div key={payment.id}><IndianRupee size={18} /><div><strong>{cash(payment.amountPaise)}</strong><span>{dayLabel(payment.date)} · {payment.method.toUpperCase()} · {payment.kind === 'initial' ? 'Paid at sale' : 'Repayment'}</span>{payment.note && <p>{payment.note}</p>}</div></div>)}</div> : <p className="finance-note">No payments have been recorded.</p>}{sale.status === 'cancelled' && <p className="notice">Cancelled: {sale.cancellationReason}</p>}<div className="dialog-buttons">{sale.status === 'completed' && sale.paidPaise === 0 && user.role === 'owner' && <button className="button outline danger" onClick={() => { setMode('cancel'); setState({ busy: false, error: '' }); }}><XCircle size={14} />Cancel record</button>}{sale.status === 'completed' && sale.outstandingPaise > 0 && <button className="button gold" onClick={() => setMode('payment')}>Record repayment<Plus size={15} /></button>}</div></> : <form className="finance-form" onSubmit={submit}><button type="button" className="text-link finance-back" disabled={state.busy} onClick={() => { setMode('details'); setState({ busy: false, error: '' }); }}><ArrowLeft size={13} />Back to history</button><div className="finance-due-preview"><span>{sale.customerName} · Remaining</span><strong>{cash(sale.outstandingPaise)}</strong></div>{mode === 'payment' ? <><label>Payment amount (₹)<input type="number" name="amount" min="0.01" max={sale.outstandingPaise / 100} step="0.01" defaultValue={(sale.outstandingPaise / 100).toFixed(2)} required /></label><div className="form-row"><label>Payment date<input name="date" type="date" min={sale.date} max={indiaToday()} defaultValue={indiaToday()} required /></label><label>Payment method<select name="method" aria-label="Payment method">{paymentMethods.map(method => <option value={method} key={method}>{method.toUpperCase()}</option>)}</select></label></div><label>Payment note (optional)<textarea name="note" rows={2} maxLength={500} /></label></> : <><p className="finance-note">This unpaid record will be excluded from sales totals and customer dues. It will stay in the ledger with your reason.</p><label>Cancellation reason<textarea name="reason" rows={3} minLength={3} maxLength={500} required /></label></>}{state.error && <p className="form-error" role="alert">{state.error}</p>}<div className="dialog-buttons"><button className="button outline" type="button" disabled={state.busy} onClick={() => setMode('details')}>Back</button><button className={`button ${mode === 'payment' ? 'gold' : 'delete-button'}`} disabled={state.busy}>{state.busy ? 'Saving…' : mode === 'payment' ? 'Save repayment' : 'Cancel unpaid record'}<ArrowRight size={15} /></button></div></form>}</>}</FinanceState></Dialog>;
}
