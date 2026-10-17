import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { api, money } from './api';
export const bulkPrice = paise => paise === null || paise === undefined ? 'Price on request' : money(paise / 100);
export function useWholesaleData(path, revision = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    let active = true; setState(s => ({ ...s, loading: true, error: '' }));
    api(path).then(data => { if(active) setState({ data, loading: false, error: '' }); }).catch(e => { if(active) setState({ data: null, loading: false, error: e.message }); });
    return () => { active = false; };
  }, [path, revision, version]);
  return { ...state, refresh };
}
export function WholesaleState({ data, loading, error, refresh, children }) {
  if (loading && !data) return <div className="ws-loading" role="status"><RefreshCw size={20} />Opening the wholesale store…</div>;
  if (error) return <div className="notice error" role="alert"><p>{error}</p>{refresh && <button className="text-link" onClick={refresh}>Try again</button>}</div>;
  return <div className="ws-results" aria-busy={loading}>{children}</div>;
}
export function WholesalePager({ data, onChange }) {
  return <div className="ws-pager"><span>{data.total} records · Page {data.page} of {data.pages}</span><div><button className="icon-button" aria-label="Previous wholesale page" disabled={data.page <= 1} onClick={() => onChange(data.page-1)}><ChevronLeft size={15} /></button><button className="icon-button" aria-label="Next wholesale page" disabled={data.page >= data.pages} onClick={() => onChange(data.page+1)}><ChevronRight size={15} /></button></div></div>;
}
