import 'dotenv/config';
import { startServer } from './startup.js';

try { await startServer(); }
catch (error) {
  // Startup helpers emit fixed configuration messages, never raw driver errors/URIs.
  console.error(`Masaloo startup failed: ${error.message}`);
  process.exitCode = 1;
}
