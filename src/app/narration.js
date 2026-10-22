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

import { play, pause, isSpeaking, isSpeechPaused, isNarrationStarting } from '../tts-engine.js';
import { flushRender } from './preview.js';

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

  // The preview has to be current, or the narrator would read a document
  // the editor has already replaced.
  flushRender();
  play();
  return isSpeechPaused() ? 'resumed' : 'playing';
}
