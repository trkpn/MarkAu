/**
 * ============================================================================
 * PAGES FUNCTION — /api/youtube-transcript
 * Brings the transcript of a video.
 *
 * The address of the player of YouTube does not allow a call from a
 * browser, so the work is done here. Only the address of a video is taken
 * from the caller — the address that is fetched is fixed in the core.
 * ============================================================================
 */

import { handleTranscriptRequest } from '../../server/youtube-transcript.js';

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

  return handleTranscriptRequest(request);
}
