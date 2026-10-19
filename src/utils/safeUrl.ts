import { lookup } from 'dns/promises';
import net from 'net';

/**
 * Protección SSRF para URLs que aporta un usuario (fondos de bienvenida,
 * audio directo en /play...). El bot no debe poder usarse para hacer peticiones
 * a la red interna de la VPS (127.0.0.1, 10.x, metadata de la nube, etc.).
 */

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||             // link-local / metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                                // multicast / reservado
  );
}

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIPv4(v6.slice(7));
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') ||   // ULA
    v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') ||
    v6.startsWith('ff')
  );
}

/**
 * Comprobación síncrona (sin DNS) del host de una URL: localhost, dominios
 * internos o una IP literal privada/reservada. Útil cuando no se hace ninguna
 * petición (p. ej. un redirector) o antes de resolver.
 */
export function isPrivateLiteralHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (net.isIP(host)) return isPrivateIP(host);
  return false;
}

/** true si la URL es http(s) y todas sus IPs resueltas son públicas. */
export async function isPublicHttpUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (net.isIP(host)) return !isPrivateIP(host);

  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIP(a.address));
  } catch {
    return false;
  }
}

/**
 * Descarga un recurso de una URL pública con límite de tiempo y tamaño.
 * Sigue redirecciones comprobando cada salto (sin seguirlas a ciegas).
 * `acceptType` valida el content-type. Lanza error si algo no cuadra.
 */
export async function fetchPublicResource(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; acceptType?: (contentType: string) => boolean; httpsOnly?: boolean } = {}
): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 7000;
  let current = raw;

  for (let hop = 0; hop < 4; hop++) {
    if (opts.httpsOnly && !current.startsWith('https://')) throw new Error('URL not allowed');
    if (!(await isPublicHttpUrl(current))) throw new Error('URL not allowed');

    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'KorexBot/1.0' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect without location');
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') ?? '';
    if (opts.acceptType && !opts.acceptType(contentType)) throw new Error('Unsupported content type');
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('Resource too large');

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Resource too large');
      }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks), contentType, finalUrl: current };
  }
  throw new Error('Too many redirects');
}

/** Descarga una imagen de una URL pública (fondos de bienvenida, etc.). */
export async function fetchPublicImage(raw: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<Buffer> {
  const { buffer } = await fetchPublicResource(raw, { ...opts, acceptType: (t) => t.startsWith('image/') });
  return buffer;
}
