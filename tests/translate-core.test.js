/**
 * ============================================================================
 * TRANSLATION — THE SERVER
 * ============================================================================
 * The translator is asked for one language only, and it is asked on the
 * server so that the address of the translator stays out of the app. These
 * tests pin down what the core promises: that only a known language is
 * accepted, that a request from another site is refused, and that the
 * answer always has the same shape.
 */

import { describe, it, expect } from 'vitest';

const { handleTranslateRequest, TranslateError } = await import('../server/translate-core.js');

/**
 * A translator that answers with a fixed shape.
 * @param {object} [options]
 * @returns {typeof fetch}
 */
function fakeTranslator(options = {}) {
  const { text = 'แปลแล้ว', detected = 'en', status = 200 } = options;

  return async () =>
    new Response(JSON.stringify({ sentences: [{ trans: text }], src: detected }), {
      status,
      headers: { 'content-type': 'application/json' }
    });
}

/**
 * Builds a request the way the browser would.
 * @param {object} body
 * @param {object} [headers]
 * @returns {Request}
 */
function makeRequest(body, headers = {}) {
  return new Request('https://markau.pages.dev/api/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

describe('answering the browser', () => {
  it('answers with a JSON envelope', async () => {
    const response = await handleTranslateRequest(makeRequest({ target: 'th', units: ['Hello'] }), {
      fetchImpl: fakeTranslator({ text: 'สวัสดี', detected: 'en' })
    });
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(payload.detected).toBe('en');
    expect(payload.results).toEqual(['สวัสดี']);
  });

  it('refuses a request from another site', async () => {
    const response = await handleTranslateRequest(
      makeRequest({ target: 'th', units: ['Hello'] }, { origin: 'https://somewhere.example' })
    );

    expect(response.status).toBe(403);
  });

  it('answers a request from the app itself', async () => {
    // The port has to be part of the address: a request that comes from
    // the app on port 5173 is not a request from some other place.
    const response = await handleTranslateRequest(
      makeRequest({ target: 'th', units: ['Hello'] }, { origin: 'https://markau.pages.dev' }),
      { fetchImpl: fakeTranslator({ text: 'สวัสดี' }) }
    );

    expect(response.status).toBe(200);
  });

  it('refuses a request that is not a POST', async () => {
    const response = await handleTranslateRequest(
      new Request('https://markau.pages.dev/api/translate')
    );

    expect(response.status).toBe(405);
  });

  it('refuses a language it does not know', async () => {
    const response = await handleTranslateRequest(makeRequest({ target: 'xx', units: ['Hello'] }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
  });

  it('refuses a request that carries nothing', async () => {
    const response = await handleTranslateRequest(makeRequest({ target: 'th', units: [] }));

    expect(response.status).toBe(400);
  });

  it('refuses a request that cannot be read', async () => {
    const request = new Request('https://markau.pages.dev/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json'
    });

    const response = await handleTranslateRequest(request);
    expect(response.status).toBe(400);
  });

  it('says what went wrong when the translator refuses', async () => {
    const response = await handleTranslateRequest(makeRequest({ target: 'th', units: ['Hello'] }), {
      fetchImpl: fakeTranslator({ status: 429 })
    });
    const payload = await response.json();

    expect(payload.ok).toBe(false);
    expect(payload.error).toBeTruthy();
  });

  it('answers with the status the browser needs to know about a refusal', async () => {
    const response = await handleTranslateRequest(makeRequest({ target: 'th', units: ['Hello'] }), {
      fetchImpl: fakeTranslator({ status: 429 })
    });

    // The browser has to be able to tell a refusal from any other failure,
    // so that it can try the other way in.
    expect(response.status).toBe(429);
  });

  it('answers with another status when the translator fails in another way', async () => {
    const response = await handleTranslateRequest(makeRequest({ target: 'th', units: ['Hello'] }), {
      fetchImpl: async () =>
        new Response('<html>Error</html>', {
          status: 400,
          headers: { 'content-type': 'text/html' }
        })
    });

    expect(response.status).toBe(502);
  });

  it('hands back the units that could not be translated as they were', async () => {
    const response = await handleTranslateRequest(
      makeRequest({ target: 'th', units: ['Hello', 'World'] }),
      { fetchImpl: fakeTranslator({ text: 'แปลแล้ว' }) }
    );
    const payload = await response.json();

    expect(payload.results).toHaveLength(2);
  });
});

describe('the error it carries', () => {
  it('is an error of its own', () => {
    const error = new TranslateError('Something went wrong.', 429);

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(429);
  });
});
