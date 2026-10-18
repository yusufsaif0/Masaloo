import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarClock, FileText, ImagePlus, Pencil, Plus, RefreshCw, Wallet } from 'lucide-react';
import { api } from './api';
import { Dialog } from './components';
import { useStore } from './store';
import { indiaToday, paymentMethods } from '../shared/sales';
import { cash, dayLabel, FinanceState, Pager, query } from './finance-ui';
import './finance.css';
import './operations.css';

const endpoint = '/admin/operations';
const kindLabel = { bill: 'Purchase bill', salary: 'Employee salary', rent: 'Shop rent' };
function useOperations(route, revision) {
  const [version, setVersion] = useState(0), [state, setState] = useState({ loading: true, data: null, error: '' });
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState(value => ({ ...value, loading: true, error: '' }));
    api(endpoint + route, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ loading: false, data, error: '' });
    }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, data: null, error: error.message }); });
    return () => controller.abort();
  }, [route, revision, version]);
  return { ...state, refresh };
}
function ErrorMessage({ error }) { return error ? <p className="form-error" role="alert">{error}</p> : null; }
function Method({ name = 'method', value, onChange }) {
  return <label>Payment method<select aria-label="Payment method" name={name} value={value} onChange={onChange}>{paymentMethods.map(method => <option key={method} value={method}>{method.toUpperCase()}</option>)}</select></label>;
}
function RecordStatus({ record }) {
  const text = record.status === 'cancelled' ? 'Cancelled' : record.paidPaise === record.totalPaise ? 'Paid' : record.overdue ? 'Overdue' : record.paidPaise ? 'Part paid' : 'Unpaid';
  return <span className={`finance-status ${text === 'Paid' ? 'paid' : text === 'Cancelled' ? 'cancelled' : 'due'}`}>{text}</span>;
}
export default function Operations({ mode, revision }) {
  return mode === 'contacts' ? <Contacts revision={revision} /> : <Records key={mode} mode={mode} revision={revision} />;
}

