import { randomBytes } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
const target = new URL('../.env', import.meta.url);
try { await access(target); console.log('.env already exists; kept existing configuration.'); }
catch {
  await writeFile(target, `PORT=4000\nMONGODB_URI=mongodb://127.0.0.1:27017/masaloo\nJWT_SECRET=${randomBytes(48).toString('hex')}\nCLIENT_ORIGIN=http://127.0.0.1:5173\nADMIN_NAME=\nADMIN_EMAIL=\nADMIN_PASSWORD=\n`, { flag: 'wx' });
  console.log('Created local .env with a random session secret. Owner details still need to be set.');
}
