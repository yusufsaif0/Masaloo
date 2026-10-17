import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api';

const Store = createContext();
function readCart() {
  try {
    const value = JSON.parse(localStorage.getItem('masaloo-cart') || '[]');
    return Array.isArray(value) ? value.filter(x => typeof x.id === 'string' && Number.isInteger(x.quantity) && x.quantity > 0).slice(0, 100) : [];
  } catch { return []; }
}

export function StoreProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [sample, setSample] = useState(false);
  const [cart, setCart] = useState(readCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [toast, setToast] = useState('');
  const notify = useCallback(message => setToast(message), []);
  const refreshProducts = useCallback(async () => {
    setLoading(true);
    try { const data = await api('/products'); setProducts(data.products); setSample(data.sample); setCatalogError(''); }
    catch (e) { setCatalogError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refreshProducts(); api('/auth/me').then(data => setUser(data.user)).catch(() => {}).finally(() => setAuthLoading(false)); }, [refreshProducts]);
  useEffect(() => { try { localStorage.setItem('masaloo-cart', JSON.stringify(cart)); } catch {} }, [cart]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);
  const cartItems = cart.map(item => {
    const product = products.find(p => p.id === item.id);
    return product && product.stock > 0 ? { ...product, quantity: Math.min(item.quantity, product.stock) } : null;
  }).filter(Boolean);
  const addToCart = product => {
    const existing = cart.find(x => x.id === product.id)?.quantity || 0;
    if (existing >= product.stock) return notify('You’ve reached the available quantity for this spice.');
    setCart(items => items.some(x => x.id === product.id) ? items.map(x => x.id === product.id ? { ...x, quantity: x.quantity + 1 } : x) : [...items, { id: product.id, quantity: 1 }]);
    notify(`${product.name} added to your bag`);
  };
  const updateQuantity = (id, quantity) => {
    const product = products.find(p => p.id === id);
    setCart(items => quantity <= 0 ? items.filter(x => x.id !== id) : items.map(x => x.id === id ? { ...x, quantity: Math.min(quantity, product?.stock || 0) } : x));
  };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); notify('You have signed out.'); };
  return <Store.Provider value={{ products, loading, sample, catalogError, refreshProducts, cartItems, addToCart, updateQuantity, cartOpen, setCartOpen, user, setUser, authLoading, logout, toast, notify }}>{children}</Store.Provider>;
}
export const useStore = () => useContext(Store);
