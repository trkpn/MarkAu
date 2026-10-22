/**
 * ============================================================================
 * PAGES FUNCTION — /api/fetch
 * Fetches a page for the browser.
 *
 * The work is done by the shared core, which lives outside this folder on
 * purpose: every file inside `functions/` becomes a route of its own, and
 * the core is not a route.
 * ============================================================================
 */

import { handleProxyRequest } from '../../server/proxy-core.js';

/**
 * Answers the request.
 * @param {{ request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequest({ request }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ ok: false, error: 'Only GET is allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  return handleProxyRequest(request);
}
