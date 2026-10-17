import { useState, useEffect } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, Eye, EyeOff, Leaf, LogOut, Minus, PackageOpen, Plus, Search, ShoppingBag, Trash2, Warehouse } from 'lucide-react';
import { useWholesale } from './wholesale-context';
import { api, date, money } from './api';
import { Dialog } from './components';
import { bulkPrice, useWholesaleData, WholesalePager, WholesaleState } from './wholesale-shared';
import './wholesale.css';

export function WholesaleEntry() {
  const { buyer, authLoading } = useWholesale();
  if (authLoading) return <div className="ws-loading">Checking wholesale access…</div>;
  return <Navigate to={buyer ? '/wholesale/store' : '/wholesale/register'} replace />;
}
function WholesaleAccess({ children }) {
  const { buyer, authLoading } = useWholesale();
  if (authLoading) return <div className="ws-loading">Checking wholesale access…</div>;
  if (!buyer) return <Navigate to="/wholesale/login" replace />;
  return children;
}

export function WholesaleAuth({ register = false }) {
  const { buyer, authLoading, signIn, sessionError } = useWholesale();
  const location = useLocation(), navigate = useNavigate();
  const [visible, setVisible] = useState(false), [state, setState] = useState({ loading: false, error: '' });
  async function submit(e) {
    e.preventDefault(); const body = Object.fromEntries(new FormData(e.currentTarget));
    setState({ loading: true, error: '' });
    try {
      const data = await api(`/wholesale/auth/${register ? 'register' : 'login'}`, { method: 'POST', body });
      if (register) navigate('/wholesale/login', { replace: true, state: { registered: true, username: data.username } });
      else { signIn(data.buyer); navigate('/wholesale/store', { replace: true }); }
    } catch(e) { setState({ loading: false, error: e.message }); }
  }
  if (authLoading) return <div className="ws-loading">Checking your session…</div>;
  if (buyer) return <Navigate to="/wholesale/store" replace />;
  return <section className="ws-auth-page container"><div className="ws-auth-story"><p className="eyebrow">MASALOO WHOLESALE</p><h1>Whole spices.<br /><em>Bigger possibilities.</em></h1><p>A dedicated marketplace for restaurants, retailers, and kitchens buying raw spices in bulk.</p><div className="ws-auth-benefits"><span><Leaf size={20} strokeWidth={1.2} />Raw and whole spices</span><span><Warehouse size={20} strokeWidth={1.2} />Bulk quantities in kilograms</span><span><PackageOpen size={20} strokeWidth={1.2} />Separate wholesale pricing</span></div><img src="/images/story.webp" alt="A collection of whole spices and ingredients" /></div><div className="ws-auth-card"><span className="ws-auth-symbol"><Warehouse size={27} strokeWidth={1.2} /></span><p className="eyebrow">YOUR WHOLESALE ACCOUNT</p><h2>{register ? 'Register for wholesale' : 'Wholesale login'}</h2><p className="muted">{register ? 'Create a username and password to get started.' : 'Log in to explore raw spices and wholesale rates.'}</p><div className="ws-auth-tabs"><Link className={register ? 'active' : ''} to="/wholesale/register">Register</Link><Link className={!register ? 'active' : ''} to="/wholesale/login">Login</Link></div>{!register && location.state?.registered && <p className="ws-auth-success" role="status"><Check size={16} />Registration complete. Log in to open the wholesale store.</p>}<form className="ws-auth-form" onSubmit={submit}><label htmlFor="wholesale-username">Username<input id="wholesale-username" name="username" autoComplete="username" required minLength={3} maxLength={40} placeholder="Your wholesale username" defaultValue={!register ? location.state?.username || '' : ''} disabled={state.loading} /></label>{register && <p className="ws-field-hint">3–40 characters. Letters, numbers, dots, underscores, and hyphens.</p>}<label htmlFor="wholesale-password">Password</label><div className="ws-password"><input id="wholesale-password" name="password" type={visible ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 10 : 1} maxLength={72} required placeholder={register ? 'At least 10 characters' : 'Your password'} disabled={state.loading} /><button type="button" aria-label={visible ? 'Hide wholesale password' : 'Show wholesale password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{(state.error || sessionError) && <p className="form-error" role="alert">{state.error || sessionError}</p>}<button className="button gold full" disabled={state.loading}>{state.loading ? 'Just a moment…' : register ? 'Create wholesale account' : 'Log in to wholesale'}<ArrowRight size={16} /></button></form><p className="ws-auth-footnote">Wholesale accounts give you access to bulk enquiries and prices set for this marketplace.</p><Link to="/shop" className="text-link"><ArrowLeft size={13} />Back to retail shop</Link></div></section>;
}

function WholesaleToolbar() {
  const { buyer, bagItems, setBagOpen, logout } = useWholesale();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function signOut() {
    setBusy(true); setError('');
    try { await logout(); navigate('/wholesale/login', { replace: true }); }
    catch(e) { setError(e.message); setBusy(false); }
  }
  return <div className="ws-account-bar"><div><Warehouse size={20} /><span>WHOLESALE MARKET</span><small>Hello, {buyer.username}</small></div><nav aria-label="Wholesale account"><Link to="/wholesale/store">Browse spices</Link><Link to="/wholesale/enquiries">My enquiries</Link><button onClick={() => setBagOpen(true)} className="ws-bag-link"><ShoppingBag size={15} />Bulk bag <span>{bagItems.length}</span></button><button onClick={signOut} disabled={busy} aria-label="Log out of wholesale"><LogOut size={15} /></button></nav>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}

function WholesaleCard({ product }) {
  const { addToBag } = useWholesale();
  return <article className="ws-product-card"><Link to={`/wholesale/products/${product.id}`} className="ws-product-image"><img src={product.image} alt={`${product.name} raw spice reference`} loading="lazy" /><span>{product.category}</span></Link><div className="ws-product-copy"><div className="ws-product-title"><Link to={`/wholesale/products/${product.id}`}><h3>{product.name}</h3></Link><ArrowUpRight size={16} /></div><p>{product.description}</p><div className="ws-product-price"><strong>{bulkPrice(product.unitPricePaise)}</strong>{product.unitPricePaise !== null && <small>/ kg</small>}</div><div className="ws-product-bottom"><span>Min. {product.minOrderKg} kg</span><button onClick={() => addToBag(product)} disabled={product.stockKg === 0} aria-label={`Add ${product.name} to bulk bag`}>{product.stockKg === 0 ? 'Unavailable' : <>Add to bulk bag<Plus size={13} /></>}</button></div></div></article>;
}
export function WholesaleStore() { return <WholesaleAccess><WholesaleStoreContent /></WholesaleAccess>; }
function WholesaleStoreContent() {
  const { products, loading, error, refreshProducts } = useWholesale();
  const [search, setSearch] = useState(''), [category, setCategory] = useState('All spices'), [sort, setSort] = useState('name');
  const filtered = products.filter(p => (category === 'All spices' || p.category === category) && `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => sort === 'price-low' ? (a.unitPricePaise ?? Infinity) - (b.unitPricePaise ?? Infinity) || a.name.localeCompare(b.name) : sort === 'price-high' ? (b.unitPricePaise ?? -1) - (a.unitPricePaise ?? -1) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  return <div className="ws-store"><div className="container"><WholesaleToolbar /></div><section className="ws-hero"><div className="container"><div><p className="eyebrow">RAW SPICES. READY FOR YOUR BUSINESS.</p><h1>Big on flavour.<br /><em>Built for bulk.</em></h1><p>Whole spices, seeds, and kitchen essentials for your next big batch. Explore quantities and rates made for wholesale buying.</p><div className="ws-hero-facts"><span>Order in kilograms</span><span>Choose your quantities</span><span>Request a bulk quote</span></div></div><img src="/images/story.webp" alt="Whole spices for a commercial kitchen" /><span className="ws-hero-mark" aria-hidden="true">✧</span></div></section><section className="container ws-catalog"><div className="ws-catalog-heading"><div><p className="eyebrow">THE RAW SPICE COLLECTION</p><h2>Your next batch starts here.</h2></div><span>{products.length} spices for bulk enquiries</span></div><div className="ws-category-tabs">{['All spices','Whole spices','Seeds','Dried herbs & roots'].map(c => <button key={c} className={c === category ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div><div className="ws-shop-controls"><label className="ws-search"><Search size={17} /><span className="sr-only">Search wholesale spices</span><input placeholder="Find a raw spice…" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Sort by<select aria-label="Sort wholesale spices" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name A–Z</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label></div><WholesaleState data={products.length ? products : null} loading={loading} error={error} refresh={refreshProducts}>{filtered.length ? <div className="ws-product-grid">{filtered.map(product => <WholesaleCard key={product.id} product={product} />)}</div> : <div className="empty-state"><Search size={35} strokeWidth={1.2} /><h3>{products.length ? 'No spices match your search.' : 'Our bulk collection is being prepared.'}</h3><p>{products.length ? 'Try another name or collection.' : 'Please check back soon or contact our team.'}</p></div>}</WholesaleState><p className="ws-catalog-note">Reference photos are illustrative. Final grade, bulk packing, and availability are confirmed with your quotation. Where a price is not listed, send an enquiry for a wholesale rate.</p></section></div>;
}

export function WholesaleDetail() { return <WholesaleAccess><WholesaleDetailContent /></WholesaleAccess>; }
function WholesaleDetailContent() {
  const { id } = useParams(), { products, loading, error, refreshProducts } = useWholesale();
  const product = products.find(p => p.id === id);
  if (loading || error) return <section className="container section"><WholesaleState loading={loading} error={error} refresh={refreshProducts} /></section>;
  if (!product) return <section className="container empty-state"><h1>This spice is unavailable.</h1><Link className="button gold" to="/wholesale/store">Back to wholesale<ArrowLeft size={15} /></Link></section>;
  return <div className="container ws-detail-page"><WholesaleToolbar /><div className="breadcrumb"><Link to="/wholesale/store">Wholesale</Link><ChevronRight size={12} /><span>{product.name}</span></div><WholesaleDetailBody key={product.id} product={product} /></div>;
}
function WholesaleDetailBody({ product }) {
  const { addToBag } = useWholesale(), [quantity, setQuantity] = useState(product.minOrderKg);
  return <div className="ws-detail-grid"><div className="ws-detail-image"><img src={product.image} alt={`${product.name} reference photo`} /></div><div className="ws-detail-copy"><p className="eyebrow">WHOLESALE / {product.category}</p><h1>{product.name}</h1><p>{product.description}</p><div className="ws-detail-price"><strong>{bulkPrice(product.unitPricePaise)}</strong>{product.unitPricePaise !== null && <span>per kg · wholesale rate</span>}</div><div className="ws-detail-specs"><div><span>Minimum order</span><strong>{product.minOrderKg} kg</strong></div><div><span>Buying unit</span><strong>1 kg increments</strong></div><div><span>Availability</span><strong>{product.stockKg === null ? 'Confirm on enquiry' : `${product.stockKg} kg listed`}</strong></div></div><label className="ws-detail-quantity">Quantity (kg)<input type="number" min={product.minOrderKg} max={product.stockKg ?? 100000} step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label><button className="button gold" onClick={() => addToBag(product, quantity)} disabled={product.stockKg === 0 || quantity < product.minOrderKg || !Number.isInteger(quantity)}>Add to bulk bag<ShoppingBag size={16} /></button><p className="ws-detail-note">The bulk bag sends a quotation enquiry. Packing, delivery, and the final price are confirmed by our team.</p><Link to="/wholesale/store" className="text-link"><ArrowLeft size={13} />All wholesale spices</Link></div></div>;
}

export function WholesaleBag() {
  const { buyer, bagOpen, setBagOpen, bagItems, updateQuantity, loading, error, refreshProducts, clearBag, notice } = useWholesale();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID()), [state, setState] = useState({ busy: false, error: '', enquiry: null });
  useEffect(() => { setState({ busy: false, error: "", enquiry: null }); setRequestId(crypto.randomUUID()); }, [buyer?.id]);
  if (!buyer) return null;
  if (!bagOpen) return notice ? <div className="toast" role="status"><Check size={16} />{notice}</div> : null;
  const invalid = bagItems.some(p => p.unavailable || p.stockKg === 0 || p.quantityKg < p.minOrderKg || (p.stockKg !== null && p.quantityKg > p.stockKg));
  const subtotal = bagItems.reduce((sum,p) => sum + (p.unitPricePaise || 0) * p.quantityKg,0), unpriced = bagItems.some(p => p.unitPricePaise === null);
  async function submit(e) {
    e.preventDefault(); const form = Object.fromEntries(new FormData(e.currentTarget));
    setState({ busy: true, error: '', enquiry: null });
    try {
      const data = await api('/wholesale/enquiries', { method: 'POST', body: { ...form, id: requestId, items: bagItems.map(p => ({ productId: p.productId, quantityKg: p.quantityKg })) } });
      setState({ busy: false, error: '', enquiry: data.enquiry }); clearBag(); setRequestId(crypto.randomUUID());
    } catch(e) { setState({ busy: false, error: e.message, enquiry: null }); }
  }
  function close() { if (!state.busy) { setBagOpen(false); setState({ busy: false, error: '', enquiry: null }); } }
  return <Dialog title={state.enquiry ? 'Bulk enquiry received' : 'Your wholesale bag'} onClose={close} className="ws-bag-dialog">{state.enquiry ? <div className="ws-enquiry-success"><Check size={38} /><h3>Thank you, {state.enquiry.contactName}.</h3><p>Our team has received your bulk requirements. We’ll contact you on the number you provided.</p><strong>{state.enquiry.reference}</strong><p>This is a quotation enquiry; no payment or confirmed order has been placed.</p><Link to="/wholesale/enquiries" className="button gold" onClick={close}>View my enquiries<ArrowRight size={15} /></Link></div> : <WholesaleState data={bagItems} loading={loading} error={error} refresh={refreshProducts}>{bagItems.length ? <form onSubmit={submit} className="ws-enquiry-form"><p className="ws-bag-intro">Choose bulk quantities, then send your requirements to our team.</p><div className="ws-bag-lines">{bagItems.map(item => <article key={item.productId}>{!item.unavailable && <img src={item.image} alt={item.name} />}<div><h3>{item.name}</h3><p>{item.unavailable ? 'This product is no longer listed. Remove it to continue.' : `${bulkPrice(item.unitPricePaise)}${item.unitPricePaise !== null ? ' / kg' : ''} · Minimum ${item.minOrderKg} kg`}</p>{!item.unavailable && <label>Quantity (kg)<input aria-label={`Wholesale quantity for ${item.name}`} type="number" required min={item.minOrderKg} max={item.stockKg ?? 100000} step={1} value={item.quantityKg} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value > 0) updateQuantity(item.productId,value); }} /></label>}</div><button type="button" className="icon-button danger" onClick={() => updateQuantity(item.productId,0)} aria-label={`Remove ${item.name} from wholesale bag`}><Trash2 size={16} /></button></article>)}</div>{invalid && <p className="form-error">Adjust quantities to the listed minimum and available stock, and remove unavailable products.</p>}<div className="ws-bag-total"><span>{unpriced ? 'Priced items subtotal' : 'Product subtotal'}</span><strong>{unpriced && subtotal === 0 ? 'Quotation required' : money(subtotal / 100)}</strong></div>{unpriced && <p className="ws-bag-note">Some spices need a price quote. The final total will be confirmed by our team.</p>}<h3 className="ws-enquiry-heading">Where can we reach you?</h3><div className="form-row"><label>Contact name<input name="contactName" required maxLength={100} autoComplete="name" /></label><label>Phone number<input name="phone" type="tel" required minLength={7} maxLength={25} autoComplete="tel" /></label></div><div className="form-row"><label>Business (optional)<input name="business" maxLength={150} autoComplete="organization" /></label><label>Delivery city (optional)<input name="city" maxLength={100} autoComplete="address-level2" /></label></div><label>Requirements (optional)<textarea name="notes" maxLength={2000} rows={3} placeholder="Tell us about packing, grade, or the volume you need." /></label>{state.error && <p className="form-error" role="alert">{state.error}</p>}<button className="button gold full" disabled={state.busy || invalid || loading}>{state.busy ? 'Sending enquiry…' : 'Send bulk enquiry'}<ArrowRight size={16} /></button><p className="ws-bag-note">An enquiry does not reserve stock. Packing, delivery, and final amounts are confirmed before an order.</p></form> : <div className="empty-state"><ShoppingBag size={42} strokeWidth={1.2} /><h3>Your bulk bag is empty.</h3><p>Add raw spices from the wholesale collection.</p><Link to="/wholesale/store" className="button gold" onClick={close}>Browse wholesale<ArrowRight size={15} /></Link></div>}</WholesaleState>}</Dialog>;
}

export function WholesaleHistory() { return <WholesaleAccess><WholesaleHistoryContent /></WholesaleAccess>; }
function WholesaleHistoryContent() {
  const [page, setPage] = useState(1), report = useWholesaleData(`/wholesale/enquiries?page=${page}`);
  return <section className="container ws-history"><WholesaleToolbar /><div className="ws-history-heading"><p className="eyebrow">YOUR BULK REQUIREMENTS</p><h1>My enquiries</h1><p>Track the wholesale requirements you’ve shared with our team.</p></div><WholesaleState {...report}>{report.data && <>{report.data.enquiries.length ? <div className="ws-history-list">{report.data.enquiries.map(enquiry => <article key={enquiry.id}><div className="ws-history-meta"><div><strong>{enquiry.reference}</strong><span>{date(enquiry.createdAt)}</span></div><span className={`ws-status ${enquiry.status}`}>{enquiry.status}</span></div><div className="ws-history-items">{enquiry.items.map(item => <div key={item.productId}><span>{item.name}<small>{item.quantityKg} kg</small></span><strong>{bulkPrice(item.totalPaise)}</strong></div>)}</div><div className="ws-history-total"><span>{enquiry.hasUnpricedItems ? 'Final total' : 'Product subtotal at enquiry'}</span><strong>{bulkPrice(enquiry.totalPaise)}</strong></div>{enquiry.quotedTotalPaise != null && <div className="ws-history-total ws-agreed-quote"><span>Quoted total from our team</span><strong>{bulkPrice(enquiry.quotedTotalPaise)}</strong></div>}{enquiry.buyerMessage && <p className="ws-history-note ws-buyer-message">{enquiry.buyerMessage}</p>}<p>Contact: {enquiry.contactName} · {enquiry.phone}</p>{enquiry.notes && <p className="ws-history-note">{enquiry.notes}</p>}</article>)}</div> : <div className="empty-state"><PackageOpen size={40} strokeWidth={1.2} /><h3>Your first bulk enquiry starts here.</h3><Link to="/wholesale/store" className="button gold">Explore raw spices<ArrowRight size={15} /></Link></div>}<WholesalePager data={report.data} onChange={setPage} /></>}</WholesaleState></section>;
}
