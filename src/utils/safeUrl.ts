import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

/**
 * SSRF protection for user-supplied URLs (welcome backgrounds, direct audio
 * in /play, addon downloads...). The bot must not be usable to make requests
 * to the VPS internal network (127.0.0.1, 10.x, cloud metadata, other local
 * services).
 *
 * Audit 2026-11-21 (J·GEN-01, J·GEN-02):
 *  - IPs are classified with net.BlockList, which recognises IPv4 addresses
 *    embedded in IPv6 in any form (`::ffff:127.0.0.1`, `::ffff:7f00:1`...).
 *    The text used to be compared, and `new URL()` normalises to the hex form.
 *  - Downloads resolve DNS once, validate ALL the IPs and connect to that
 *    pinned IP (custom lookup), revalidating on every redirect. There is no
 *    window between validating and connecting (DNS rebinding).
 */

const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128],
  ['::', 96],            // IPv4-compatible (deprecated)
  ['::ffff:0:0:0', 96],  // IPv4-translated
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], // NAT64 (may wrap private IPs)
  ['100::', 64],         // discard
  ['2001::', 32],        // Teredo
  ['2001:db8::', 32],    // documentation
  ['2002::', 16],        // 6to4 (wraps arbitrary IPv4)
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) BLOCKED.addSubnet(addr, prefix, 'ipv6');

/** true if the IP (v4 or v6, including mapped IPv4) is not publicly routable. */
export function isPrivateIP(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED.check(ip, 'ipv4');
  if (family === 6) return BLOCKED.check(ip, 'ipv6');
  return true; // not an IP: treat as non-public
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isInternalName(host: string): boolean {
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local');
}

/**
 * Synchronous check (no DNS) of a URL's host: localhost, internal
 * domains or a literal private/reserved IP. Useful when no request is
 * made (e.g. a redirector) or before resolving.
 */
export function isPrivateLiteralHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (isInternalName(host)) return true;
  if (net.isIP(host)) return isPrivateIP(host);
  return false;
}

/** Resolves a host and returns its IPs only if ALL of them are public; throws otherwise. */
export async function resolvePublicAddresses(hostname: string): Promise<dns.LookupAddress[]> {
  const host = normalizeHost(hostname);
  if (isInternalName(host)) throw new Error('URL not allowed');
  if (net.isIP(host)) {
    if (isPrivateIP(host)) throw new Error('URL not allowed');
    return [{ address: host, family: net.isIP(host) }];
  }
  const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIP(a.address))) throw new Error('URL not allowed');
  return addrs;
}

function parseHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url;
}

/** true if the URL is http(s) and all its resolved IPs are public. */
export async function isPublicHttpUrl(raw: string): Promise<boolean> {
  const url = parseHttpUrl(raw);
  if (!url) return false;
  try {
    await resolvePublicAddresses(url.hostname);
    return true;
  } catch {
    return false;
  }
}

/**
 * `lookup` for http(s).request / agents: resolves, validates and hands the
 * connection exactly the validated IP (DNS is not queried again).
 */
export function publicLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  resolvePublicAddresses(hostname).then(
    (addrs) => {
      if (options?.all) callback(null, addrs);
      else callback(null, addrs[0].address, addrs[0].family);
    },
    (err) => callback(Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'ESSRF' }), ''),
  );
}

interface RawResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

