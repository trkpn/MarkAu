/**
 * ============================================================================
 * NARRATION CONTROL
 * ============================================================================
 *
 * One place that decides what "play / pause" means, so that every gesture
 * behaves the same:
 *
 *   • the Space key
 *   • the Play / Pause button in the header
 *   • the mini player
 *   • a click on the empty space of the preview
 *
 * All of them toggle: the reading starts, pauses, and resumes again — never
 * "does nothing", which is what a half-finished control ends up doing.
 *
 * Reading *from a word* is a different gesture and lives in the preview: the
 * reader points at the place they want to start from.
 * ============================================================================
 */

import {
  play,
  pause,
  isSpeaking,
  isSpeechPaused,
  isNarrationStarting,
  hasSpeechContent
} from '@/speech/tts.js';
import {
  ensureRenderedThrough,
  flushRender,
  hasDocumentContent,
  isPreviewCurrent
} from '@/app/preview/preview.js';

/** True while a start is waiting for the preview to catch up. */
let pendingStart = false;
/** Bumped when a waiting start is no longer wanted. */
let startGeneration = 0;
/** How many times the same start has waited for a new render. */
let startRetries = 0;
const MAX_START_RETRIES = 2;

/**
 * Starts the reading from whatever part of the preview is already on screen.
 * The render keeps appending blocks, and the narration picks them up as the
 * window grows.
 *
 * @returns {boolean} whether the engine took the request
 */
function startNow() {
  play();
  return isNarrationStarting() || isSpeaking() || isSpeechPaused();
}

/**
 * Cancels a Play press that is still waiting for the preview.
 *
 * A reader who presses Stop while the first chunk is rendering does not want
 * the narration to begin as soon as that chunk arrives.
 */
export function cancelPendingStart() {
  const wasPending = pendingStart;
  startGeneration += 1;
  pendingStart = false;
  startRetries = 0;
  return wasPending;
}

/**
 * Decides what to do when the engine did not take the request immediately.
 *
 * @returns {'starting'|'empty'}
 */
function finishStart() {
  if (isPreviewCurrent() && !hasSpeechContent()) return 'empty';
  return waitForFirstChunk();
}

/**
 * Waits for the first rendered chunk, then tries again.
 * @returns {'starting'|'empty'}
 */
function waitForFirstChunk() {
  if (pendingStart) return 'starting';
  if (isPreviewCurrent() && !hasSpeechContent()) return 'empty';
  if (startRetries >= MAX_START_RETRIES) return 'empty';

  const generation = startGeneration;
  pendingStart = true;
  startRetries += 1;

  ensureRenderedThrough(1)
    .then(() => {
      if (generation !== startGeneration) return;

      pendingStart = false;
      if (isSpeaking() || isSpeechPaused()) return;
      if (!hasDocumentContent()) return;
      if (startNow()) return;

      // A new render may have cleared the preview after this waiter was
      // resolved; wait for the new one instead of silently doing nothing.
      if (!isPreviewCurrent()) {
        waitForFirstChunk();
        return;
      }

      if (hasSpeechContent() && startRetries < MAX_START_RETRIES) {
        waitForFirstChunk();
      }
    })
    .catch(() => {
      if (generation === startGeneration) pendingStart = false;
    });

  return 'starting';
}

/**
 * Toggles the narration.
 *
 * @returns {'playing'|'paused'|'resumed'|'starting'|'empty'} what the narration
 *   is doing now
 */
export function toggleNarration() {
  // The engine is still warming up, or the first chunk is still rendering — a
  // second request would restart the work underneath the first one.
  if (isNarrationStarting() || pendingStart) return 'starting';

  if (isSpeaking() && !isSpeechPaused()) {
    pause();
    return 'paused';
  }

  // Taking a pause back resumes the utterance that is already waiting; the
  // preview does not have to be rebuilt for that.
  if (isSpeaking() && isSpeechPaused()) {
    if (!isPreviewCurrent()) flushRender();
    if (startNow()) return isSpeechPaused() ? 'resumed' : 'playing';
    return finishStart();
  }

  if (!hasDocumentContent()) return 'empty';

  // Start from the blocks that are already rendered instead of waiting for a
  // whole book to reach the page. The progressive render adds the rest of its
  // chunks to the speech window while the engine is warming up.
  startRetries = 0;
  if (!isPreviewCurrent()) flushRender();

  if (startNow()) return isSpeechPaused() ? 'resumed' : 'playing';

  // The preview was just cleared by a fresh render and has no block yet, or
  // the visible part holds no readable text.
  return finishStart();
}