function Records({ mode, revision }) {
  const billMode = mode === 'bills', { notify } = useStore();
  const [filters, setFilters] = useState({ kind: billMode ? 'bill' : 'running', month: '', state: 'all', search: '', page: 1 });
  const report = useOperations('/records?' + query(filters), revision);
  const [form, setForm] = useState(null), [detail, setDetail] = useState(null);
  const change = (key, value) => setFilters(current => ({ ...current, [key]: value, page: 1 }));
  const saved = () => { setForm(null); report.refresh(); notify('Record saved.'); };
  return <div className="operations-module">
    <div className="operations-intro"><p>{billMode ? 'Attach a bill, read Hindi or English text, then review and correct the details before saving.' : 'Record employee salaries and shop rent, track due dates, and keep a history of partial or full payments.'}</p>
      <div className="operations-actions">{billMode ? <button className="button gold" onClick={() => setForm('bill')}><ImagePlus size={17} />Upload bill</button> : <><button className="button gold" onClick={() => setForm('salary')}><Plus size={16} />Add salary</button><button className="button outline" onClick={() => setForm('rent')}><Plus size={16} />Add rent</button></>}</div>
    </div>
    <p className="finance-note">These are outgoing payments. They do not change sales reports, customer udhari, or product stock.</p>
    <div className="finance-filters operations-filters">
      {!billMode && <label>Record type<select aria-label="Record type" value={filters.kind} onChange={event => change('kind', event.target.value)}><option value="running">Salary + rent</option><option value="salary">Employee salary</option><option value="rent">Shop rent</option></select></label>}
      <label>{billMode ? 'Bill month' : 'Salary / rent month'}<input type="month" value={filters.month} onChange={event => change('month', event.target.value)} /></label>
      <label>Payment status<select aria-label="Payment status" value={filters.state} onChange={event => change('state', event.target.value)}>{['all', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled'].map(status => <option key={status} value={status}>{status === 'all' ? 'All active records' : status === 'partial' ? 'Part paid' : status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
      <label>Search records<input type="search" maxLength={100} placeholder="Payee, title or bill number" value={filters.search} onChange={event => change('search', event.target.value)} /></label>
      <button className="text-link" onClick={() => setFilters({ kind: billMode ? 'bill' : 'running', month: '', state: 'all', search: '', page: 1 })}>Clear filters</button>
    </div>
    <FinanceState {...report}>{report.data && <>
      {filters.state !== 'cancelled' && <div className="finance-stats">{[['Recorded amount', report.data.summary.totalPaise], ['Paid out', report.data.summary.paidPaise], ['Remaining to pay', report.data.summary.outstandingPaise], ['Overdue', report.data.summary.overduePaise]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{cash(value)}</strong><small>Matching the selected filters</small></article>)}</div>}
      {report.data.records.length ? <div className="table-wrap"><table><thead><tr><th>Record / payee</th><th>Due date</th><th>Total</th><th>Paid / remaining</th><th>Status</th><th>Actions</th></tr></thead><tbody>{report.data.records.map(record => <tr key={record.id}><td><strong>{record.title}</strong><small className="finance-cell-sub">{record.payeeName} · {kindLabel[record.kind]}</small>{record.period && <small className="finance-cell-sub">For {record.period}</small>}{record.billNumber && <small className="finance-cell-sub">Bill {record.billNumber}</small>}</td><td>{dayLabel(record.dueDate)}</td><td>{cash(record.totalPaise)}</td><td>{cash(record.paidPaise)}<small className="finance-cell-sub">{record.status === 'cancelled' ? 'Cancelled' : `${cash(record.outstandingPaise)} remaining`}</small></td><td><RecordStatus record={record} /></td><td><button className="button outline operations-small" onClick={() => setDetail(record.id)}>View / pay</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><CalendarClock size={35} /><h2>No matching records.</h2><p>Add a record or change the filters.</p></div>}
      <Pager data={report.data} onChange={page => change('page', page)} />
    </>}</FinanceState>
    {form && <RecordForm kind={form} onClose={() => setForm(null)} onSaved={saved} />}
    {detail && <RecordDetails id={detail} onClose={() => setDetail(null)} onChanged={report.refresh} />}
  </div>;
}

function RecordForm({ kind, onClose, onSaved }) {
  const bill = kind === 'bill';
  const [id] = useState(() => crypto.randomUUID()), [file, setFile] = useState(null), [preview, setPreview] = useState('');
  const [form, setForm] = useState({ title: kindLabel[kind], payeeName: '', billNumber: '', period: indiaToday().slice(0, 7), date: indiaToday(), dueDate: indiaToday(), total: '', amountPaid: '0', paymentMethod: 'cash', notes: '', ocrText: '' });
  const [reviewed, setReviewed] = useState(false), [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [extraction, setExtraction] = useState(null), controller = useRef(null);
  const change = (key, value) => { setForm(current => ({ ...current, [key]: value })); setReviewed(false); };
  useEffect(() => { if (!file) { setPreview(''); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => () => controller.current?.abort(), []);
  const close = () => { if (!busy) { controller.current?.abort(); onClose(); } };
  function selectFile(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || selected.size > 5 * 1024 * 1024) { setError('Choose a JPG, PNG or WebP image up to 5 MB.'); event.target.value = ''; return; }
    controller.current?.abort(); setFile(selected); setExtraction(null); setReviewed(false); setError('');
    setForm(current => ({ ...current, total: '', ocrText: '', billNumber: '', payeeName: '' }));
  }
  async function extract() {
    setReading(true); setError(''); controller.current = new AbortController(); const signal = controller.current.signal;
    try {
      const body = new FormData(); body.append('image', file);
      const result = await api(endpoint + '/bills/preview', { method: 'POST', body, signal });
      if (signal.aborted) return;
      setExtraction(result); setReviewed(false);
      setForm(current => ({ ...current, ...result.suggestions, date: result.suggestions.date || current.date, dueDate: result.suggestions.date || current.dueDate, total: String(result.suggestions.total), ocrText: result.text }));
    } catch (failure) { if (!signal.aborted) setError(failure.message + ' You can fill in the fields below and save after review.'); }
    finally { if (!signal.aborted) setReading(false); }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const details = { ...form, id, kind, reviewed, period: bill ? undefined : form.period, ocrConfidence: extraction?.confidence };
      let body = details;
      if (bill) { body = new FormData(); body.append('details', JSON.stringify(details)); body.append('image', file); }
      await api(endpoint + '/records', { method: 'POST', body }); onSaved();
    } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Dialog title={bill ? 'Review bill before saving' : `Record ${kind === 'salary' ? 'employee salary' : 'shop rent'}`} className={bill ? 'operations-bill-dialog' : ''} onClose={close}>
    <form onSubmit={submit} className="finance-form">
      {bill && <><p className="muted">Choose an image, read its text, then correct anything that is wrong. Nothing is added to the register until you save.</p>
        <label>Bill image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} disabled={reading || busy} required /></label>
        {file && <div className="operations-scan"><div className="operations-image"><a href={preview} target="_blank" rel="noreferrer"><img src={preview} alt="Bill selected for review" /></a><small>Open image to check the original</small></div><div><button className="button outline" type="button" disabled={reading || busy} onClick={extract}>{reading ? <RefreshCw size={16} className="operations-spin" /> : <FileText size={16} />}{reading ? 'Reading Hindi + English…' : 'Read text & amount'}</button><p className="finance-note">Clear, straight photos work best. You can also enter the details manually.</p>{extraction && <p className="finance-note">Reading confidence: {Math.round(extraction.confidence)}%. Always compare the amount with the image.</p>}</div></div>}
        {extraction?.warnings.length > 0 && <div className="notice operations-warning" role="status">{extraction.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      </>}
      <fieldset disabled={reading || busy} className="operations-fields">
        <label>{kind === 'rent' ? 'Shop / property name' : 'Record title'}<input required maxLength={150} value={form.title} onChange={event => change('title', event.target.value)} /></label>
        <label>{kind === 'salary' ? 'Employee name' : kind === 'rent' ? 'Landlord / payee name' : 'Supplier / payee name'}<input required maxLength={150} value={form.payeeName} onChange={event => change('payeeName', event.target.value)} /></label>
        {bill ? <label>Bill number (optional)<input maxLength={100} value={form.billNumber} onChange={event => change('billNumber', event.target.value)} /></label> : <label>{kind === 'salary' ? 'Salary month' : 'Rent month'}<input type="month" required value={form.period} onChange={event => change('period', event.target.value)} /></label>}
        <div className="form-row"><label>{bill ? 'Bill date' : 'Record date'}<input type="date" required max={indiaToday()} value={form.date} onChange={event => change('date', event.target.value)} /></label><label>Payment due date<input type="date" required min={form.date} value={form.dueDate} onChange={event => change('dueDate', event.target.value)} /></label></div>
        <div className="form-row"><label>Total amount (₹)<input type="number" min="0.01" max="1000000000" step="0.01" required value={form.total} onChange={event => change('total', event.target.value)} /></label><label>Amount already paid (₹)<input type="number" min="0" max={form.total || 1000000000} step="0.01" required value={form.amountPaid} onChange={event => change('amountPaid', event.target.value)} /></label></div>
        {Number(form.amountPaid) > 0 && <Method value={form.paymentMethod} onChange={event => change('paymentMethod', event.target.value)} />}
        <p className="finance-due-preview">Remaining to pay <strong>{cash(Math.max(0, Math.round((Number(form.total || 0) - Number(form.amountPaid || 0)) * 100)))}</strong></p>
        {bill && <label>Extracted text — editable<textarea aria-label="Extracted bill text" rows={5} maxLength={20000} value={form.ocrText} onChange={event => change('ocrText', event.target.value)} placeholder="Extracted Hindi / English text will appear here." /></label>}
        <label>Notes (optional)<textarea rows={2} maxLength={2000} value={form.notes} onChange={event => change('notes', event.target.value)} /></label>
        <label className="operations-confirm"><input type="checkbox" checked={reviewed} required onChange={event => setReviewed(event.target.checked)} />I checked the details, total and due date{bill ? ' against the bill image' : ''}.</label>
      </fieldset>
      <ErrorMessage error={error} />
      <div className="dialog-buttons"><button className="button outline" type="button" disabled={busy} onClick={close}>Cancel</button><button className="button gold" disabled={busy || reading || !reviewed || (bill && !file)}>{busy ? 'Saving…' : bill ? 'Save reviewed bill' : 'Save record'}<ArrowRight size={15} /></button></div>
    </form>
  </Dialog>;
}

function RecordDetails({ id, onClose, onChanged }) {
  const report = useOperations('/records/' + id), { user, notify } = useStore();
  const [mode, setMode] = useState('view'), [paymentId, setPaymentId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const record = report.data?.record;
  async function submit(event) {
    event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); setBusy(true); setError('');
    try {
      await api(`${endpoint}/records/${id}/${mode === 'pay' ? 'payments' : 'cancel'}`, { method: 'POST', body: mode === 'pay' ? { ...body, id: paymentId } : body });
      setMode('view'); setPaymentId(crypto.randomUUID()); report.refresh(); onChanged(); notify(mode === 'pay' ? 'Payment recorded.' : 'Unpaid record cancelled.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Dialog title="Record & payment history" className="finance-details-dialog" onClose={() => !busy && onClose()}><FinanceState {...report}>{record && <>
    <div className="finance-detail-meta"><div><p className="eyebrow">{kindLabel[record.kind]}</p><h3>{record.title}</h3><p>{record.payeeName}{record.period ? ` · ${record.period}` : ''}</p></div><RecordStatus record={record} /></div>
    <p className="finance-note">Recorded {dayLabel(record.date)} · Due {dayLabel(record.dueDate)}{record.billNumber ? ` · Bill ${record.billNumber}` : ''}</p>
    <div className="finance-detail-totals"><div><span>Total</span><strong>{cash(record.totalPaise)}</strong></div><div><span>Paid</span><strong>{cash(record.paidPaise)}</strong></div><div><span>Remaining</span><strong>{cash(record.status === 'cancelled' ? 0 : record.outstandingPaise)}</strong></div></div>
    {record.imageUrl && <a className="operations-saved-image" href={record.imageUrl} target="_blank" rel="noreferrer"><img src={record.imageUrl} alt="Saved bill" /><span>Open saved bill image</span></a>}
    {record.ocrText && <details className="operations-text"><summary>Bill text</summary><pre>{record.ocrText}</pre></details>}
    {record.notes && <p className="finance-record-note">{record.notes}</p>}
    <h3 className="finance-history-title">Payment history</h3>{record.payments.length ? <div className="finance-payment-history">{record.payments.map(payment => <div key={payment.id}><Wallet size={18} /><div><strong>{cash(payment.amountPaise)}</strong><span>{dayLabel(payment.date)} · {payment.method.toUpperCase()}</span>{payment.note && <p>{payment.note}</p>}</div></div>)}</div> : <p className="finance-note">No payments recorded yet.</p>}
    {record.status === 'cancelled' && <p className="notice">Cancelled: {record.cancellationReason}</p>}
    {mode === 'view' ? <div className="dialog-buttons">{record.status === 'active' && record.paidPaise === 0 && user.role === 'owner' && <button className="button outline danger" onClick={() => { setMode('cancel'); setError(''); }}>Cancel unpaid record</button>}{record.status === 'active' && record.outstandingPaise > 0 && <button className="button gold" onClick={() => { setMode('pay'); setError(''); }}><Plus size={15} />Record payment</button>}</div> : <form className="finance-form" onSubmit={submit}>
      {mode === 'pay' ? <><label>Payment amount (₹)<input name="amount" type="number" min="0.01" max={record.outstandingPaise / 100} step="0.01" required defaultValue={(record.outstandingPaise / 100).toFixed(2)} /></label><div className="form-row"><label>Payment date<input name="date" type="date" min={record.date} max={indiaToday()} defaultValue={indiaToday()} required /></label><Method /></div><label>Payment note (optional)<textarea name="note" maxLength={500} rows={2} /></label></> : <label>Cancellation reason<textarea name="reason" required minLength={3} maxLength={500} rows={3} /></label>}
      <ErrorMessage error={error} /><div className="dialog-buttons"><button className="button outline" type="button" disabled={busy} onClick={() => setMode('view')}>Back</button><button className="button gold" disabled={busy}>{busy ? 'Saving…' : mode === 'pay' ? 'Save payment' : 'Confirm cancellation'}</button></div>
    </form>}
  </>}</FinanceState></Dialog>;
}

function Contacts({ revision }) {
  const [filters, setFilters] = useState({ type: 'all', status: 'active', search: '', page: 1 }), [edit, setEdit] = useState(null);
  const report = useOperations('/contacts?' + query(filters), revision), { notify } = useStore();
  const change = (key, value) => setFilters(current => ({ ...current, [key]: value, page: 1 }));
  return <div className="operations-module"><div className="operations-intro"><p>Keep customer, hotel and supplier phone numbers, addresses, GST details, and notes in one directory.</p><button className="button gold" onClick={() => setEdit({})}><Plus size={16} />Add contact</button></div>
    <p className="finance-note">This is your business contact directory. Customer balances and repayments are managed in the Udhari ledger.</p>
    <div className="finance-filters"><label>Contact type<select aria-label="Contact type" value={filters.type} onChange={event => change('type', event.target.value)}>{['all', 'customer', 'hotel', 'supplier'].map(type => <option key={type} value={type}>{type === 'all' ? 'All types' : type[0].toUpperCase() + type.slice(1)}</option>)}</select></label><label>Contact status<select aria-label="Contact status" value={filters.status} onChange={event => change('status', event.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All contacts</option></select></label><label>Search contacts<input type="search" maxLength={100} value={filters.search} onChange={event => change('search', event.target.value)} placeholder="Name, phone, email or GST number" /></label></div>
    <FinanceState {...report}>{report.data && <>{report.data.contacts.length ? <div className="table-wrap"><table><thead><tr><th>Name / type</th><th>Contact</th><th>Address / GST</th><th>Actions</th></tr></thead><tbody>{report.data.contacts.map(contact => <tr key={contact.id}><td><strong>{contact.name}</strong><small className="finance-cell-sub">{contact.type}{!contact.active ? ' · Archived' : ''}</small>{contact.contactPerson && <small className="finance-cell-sub">{contact.contactPerson}</small>}</td><td>{contact.phone ? <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}>{contact.phone}</a> : '—'}{contact.email && <a className="finance-cell-sub" href={`mailto:${contact.email}`}>{contact.email}</a>}</td><td className="operations-address">{contact.address || '—'}{contact.gstNumber && <small className="finance-cell-sub">GST: {contact.gstNumber}</small>}</td><td><button className="icon-button" aria-label={`Edit ${contact.name}`} onClick={() => setEdit(contact)}><Pencil size={16} /></button></td></tr>)}</tbody></table></div> : <div className="empty-state"><h2>No matching contacts.</h2><p>Add a customer, hotel or supplier to start your directory.</p></div>}<Pager data={report.data} onChange={page => change('page', page)} /></>}</FinanceState>
    {edit && <ContactForm contact={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); report.refresh(); notify('Contact saved.'); }} />}
  </div>;
}
function ContactForm({ contact, onClose, onSaved }) {
  const [id] = useState(() => contact.id || crypto.randomUUID()), [active, setActive] = useState(contact.active ?? true);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); const body = { ...Object.fromEntries(new FormData(event.currentTarget)), id, active }; setBusy(true); setError('');
    try { await api(endpoint + '/contacts' + (contact.id ? '/' + contact.id : ''), { method: contact.id ? 'PUT' : 'POST', body }); onSaved(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Dialog title={contact.id ? 'Edit business contact' : 'Add business contact'} onClose={() => !busy && onClose()}><form className="finance-form" onSubmit={submit}>
    <label>Contact type<select aria-label="Contact type" name="type" defaultValue={contact.type || 'customer'}><option value="customer">Customer</option><option value="hotel">Hotel</option><option value="supplier">Supplier</option></select></label>
    <label>Name / business name<input name="name" required maxLength={150} defaultValue={contact.name || ''} /></label>
    <label>Contact person (optional)<input name="contactPerson" maxLength={100} defaultValue={contact.contactPerson || ''} /></label>
    <div className="form-row"><label>Phone number<input name="phone" type="tel" maxLength={25} defaultValue={contact.phone || ''} /></label><label>Email (optional)<input name="email" type="email" maxLength={254} defaultValue={contact.email || ''} /></label></div>
    <label>Address<textarea name="address" rows={2} maxLength={500} defaultValue={contact.address || ''} /></label><label>GST number (optional)<input name="gstNumber" maxLength={30} defaultValue={contact.gstNumber || ''} /></label><label>Notes (optional)<textarea name="notes" rows={3} maxLength={1500} defaultValue={contact.notes || ''} /></label>
    <label className="operations-confirm"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Active contact</label><p className="finance-note">Uncheck to archive a contact. Existing records are preserved.</p>
    <ErrorMessage error={error} /><div className="dialog-buttons"><button className="button outline" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button gold" disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</button></div>
  </form></Dialog>;
}
