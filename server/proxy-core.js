/**
 * ============================================================================
 * URL PROXY — CORE
 * Fetches a page on behalf of the browser.
 *
 * Most websites do not allow a browser to read them from another origin:
 * they answer with a CORS error instead of the page. The proxy solves that,
 * because the server is not bound by the same-origin rule.
 *
 * A proxy that fetches any address on request is also a door into the
 * network it runs in, so the address is checked before anything is fetched:
 *
 *   • only http and https
 *   • only the standard ports
 *   • never a private, loopback or link-local address — no reaching into
 *     the machine or the network the proxy lives in
 *   • a redirect is followed a few times at most, and every hop is checked
 *     again, because a redirect is the easiest way around a check
 *   • the response is capped in size and in time
 *
 * The core is written with the standard Request/Response/fetch API, so the
 * same file runs on Cloudflare Pages Functions and in the local dev server.
 * ============================================================================
 */

/** How many redirects are followed before the chain is called a loop. */
export const MAX_REDIRECTS = 3;

/** How long a single request may take. */
export const TIMEOUT_MS = 10000;

/** The largest response that is passed on. */
export const MAX_BYTES = 5 * 1024 * 1024;

/** The only ports that may be fetched. */
const ALLOWED_PORTS = ['', '80', '443'];

/** The headers the proxy sends. */
const DEFAULT_HEADERS = {
  'User-Agent': 'MarkAu/1.0 (+https://markau.pages.dev)',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en;q=0.9,*;q=0.5'
};

/**
 * Some sites answer a request that does not look like a browser with a
 * refusal rather than with the page. For those, the proxy dresses up as
 * one — the same thing a browser does.
 *
 * The key is the domain, so it covers every subdomain of it.
 */
const HOST_HEADERS = {
  'reddit.com': {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
  }
};

/**
 * The headers to send to an address.
 *
 * @param {URL} url
 * @returns {Record<string, string>}
 */
function headersFor(url) {
  const host = url.hostname.toLowerCase();

  for (const [domain, headers] of Object.entries(HOST_HEADERS)) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return { ...DEFAULT_HEADERS, ...headers };
    }
  }

  return { ...DEFAULT_HEADERS };
}

/**
 * An error that carries the status the client should see.
 */
export class ProxyError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status = 400) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
  }
}

/**
 * Tells whether a host name points into a network that must not be
 * reachable from the outside.
 *
 * @param {string} host the host name, without brackets
 * @returns {boolean}
 */
export function isBlockedHost(host) {
  const name = String(host || '')
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '');

  if (!name) return true;

  // Host names that are only digits are a decimal IP address in disguise.
  if (/^\d+$/.test(name)) return true;
  // The same, written in hex.
  if (/^0x[0-9a-f]+$/.test(name)) return true;
  // Octal parts, or a dotted address that is not four plain numbers.
  if (/^[\d.]+$/.test(name) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;

  // IPv6 in the ranges that belong to the local network.
  if (name === '::' || name === '::1') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(name)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(name)) return true;

  // Names that only ever resolve inside a network.
  if (name === 'localhost') return true;
  if (/\.(localhost|local|internal|home\.arpa)$/.test(name)) return true;
  if (name === 'metadata.google.internal') return true;

  // IPv4 in the private ranges.
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (octets) {
    const a = Number(octets[1]);
    const b = Number(octets[2]);
    if (a === 0 || a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
  }

  return false;
}

/**
 * Checks an address and returns it as a URL.
 *
 * @param {string} rawUrl
 * @returns {URL}
 * @throws {ProxyError} when the address must not be fetched
 */
export function assertAllowedUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new ProxyError('That is not a valid address.', 400);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError('Only http and https addresses can be fetched.', 400);
  }

  if (!ALLOWED_PORTS.includes(url.port)) {
    throw new ProxyError('Only the standard ports 80 and 443 can be fetched.', 400);
  }

  const host = url.hostname.toLowerCase();
  if (isBlockedHost(host)) {
    throw new ProxyError('That address cannot be reached.', 403);
  }

  return url;
}

/**
 * Reads a response, stopping at the size cap.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<{ bytes: Uint8Array, truncated: boolean }>}
 */
