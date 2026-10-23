/**
 * ============================================================================
 * VERSION HISTORY (LOCAL STORAGE)
 * ============================================================================
 * The versions of the document are kept in the browser — and nowhere else.
 * There is no server for them: the history lives in the localStorage of the
 * browser and dies with it.
 *
 * Three rules keep it from turning into a problem:
 *
 *   1. Every read is sanitized. A payload that was edited by hand, or that
 *      was cut in half by a crash, starts from empty instead of throwing —
 *      the history is a comfort, never a reason for the app to stop.
 *   2. The history is capped twice: by the number of versions and by the
 *      space they take. The oldest ones go first, and at least one version
 *      always stays.
 *   3. The same text is never stored twice in a row — a restore or a
 *      translation would otherwise fill the history with copies of itself.
 *
 * Everything that can be tested on its own is a pure function: the pruning,
 * the fingerprint, the summary of a document, the moment a version was
 * taken.
 * ============================================================================
 */

const HISTORY_STORAGE_KEY = 'markau_history_v1';

const SCHEMA_VERSION = 1;

/** How many versions are kept when nothing else is asked for. */
export const DEFAULT_LIMIT = 100;

/** How much space the history may take — about 1.5 MB of text. */
export const HISTORY_BUDGET_BYTES = 1_500_000;

/** The history never becomes empty: a history of nothing is no history. */
export const MIN_ENTRIES = 1;

/** The version was taken because the typing stopped. */
export const REASON_AUTO = 'auto';

/** The version was taken because the user asked for it. */
export const REASON_MANUAL = 'manual';

/** The version was taken just before the document was replaced. */
export const REASON_BEFORE_REPLACE = 'before-replace';

/** The version was taken just before an older version was put back. */
export const REASON_BEFORE_RESTORE = 'before-restore';

/** Every reason a version can have. Anything else is read as `auto`. */
const REASONS = [REASON_AUTO, REASON_MANUAL, REASON_BEFORE_REPLACE, REASON_BEFORE_RESTORE];

/** The listeners that want to know when the history changes. */
const listeners = new Set();

/* ==========================================================================
 * Small helpers
 * ========================================================================== */

/**
 * The size of a text in bytes (UTF-8).
 *
 * The browser counts the storage in bytes, not in characters — a text of
 * Thai characters takes three bytes for every character it has.
 *
 * @param {string} text
 * @returns {number}
 */
