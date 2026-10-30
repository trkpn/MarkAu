/**
 * ============================================================================
 * PAGES FUNCTION — /api/version
 * Returns the version, commit hash, and build information of this deployment.
 * ============================================================================
 */

import { BUILD_INFO } from '../../src/core/build-info.js';

/**
 * Answers the request.
 * @param {{ request: Request, env?: object }} context
 * @returns {Promise<Response>}
 */
export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ ok: false, error: 'Only GET is allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const cfCommit = env?.CF_PAGES_COMMIT_SHA || null;
  const cfBranch = env?.CF_PAGES_BRANCH || null;
  const commit = cfCommit ? cfCommit.slice(0, 7) : BUILD_INFO.commit;

  const payload = {
    app: 'MarkAu',
    version: BUILD_INFO.version,
    commit,
    cfCommit,
    cfBranch,
    buildTime: BUILD_INFO.buildTime
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}
