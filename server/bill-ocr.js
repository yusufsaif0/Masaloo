import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import sharp from 'sharp';
import { parseBillText } from './bill-parser.js';

const problem = (status, message) => Object.assign(new Error(message), { status });
export async function prepareBillImage(bytes) {
  try {
    const image = sharp(bytes, { limitInputPixels: 30000000, animated: false });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.pages > 1) throw Error();
    return await image.rotate().resize({ width: 2200, height: 4000, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).png().toBuffer();
  } catch { throw problem(400, 'Choose a clear JPG, PNG or WebP bill image up to 5 MB.'); }
}
export function createBillReader({ timeoutMs = 45000 } = {}) {
  let busy = false;
  return async (bytes, { signal } = {}) => {
    if (busy) throw problem(429, 'Another bill is being read. Try again shortly, or enter the details manually.');
    busy = true; let child, timer;
    try {
      const image = await prepareBillImage(bytes);
      await Promise.all(['eng', 'hin'].map(language => access(fileURLToPath(new URL(`../data/ocr/${language}.traineddata.gz`, import.meta.url)))));
      const output = await new Promise((resolve, reject) => {
        child = fork(fileURLToPath(new URL('./ocr-worker.js', import.meta.url)), [], {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', windowsHide: true,
          execArgv: ['--max-old-space-size=256'],
        });
        const cancel = () => { child.kill(); reject(problem(408, 'Reading was cancelled. You can enter the details manually.')); };
        signal?.addEventListener('abort', cancel, { once: true });
        child.once('exit', () => signal?.removeEventListener('abort', cancel));
        child.once('message', data => data.error ? reject(problem(422, 'Could not read this bill. Enter the details manually or try a clearer photo.')) : resolve(data));
        child.once('error', () => reject(problem(503, 'Bill reading is unavailable. You can still enter the details manually.')));
        child.once('exit', () => reject(problem(422, 'Bill reading stopped. Enter the details manually or try a clearer photo.')));
        timer = setTimeout(() => { child.kill(); reject(problem(408, 'Reading took too long. Enter the details manually or try a smaller, clearer image.')); }, timeoutMs);
        if (signal?.aborted) cancel(); else child.send(image);
      });
      return parseBillText(output.text, output.confidence);
    } catch (error) {
      if (error.status) throw error;
      throw problem(503, 'Bill reading is unavailable. You can still enter the details manually.');
    } finally { clearTimeout(timer); child?.kill(); busy = false; }
  };
}
export const readBill = createBillReader();
