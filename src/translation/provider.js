/**
 * ============================================================================
 * TRANSLATION — THE PROVIDER
 * The part that talks to the translator.
 *
 * It lives outside the server folder on purpose: the same code has to run
 * on the server and in the browser. The server uses it because the
 * translator refuses to work when it is asked too much at once, and the
 * browser uses it as a second way in — every visitor of the app has their
 * own address, and the translator counts what it does per address.
 *
 * The translator is asked for one language only: the language the text
 * should end up in. The language it comes from is found by the translator
 * itself, and is reported back so that the app can say where the text
 * came from.
 * ============================================================================
 */

import { TARGET_LANGUAGES } from './languages.js';

/** The address of the translator. */
export const TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/**
 * The clients the translator is asked with, in the order they are tried.
 *
 * The name of the client is not checked by the translator, but the clients
 * are counted separately: one of them can be refused for hours while the
 * others work. So every one of them is tried in turn, and the first that
 * answers is used.
 */
export const CLIENTS = ['gtx', 'dict-chrome-ex', 'at'];

/**
 * How much text may travel in one request.
 *
 * The translator refuses a request that is too long — somewhere above
 * sixteen thousand characters — and the limit is counted in the characters
 * of the address that is built, because a Thai sentence takes three bytes
 * per letter and every one of them is written out three times over.
 */
export const MAX_BATCH_CHARS = 3000;

/** The most characters a single unit may have. */
export const MAX_UNIT_CHARS = 1200;

/** The most units that may travel in one request. */
export const MAX_BATCH_UNITS = 24;

/** How long a request may take. */
export const TIMEOUT_MS = 15000;

/**
 * The token that separates two units from each other inside one request.
 *
 * The translator does not answer with one text per unit — it answers with
 * the sentences it found, and the sentences do not follow the units of the
 * input. It also drops everything that stands behind a line break. So the
 * units are joined by a token that survives the trip and cannot be
 * mistaken for a word.
 */
export const SEPARATOR = '⟦§⟧';

/**
 * The languages the app can translate into.
 *
 * The list comes from the same place the dialog is filled from, so that a
 * language the user can choose is a language the translator accepts.
 */
const TARGET_CODES = new Set(TARGET_LANGUAGES.map((language) => language.code));

/**
 * Tells whether a code names a language the app can translate into.
 * @param {string} code
 * @returns {boolean}
 */
export function isTargetLanguage(code) {
  return TARGET_CODES.has(String(code || '').trim());
}

/**
 * An error that carries the status the client should see.
 */
export class TranslateError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status = 400) {
    super(message);
    this.name = 'TranslateError';
    this.status = status;
  }
}

/**
 * Checks that a language is one the app can translate into.
 *
 * @param {string} code
 * @returns {string} the code, checked
 * @throws {TranslateError}
 */
export function assertTarget(code) {
  const value = String(code || '').trim();
  if (!value) {
    throw new TranslateError('No target language was given.', 400);
  }
  if (!TARGET_CODES.has(value)) {
    throw new TranslateError('That language cannot be translated into.', 400);
  }
  return value;
}

/**
 * The address of the translator for a piece of text.
 *
 * @param {string} text
 * @param {string} target the language the text should end up in
 * @param {string} [client] the client to ask with
 * @returns {string}
 */
export function buildTranslateUrl(text, target, client = CLIENTS[0]) {
  const params = new URLSearchParams({
    client,
    dj: '1',
    dt: 't',
    // The language of the source is left to the translator: the user says
    // where the text should go, not where it comes from.
    sl: 'auto',
    tl: target,
    q: text
  });

  return `${TRANSLATE_ENDPOINT}?${params.toString()}`;
}

/**
 * Reads the answer of the translator.
 *
 * The answer with `dj=1` is an object with the sentences in it and the
 * language that was detected at the top.
 *
 * @param {object} payload
 * @returns {{ text: string, detected: string }}
 */
export function parseTranslateResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new TranslateError('The translator sent an answer that could not be read.', 502);
  }

  const sentences = Array.isArray(payload.sentences) ? payload.sentences : [];
  const text = sentences
    .map((sentence) => (sentence && typeof sentence.trans === 'string' ? sentence.trans : ''))
    .join('');

  if (!text && sentences.length > 0) {
    throw new TranslateError('The translator sent an empty answer.', 502);
  }

  return {
    text,
    detected: typeof payload.src === 'string' ? payload.src : ''
  };
}

