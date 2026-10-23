/**
 * ============================================================================
 * STATUS BAR MANAGER
 * ============================================================================
 * The status bar used to be written from a dozen different places, which meant
 * a late TTS state notification could silently overwrite the explanation the
 * user was supposed to read ("Content replaced — playback stopped").
 *
 * This module owns the footer completely:
 *   • a BASE message, driven by the current narration / dictation state
 *   • an OVERRIDE message with a time-to-live, used for one-off explanations
 * The override always wins while it is alive, so the explanation survives.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';

const BASE_DEFAULT = 'Click word to listen';

let base = { text: BASE_DEFAULT, tone: 'muted' };
let override = null; // { text, tone, expiresAt }
let overrideTimer = null;

/** Narration state: 'idle' | 'starting' | 'playing' | 'paused' */
let narrationState = 'idle';
/** Dictation state: boolean */
let dictationActive = false;
/** Network state: boolean */
let networkOnline = true;

/**
 * Renders the effective message into the footer chip.
 */
function renderChip() {
  if (!el.speechStatusChip) return;

  const now = Date.now();
  if (override && override.expiresAt && now >= override.expiresAt) {
    override = null;
  }

  const effective = override || base;
  if (el.speechStatusChip.textContent !== effective.text) {
    el.speechStatusChip.textContent = effective.text;
  }
  el.speechStatusChip.dataset.tone = effective.tone;
}

/**
 * Sets the message that reflects the current application state.
 * @param {string} text
 * @param {'muted'|'accent'|'warn'} [tone]
 */
export function setBaseMessage(text, tone = 'muted') {
  base = { text, tone };
  renderChip();
}

/**
 * Shows a temporary, explanatory message that takes precedence over the base
 * message until it expires.
 * @param {string} text
 * @param {{ tone?: 'muted'|'accent'|'warn', ttl?: number }} [options]
 */
export function setMessage(text, { tone = 'muted', ttl = 0 } = {}) {
  override = { text, tone, expiresAt: ttl > 0 ? Date.now() + ttl : 0 };

  if (overrideTimer) {
    clearTimeout(overrideTimer);
    overrideTimer = null;
  }

  if (ttl > 0) {
    overrideTimer = setTimeout(() => {
      override = null;
      overrideTimer = null;
      renderChip();
    }, ttl + 50);
  }

  renderChip();
}

/**
 * Removes any active override message.
 */
export function clearMessage() {
  override = null;
  if (overrideTimer) {
    clearTimeout(overrideTimer);
    overrideTimer = null;
  }
  renderChip();
}

/**
 * Updates the narration state and refreshes the system indicator.
 * @param {'idle'|'playing'|'paused'} state
 */
export function setNarrationState(state) {
  narrationState = state;
  renderSystemIndicator();
}

/**
 * Updates the dictation state and refreshes the system indicator.
 * @param {boolean} active
 */
export function setDictationState(active) {
  dictationActive = active;
  renderSystemIndicator();
}

/**
 * The system indicator merges the narration, dictation and network states;
 * the more pressing one wins. Being offline is worth surfacing because the
 * app still works — it just cannot reach the network.
 */
function renderSystemIndicator() {
  if (!el.systemStatusDot || !el.systemStatusText) return;

  if (dictationActive) {
    el.systemStatusDot.className = 'status-dot recording';
    el.systemStatusText.textContent = 'Microphone Active (Dictating...)';
    return;
  }

  if (narrationState === 'starting') {
    el.systemStatusDot.className = 'status-dot reading';
    el.systemStatusText.textContent = 'Preparing narration…';
    return;
  }

  if (narrationState === 'playing') {
    el.systemStatusDot.className = 'status-dot reading';
    el.systemStatusText.textContent = 'Text-to-Speech active';
    return;
  }

  if (narrationState === 'paused') {
    el.systemStatusDot.className = 'status-dot active';
    el.systemStatusText.textContent = 'Audio paused';
    return;
  }

  if (!networkOnline) {
    el.systemStatusDot.className = 'status-dot';
    el.systemStatusText.textContent = 'Offline — still working';
    return;
  }

  el.systemStatusDot.className = 'status-dot active';
  el.systemStatusText.textContent = 'Client Ready';
}

/**
 * Updates the network state.
 * @param {boolean} online
 */
export function setNetworkState(online) {
  networkOnline = Boolean(online);
  renderSystemIndicator();
}

/**
 * Initializes the status bar.
 */
export function initStatus() {
  base = { text: BASE_DEFAULT, tone: 'muted' };
  override = null;
  narrationState = 'idle';
  dictationActive = false;
  networkOnline = true;
  renderChip();
  renderSystemIndicator();
}
