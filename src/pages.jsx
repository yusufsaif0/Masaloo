import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, ChevronRight, Leaf, Sprout, Heart, Sparkles, Search, SlidersHorizontal, X, Mail, MessageCircle, Building2, Clock3, Minus, Plus, ShoppingBag, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useStore } from './store';
import { SectionHeading, ProductCard, Benefits, CatalogStatus } from './components';
import { api, money, date } from './api';
import { categories } from '../shared/catalog';

export function Home() {
  const { products, loading, catalogError } = useStore();
  const [posts, setPosts] = useState([]);
  useEffect(() => { api('/blogs').then(data => setPosts(data.posts.slice(0, 3))).catch(() => {}); }, []);
  return <>
    <section className="hero"><img className="hero-photo" src="/images/hero.webp" alt="Masaloo garam masala, a generous bowl of aromatic spices, and traditional brassware" fetchPriority="high" /><div className="hero-shade" /><div className="container hero-content"><div className="hero-copy"><p className="eyebrow"><span /> THE SOUL OF AN INDIAN KITCHEN</p><h1>Pure Spices.<br /><em>Rich Taste.</em></h1><p className="hero-description">A pinch of tradition. A spoonful of love.<br />Bring the heart of Indian flavour<br className="desktop-br" /> to every meal you make.</p><div className="hero-buttons"><Link to="/shop" className="button gold">Shop our spices <ArrowRight size={17} /></Link><Link to="/about" className="button outline">Discover our story <ArrowUpRight size={16} /></Link></div><div className="hero-footnote"><span className="hero-star">✦</span><span>Good food. Great company. A little Masaloo.</span></div></div><div className="hero-stamp"><Leaf size={24} strokeWidth={1} /><span>INSPIRED BY<br />TRADITION</span><small>MADE FOR TODAY</small></div></div><div className="hero-bottom"><span>YOUR EVERYDAY, A LITTLE MORE EXTRAORDINARY</span><span>SCROLL TO EXPLORE <span className="scroll-line" /></span></div></section>
    <Benefits />
    <section className="section featured-section"><div className="container"><SectionHeading eyebrow="A PLACE IN EVERY SPICE BOX" title="Everyday spices. Endless possibilities." link="Shop all spices" to="/shop" /><CatalogStatus />{!loading && !catalogError && <div className="product-grid">{products.filter(p => p.featured).slice(0, 4).map(p => <ProductCard product={p} key={p.id} />)}</div>}<div className="section-footnote"><span /><Leaf size={13} /><p>Little ingredients. Beautifully big flavours.</p><span /></div></div></section>
    <StorySection />
    <section className="section collections-section"><div className="container"><SectionHeading eyebrow="FIND YOUR KIND OF FLAVOUR" title="Something for every kitchen." center /><div className="collection-grid">{[['Everyday essentials', 'The familiar flavours you come home to.', '/images/haldi.webp', '01'], ['Signature blends', 'Many spices. One beautiful harmony.', '/images/garam.webp', '02'], ['Whole spices', 'Small wonders. A world of aroma.', '/images/story.webp', '03']].map(([title, desc, image, n]) => <Link className="collection-card" to={`/shop?category=${encodeURIComponent(title)}`} key={title}><img src={image} alt={title} loading="lazy" /><span className="collection-number">{n} / THE COLLECTION</span><div><h3>{title}</h3><p>{desc}</p></div><span className="circle-arrow"><ArrowUpRight size={22} /></span></Link>)}</div></div></section>
    <section className="kitchen-note"><div className="container"><span>“</span><p>The best memories are made around the table.<br /><em>We’re just here to add a little flavour.</em></p><div className="note-signature">with love, <strong>masaloo</strong><Heart size={15} /></div></div></section>
    {posts.length > 0 && <section className="section journal-section"><div className="container"><SectionHeading eyebrow="FROM OUR KITCHEN, WITH LOVE" title="A few stories. A little inspiration." link="Visit the spice journal" to="/blog" /><div className="journal-grid">{posts.map(p => <BlogCard post={p} key={p.id} />)}</div></div></section>}
  </>;
}

