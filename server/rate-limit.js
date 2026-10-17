import { ipKeyGenerator } from 'express-rate-limit';

// Use the actual connection address. Forwarding headers never choose a rate-limit key.
// Behind a proxy, visitors can share this budget; no proxy configuration is required.
export const limiterIdentity = {
  keyGenerator: req => ipKeyGenerator(req.socket.remoteAddress || 'unknown', 56),
  validate: { xForwardedForHeader: false, trustProxy: false },
};
