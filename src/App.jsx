import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { StoreProvider, useStore } from './store';
import { Header, Footer, Cart, Newsletter } from './components';
import { Home, Shop, ProductDetail, About, Contact, Blog, BlogPost, NotFound } from './pages';
import AdminAuth, { AdminHeader, AdminAccess } from './admin-auth';
import { WholesaleProvider } from './wholesale-context';
const Account = lazy(() => import('./admin').then(module => ({ default: module.Account })));
const Admin = lazy(() => import('./admin').then(module => ({ default: module.Admin })));
const WholesaleEntry = lazy(() => import('./wholesale').then(module => ({ default: module.WholesaleEntry })));
const WholesaleAuth = lazy(() => import('./wholesale').then(module => ({ default: module.WholesaleAuth })));
const WholesaleStore = lazy(() => import('./wholesale').then(module => ({ default: module.WholesaleStore })));
const WholesaleDetail = lazy(() => import('./wholesale').then(module => ({ default: module.WholesaleDetail })));
const WholesaleHistory = lazy(() => import('./wholesale').then(module => ({ default: module.WholesaleHistory })));
const WholesaleBag = lazy(() => import('./wholesale').then(module => ({ default: module.WholesaleBag })));

function Layout() {
  const { toast } = useStore();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const titles = { '/': 'Pure Spices. Rich Taste.', '/shop': 'The Spice Shop', '/about': 'Our Story', '/contact': 'Let’s Talk', '/blog': 'The Spice Journal', '/account': 'Your Account', '/admin': 'Team Dashboard', '/admin/login': 'Admin Login', '/admin/register': 'Admin Registration' };
    document.title = `Masaloo — ${location.pathname.startsWith('/wholesale') ? 'Wholesale Raw Spices' : titles[location.pathname] || 'A World of Flavour'}`;
  }, [location.pathname]);
  const isAdmin = location.pathname.startsWith('/admin');
  const isWholesale = location.pathname.startsWith('/wholesale');
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    {isAdmin ? <AdminHeader /> : <Header />}
    <main id="main"><Suspense fallback={<div className="container section empty-state">Opening your kitchen…</div>}><Routes>
      <Route path="/" element={<Home />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/shop/:id" element={<ProductDetail />} />
      <Route path="/about" element={<About />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/blog/:id" element={<BlogPost />} />
      <Route path="/account" element={<Account />} />
      <Route path="/wholesale" element={<WholesaleEntry />} />
      <Route path="/wholesale/register" element={<WholesaleAuth key="wholesale-register" register />} />
      <Route path="/wholesale/login" element={<WholesaleAuth key="wholesale-login" />} />
      <Route path="/wholesale/store" element={<WholesaleStore />} />
      <Route path="/wholesale/products/:id" element={<WholesaleDetail />} />
      <Route path="/wholesale/enquiries" element={<WholesaleHistory />} />
      <Route path="/admin/login" element={<AdminAuth key="login" />} />
      <Route path="/admin/register" element={<AdminAuth key="register" register />} />
      <Route path="/admin" element={<AdminAccess><Admin /></AdminAccess>} />
      <Route path="*" element={<NotFound />} />
    </Routes></Suspense></main>
    {!isAdmin && <>{!isWholesale && <Newsletter />}<Footer /><Cart />{isWholesale && <Suspense fallback={null}><WholesaleBag /></Suspense>}</>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
  </>;
}
export default function App() { return <StoreProvider><WholesaleProvider><Layout /></WholesaleProvider></StoreProvider>; }