function StorySection() {
  return <section className="story-section"><div className="container story-grid"><div className="story-photo"><img src="/images/story.webp" alt="A traditional Indian spice spread with vibrant powders, whole spices, and brassware" loading="lazy" /><div className="image-caption"><span>THE HEART OF EVERY HOME</span><span>✦</span></div></div><div className="story-copy"><p className="eyebrow">OUR ROOTS. YOUR RECIPES.</p><h2>A little of our tradition.<br /><em>A lot of your love.</em></h2><p>There’s something about the aroma of spices in a warm kitchen. It brings us together. It takes us back. It makes a meal feel like home.</p><p>That’s the feeling behind Masaloo. A collection of familiar favourites and thoughtfully imagined blends, made to find a place in your everyday cooking.</p><div className="story-values">{[[Sprout, 'Rooted in tradition'], [Sparkles, 'Full of character'], [Heart, 'Made for sharing']].map(([Icon, label]) => <div key={label}><Icon size={26} strokeWidth={1} /><span>{label}</span></div>)}</div><Link to="/about" className="button dark">The story of Masaloo <ArrowRight size={16} /></Link><span className="story-botanical" aria-hidden="true">❧</span></div></div></section>;
}

function PageIntro({ eyebrow, title, children }) {
  return <section className="page-intro"><div className="container"><div className="breadcrumb"><Link to="/">Home</Link><ChevronRight size={12} /><span>{eyebrow}</span></div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children && <p>{children}</p>}<span className="intro-decoration" aria-hidden="true">✧</span></div></section>;
}

