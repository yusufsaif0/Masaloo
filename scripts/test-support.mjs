import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function temporaryTestDirectory() {
  return mkdtemp(path.join(os.tmpdir(), 'masaloo-test-'));
}

export async function removeTestDirectory(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('masaloo-test-')) {
    throw new Error('Refusing to remove a directory outside the generated test scope.');
  }
  await rm(resolved, { recursive: true, force: true });
}

export async function isolateTestUploads() {
  const directory = await temporaryTestDirectory();
  process.env.UPLOAD_DIR = directory;
  return directory;
}
