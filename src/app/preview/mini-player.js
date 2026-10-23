/**
 * ============================================================================
 * MINI PLAYER (FLOATING READING CONTROLS)
 * ============================================================================
 * On a phone the transport in the header is far away from the text being
 * read. This small bar floats at the bottom of the preview while the
 * narration is running, so pause and stop are always within reach.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { stop, isSpeechPaused, onTTSStateChange } from '@/speech/tts.js';
import { icons } from '@/ui/icons.js';
import { toggleNarration } from '@/app/preview/narration.js';

let dismissed = false;

/**
 * Shows or hides the mini player.
 * @param {boolean} visible
 */
function setVisible(visible) {
  if (!el.miniPlayer) return;
  el.miniPlayer.hidden = !visible;
}

/**
 * Updates the label and the progress bar.
 */
function updateProgress({ currentWordIndex, totalWords }) {
  if (!el.miniPlayer || el.miniPlayer.hidden) return;

  const total = Math.max(1, totalWords);
  const current = Math.max(0, currentWordIndex);
  const percent = Math.min(100, (current / total) * 100);

  if (el.mpBar) el.mpBar.style.width = `${percent.toFixed(1)}%`;
  if (el.mpLabel) {
    el.mpLabel.textContent = isSpeechPaused()
      ? `Paused · ${current}/${total}`
      : `Reading ${current}/${total}`;
  }

  if (el.mpToggle) {
    const isPaused = isSpeechPaused();
    const slot = el.mpToggle.querySelector('.btn-icon-slot');
    if (slot) slot.innerHTML = isPaused ? icons.play : icons.pause;
    el.mpToggle.title = isPaused ? 'Resume' : 'Pause';
    el.mpToggle.setAttribute('aria-label', isPaused ? 'Resume reading' : 'Pause reading');
    el.mpToggle.classList.remove('is-busy');
  }
}

/**
 * Initializes the mini player.
 */
export function initMiniPlayer() {
  if (!el.miniPlayer) return;

  // Static icons
  if (el.mpStop) {
    const slot = el.mpStop.querySelector('.btn-icon-slot');
    if (slot) slot.innerHTML = icons.stop;
  }
  if (el.mpClose) {
    const slot = el.mpClose.querySelector('.btn-icon-slot');
    if (slot) slot.innerHTML = icons.close;
  }

  el.mpToggle?.addEventListener('click', () => {
    toggleNarration();
  });

  el.mpStop?.addEventListener('click', () => {
    stop('user');
    setVisible(false);
  });

  el.mpClose?.addEventListener('click', () => {
    dismissed = true;
    setVisible(false);
  });

  onTTSStateChange((state) => {
    const active = state.isPlaying || state.isPaused || state.starting;

    if (!active) {
      setVisible(false);
      dismissed = false;
      return;
    }

    if (!dismissed) setVisible(true);

    if (state.starting) {
      if (el.mpLabel) el.mpLabel.textContent = 'Starting…';
      const slot = el.mpToggle?.querySelector('.btn-icon-slot');
      if (slot) slot.innerHTML = icons.spinner;
      el.mpToggle?.classList.add('is-busy');
      return;
    }

    el.mpToggle?.classList.remove('is-busy');
    // The engine notifies on every word boundary, so the progress bar
    // advances on its own.
    updateProgress(state);
  });
}