function utf8Bytes(text) {
  const value = String(text ?? '');
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

/**
 * The space an entry takes in the stored payload.
 * @param {object} entry
 * @returns {number} bytes
 */
export function entryBytes(entry) {
  try {
    return utf8Bytes(JSON.stringify(entry ?? {}));
  } catch {
    return utf8Bytes(String(entry?.markdown ?? ''));
  }
}

/**
 * The size of a list of entries.
 * @param {object[]} entries
 * @returns {number} bytes
 */
function totalBytes(entries) {
  return entries.reduce((sum, entry) => sum + entryBytes(entry), 0);
}

/**
 * Notifies the listeners that the history has changed.
 */
function notifyListeners() {
  const stats = historyStats();
  listeners.forEach((fn) => {
    try {
      fn(stats);
    } catch (e) {
      console.error('History listener error:', e);
    }
  });
}

/* ==========================================================================
 * The pure helpers
 * ========================================================================== */

/**
 * The mark of a text — the same text always has the same mark.
 *
 * FNV-1a (32 bit) together with the length of the text: the hash alone
 * would let two different documents look the same, and the length alone
 * would let two documents of the same size look the same.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function fingerprint(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${hash.toString(16)}-${text.length}`;
}

/**
 * What is known about a document without reading all of it again.
 *
 * The title is the first heading of the document; a document without a
 * heading is named after its first line that is not empty. Long titles are
 * cut short — the name of a version is a label, not the document.
 *
 * @param {string} markdown
 * @returns {{ title: string, chars: number, words: number, lines: number }}
 */
export function summarize(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  const lines = text.split('\n');

  const heading = lines.find((line) => /^#\s+\S/.test(line.trim()));
  const firstLine = lines.find((line) => line.trim());

  const rawTitle = heading ? heading.trim().replace(/^#\s+/, '') : (firstLine?.trim() ?? '');

  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;

  return {
    title: rawTitle.slice(0, 60),
    chars: text.length,
    words,
    lines: lines.length
  };
}

/**
 * How many characters an edit takes out of, or puts into, the document.
 *
 * The beginning and the end that the two texts share are not part of the
 * change; what lies between them is. It is a cheap measure of an edit — a
 * real diff would say more, and cost far more.
 *
 * @param {string} before the text as it was
 * @param {string} after the text as it is
 * @returns {number} the characters that were removed plus those that were added
 */
export function changedCharacters(before, after) {
  const first = typeof before === 'string' ? before : '';
  const second = typeof after === 'string' ? after : '';

  const shortest = Math.min(first.length, second.length);

  let start = 0;
  while (start < shortest && first[start] === second[start]) start += 1;

  let end = 0;
  while (
    end < shortest - start &&
    first[first.length - 1 - end] === second[second.length - 1 - end]
  ) {
    end += 1;
  }

  return first.length + second.length - 2 * (start + end);
}

/**
 * Whether the document was rewritten instead of edited.
 *
 * A rewrite is a change in which most of the text is gone: an import, a
 * translation, a reset. The measure is the part the two texts have in
 * common at the front — when less than half of the shorter text is shared,
 * the text that was there is not in the text that is there any more.
 *
 * @param {string} before the text as it was
 * @param {string} after the text as it is
 * @returns {boolean}
 */
export function looksLikeBulkRewrite(before, after) {
  const first = typeof before === 'string' ? before : '';
  const second = typeof after === 'string' ? after : '';

  const shortest = Math.min(first.length, second.length);
  if (shortest === 0) return first !== second;

  let shared = 0;
  while (shared < shortest && first[shared] === second[shared]) shared += 1;

  return shared / shortest < 0.5;
}

/**
 * How long ago a version was taken.
 * @param {number} at the moment the version was taken
 * @param {number} [now] the moment to measure from
 * @returns {string}
 */
export function formatRelativeTime(at, now = Date.now()) {
  const then = Number(at);
  if (!Number.isFinite(then)) return 'unknown';

  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);

  if (seconds < 45) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  try {
    return new Date(then).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return 'unknown';
  }
}

/**
 * A number with at most one decimal — and without a decimal that is only
 * zeros: 240 KB reads better than 240.0 KB.
 * @param {number} value
 * @returns {string}
 */
function trimZero(value) {
  return String(Math.round(value * 10) / 10);
}

/**
 * A number of bytes that a person can read.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const value = Number(bytes);
  const size = Number.isFinite(value) && value > 0 ? value : 0;

  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${trimZero(size / 1024)} KB`;
  return `${trimZero(size / (1024 * 1024))} MB`;
}

/* ==========================================================================
 * Reading and writing
 * ========================================================================== */

/**
 * Turns an entry of the payload into one that can be trusted.
 *
 * The metadata is not taken from the payload but computed again from the
 * text — a hand-edited title cannot lie about the document it names.
 *
 * @param {unknown} raw
 * @param {number} [index] the place of the entry in the list
 * @returns {object|null} the entry, or null when it is of no use
 */
function sanitizeEntry(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;

  const markdown = typeof raw.markdown === 'string' ? raw.markdown : null;
  if (markdown === null) return null;

  const stamp = Number(raw.at);
  const at = Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
  const reason = REASONS.includes(raw.reason) ? raw.reason : REASON_AUTO;
  const id =
    typeof raw.id === 'string' && raw.id ? raw.id : `${at}-${fingerprint(markdown)}-${index}`;

  return { id, at, reason, ...summarize(markdown), markdown };
}

/**
 * Reads the history out of the browser.
 *
 * A payload that cannot be read is not an error — the history starts from
 * empty, and the app carries on.
 *
 * @returns {object[]} the versions, newest first
 */
export function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];

    const list = Array.isArray(parsed.entries) ? parsed.entries : [];
    return list.map((entry, index) => sanitizeEntry(entry, index)).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Writes the history into the browser.
 *
 * When the browser refuses the write — the storage is full — the oldest
 * versions are thrown out and the write is tried one more time. A history
 * that is a little shorter is better than a history that is not there.
 *
 * @param {object[]} entries the versions, newest first
 * @param {{ limit?: number, budget?: number }} [options]
 * @returns {boolean} whether the history was written
 */
export function writeHistory(entries, options = {}) {
  const { limit = DEFAULT_LIMIT, budget = HISTORY_BUDGET_BYTES } = options;
  const list = Array.isArray(entries) ? entries : [];

  const payload = JSON.stringify({ version: SCHEMA_VERSION, entries: list });

  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, payload);
    notifyListeners();
    return true;
  } catch {
    /* the storage is full — the oldest versions go first */
  }

  try {
    const smaller = prune(list, { limit, budget: Math.floor(budget / 2) });
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, entries: smaller })
    );
    notifyListeners();
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps the history within its limits.
 *
 * The oldest versions are the ones that go: the newest is the one the user
 * is most likely to want back. At least one version always stays — a
 * history of nothing is no history at all.
 *
 * @param {object[]} entries the versions, newest first
 * @param {{ limit?: number, budget?: number }} [options]
 * @returns {object[]} the versions that are kept
 */
