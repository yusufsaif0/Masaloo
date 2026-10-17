import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const WholesaleContext = createContext();
function readBag(id) {
  try {
    const stored = JSON.parse(localStorage.getItem(`masaloo-wholesale-bag-${id}`) || '[]');
    if (!Array.isArray(stored)) return [];
    const seen = new Set();
    return stored.filter(item => {
      if (typeof item.productId !== 'string' || !Number.isInteger(item.quantityKg) || item.quantityKg < 1 || item.quantityKg > 100000 || seen.has(item.productId)) return false;
      seen.add(item.productId); return true;
    }).slice(0,50);
  } catch { return []; }
}
export function WholesaleProvider({ children }) {
  const [buyer, setBuyer] = useState(null), [authLoading, setAuthLoading] = useState(true), [sessionError, setSessionError] = useState('');
  const [products, setProducts] = useState([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [bag, setBag] = useState({ ownerId: null, items: [] }), [bagOpen, setBagOpen] = useState(false), [notice, setNotice] = useState('');
  const refreshSession = useCallback(async () => {
    setAuthLoading(true);
    try { const data = await api('/wholesale/auth/me'); setBuyer(data.buyer); setSessionError(''); }
    catch (e) { setBuyer(null); setSessionError(e.status === 401 ? '' : e.message); }
    finally { setAuthLoading(false); }
  }, []);
  useEffect(() => { refreshSession(); }, [refreshSession]);
  const refreshProducts = useCallback(async () => {
    if (!buyer) return;
    setLoading(true); setError('');
    try { const data = await api('/wholesale/products'); setProducts(data.products); }
    catch (e) { setError(e.message); if (e.status === 401 || e.status === 403) { setBuyer(null); setSessionError(e.message); setBagOpen(false); } }
    finally { setLoading(false); }
  }, [buyer?.id]);
  useEffect(() => {
    if (buyer) { setBag({ ownerId: buyer.id, items: readBag(buyer.id) }); refreshProducts(); }
    else { setProducts([]); setBagOpen(false); setBag({ ownerId: null, items: [] }); }
  }, [buyer?.id, refreshProducts]);
  useEffect(() => {
    if (buyer && bag.ownerId === buyer.id) { try { localStorage.setItem(`masaloo-wholesale-bag-${buyer.id}`, JSON.stringify(bag.items)); } catch {} }
  }, [bag, buyer?.id]);
  useEffect(() => { if (bagOpen) refreshProducts(); }, [bagOpen, refreshProducts]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t); }, [notice]);
  const signIn = value => { setBuyer(value); setSessionError(''); };
  const logout = async () => { await api('/wholesale/auth/logout', { method: 'POST' }); setBuyer(null); setSessionError(''); setBagOpen(false); };
  const bagItems = bag.ownerId === buyer?.id ? bag.items.map(item => {
    const product = products.find(p => p.id === item.productId);
    return product ? { ...product, productId: product.id, quantityKg: item.quantityKg, unavailable: false } : { ...item, name: 'Unavailable product', unavailable: true };
  }) : [];
  const addToBag = (product, quantity = product.minOrderKg) => {
    if (!Number.isInteger(quantity) || quantity < product.minOrderKg) return setNotice(`Minimum quantity for ${product.name}: ${product.minOrderKg} kg.`);
    const existing = bag.items.find(i => i.productId === product.id)?.quantityKg || 0;
    if (product.stockKg !== null && existing + quantity > product.stockKg) return setNotice(`Only ${product.stockKg} kg is currently available for ${product.name}.`);
    setBag(current => ({ ownerId: buyer.id, items: current.items.some(i => i.productId === product.id) ? current.items.map(i => i.productId === product.id ? { ...i, quantityKg: i.quantityKg + quantity } : i) : [...current.items, { productId: product.id, quantityKg: quantity }] }));
    setNotice(`${quantity} kg ${product.name} added to your bulk bag.`);
  };
  const updateQuantity = (productId, quantityKg) => setBag(current => ({ ...current, items: quantityKg <= 0 ? current.items.filter(i => i.productId !== productId) : current.items.map(i => i.productId === productId ? { ...i, quantityKg } : i) }));
  const clearBag = () => setBag({ ownerId: buyer.id, items: [] });
  return <WholesaleContext.Provider value={{ buyer, authLoading, sessionError, refreshSession, signIn, logout, products, loading, error, refreshProducts, bagItems, bagOpen, setBagOpen, addToBag, updateQuantity, clearBag, notice }}>{children}</WholesaleContext.Provider>;
}
export const useWholesale = () => useContext(WholesaleContext);
