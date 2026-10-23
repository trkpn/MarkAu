/**
 * The proxy fetches addresses on request, so the checks that keep it from
 * reaching into the network it lives in are worth a test of their own.
 */
import { describe, it, expect } from 'vitest';

const { isBlockedHost, assertAllowedUrl, fetchThroughProxy, handleProxyRequest, ProxyError } =
  await import('../server/proxy-core.js');

describe('the addresses that must never be fetched', () => {
  it('refuses the loopback interface', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('127.13.2.9')).toBe(true);
  });

  it('refuses the private ranges', () => {
    expect(isBlockedHost('10.0.0.5')).toBe(true);
    expect(isBlockedHost('172.16.4.4')).toBe(true);
    expect(isBlockedHost('172.31.255.255')).toBe(true);
    expect(isBlockedHost('192.168.1.1')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('100.64.0.1')).toBe(true);
  });

  it('refuses an address written as a number', () => {
    // 2130706433 is 127.0.0.1 written in decimal.
    expect(isBlockedHost('2130706433')).toBe(true);
    expect(isBlockedHost('0x7f000001')).toBe(true);
  });

  it('refuses the local names', () => {
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('printer.local')).toBe(true);
    expect(isBlockedHost('db.internal')).toBe(true);
    expect(isBlockedHost('metadata.google.internal')).toBe(true);
  });

  it('refuses the local IPv6 ranges', () => {
    expect(isBlockedHost('::1')).toBe(true);
    expect(isBlockedHost('fd00::1')).toBe(true);
    expect(isBlockedHost('fe80::1')).toBe(true);
  });

  it('allows the addresses of the internet', () => {
    expect(isBlockedHost('example.com')).toBe(false);
    expect(isBlockedHost('github.com')).toBe(false);
    expect(isBlockedHost('8.8.8.8')).toBe(false);
    expect(isBlockedHost('172.32.0.1')).toBe(false);
  });
});

describe('checking an address before it is fetched', () => {
  it('accepts an ordinary address', () => {
    expect(assertAllowedUrl('https://example.com/post').href).toBe('https://example.com/post');
  });

  it('refuses a scheme that is not http', () => {
    expect(() => assertAllowedUrl('file:///etc/passwd')).toThrow(ProxyError);
    expect(() => assertAllowedUrl('gopher://example.com')).toThrow(ProxyError);
  });

  it('refuses a port that is not a standard one', () => {
    expect(() => assertAllowedUrl('https://example.com:8443/')).toThrow(ProxyError);
  });

  it('refuses an address that points inside the network', () => {
    expect(() => assertAllowedUrl('http://169.254.169.254/latest/meta-data')).toThrow(ProxyError);
  });
});

describe('following redirects', () => {
  it('checks every hop', async () => {
    const calls = [];

    const fetchImpl = async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/secret' }
        });
      }
      return new Response('the page', { status: 200 });
    };

    await expect(fetchThroughProxy('https://example.com/', { fetchImpl })).rejects.toThrow(
      ProxyError
    );
    expect(calls).toEqual(['https://example.com/']);
  });

  it('stops after too many hops', async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/${call}` }
      });
    };

    await expect(fetchThroughProxy('https://example.com/', { fetchImpl })).rejects.toThrow(
      /redirected too many times/
    );
  });

  it('returns the page and the address it ended up at', async () => {
    const fetchImpl = async () => new Response('hello', { status: 200 });

    const result = await fetchThroughProxy('https://example.com/', { fetchImpl });

    expect(result.body).toBe('hello');
    expect(result.finalUrl).toBe('https://example.com/');
    expect(result.status).toBe(200);
  });
});

describe('answering the browser', () => {
  it('answers with a JSON envelope', async () => {
    const request = new Request(
      'https://markau.pages.dev/api/fetch?url=https%3A%2F%2Fexample.com%2F'
    );

    const response = await handleProxyRequest(request, {
      fetchImpl: async () => new Response('the page', { status: 200 })
    });
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(payload.body).toBe('the page');
  });

  it('refuses a request from another site', async () => {
    const request = new Request(
      'https://markau.pages.dev/api/fetch?url=https%3A%2F%2Fexample.com%2F',
      {
        headers: { origin: 'https://somewhere.example' }
      }
    );

    const response = await handleProxyRequest(request, {
      fetchImpl: async () => new Response('the page', { status: 200 })
    });

    expect(response.status).toBe(403);
  });

  it('refuses a request without an address', async () => {
    const request = new Request('https://markau.pages.dev/api/fetch');

    const response = await handleProxyRequest(request);

    expect(response.status).toBe(400);
    expect((await response.json()).ok).toBe(false);
  });
});
