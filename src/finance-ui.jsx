import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { api, money } from './api';
import { indiaToday, monthBounds } from '../shared/sales';

export const cash = paise => money((paise || 0) / 100);
export const dayLabel = value => new Date(`${value}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
export const monthLabel = value => new Date(`${value}-01T00:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
export const query = values => new URLSearchParams(Object.entries(values).filter(([,value]) => value !== '' && value !== undefined)).toString();
export function useFinance(path, revision = 0) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    let active = true;
    setState(s => ({ ...s, loading: true, error: '' }));
    api(`/admin/finance${path}`).then(data => { if (active) setState({ data, loading: false, error: '' }); }).catch(e => { if (active) setState({ data: null, loading: false, error: e.message }); });
    return () => { active = false; };
  }, [path, version, revision]);
  return { ...state, refresh };
}
export function FinanceState({ data, loading, error, refresh, children }) {
  if (loading && !data) return <div className="finance-loading" role="status"><RefreshCw size={19} />Loading your records…</div>;
  if (error) return <div className="notice error" role="alert"><p>{error}</p><button className="text-link" onClick={refresh}>Try again</button></div>;
  return <div className="finance-results" aria-busy={loading}>{loading && <p className="finance-updating" role="status">Updating records…</p>}{children}</div>;
}
export function FinanceStats({ summary = {}, credit = false }) {
  const fields = credit ? [
    ['Outstanding udhari', cash(summary.outstandingPaise), 'Remaining balance across these customers'],
    ['Overdue amount', cash(summary.overduePaise), 'Past the agreed due date'],
    ['Customers with dues', summary.withDue || 0, 'Customers with an unpaid balance'],
    ['Saved customers', summary.customers || 0, 'Matching your current filters'],
  ] : [
    ['Sales value', cash(summary.totalPaise), `${summary.saleCount || 0} sales · ${summary.units || 0} packs sold`],
    ['Money collected', cash(summary.collectedPaise), 'Payments received during these dates'],
    ['Udhari on these sales', cash(summary.outstandingPaise), 'Current unpaid balance on selected sales'],
    ['Sales by channel', cash(summary.shopPaise), `Offline / shop · Online ${cash(summary.onlinePaise)}`],
  ];
  return <div className="finance-stats">{fields.map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>;
}
export function ChannelSelect({ value, onChange }) {
  return <label className="finance-filter-label">Sales channel<select aria-label="Sales channel" value={value} onChange={e => onChange(e.target.value)}><option value="all">Online + shop</option><option value="shop">Offline / shop</option><option value="online">Online only</option></select></label>;
}
export function RangeFilters({ filters, setFilters, children }) {
  const change = (key, value) => setFilters(f => ({ ...f, [key]: value, page: 1 }));
  return <div className="finance-filters"><label>From date<input type="date" aria-label="From date" value={filters.from} onChange={e => change('from', e.target.value)} /></label><label>To date<input type="date" aria-label="To date" value={filters.to} onChange={e => change('to', e.target.value)} /></label><ChannelSelect value={filters.channel} onChange={value => change('channel', value)} />{children}<div className="finance-date-shortcuts"><button onClick={() => setFilters(f => ({ ...f, from: indiaToday(), to: indiaToday(), page: 1 }))}>Today</button><button onClick={() => setFilters(f => ({ ...f, ...monthBounds(indiaToday().slice(0,7)), page: 1 }))}>This month</button></div></div>;
}
export function Pager({ data, onChange }) {
  return <div className="finance-pager"><span>{data.total} records · Page {data.page} of {data.pages}</span><div><button className="icon-button" disabled={data.page <= 1} aria-label="Previous page" onClick={() => onChange(data.page - 1)}><ChevronLeft size={16} /></button><button className="icon-button" disabled={data.page >= data.pages} aria-label="Next page" onClick={() => onChange(data.page + 1)}><ChevronRight size={16} /></button></div></div>;
}
export function PaymentStatus({ sale }) {
  const status = sale.status === 'cancelled' ? 'Cancelled' : sale.paidPaise === sale.totalPaise ? 'Paid' : sale.paidPaise > 0 ? 'Part paid' : 'Udhari';
  return <span className={`finance-status ${status === 'Paid' ? 'paid' : status === 'Cancelled' ? 'cancelled' : 'due'}`}>{status}</span>;
}
export function ExportButton({ filename, headings, rows, label = 'Export CSV', disabled = false }) {
  function download() {
    const escape = value => {
      let string = String(value ?? '');
      if (/^[=+@\-\t\r]/.test(string)) string = `'${string}`;
      return `"${string.replaceAll('"', '""')}"`;
    };
    const csv = '\uFEFF' + [headings, ...rows].map(row => row.map(escape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <button className="button outline finance-export" disabled={disabled || !rows.length} onClick={download}><Download size={14} />{label}</button>;
}
