import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, ArrowUp, ShoppingBag, Search, UserRound, Menu, X, Leaf, ShieldCheck, Truck, Sprout, Plus, Minus, Trash2, Mail, Check, Instagram, Heart, PackageCheck } from 'lucide-react';
import { useStore } from './store';
import { api, money } from './api';
import { useWholesale } from './wholesale-context';

export function Logo() {
  return <Link to="/" className="logo" aria-label="Masaloo home"><span>masal<span className="logo-orange">oo<i>✦</i></span><sup>®</sup></span><small>PURE SPICES. RICH TASTE.</small></Link>;
}

export function Header() {
  const { cartItems, setCartOpen, user } = useStore();
  const wholesale = useWholesale();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const wholesaleBag = location.pathname.startsWith('/wholesale') && wholesale.buyer;
  useEffect(() => setMenu(false), [location.pathname]);
  return <>
    <div className="announcement"><span>A LITTLE SPICE. A LOT OF LOVE.</span><span><span className="tiny-star">✧</span> ROOTED IN INDIAN FLAVOUR <span className="tiny-star">✧</span></span><span>FROM OUR KITCHEN TO YOURS</span></div>
    <header className="header"><div className="container header-inner">
      <Logo />
      <nav className={menu ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
        {[['/', 'Home'], ['/shop', 'Shop'], ['/wholesale', 'Wholesale'], ['/about', 'Our story'], ['/blog', 'Spice journal'], ['/contact', 'Contact']].map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
      </nav>
      <div className="header-actions"><Link className="icon-button search-link" to="/shop?search=" aria-label="Search spices"><Search size={20} /></Link><Link className="icon-button" to={user && user.role !== 'customer' ? '/admin' : '/account'} aria-label={user ? 'Your account' : 'Sign in'}><UserRound size={20} /></Link><button className="icon-button bag-button" onClick={() => wholesaleBag ? wholesale.setBagOpen(true) : setCartOpen(true)} aria-label={wholesaleBag ? `Open wholesale bag, ${wholesale.bagItems.length} spices` : `Open bag, ${cartItems.reduce((n,x) => n + x.quantity, 0)} items`}><ShoppingBag size={20} /><span>{wholesaleBag ? wholesale.bagItems.length : cartItems.reduce((n,x) => n + x.quantity, 0)}</span></button><button className="icon-button menu-toggle" onClick={() => setMenu(!menu)} aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu}>{menu ? <X /> : <Menu />}</button></div>
    </div></header>
  </>;
}

export function SectionHeading({ eyebrow, title, link, to, center = false }) {
  return <div className={`section-heading ${center ? 'center' : ''}`}><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{link && <Link className="text-link" to={to}>{link}<ArrowUpRight size={16} /></Link>}</div>;
}

export function ProductCard({ product }) {
  const { addToCart } = useStore();
  return <article className="product-card"><Link to={`/shop/${product.id}`} className="product-image"><img src={product.image} alt={`${product.name} — Masaloo spice package and spices`} loading="lazy" />{product.badge && <span className="product-badge">{product.badge}</span>}<span className="product-quick">Discover this spice <ArrowUpRight size={15} /></span></Link><div className="product-info"><div className="product-title-row"><Link to={`/shop/${product.id}`}><h3>{product.name}</h3></Link><span>{product.weight}</span></div><p>{product.subtitle}</p><div className="product-bottom"><strong>{money(product.price)}</strong><button className="add-button" onClick={() => addToCart(product)} disabled={!product.stock} aria-label={`Add ${product.name} to bag`}>{product.stock ? <>Add to bag <Plus size={14} /></> : 'Sold out'}</button></div></div></article>;
}

export function Benefits() {
  return <div className="benefits"><div className="container benefit-grid">{[[Leaf, 'The goodness of nature', 'Everyday ingredients, extraordinary flavour'], [Sprout, 'Rooted in tradition', 'Inspired by the kitchens of India'], [ShieldCheck, 'Packed with care', 'Thoughtfully packed for your kitchen'], [Truck, 'A flavourful journey', 'From our collection to your doorstep']].map(([Icon, title, desc]) => <div className="benefit" key={title}><Icon size={29} strokeWidth={1.1} /><div><strong>{title}</strong><span>{desc}</span></div></div>)}</div></div>;
}

export function Newsletter() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ loading: false, message: '', error: false });
  async function submit(e) {
    e.preventDefault(); setState({ loading: true, message: '', error: false });
    try { const data = await api('/newsletter', { method: 'POST', body: { email } }); setState({ loading: false, message: data.message, error: false }); setEmail(''); }
    catch (err) { setState({ loading: false, message: err.message, error: true }); }
  }
  return <section className="newsletter"><div className="container newsletter-inner"><div className="newsletter-intro"><Mail size={38} strokeWidth={1} /><div><p className="eyebrow">A LETTER FROM OUR KITCHEN</p><h2>A little inspiration.<br />A whole lot of flavour.</h2><p>Spice stories, kitchen tips, and something delicious.</p></div></div><form onSubmit={submit}><div className="newsletter-input"><label htmlFor="newsletter" className="sr-only">Email address</label><input id="newsletter" type="email" placeholder="Your email address" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /><button className="button gold" disabled={state.loading}>{state.loading ? 'Joining…' : 'Count me in'}<ArrowRight size={16} /></button></div><span className={state.error ? 'form-error' : 'newsletter-note'} role="status">{state.message || <><Check size={13} /> Only the good stuff. Unsubscribe anytime.</>}</span></form></div></section>;
}

