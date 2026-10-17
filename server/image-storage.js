import { constants } from 'node:fs';
import { access, mkdir, lstat, realpath, open, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { uploadDirectory } from './config.js';

const fileName = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/;
export class ImageError extends Error { constructor(message, status) { super(message); this.status = status; } }
const unavailable = () => new ImageError('Image storage is unavailable. Please try again later.', 503);

export function createImageStorage(directory = uploadDirectory()) {
  const base = path.resolve(directory);
  const target = name => {
    if (typeof name !== 'string' || !fileName.test(name)) throw new ImageError('Invalid image filename.', 400);
    return path.join(base, name);
  };
  async function existing(name) {
    const file = target(name), metadata = await lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || path.dirname(await realpath(file)) !== await realpath(base)) throw new ImageError('Image not found.', 404);
    return file;
  }
  async function prepare() {
    try { await mkdir(base, { recursive: true }); await access(base, constants.R_OK | constants.W_OK); }
    catch { throw unavailable(); }
  }
  async function writeImage(bytes, { name = `${randomUUID()}.webp`, width = 1600, height = 1600, quality = 85, reuse = false } = {}) {
    if (!name.endsWith('.webp')) throw new ImageError('Images must be stored as WebP.', 400);
    const file = target(name);
    let encoded;
    try { encoded = await sharp(bytes, { limitInputPixels: 30000000 }).rotate().resize(width, height, { fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer(); }
    catch { throw new ImageError('That file is not a supported image. Choose a JPG, PNG, or WebP.', 400); }
    let temporary, handle;
    try {
      await prepare();
      const temporaryPath = path.join(base, `.image-${randomUUID()}.tmp`);
      handle = await open(temporaryPath, 'wx'); temporary = temporaryPath;
      await handle.writeFile(encoded); await handle.sync(); await handle.close(); handle = null;
      try { await link(temporary, file); }
      catch (error) { if (error.code !== 'EEXIST' || !reuse) throw error; await existing(name); }
      return `/uploads/${name}`;
    } catch { throw unavailable(); }
    finally {
      await handle?.close().catch(() => {});
      // Only our exclusively-created temporary file is removed; existing images are never overwritten.
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  async function serve(req, res) {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(404).json({ error: 'Image not found.' });
    let name;
    try { name = decodeURIComponent(req.path.slice(1)); if (!fileName.test(name)) throw new Error(); }
    catch { return res.status(404).json({ error: 'Image not found.' }); }
    let file;
    try { file = await existing(name); }
    catch (error) {
      const missing = ['ENOENT', 'ENOTDIR'].includes(error.code) || error.status === 404;
      return res.status(missing ? 404 : 503).json({ error: missing ? 'Image not found.' : 'Image storage is unavailable.' });
    }
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.sendFile(file, { dotfiles: 'deny' }, error => {
      if (!error || res.headersSent) return;
      const missing = error.status === 404 || error.code === 'ENOENT';
      res.status(missing ? 404 : 503).json({ error: missing ? 'Image not found.' : 'Image storage is unavailable.' });
    });
  }
  return { directory: base, prepare, existing, writeImage, serve };
}
