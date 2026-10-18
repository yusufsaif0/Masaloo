import { createWorker } from 'tesseract.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.once('message', async bytes => {
  let worker;
  try {
    worker = await createWorker(['eng', 'hin'], 1, {
      langPath: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/ocr'),
      cacheMethod: 'none', gzip: true, errorHandler: () => {},
    });
    await worker.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: '300' });
    const { data } = await worker.recognize(Buffer.from(bytes));
    await worker.terminate(); worker = null;
    process.send({ text: String(data.text || '').slice(0, 20000), confidence: Number(data.confidence) || 0 }, () => process.exit(0));
  } catch {
    await worker?.terminate().catch(() => {});
    process.send({ error: true }, () => process.exit(1));
  }
});
