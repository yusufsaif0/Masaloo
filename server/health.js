export function createHealthHandler({ connection, readiness, configured, production, timeoutMs = 1500 }) {
  let pending;
  function probe() {
    if (!pending) pending = (async () => {
      let timer;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => connection.db.command({ ping: 1, maxTimeMS: timeoutMs }, { timeoutMS: timeoutMs })),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Database health timeout')), timeoutMs); }),
        ]);
        return result?.ok === 1 && connection.readyState === 1;
      } catch { return false; }
      finally { clearTimeout(timer); }
    })().finally(() => { pending = null; });
    return pending;
  }
  return async (req, res) => {
    const connected = connection.readyState === 1 && Boolean(connection.db) && await probe();
    const ready = connected && readiness.ready && !readiness.shuttingDown;
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable', ready,
      database: connected ? 'connected' : configured || connection.readyState !== 0 || connection.db ? 'unavailable' : 'not configured',
      catalog: connected ? 'database' : production ? 'unavailable' : 'sample',
    });
  };
}