export function Shop() {
  const { products, loading, catalogError, sample } = useStore();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') || '';
  const category = categories.includes(params.get('category')) ? params.get('category') : 'All spices';
  const sort = params.get('sort') || 'featured';
  const update = (key, value) => { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next, { replace: true }); };
  let filtered = products.filter(p => (category === 'All spices' || p.category === category) && `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(search.toLowerCase()));
  filtered = [...filtered].sort((a, b) => sort === 'price-low' ? a.price - b.price : sort === 'price-high' ? b.price - a.price : sort === 'name' ? a.name.localeCompare(b.name) : Number(b.featured) - Number(a.featured));
  return <><PageIntro eyebrow="THE SPICE SHOP" title={<>A world of flavour.<br /><em>A pinch away.</em></>}>Everyday essentials, signature blends, and the beginnings of something delicious.</PageIntro><section className="section shop-section"><div className="container"><div className="shop-top"><div className="category-tabs" aria-label="Spice categories">{categories.map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => update('category', c === 'All spices' ? '' : c)}>{c}</button>)}</div><span className="result-count">{loading ? 'Finding your flavour…' : `${filtered.length} spices to explore`}</span></div><div className="shop-controls"><div className="search-field"><Search size={18} /><label className="sr-only" htmlFor="product-search">Search spices</label><input autoFocus={params.has('search')} id="product-search" placeholder="Find your favourite spice…" value={search} onChange={e => update('search', e.target.value)} />{search && <button aria-label="Clear search" onClick={() => update('search', '')}><X size={15} /></button>}</div><label className="sort-label"><SlidersHorizontal size={15} /><span>Sort by</span><select value={sort} onChange={e => update('sort', e.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name: A to Z</option></select></label></div>{sample && <p className="sample-note">You’re browsing a sample catalog. Products and prices can be updated from the admin panel once MongoDB is connected.</p>}<CatalogStatus />{!loading && !catalogError && (filtered.length ? <div className="product-grid shop-grid">{filtered.map(p => <ProductCard product={p} key={p.id} />)}</div> : <div className="empty-state"><Search size={40} strokeWidth={1} /><h2>No spices found just yet.</h2><p>Try a different search or explore our full collection.</p><button className="button outline" onClick={() => setParams({})}>Show all spices <ArrowRight size={16} /></button></div>)}</div></section><Benefits /></>;
}

export function ProductDetail() {
  const { id } = useParams();
  const { products, loading, catalogError, addToCart } = useStore();
  const product = products.find(p => p.id === id);
  if (loading || catalogError) return <div className="section container"><CatalogStatus /></div>;
  if (!product) return <NotFound />;
  return <><div className="container product-detail"><div className="breadcrumb"><Link to="/">Home</Link><ChevronRight size={12} /><Link to="/shop">Shop</Link><ChevronRight size={12} /><span>{product.name}</span></div><div className="product-detail-grid"><img src={product.image} alt={`${product.name} spice packaging and bowl`} /><div><p className="eyebrow">{product.category}</p><h1>{product.name}</h1><p className="product-subtitle">{product.subtitle}</p><p className="detail-description">{product.description}</p><span className="weight-pill">{product.weight}</span><div className="detail-price">{money(product.price)}<small>Price per pack</small></div><p className={product.stock ? 'stock-note' : 'form-error'}>{product.stock ? 'Available for your spice shelf' : 'Currently out of stock'}</p><button className="button gold" disabled={!product.stock} onClick={() => addToCart(product)}>Add to bag <ShoppingBag size={17} /></button><div className="detail-note"><ShieldCheck size={20} strokeWidth={1} /><span>Store in a cool, dry place. Keep sealed to preserve the aroma.</span></div><Link to="/shop" className="text-link"><ArrowLeft size={14} />Back to all spices</Link></div></div></div><section className="section container"><SectionHeading eyebrow="MAKE ROOM ON YOUR SPICE SHELF" title="A little more to love." /><div className="product-grid">{products.filter(p => p.id !== id).slice(0, 4).map(p => <ProductCard product={p} key={p.id} />)}</div></section></>;
}

export function About() {
  return <><PageIntro eyebrow="THE MASALOO STORY" title={<>Some stories begin<br /><em>in the kitchen.</em></>}>Ours begins with a love for the flavours that bring us home.</PageIntro><StorySection /><section className="section about-values"><div className="container"><SectionHeading eyebrow="WHAT BRINGS US TO THE TABLE" title="Simple things. Deeply held." center /><div className="values-grid">{[[Leaf, 'A respect for ingredients', 'Every spice has its own character. We celebrate the warmth, colour, and aroma that make it special.'], [Sprout, 'A love for our roots', 'Indian kitchens are wonderfully diverse. Our collection is inspired by the everyday rituals and recipes that connect them.'], [Heart, 'The joy of sharing', 'A quick weekday dal or a long Sunday lunch: we believe there’s always room for a meal made with a little more love.']].map(([Icon, title, text], i) => <article key={title}><span className="value-number">0{i + 1}</span><Icon size={36} strokeWidth={1} /><h3>{title}</h3><p>{text}</p></article>)}</div></div></section><section className="about-cta container"><p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p><h2>Make something<br /><em>worth gathering for.</em></h2><Link to="/shop" className="button gold">Find your flavour <ArrowRight size={16} /></Link></section></>;
}

export function Contact() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ loading: false, message: '', success: false });
  async function submit(e) {
    e.preventDefault(); const form = e.currentTarget;
    setState({ loading: true, message: '', success: false });
    try { const data = await api('/contact', { method: 'POST', body: Object.fromEntries(new FormData(form)) }); form.reset(); setState({ loading: false, message: data.message, success: true }); }
    catch (err) { setState({ loading: false, message: err.message, success: false }); }
  }
  return <><PageIntro eyebrow="LET’S TALK" title={<>Good conversations.<br /><em>Great beginnings.</em></>}>A question, an idea, or simply a hello. There’s a place for it here.</PageIntro><section className="section"><div className="container contact-grid"><div className="contact-copy"><p className="eyebrow">OUR KITCHEN DOOR IS OPEN</p><h2>We’d love to<br />hear from you.</h2><p>Need help choosing a spice? Looking to bring Masaloo to your business? Send us a note and our team will get back to you.</p><div className="contact-reasons">{[[MessageCircle, 'A little help', 'Product questions, cooking ideas, and your feedback.'], [Building2, 'Let’s grow together', 'Retail, restaurant, and bulk order enquiries.'], [Mail, 'Straight to the team', 'Your message is saved securely in our team inbox.']].map(([Icon, title, desc]) => <div key={title}><Icon size={24} strokeWidth={1.2} /><div><h3>{title}</h3><p>{desc}</p></div></div>)}</div><div className="contact-detail-note"><Leaf size={20} /><p>Every good thing begins with a conversation.</p></div></div><form className="contact-form form-panel" onSubmit={submit}><h3>Drop us a little note.</h3><p className="muted">Fields marked * help us get back to you.</p><div className="form-row"><label>Your name *<input name="name" placeholder="What should we call you?" autoComplete="name" required maxLength={80} /></label><label>Email address *<input name="email" type="email" placeholder="you@example.com" autoComplete="email" required maxLength={254} /></label></div><label>What’s on your mind? *<select name="subject" defaultValue={params.get('subject') || 'Product enquiry'}><option>Product enquiry</option><option>Bulk order enquiry</option><option>Retail partnership</option><option>Feedback & suggestions</option><option>Something else</option></select></label><label>Your message *<textarea name="message" rows={6} placeholder="Tell us a little more…" required minLength={5} maxLength={5000} /></label><button className="button gold" disabled={state.loading}>{state.loading ? 'Sending your note…' : 'Send your message'}<ArrowRight size={16} /></button>{state.message && <p className={state.success ? 'form-success' : 'form-error'} role="status">{state.message}</p>}<p className="small muted">We use your details only to respond to your enquiry.</p></form></div></section></>;
}

export function BlogCard({ post }) {
  return <article className="blog-card"><Link to={`/blog/${post.id}`} className="blog-image"><img src={post.image} alt={post.title} loading="lazy" /><span>{post.category}</span></Link><div className="blog-meta">{date(post.createdAt)}<span>·</span>FROM THE MASALOO KITCHEN</div><Link to={`/blog/${post.id}`}><h3>{post.title}</h3></Link><p>{post.excerpt}</p><Link className="text-link" to={`/blog/${post.id}`}>Read the story <ArrowUpRight size={14} /></Link></article>;
}

function usePosts() {
  const [state, setState] = useState({ posts: [], loading: true, error: '' });
  useEffect(() => { api('/blogs').then(data => setState({ posts: data.posts, loading: false, error: '' })).catch(e => setState({ posts: [], loading: false, error: e.message })); }, []);
  return state;
}

export function Blog() {
  const { posts, loading, error } = usePosts();
  const [filter, setFilter] = useState('All stories');
  const options = ['All stories', ...new Set(posts.map(p => p.category))];
  const shown = filter === 'All stories' ? posts : posts.filter(p => p.category === filter);
  return <><PageIntro eyebrow="THE SPICE JOURNAL" title={<>Stories to savour.<br /><em>Ideas to stir.</em></>}>Notes from our kitchen. A daily dose of flavour for yours.</PageIntro><section className="section container"><div className="category-tabs blog-tabs">{options.map(c => <button className={filter === c ? 'active' : ''} onClick={() => setFilter(c)} key={c}>{c}</button>)}</div>{loading ? <p className="empty-state">Opening the journal…</p> : error ? <p className="notice error" role="alert">{error}</p> : shown.length ? <div className="journal-grid">{shown.map(p => <BlogCard key={p.id} post={p} />)}</div> : <p className="empty-state">Our next story is brewing. Come back soon.</p>}</section></>;
}

export function BlogPost() {
  const { id } = useParams();
  const { posts, loading, error } = usePosts();
  if (loading) return <div className="section container empty-state">Opening the story…</div>;
  if (error) return <div className="section container notice error">{error}</div>;
  const post = posts.find(p => p.id === id);
  if (!post) return <NotFound />;
  return <article className="article-page container"><div className="breadcrumb"><Link to="/blog">Spice journal</Link><ChevronRight size={12} /><span>{post.category}</span></div><p className="eyebrow">{post.category}</p><h1>{post.title}</h1><p className="article-excerpt">{post.excerpt}</p><div className="blog-meta">{date(post.createdAt)}<span>·</span>THE MASALOO KITCHEN</div><img className="article-cover" src={post.image} alt={post.title} /><div className="article-body">{post.content.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}<Link to="/blog" className="text-link"><ArrowLeft size={14} />Back to the journal</Link></div></article>;
}

export function NotFound() {
  return <section className="empty-state section container"><p className="eyebrow">A LITTLE DETOUR</p><h1>This flavour is<br /><em>still out there.</em></h1><p>We couldn’t find the page you were looking for.</p><Link to="/shop" className="button gold">Explore the spice shop <ArrowRight size={16} /></Link></section>;
}
