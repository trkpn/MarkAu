/**
 * ============================================================================
 * YOUTUBE TRANSCRIPT — CORE
 * Fetches the transcript of a video.
 *
 * The transcript is the caption track of the video, and there are two ways
 * to reach it. The one that the page of the video uses is guarded: YouTube
 * asks for a token that only a player can produce, and the answer of the
 * server is an empty one.
 *
 * The other way is the address that the players of the apps use. It asks
 * for the video with the voice of the app for Android, and the answer
 * carries the caption tracks that can be read right away.
 *
 * That address does not allow a call from a browser — it answers with the
 * address of the caller in the wrong shape and no permission at all — so
 * the work is done here, on the server.
 * ============================================================================
 */

import { parseCaptionTrack } from '../src/youtube-to-markdown.js';

/** The voice the players of the app for Android use. */
const ANDROID_CLIENT = {
  clientName: 'ANDROID',
  clientVersion: '20.10.38',
  androidSdkVersion: 31
};

/** The voice of the app for Android, as it is written in the address. */
const ANDROID_USER_AGENT = 'com.google.android.youtube/20.10.38 (Linux; U; Android 12) gzip';

/** The address of the player. */
const PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player';

/** The shape of the address of a video. */
const VIDEO_ID = /^[A-Za-z0-9_-]{4,24}$/;

/**
 * An error that carries the status the client should see.
 */
export class TranscriptError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status = 400) {
    super(message);
    this.name = 'TranscriptError';
    this.status = status;
  }
}

/**
 * Checks the address of a video.
 *
 * @param {string} videoId
 * @returns {string} the address, checked
 * @throws {TranscriptError}
 */
export function assertVideoId(videoId) {
  const value = String(videoId || '').trim();

  if (!VIDEO_ID.test(value)) {
    throw new TranscriptError('That is not the address of a video.', 400);
  }

  return value;
}

/**
 * Asks the player of the app for Android about a video.
 *
 * @param {string} videoId
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<Array<{ url: string, language: string, automatic: boolean, name: string }>>}
 *   the caption tracks of the video
 */
export async function fetchCaptionTracks(videoId, { fetchImpl = fetch } = {}) {
  const id = assertVideoId(videoId);

  let response;
  try {
    response = await fetchImpl(PLAYER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ANDROID_USER_AGENT
      },
      body: JSON.stringify({
        context: { client: ANDROID_CLIENT },
        videoId: id,
        contentCheckOk: true,
        racyCheckOk: true
      })
    });
  } catch {
    throw new TranscriptError('YouTube could not be reached.', 502);
  }

  if (!response.ok) {
    throw new TranscriptError(
      response.status === 403
        ? 'YouTube refused the request.'
        : `YouTube answered ${response.status}.`,
      502
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TranscriptError('YouTube sent an answer that could not be read.', 502);
  }

  const tracks = payload?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (tracks.length === 0) {
    const status = payload?.playabilityStatus?.status || '';
    throw new TranscriptError(
      status === 'LOGIN_REQUIRED' || status === 'AGE_VERIFICATION_REQUIRED'
        ? 'That video is not open to everyone.'
        : 'That video has no captions.',
      404
    );
  }

  return tracks.map((track) => ({
    url: track.baseUrl,
    language: track.languageCode || '',
    automatic: Boolean(track.kind),
    name: track.name?.simpleText || track.name?.runs?.[0]?.text || ''
  }));
}

/**
 * Picks the caption track that is worth reading.
 *
 * A track that was written by a person is better than one that was written
 * by a machine, and the language of the video is better than a translation
 * of it.
 *
 * @param {Array<{ language: string, automatic: boolean, name: string }>} tracks
 * @param {string} [language] the language wanted
 * @returns {object|null}
 */
export function chooseTrack(tracks, language = 'en') {
  if (!tracks || tracks.length === 0) return null;

  const wanted = String(language || '').toLowerCase();
  const sameLanguage = tracks.filter((track) =>
    String(track.language || '')
      .toLowerCase()
      .startsWith(wanted)
  );
  const pool = sameLanguage.length > 0 ? sameLanguage : tracks;

  const written = pool.find((track) => !track.automatic);
  return written || pool[0];
}

/**
 * Reads the text of a caption track.
 *
 * @param {object} track
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<Array<{ start: number, text: string }>>}
 */
export async function fetchCaptionText(track, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(`${track.url}&fmt=json3`, {
      headers: { 'User-Agent': ANDROID_USER_AGENT }
    });
  } catch {
    throw new TranscriptError('The captions could not be reached.', 502);
  }

  if (!response.ok) {
    throw new TranscriptError(`The captions answered ${response.status}.`, 502);
  }

  const text = await response.text();
  return parseCaptionTrack(text);
}

/**
 * Fetches the transcript of a video.
 *
 * @param {string} videoId
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.language]
 * @returns {Promise<{
 *   language: string,
 *   automatic: boolean,
 *   name: string,
 *   lines: Array<{ start: number, text: string }>
 * }>}
 */
export async function fetchTranscript(videoId, { fetchImpl = fetch, language = 'en' } = {}) {
  const tracks = await fetchCaptionTracks(videoId, { fetchImpl });
  const track = chooseTrack(tracks, language);

  if (!track) {
    throw new TranscriptError('That video has no captions.', 404);
  }

  const lines = await fetchCaptionText(track, { fetchImpl });

  if (lines.length === 0) {
    throw new TranscriptError('The captions of that video are empty.', 404);
  }

  return {
    language: track.language,
    automatic: track.automatic,
    name: track.name,
    lines
  };
}

/**
 * Answers a request for a transcript.
 *
 * @param {Request} request
 * @param {object} [options]
 * @returns {Promise<Response>}
 */
export async function handleTranscriptRequest(request, options = {}) {
  const videoId = new URL(request.url).searchParams.get('id');

  try {
    const transcript = await fetchTranscript(videoId, options);
    return jsonResponse({ ok: true, ...transcript });
  } catch (err) {
    const status = err instanceof TranscriptError ? err.status : 502;
    const message = err instanceof Error ? err.message : 'The transcript could not be read.';
    return jsonResponse({ ok: false, error: message }, status);
  }
}

/**
 * Writes a JSON answer.
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
