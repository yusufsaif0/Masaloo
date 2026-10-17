export function createShutdown({ server, readiness, disconnect, timeoutMs = 25000, exit = code => process.exit(code), log = message => console.log(message) }) {
  const sockets = new Set();
  const responses = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('request', (req, res) => {
    if (res.writableFinished) return;
    responses.add(res);
    const finished = () => {
      responses.delete(res);
      // An active response can become an idle keep-alive connection after close() starts.
      if (readiness.shuttingDown) setImmediate(() => server.closeIdleConnections?.());
    };
    res.once('finish', finished); res.once('close', finished);
  });
  let shutdown, databaseClose;
  const closeDatabase = () => {
    if (!databaseClose) {
      try { databaseClose = Promise.resolve(disconnect()); }
      catch (error) { databaseClose = Promise.reject(error); }
    }
    return databaseClose;
  };
  return function stop() {
    if (shutdown) return shutdown;
    readiness.ready = false; readiness.shuttingDown = true;
    for (const response of responses) if (!response.headersSent) response.setHeader('Connection', 'close');
    let resolve, timer, finished = false;
    shutdown = new Promise(done => { resolve = done; });
    const finish = code => {
      if (finished) return;
      finished = true; clearTimeout(timer); resolve(code); exit(code);
    };
    timer = setTimeout(() => {
      log('Shutdown deadline reached; closing remaining connections.');
      server.closeAllConnections?.(); for (const socket of sockets) socket.destroy();
      closeDatabase().catch(() => {});
      finish(1);
    }, timeoutMs);
    (async () => {
      try {
        await new Promise((done, reject) => {
          server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : done());
          server.closeIdleConnections?.();
        });
        if (finished) return;
        await closeDatabase();
        log('HTTP requests drained and database closed.'); finish(0);
      } catch { log('Shutdown failed.'); finish(1); }
    })();
    return shutdown;
  };
}

export function installShutdownHandlers(stop, signals = process) {
  const handler = () => { void stop(); };
  signals.on('SIGTERM', handler); signals.on('SIGINT', handler);
  return () => { signals.off('SIGTERM', handler); signals.off('SIGINT', handler); };
}
