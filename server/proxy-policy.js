import { BlockList, isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';

const forwardingHeaders = ['forwarded', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip'];

export function normalizeIp(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.includes('%') || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([\da-f]+):([\da-f]+)$/i);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return canonical;
}

export function readProxyPolicy(env, production) {
  const mode = env.PROXY_MODE || (production ? '' : 'direct');
  if (!['direct', 'trusted-real-ip'].includes(mode)) throw new Error('Set PROXY_MODE explicitly to direct or trusted-real-ip.');
  if (mode === 'direct') {
    if (env.TRUSTED_PROXY_CIDRS || env.PROXY_HEADER_VERIFIED) throw new Error('Direct proxy mode cannot include forwarded-header trust settings.');
    return { mode, production, trustsPeer: () => false };
  }
  if (env.PROXY_HEADER_VERIFIED !== 'true') throw new Error('Trusted proxy mode requires staging verification and PROXY_HEADER_VERIFIED=true.');
  const entries = (env.TRUSTED_PROXY_CIDRS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!entries.length || entries.length > 32) throw new Error('Provide a bounded TRUSTED_PROXY_CIDRS allowlist after ingress verification.');
  const allowlist = new BlockList();
  for (const entry of entries) {
    const [address, mask, extra] = entry.split('/');
    const normalized = normalizeIp(address), family = normalized && isIP(normalized);
    const prefix = mask === undefined ? (family === 4 ? 32 : 128) : Number(mask);
    if (!normalized || extra !== undefined || (mask !== undefined && !/^\d+$/.test(mask)) || !Number.isInteger(prefix)
      || prefix < (family === 4 ? 24 : 64) || prefix > (family === 4 ? 32 : 128)
      || (family !== isIP(address))) throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IPs or narrow IPv4/IPv6 subnets.');
    allowlist.addSubnet(normalized, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return { mode, production, trustsPeer: address => {
    const normalized = normalizeIp(address);
    return Boolean(normalized && allowlist.check(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6'));
  } };
}

export function clientIpMiddleware(policy) {
  return (req, res, next) => {
    const reject = () => res.status(503).json({ error: 'The request ingress could not be verified.' });
    const peer = normalizeIp(req.socket.remoteAddress);
    if (!peer) return reject();
    if (policy.mode === 'direct') {
      // In development, forwarding headers are ignored. Production direct mode rejects them.
      if (policy.production && forwardingHeaders.some(header => req.headers[header] !== undefined)) return reject();
      req.clientIp = peer;
    } else {
      if (!policy.trustsPeer(peer)) return reject();
      const count = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'x-real-ip').length;
      const client = normalizeIp(req.headers['x-real-ip']);
      if (count !== 1 || !client) return reject();
      // X-Forwarded-For is deliberately never used. The peer must overwrite X-Real-IP;
      // this property cannot be established locally and must be verified in staging.
      req.clientIp = client;
    }
    next();
  };
}

export const limiterIdentity = {
  keyGenerator: req => ipKeyGenerator(req.clientIp, 56),
  // Express trust stays disabled; our middleware validates the selected identity instead.
  validate: { xForwardedForHeader: false, trustProxy: false },
};