/** Only call after validating the host (see fetchPublicResource). */
function requestPinned(url: URL, opts: { timeoutMs: number; maxBytes: number; acceptType?: (ct: string) => boolean; headers?: Record<string, string>; method?: string; body?: Buffer | string }): Promise<RawResponse> {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: opts.method ?? 'GET',
      headers: {
        'User-Agent': 'KorexBot/1.0',
        ...(opts.headers ?? {}),
        ...(opts.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(opts.body)) } : {}),
      },
      lookup: publicLookup as any,
      timeout: opts.timeoutMs,
      // No shared agent: every connection goes through publicLookup
      agent: false,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
      }
      const ct = String(res.headers['content-type'] ?? '');
      if (status >= 200 && status < 300 && opts.acceptType && !opts.acceptType(ct)) {
        res.destroy();
        return reject(new Error('Unsupported content type'));
      }
      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared > opts.maxBytes) {
        res.destroy();
        return reject(new Error('Resource too large'));
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > opts.maxBytes) {
          res.destroy();
          reject(new Error('Resource too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    // Total cap (Node's `timeout` only measures socket inactivity)
    const timer = setTimeout(() => req.destroy(new Error('Request timeout')), opts.timeoutMs);
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('close', () => clearTimeout(timer));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * Downloads a resource from a public URL with time and size limits.
 * Follows redirects (max. 4) checking each hop, and always connects to the
 * validated IP. `acceptType` validates the content-type. Throws if anything is off.
 */
export async function fetchPublicResource(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; acceptType?: (contentType: string) => boolean; httpsOnly?: boolean } = {},
): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 7000;
  let current = raw;

  for (let hop = 0; hop < 5; hop++) {
    const url = parseHttpUrl(current);
    if (!url) throw new Error('URL not allowed');
    if (opts.httpsOnly && url.protocol !== 'https:') throw new Error('URL not allowed');
    // Node does not call `lookup` when the host is a literal IP: validate it here.
    // For names, publicLookup resolves again and pins the IP on the connection.
    await resolvePublicAddresses(url.hostname);

    const res = await requestPinned(url, { timeoutMs, maxBytes, acceptType: opts.acceptType });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) throw new Error('Redirect without location');
      current = new URL(String(location), url).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return { buffer: res.body, contentType: String(res.headers['content-type'] ?? ''), finalUrl: url.toString() };
  }
  throw new Error('Too many redirects');
}

/** Downloads an image from a public URL (welcome backgrounds, etc.). */
export async function fetchPublicImage(raw: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<Buffer> {
  const { buffer } = await fetchPublicResource(raw, { ...opts, acceptType: (t) => t.startsWith('image/') });
  return buffer;
}

/**
 * Opens a stream (e.g. audio) from a public URL with the IP pinned and
 * redirects revalidated. Returns the response unread; the caller must
 * consume or destroy it. `idleTimeoutMs` aborts if the server stops sending
 * data (long playbacks have no total cap).
 */
export async function openPublicStream(
  raw: string,
  opts: { connectTimeoutMs?: number; idleTimeoutMs?: number; acceptType?: (contentType: string) => boolean; httpsOnly?: boolean } = {},
): Promise<{ stream: http.IncomingMessage; contentType: string; finalUrl: string }> {
  const connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 30_000;
  let current = raw;

  for (let hop = 0; hop < 5; hop++) {
    const url = parseHttpUrl(current);
    if (!url) throw new Error('URL not allowed');
    if (opts.httpsOnly && url.protocol !== 'https:') throw new Error('URL not allowed');
    await resolvePublicAddresses(url.hostname);

    const mod = url.protocol === 'https:' ? https : http;
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = mod.get(url, { headers: { 'User-Agent': 'KorexBot/1.0' }, lookup: publicLookup as any, agent: false }, resolve);
      const timer = setTimeout(() => req.destroy(new Error('Connect timeout')), connectTimeoutMs);
      req.once('response', () => clearTimeout(timer));
      req.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      res.destroy();
      const location = res.headers.location;
      if (!location) throw new Error('Redirect without location');
      current = new URL(String(location), url).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      throw new Error(`HTTP ${status}`);
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (opts.acceptType && !opts.acceptType(contentType)) {
      res.destroy();
      throw new Error('Unsupported content type');
    }
    res.setTimeout(idleTimeoutMs, () => res.destroy(new Error('Idle timeout')));
    return { stream: res, contentType, finalUrl: url.toString() };
  }
  throw new Error('Too many redirects');
}

/**
 * Single request (redirects are not followed) to a public URL, with the IP
 * validated and pinned, and caps on total time and response size.
 * For external APIs whose host a user can configure (e.g. the `custom` AI
 * provider). A redirect is returned as a 3xx.
 */
export async function publicRequest(
  raw: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer; timeoutMs?: number; maxBytes?: number; httpsOnly?: boolean } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const url = parseHttpUrl(raw);
  if (!url) throw new Error('URL not allowed');
  if (opts.httpsOnly && url.protocol !== 'https:') throw new Error('URL not allowed');
  await resolvePublicAddresses(url.hostname);
  return requestPinned(url, {
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
    timeoutMs: opts.timeoutMs ?? 30_000,
    maxBytes: opts.maxBytes ?? 2 * 1024 * 1024,
  });
}
