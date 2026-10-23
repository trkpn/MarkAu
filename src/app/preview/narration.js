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

import { play, pause, isSpeaking, isSpeechPaused, isNarrationStarting } from '@/speech/tts.js';
import { flushRender, isPreviewCurrent } from '@/app/preview/preview.js';

/** True while a start is waiting for the preview to catch up. */
let pendingStart = false;

/**
 * Toggles the narration.
 *
 * @returns {'playing'|'paused'|'resumed'|'starting'} what the narration is
 *   doing now
 */
export function toggleNarration() {
  // The engine is still warming up — a second request would start the
  // reading twice.
  if (isNarrationStarting()) return 'starting';

  if (isSpeaking() && !isSpeechPaused()) {
    pause();
    return 'paused';
  }

  // Taking a pause back resumes the utterance that is already waiting; the
  // preview does not have to be rebuilt for that.
  if (isSpeaking() && isSpeechPaused()) {
    flushRender();
    play();
    return isSpeechPaused() ? 'resumed' : 'playing';
  }

  // The preview has to be current, or the narrator would read a document the
  // editor has already replaced. Rendering is incremental now, so wait for
  // it instead of tokenizing the first block of a half-rendered page.
  if (!isPreviewCurrent()) {
    if (pendingStart) return 'starting';

    pendingStart = true;
    flushRender()
      .then(() => {
        pendingStart = false;
        if (!isSpeaking() && !isSpeechPaused()) play();
      })
      .catch(() => {
        pendingStart = false;
      });

    return 'starting';
  }

  play();
  return isSpeechPaused() ? 'resumed' : 'playing';
}