export function prune(entries, options = {}) {
  const { limit = DEFAULT_LIMIT, budget = HISTORY_BUDGET_BYTES } = options;
  const list = Array.isArray(entries) ? entries : [];

  const wanted = Number(limit);
  const max = Math.max(MIN_ENTRIES, Number.isFinite(wanted) ? Math.floor(wanted) : MIN_ENTRIES);

  const wantedBytes = Number(budget);
  const maxBytes = Number.isFinite(wantedBytes) && wantedBytes > 0 ? wantedBytes : Infinity;

  const kept = [];
  let bytes = 0;

  for (const entry of list) {
    if (!entry) continue;
    if (kept.length >= max) break;

    const size = entryBytes(entry);

    // The newest version is kept even when it is bigger than the whole
    // budget — it is the one the user is working on.
    if (kept.length >= MIN_ENTRIES && bytes + size > maxBytes) break;

    kept.push(entry);
    bytes += size;
  }

  return kept;
}

/* ==========================================================================
 * The public API
 * ========================================================================== */

/**
 * The versions of the document — without their text.
 *
 * The list is drawn over and over again, and the text of the versions is
 * far bigger than what is shown of them. So the list only carries what is
 * on the screen.
 *
 * @returns {object[]}
 */
export function listVersions() {
  return readHistory().map((entry) => ({
    id: entry.id,
    at: entry.at,
    reason: entry.reason,
    title: entry.title,
    chars: entry.chars,
    words: entry.words,
    lines: entry.lines
  }));
}

/**
 * One version, with its text.
 * @param {string} id
 * @returns {object|null}
 */
export function getVersion(id) {
  if (!id) return null;
  return readHistory().find((entry) => entry.id === id) ?? null;
}

/**
 * Keeps a version of the document.
 *
 * The same text is kept once, wherever it sits in the history: a restore,
 * a translation or a paste of something that was there before would
 * otherwise fill the history with copies of itself.
 *
 * @param {string} markdown the text of the version
 * @param {{ reason?: string, at?: number, limit?: number, budget?: number }} [options]
 * @returns {{ added: boolean, entry?: object, reason?: 'duplicate'|'empty'|'quota' }}
 */
export function addVersion(markdown, options = {}) {
  const text = typeof markdown === 'string' ? markdown : '';
  if (!text.trim()) return { added: false, reason: 'empty' };

  const {
    reason = REASON_AUTO,
    at = Date.now(),
    limit = DEFAULT_LIMIT,
    budget = HISTORY_BUDGET_BYTES
  } = options;

  const entries = readHistory();
  const newest = entries[0];
  const mark = fingerprint(text);

  if (newest && fingerprint(newest.markdown) === mark) {
    return { added: false, reason: 'duplicate' };
  }

  const wanted = Number(at);
  const stamp = Number.isFinite(wanted) ? wanted : Date.now();

  // The same document is kept only once in the whole history — not only
  // once in a row. A text that was seen before is moved to the top
  // instead of being kept again: pasting the same thing ten times must
  // leave one version, not ten.
  const knownIndex = entries.findIndex((entry) => fingerprint(entry.markdown) === mark);
  const known = knownIndex >= 0 ? entries[knownIndex] : null;

  const entry = {
    id: known?.id ?? `${stamp}-${mark}`,
    at: stamp,
    reason: REASONS.includes(reason) ? reason : REASON_AUTO,
    ...summarize(text),
    markdown: text
  };

  const rest = entries.filter((_, index) => index !== knownIndex);
  const next = prune([entry, ...rest], { limit, budget });
  if (!writeHistory(next, { limit, budget })) {
    return { added: false, reason: 'quota' };
  }

  return { added: true, entry };
}

/**
 * Throws one version away.
 * @param {string} id
 * @returns {boolean} whether a version was thrown away
 */
export function removeVersion(id) {
  if (!id) return false;

  const entries = readHistory();
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return false;

  writeHistory(next);
  return true;
}

/**
 * Keeps the stored versions within a new set of limits, right away.
 *
 * A smaller limit in the preferences has to be honest the moment it is
 * chosen, not only when the next version is taken.
 *
 * @param {{ limit?: number, budget?: number }} [options]
 * @returns {boolean} whether the history is within its limits now
 */
export function trimHistory(options = {}) {
  const entries = readHistory();
  const next = prune(entries, options);
  if (next.length === entries.length) return true;
  return writeHistory(next, options);
}

/**
 * Throws the whole history away. The document itself is not touched.
 */
export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    /* the storage may be unavailable */
  }
  notifyListeners();
}

/**
 * What the history holds.
 * @returns {{ count: number, bytes: number, oldest: number|null, newest: number|null }}
 */
export function historyStats() {
  const entries = readHistory();

  return {
    count: entries.length,
    bytes: totalBytes(entries),
    oldest: entries.length ? entries[entries.length - 1].at : null,
    newest: entries.length ? entries[0].at : null
  };
}

/**
 * Subscribes to the changes of the history.
 * @param {(stats: { count: number, bytes: number }) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onHistoryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Refreshes the open dialog when another tab adds, removes or clears a
 * version. The event only fires in the other tabs.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== HISTORY_STORAGE_KEY) return;
    notifyListeners();
  });
}