export function Footer() {
  return <footer className="footer"><div className="container"><div className="footer-grid"><div className="footer-brand"><Logo /><p>For the love of good food.<br />For the joy of coming home.</p><Link to="/about" className="footer-brand-link">Get to know Masaloo <ArrowUpRight size={14} /></Link></div><div><h3>Explore</h3><Link to="/">Home</Link><Link to="/shop">Shop all spices</Link><Link to="/about">Our story</Link><Link to="/blog">Spice journal</Link></div><div><h3>We’re here to help</h3><Link to="/contact">Contact us</Link><Link to="/contact?subject=Bulk%20order%20enquiry">Bulk & business enquiries</Link><Link to="/account">My account</Link><Link to="/admin">Team login</Link></div><div className="footer-note"><p className="eyebrow">MADE FOR YOUR KITCHEN</p><h3>Good food begins<br />with a good pinch.</h3><span>Explore. Cook. Share. Repeat.</span><Leaf size={30} strokeWidth={1} /></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Masaloo. All rights reserved.</span><span>Crafted with a love for Indian flavour <Heart size={12} /></span><button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top"><ArrowUp size={16} /></button></div></div></footer>;
}

export function Dialog({ title, children, onClose, className = '' }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = e => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const elements = [...ref.current.querySelectorAll('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]')];
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className={`dialog-backdrop ${className}`} onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}><div className="dialog-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X /></button></div>{children}</section></div>;
}

export function Cart() {
  const { cartOpen, setCartOpen, cartItems, updateQuantity, loading, catalogError } = useStore();
  const [checkout, setCheckout] = useState(false);
  useEffect(() => { if (!cartOpen) setCheckout(false); }, [cartOpen]);
  if (!cartOpen) return null;
  const total = cartItems.reduce((n, x) => n + x.price * x.quantity, 0);
  return <Dialog title="Your spice bag" className="cart-dialog" onClose={() => setCartOpen(false)}><p className="muted">A little closer to something delicious.</p>{loading || catalogError ? <p className="empty-state">{catalogError || 'Loading your bag…'}</p> : cartItems.length ? <><div className="cart-items">{cartItems.map(item => <article className="cart-item" key={item.id}><img src={item.image} alt={item.name} /><div><Link to={`/shop/${item.id}`} onClick={() => setCartOpen(false)}><h3>{item.name}</h3></Link><span className="muted">{item.weight} · {money(item.price)}</span><div className="quantity"><button onClick={() => updateQuantity(item.id, item.quantity - 1)} aria-label={`Remove one ${item.name}`}><Minus size={13} /></button><span>{item.quantity}</span><button disabled={item.quantity >= item.stock} onClick={() => updateQuantity(item.id, item.quantity + 1)} aria-label={`Add one ${item.name}`}><Plus size={13} /></button></div></div><div className="cart-item-right"><strong>{money(item.quantity * item.price)}</strong><button className="icon-button" onClick={() => updateQuantity(item.id, 0)} aria-label={`Remove ${item.name}`}><Trash2 size={16} /></button></div></article>)}</div><div className="cart-total"><span>Subtotal</span><strong>{money(total)}</strong></div><p className="muted small">Delivery and taxes will be calculated when checkout launches.</p><button className="button gold full" onClick={() => setCheckout(true)}>Continue to checkout <ArrowRight size={16} /></button>{checkout && <div className="notice" role="status"><PackageCheck size={22} /><div><strong>Checkout is coming soon</strong><p>Payment integration is being prepared. Your bag is saved on this device; no order or payment has been placed.</p></div></div>}<button className="text-link cart-continue" onClick={() => setCartOpen(false)}>Keep exploring <ArrowRight size={14} /></button></> : <div className="empty-state"><ShoppingBag size={50} strokeWidth={1} /><h3>Your next favourite is waiting.</h3><p>Let’s find a little flavour for your kitchen.</p><Link to="/shop" className="button gold" onClick={() => setCartOpen(false)}>Explore the spices <ArrowRight size={16} /></Link></div>}</Dialog>;
}

export function CatalogStatus() {
  const { loading, catalogError, refreshProducts } = useStore();
  if (catalogError) return <div className="notice error" role="alert"><span>{catalogError}</span><button onClick={refreshProducts} className="text-link">Try again</button></div>;
  if (loading) return <div className="product-grid skeleton-grid" aria-label="Loading spices">{[1,2,3,4].map(i => <div className="skeleton" key={i} />)}</div>;
  return null;
}
