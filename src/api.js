export async function api(path, options = {}) {
  const form = options.body instanceof FormData;
  let response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { ...(!form && options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.body ? (form ? options.body : JSON.stringify(options.body)) : undefined });
  } catch { throw new Error('Unable to reach the store. Check your connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || 'The request could not be completed. Please try again.'); error.status = response.status; throw error; }
  return data;
}

export const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
export const date = value => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