/**
 * Asks the translator for one piece of text, with one client.
 *
 * @param {string} text
 * @param {string} target
 * @param {string} client
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ text: string, detected: string }>}
 */
async function translateWithClient(text, target, client, { fetchImpl = fetch } = {}) {
  const url = buildTranslateUrl(text, target, client);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        // The translator answers a browser more willingly than a script.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en;q=0.9,*;q=0.5'
      }
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new TranslateError('The translator took too long to answer.', 504);
    }
    throw new TranslateError('The translator could not be reached.', 502);
  } finally {
    clearTimeout(timer);
  }

  // The translator answers an error with a page of HTML, not with JSON —
  // so the answer is looked at before it is read.
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();

  if (response.status === 429) {
    throw new TranslateError('The translator is busy right now.', 429);
  }

  if (!response.ok) {
    throw new TranslateError(`The translator answered ${response.status}.`, 502);
  }

  if (!contentType.includes('json')) {
    throw new TranslateError('The translator sent an answer that could not be read.', 502);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new TranslateError('The translator sent an answer that could not be read.', 502);
  }

  return parseTranslateResponse(payload);
}

/**
 * The client that answered last.
 *
 * The clients are counted separately by the translator, so the one that
 * worked is remembered: the next request goes straight to it, and the
 * others are only tried when it refuses as well.
 */
let workingClient = null;

/**
 * The clients to try, the one that worked last first.
 * @returns {string[]}
 */
function clientOrder() {
  if (!workingClient) return CLIENTS;
  return [workingClient, ...CLIENTS.filter((client) => client !== workingClient)];
}

/**
 * Remembers the client that answered.
 * @param {string} client
 */
function rememberClient(client) {
  workingClient = client;
}

/**
 * Asks the translator for one piece of text.
 *
 * The clients are counted separately by the translator, and one of them
 * can be refused for hours while the others answer. So when one refuses,
 * the next is tried — and the one that worked is remembered, so that the
 * next request goes straight to it.
 *
 * @param {string} text
 * @param {string} target
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ text: string, detected: string }>}
 */
export async function translateText(text, target, { fetchImpl = fetch } = {}) {
  let lastError = null;

  for (const client of clientOrder()) {
    try {
      const answer = await translateWithClient(text, target, client, { fetchImpl });
      rememberClient(client);
      return answer;
    } catch (err) {
      lastError = err;

      // Only a refusal is worth another client: every other failure would
      // fail the same way again.
      if (!(err instanceof TranslateError) || err.status !== 429) throw err;
    }
  }

  throw lastError;
}

/**
 * The units of one request.
 *
 * The units are joined by a separator, because the translator answers with
 * the sentences it found rather than with one answer per unit. A request
 * that carries a single unit does not need the separator at all.
 *
 * @param {string[]} units
 * @returns {string}
 */
export function joinUnits(units) {
  return units.join(` ${SEPARATOR} `);
}

/**
 * Takes the units apart again.
 *
 * @param {string} text the answer of the translator
 * @param {number} count how many units went into the request
 * @returns {string[]|null} the units, or null when they cannot be found
 */
export function splitUnits(text, count) {
  if (count === 1) return [text];

  const parts = text.split(SEPARATOR);
  if (parts.length !== count) return null;

  return parts.map((part) => part.trim());
}

/**
 * A request: the pieces that travel together, and the unit each belongs to.
 *
 * @typedef {{ unit: number, text: string }} Piece
 */

/**
 * Groups the units into the requests that will be made.
 *
 * A unit that is too long is cut into pieces, and the pieces travel in the
 * request on their own. Every piece remembers the unit it came from, so
 * that the answers can be put back together into the units they belong
 * to — a unit that was cut in two must not turn into two units.
 *
 * @param {string[]} units
 * @returns {Array<{ pieces: Piece[], texts: string[] }>}
 */
