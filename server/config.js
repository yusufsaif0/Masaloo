import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProxyPolicy } from './proxy-policy.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function uploadDirectory(env = process.env) {
  const production = env.NODE_ENV === 'production', configured = env.UPLOAD_DIR;
  if (production && (!configured || !path.isAbsolute(configured))) throw new Error('Production requires an absolute UPLOAD_DIR on persistent storage.');
  const directory = path.resolve(configured || path.join(root, 'uploads'));
  const relative = path.relative(root, directory);
  const toApplication = path.relative(directory, root);
  const ancestor = toApplication === '' || (toApplication !== '..' && !toApplication.startsWith('..' + path.sep) && !path.isAbsolute(toApplication));
  const checked = process.platform === 'win32' ? relative.toLowerCase() : relative;
  if (directory === path.parse(directory).root || ancestor
    || ['src', 'server', 'shared', 'scripts', 'public', 'dist', 'data', 'assets', 'node_modules'].some(name => checked === name || checked.startsWith(name + path.sep))) {
    throw new Error('UPLOAD_DIR must be a dedicated writable upload directory.');
  }
  return directory;
}

export function readConfig(env = process.env) {
  const mode = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('NODE_ENV must be development, test, or production.');
  const production = mode === 'production';
  const port = Number(env.PORT || 4000);
  if (!/^\d+$/.test(String(env.PORT || 4000)) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const mongoUri = env.MONGODB_URI || '';
  let origin = env.CLIENT_ORIGIN || 'http://127.0.0.1:5173';
  if (production) {
    if (!/^mongodb(?:\+srv)?:\/\/[^/\s]+\/[^?\s]+(?:\?[^#\s]*)?$/.test(mongoUri)) throw new Error('Production requires MONGODB_URI with an explicit database name.');
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /<|>|change[-_ ]?me/i.test(env.JWT_SECRET)) throw new Error('Production requires a strong JWT_SECRET of at least 32 characters.');
    let url;
    try { url = new URL(env.CLIENT_ORIGIN); } catch { throw new Error('Production requires a valid HTTPS CLIENT_ORIGIN.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('CLIENT_ORIGIN must be one HTTPS origin without credentials, a path, query, or fragment.');
    origin = url.origin;
  }
  return { production, mode, port, host: production ? '0.0.0.0' : '127.0.0.1', mongoUri, origin,
    uploadDir: uploadDirectory(env), proxy: readProxyPolicy(env, production), healthTimeoutMs: 1500, shutdownTimeoutMs: 25000 };
}
