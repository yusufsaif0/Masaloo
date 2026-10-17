import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Eye, EyeOff, LockKeyhole, ShieldCheck, RefreshCw } from 'lucide-react';
import { api } from './api';
import { useStore } from './store';

export function AdminHeader() {
  return <header className="portal-header"><div className="container"><Link to="/admin" className="portal-brand">Masaloo<span>ADMIN PORTAL</span></Link><Link to="/" className="portal-back"><ArrowLeft size={14} />Visit store</Link></div></header>;
}

export function AdminAccess({ children }) {
  const { user, setUser, authLoading, logout } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  if (authLoading) return <section className="container section empty-state">Checking your session…</section>;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (user.role !== 'pending' && user.role !== 'customer') return children;
  async function checkAccess() {
    setBusy(true); setError('');
    try { setUser((await api('/auth/me')).user); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setError('');
    try { await logout(); navigate('/admin/login', { replace: true }); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return <section className="portal-auth"><div className="portal-auth-card portal-pending"><div className="portal-auth-icon"><ShieldCheck size={28} strokeWidth={1.3} /></div><p className="eyebrow">MASALOO ADMIN</p><h1>{user.role === 'pending' ? 'Awaiting approval' : 'Team access required'}</h1><p className="portal-auth-description">{user.role === 'pending' ? `Thanks, ${user.name}. Your account is registered. The store owner needs to assign you a team role before you can open the dashboard.` : 'You are signed in with a customer account. Ask the store owner to assign you a team role, or sign in with your admin account.'}</p><p className="portal-pending-email">{user.email}</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button gold full" disabled={busy} onClick={checkAccess}>{busy ? 'Checking…' : 'Check access'}<RefreshCw size={15} /></button><button className="text-link" onClick={signOut} disabled={busy}>Sign out</button></div></section>;
}

export default function AdminAuth({ register = false }) {
  const { user, setUser, authLoading } = useStore();
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [checking, setChecking] = useState(register);
  const [state, setState] = useState({ loading: false, error: '' });
  const navigate = useNavigate();

  async function checkRegistration() {
    setChecking(true); setStatusError('');
    try { setStatus(await api('/auth/admin-registration')); }
    catch (e) { setStatusError(e.message); }
    finally { setChecking(false); }
  }
  useEffect(() => { setState({ loading: false, error: '' }); setVisible(false); if (register) checkRegistration(); }, [register]);

  async function submit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (register && data.password !== data.confirmPassword) return setState({ loading: false, error: 'Passwords do not match.' });
    setState({ loading: true, error: '' });
    try {
      const result = await api(register ? '/auth/admin-register' : '/auth/admin-login', { method: 'POST', body: data });
      setUser(result.user);
      navigate('/admin', { replace: true });
    } catch (e) { setState({ loading: false, error: e.message }); }
  }

  if (authLoading) return <section className="container section empty-state">Checking your session…</section>;
  if (user && user.role !== 'customer') return <Navigate to="/admin" replace />;
  return <section className="portal-auth"><div className="portal-auth-card">
    <div className="portal-auth-icon">{register ? <ShieldCheck size={25} strokeWidth={1.4} /> : <LockKeyhole size={25} strokeWidth={1.4} />}</div>
    <p className="eyebrow">MASALOO ADMIN</p>
    <h1>{register ? 'Create admin account' : 'Admin login'}</h1>
    <p className="portal-auth-description">{register ? (status?.firstOwner ? 'Set up your owner account to start managing your store.' : 'Register for team access. The owner will assign your role.') : 'Sign in to manage your products, prices, and store.'}</p>
    <div className="portal-auth-tabs"><Link to="/admin/login" className={!register ? 'active' : ''}>Login</Link><Link to="/admin/register" className={register ? 'active' : ''}>Register</Link></div>
    {register && checking ? <p className="portal-auth-loading" role="status">Checking registration…</p> : register && statusError ? <div className="portal-auth-status"><p className="form-error" role="alert">{statusError}</p><button className="text-link" onClick={checkRegistration}><RefreshCw size={13} />Try again</button></div> : register && !status?.canRegister ? <p className="notice">The first owner account must be set up on the store’s local computer. Contact the store owner for access.</p> : <form className="portal-auth-form" onSubmit={submit} key={register ? 'register' : 'login'}>
      {register && <label htmlFor="admin-name">Full name<input id="admin-name" name="name" autoComplete="name" placeholder="Your full name" maxLength={80} required disabled={state.loading} /></label>}
      <label htmlFor="admin-email">Email address<input id="admin-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required disabled={state.loading} /></label>
      <label htmlFor="admin-password">Password</label><div className="portal-password"><input id="admin-password" name="password" type={visible ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'At least 10 characters' : 'Enter your password'} minLength={register ? 10 : 1} maxLength={72} required disabled={state.loading} aria-describedby={register ? 'admin-password-hint' : undefined} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
      {register && <><small id="admin-password-hint" className="portal-password-hint">Use at least 10 characters.</small><label htmlFor="admin-confirm">Confirm password<input id="admin-confirm" name="confirmPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter your password again" maxLength={72} required disabled={state.loading} /></label></>}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="button gold full" disabled={state.loading}>{state.loading ? (register ? 'Creating account…' : 'Signing in…') : (register ? 'Create account' : 'Login')}<ArrowRight size={16} /></button>
    </form>}
    <p className="portal-auth-footnote"><ShieldCheck size={14} />{register && status?.firstOwner ? 'This first account will be the store owner.' : 'Access is based on the role assigned to your account.'}</p>
  </div><p className="portal-auth-bottom">Masaloo · Store management</p></section>;
}