export function planRequests(units) {
  const requests = [];
  let current = { pieces: [], texts: [] };
  let size = 0;

  for (let unit = 0; unit < units.length; unit += 1) {
    const text = units[unit];

    // A unit that is too long on its own is cut into pieces at the spaces
    // around it, so that no word is torn apart.
    const pieces = text.length > MAX_UNIT_CHARS ? splitLongUnit(text) : [text];

    for (const piece of pieces) {
      const added = piece.length + SEPARATOR.length + 2;

      if (
        current.pieces.length &&
        (size + added > MAX_BATCH_CHARS || current.pieces.length >= MAX_BATCH_UNITS)
      ) {
        requests.push(current);
        current = { pieces: [], texts: [] };
        size = 0;
      }

      current.pieces.push({ unit, text: piece });
      current.texts.push(piece);
      size += added;
    }
  }

  if (current.pieces.length) requests.push(current);

  return requests;
}

/**
 * Groups the units into requests that are not too large.
 *
 * @param {string[]} units
 * @returns {Array<Array<{ unit: number, text: string }>>}
 */
export function groupUnits(units) {
  return planRequests(units).map((request) => request.pieces);
}

/**
 * Cuts a unit that is too long into pieces at the spaces around it.
 *
 * The last piece is cut as well, so that no piece is longer than the limit
 * — a piece that is too long is of no use to anybody. A word that is
 * longer than the limit on its own cannot be cut at a space, so it is cut
 * where it is: a word of that size is a mistake either way.
 *
 * @param {string} unit
 * @returns {string[]}
 */
export function splitLongUnit(unit) {
  const pieces = [];
  let rest = String(unit || '').trim();

  while (rest.length > MAX_UNIT_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_UNIT_CHARS);
    if (cut <= 0) {
      pieces.push(rest.slice(0, MAX_UNIT_CHARS));
      rest = rest.slice(MAX_UNIT_CHARS).trimStart();
      continue;
    }

    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }

  if (rest) pieces.push(rest);

  return pieces.length ? pieces : [unit];
}

/**
 * Translates a list of units, one request at a time.
 *
 * The requests are made one after another, and a short pause is made
 * between them: the translator refuses to work when it is asked too much
 * at once, and a pause is cheaper than a refusal.
 *
 * @param {string[]} units
 * @param {string} target
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(progress: { done: number, total: number }) => void} [options.onProgress]
 * @returns {Promise<{ results: string[], detected: string }>}
 */
export async function translateUnits(units, target, { fetchImpl = fetch, onProgress } = {}) {
  if (!Array.isArray(units) || units.length === 0) {
    return { results: [], detected: '' };
  }

  const groups = groupUnits(units);

  // The answers are collected per unit: a unit that was cut into pieces
  // is put back together here, so that the caller gets one answer per
  // unit — always in the same order as the units it was given.
  const answers = new Map();
  let detected = '';

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const joined = group.map((piece) => piece.text).join(` ${SEPARATOR} `);

    const answer = await translateWithRetry(joined, target, fetchImpl);
    const split = splitUnits(answer.text, group.length);

    if (!split) {
      // The pieces cannot be found apart again — so every one of them is
      // asked for on its own, which is slower but keeps them in their
      // places.
      for (const piece of group) {
        const single = await translateWithRetry(piece.text, target, fetchImpl);
        appendAnswer(answers, piece.unit, single.text);
        if (!detected) detected = single.detected;
      }
    } else {
      group.forEach((piece, pieceIndex) => {
        appendAnswer(answers, piece.unit, split[pieceIndex]);
      });
      if (!detected) detected = answer.detected;
    }

    onProgress?.({ done: answers.size, total: units.length });

    // A pause between the requests, so that the translator does not refuse.
    if (index < groups.length - 1) {
      await sleep(350);
    }
  }

  // One answer per unit, in the order the units were given.
  const results = units.map((_, index) => answers.get(index) ?? '');

  return { results, detected };
}

/**
 * Adds an answer to a unit, joining the pieces of a unit that was cut.
 *
 * @param {Map<number, string>} answers
 * @param {number} unit the number of the unit
 * @param {string} text the answer for it
 */
function appendAnswer(answers, unit, text) {
  const existing = answers.get(unit);
  answers.set(unit, existing === undefined ? text : `${existing} ${text}`);
}

/**
 * Asks the translator for a piece of text.
 *
 * The clients are tried one after another inside `translateText`, so
 * there is nothing left to try again here: a refusal that survived every
 * client is not going to pass by itself, and asking again only makes it
 * worse.
 *
 * @param {string} text
 * @param {string} target
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ text: string, detected: string }>}
 */
async function translateWithRetry(text, target, fetchImpl) {
  return translateText(text, target, { fetchImpl });
}

/**
 * Waits a while.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
