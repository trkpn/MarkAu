/**
 * ============================================================================
 * PAGES FUNCTION — /api/translate
 * Translates the document for the browser.
 *
 * The work is done by the shared core, which lives outside this folder on
 * purpose: every file inside `functions/` becomes a route of its own, and
 * the core is not a route.
 * ============================================================================
 */

import { handleTranslateRequest } from '../../server/translate-core.js';

/**
 * Answers the request.
 * @param {{ request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequest({ request }) {
  return handleTranslateRequest(request);
}
