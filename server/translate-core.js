/**
 * ============================================================================
 * TRANSLATION — CORE
 * Translates text on behalf of the browser.
 *
 * The work is done here, on the server, for three reasons:
 *
 *   • the address of the translator is not written into the app, so it can
 *     be changed without touching the browser at all
 *   • the answer can be checked, and a request that comes back broken can
 *     be tried again — the translator does not answer the same way every
 *     time, and it refuses to work when it is asked too much at once
 *   • one key can serve every visitor of the app
 *
 * The core is written with the standard Request/Response/fetch API, so the
 * same file runs on Cloudflare Pages Functions and in the local dev server.
 * ============================================================================
 */

import { TranslateError, assertTarget, translateUnits } from '../src/translation/provider.js';

export { TranslateError, assertTarget, translateUnits } from '../src/translation/provider.js';

/**
 * Handles a request to the translator and answers with a JSON envelope.
 *
 * The envelope always has the same shape, so the client never has to guess
 * what came back:
 *
 *   { ok: true,  detected, results }
 *   { ok: false, error }
 *
 * @param {Request} request
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<Response>}
 */
export async function handleTranslateRequest(request, options = {}) {
  const origin = request.headers.get('origin');

  // A request that comes from another site is refused. A request without
  // an origin is the app itself (or a command line), and is allowed through.
  if (origin) {
    let own = '';
    try {
      own = new URL(request.url).origin;
    } catch {
      own = '';
    }
    if (origin !== own) {
      return jsonResponse({ ok: false, error: 'This translator only serves its own app.' }, 403);
    }
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Only POST is allowed.' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'The request could not be read.' }, 400);
  }

  const units = Array.isArray(payload?.units) ? payload.units : null;
  if (!units || units.length === 0) {
    return jsonResponse({ ok: false, error: 'There was nothing to translate.' }, 400);
  }

  let target;
  try {
    target = assertTarget(payload?.target);
  } catch (err) {
    const message = err instanceof TranslateError ? err.message : 'That language is not known.';
    return jsonResponse({ ok: false, error: message }, 400);
  }

  const cleaned = units.map((unit) => (typeof unit === 'string' ? unit : ''));

  if (!cleaned.some((unit) => unit.trim())) {
    return jsonResponse({ ok: false, error: 'There was nothing to translate.' }, 400);
  }

  try {
    const { results, detected } = await translateUnits(cleaned, target, {
      fetchImpl: options.fetchImpl
    });

    // The units that were not translated are given back as they were, so
    // that the client can put the document together without a hole in it.
    let cursor = 0;
    const aligned = units.map((unit) => {
      if (typeof unit !== 'string' || !unit.trim()) return '';
      const result = results[cursor];
      cursor += 1;
      return result ?? unit;
    });

    return jsonResponse({ ok: true, detected, results: aligned });
  } catch (err) {
    const status = err instanceof TranslateError ? err.status : 502;
    const message =
      err instanceof TranslateError ? err.message : 'The translator could not be reached.';
    return jsonResponse({ ok: false, error: message }, status);
  }
}

/**
 * Writes a JSON response.
 * @param {object} payload
 * @param {number} [status]
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