async function readCapped(response, maxBytes) {
  const stream = response.body;
  if (!stream || typeof stream.getReader !== 'function') {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return { bytes: buffer.slice(0, maxBytes), truncated: buffer.length > maxBytes };
  }

  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        truncated = true;
        chunks.push(value.slice(0, Math.max(0, value.byteLength - (size - maxBytes))));
        break;
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* the stream is already closed */
    }
  }

  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes: merged, truncated };
}

/**
 * Turns bytes into text that can travel in JSON.
 *
 * A PDF or a book in EPUB form is not text, and a JSON answer cannot hold
 * bytes. So the bytes are written out as base64 and the client turns them
 * back.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

/**
 * Tells whether an answer holds text that can be read.
 *
 * The rule is: everything is text unless it is certainly not. The types
 * that are certainly not are the ones that carry bytes — a PDF, a zip, a
 * picture. A type that is not known is left as text, so that an unusual
 * one does not turn a page of writing into a wall of nonsense.
 *
 * @param {string} contentType
 * @returns {boolean}
 */
function isTextual(contentType) {
  if (!contentType) return true;

  const type = String(contentType).toLowerCase();

  const certainlyBinary =
    /^(application\/(pdf|zip|octet-stream|epub\+zip|msword|rtf|x-tar|x-gzip|x-7z-compressed)|image\/(?!svg)|video\/|audio\/|font\/)/;

  return !certainlyBinary.test(type);
}

/**
 * Fetches an address, following a few redirects and checking every hop.
 *
 * @param {string} rawUrl
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] the fetch to use
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @returns {Promise<{ status: number, finalUrl: string, contentType: string, body: string, truncated: boolean }>}
 * @throws {ProxyError}
 */
export async function fetchThroughProxy(
  rawUrl,
  { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}
) {
  let current = assertAllowedUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetchImpl(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: headersFor(current)
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new ProxyError('The page took too long to answer.', 504);
      }
      throw new ProxyError(`The page could not be reached: ${err?.message || 'unknown error'}`, 502);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ProxyError('The page redirected without saying where to.', 502);
      }
      current = assertAllowedUrl(new URL(location, current).href);
      continue;
    }

    const { bytes, truncated } = await readCapped(response, maxBytes);
    const contentType = response.headers.get('content-type') || '';

    // Text travels as text; anything else travels as base64, so that a
    // PDF or a book arrives whole.
    const textual = isTextual(contentType);

    return {
      status: response.status,
      finalUrl: current.href,
      contentType,
      encoding: textual ? 'text' : 'base64',
      body: textual ? new TextDecoder('utf-8').decode(bytes) : toBase64(bytes),
      truncated
    };
  }

  throw new ProxyError('The page redirected too many times.', 502);
}

/**
 * Handles a request to the proxy and answers with a JSON envelope.
 *
 * The envelope always has the same shape, so the client never has to guess
 * what came back:
 *
 *   { ok: true,  status, finalUrl, contentType, body, truncated }
 *   { ok: false, error }
 *
 * @param {Request} request
 * @param {object} [options]
 * @returns {Promise<Response>}
 */
export async function handleProxyRequest(request, options = {}) {
  const origin = request.headers.get('origin');

  // A request that comes from another site is refused. A request without an
  // origin is the app itself (or a command line), and is allowed through.
  if (origin) {
    let own = '';
    try {
      own = new URL(request.url).origin;
    } catch {
      own = '';
    }
    if (origin !== own) {
      return jsonResponse({ ok: false, error: 'This proxy only serves its own app.' }, 403);
    }
  }

  const target = new URL(request.url).searchParams.get('url');
  if (!target) {
    return jsonResponse({ ok: false, error: 'No address was given.' }, 400);
  }

  try {
    const result = await fetchThroughProxy(target, options);
    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    const status = err instanceof ProxyError ? err.status : 502;
    const message = err instanceof ProxyError ? err.message : 'The page could not be fetched.';
    return jsonResponse({ ok: false, error: message }, status);
  }
}

/**
 * Writes a JSON response.
 * @param {object} payload
 * @param {number} status
 * @returns {Response}
 */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
