/**
 * ============================================================================
 * COOPERATIVE SCHEDULING
 * ============================================================================
 * The app handles documents that can be several megabytes long. A loop that
 * touches every block at once freezes the page, so the heavy stages yield
 * between small slices instead.
 *
 * The helpers here are deliberately small and dependency free: the importers,
 * the preview, the narrator and the translator all share the same budget.
 * ============================================================================
 */

/** A document above this size gets the lazy, time-sliced treatment. */
export const LARGE_DOC_CHARS = 120_000;

/** Above this size the one-time Markdown parse is moved off the main thread. */
export const HUGE_DOC_CHARS = 3_000_000;

/** How much rendered HTML one preview slice may produce. */
export const RENDER_CHUNK_CHARS = 32_000;

/** How much speech text one narrator window should cover. */
export const TTS_WINDOW_CHARS = 6_000;

/**
 * How much text the first window should cover.
 *
 * The first Play must not spend its whole click tokenizing a large part of
 * the page: the window grows while the voice is already speaking.
 */
export const TTS_START_WINDOW_CHARS = 2_500;

/** How many source lines the translator reads ahead of the viewport. */
export const TRANSLATE_LOOKAHEAD_LINES = 160;

/** The most translation units one lazy round may carry. */
export const TRANSLATE_MAX_UNITS = 80;

/** How long a slice may run before it must yield, in milliseconds. */
export const SLICE_BUDGET_MS = 8;

/**
 * Returns the browser's scheduler when it has one.
 * @returns {object|null}
 */
function schedulerApi() {
  return typeof globalThis.scheduler !== 'undefined' &&
    typeof globalThis.scheduler?.postTask === 'function'
    ? globalThis.scheduler
    : null;
}

/**
 * Yields to the event loop so the browser can paint and handle input.
 *
 * `scheduler.postTask` is used where it exists because it keeps the task
 * priority honest. The animation-frame fallback also gives the browser a
 * paint; the timer fallback is for jsdom and old browsers.
 *
 * @param {'user-visible'|'background'} [priority]
 * @returns {Promise<void>}
 */
export function yieldToMainThread(priority = 'user-visible') {
  const scheduler = schedulerApi();
  if (scheduler) {
    return scheduler.postTask(() => {}, { priority }).then(() => {});
  }

  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  }

  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Waits for idle time, with a bounded fallback.
 *
 * @param {number} [timeout]
 * @returns {Promise<void>}
 */
export function yieldToIdle(timeout = 1000) {
  if (typeof requestIdleCallback === 'function') {
    return new Promise((resolve) => {
      requestIdleCallback(() => resolve(), { timeout });
    });
  }

  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Tells whether a slice has used its time budget.
 *
 * @param {number} started when the slice started, from `performance.now()`
 * @param {number} [budget]
 * @returns {boolean}
 */
export function shouldYield(started, budget = SLICE_BUDGET_MS) {
  return performance.now() - started >= budget;
}

/**
 * Throws the abort reason when a signal has been aborted.
 *
 * @param {AbortSignal|undefined|null} signal
 */
export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('The work was stopped.');
    error.name = 'AbortError';
    throw error;
  }
}

/**
 * Reports progress without letting a broken listener stop the work.
 *
 * @param {((progress: object) => void)|undefined|null} callback
 * @param {object} progress
 */
export function reportProgress(callback, progress) {
  if (typeof callback !== 'function') return;

  try {
    callback(progress);
  } catch (err) {
    console.warn('Progress listener failed:', err);
  }
}
