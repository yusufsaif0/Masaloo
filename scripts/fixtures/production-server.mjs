import mongoose from 'mongoose';
import { startServer } from '../../server/startup.js';

if (process.env.NODE_ENV !== 'production' || !/^mongodb:\/\/127\.0\.0\.1:27017\/masaloo_test_production_[a-f0-9]+$/.test(process.env.MONGODB_URI || '')) {
  throw new Error('This fixture only runs against a generated local production-test database.');
}
try {
  const runtime = await startServer();
  process.on('message', async message => {
    if (message === 'SIGTERM' || message === 'SIGINT') process.emit(message);
    if (message === 'disconnect-database') { await mongoose.disconnect(); process.send?.({ type: 'disconnected' }); }
  });
  process.send?.({ type: 'ready', address: runtime.server.address() });
} catch (error) { console.error(error.message); process.exitCode = 1; }
