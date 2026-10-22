/**
 * ============================================================================
 * HEADER CONTROLS
 * ============================================================================
 * Playback transport, voice selection, dictation, theme, sync-scroll toggle,
 * network badge and PWA registration.
 * ============================================================================
 */

import { el } from './dom.js';
import { icons } from '../icons.js';
import {
  stop,
  setRate,
  setVoice,
  getAvailableVoices,
  onTTSStateChange,
  initPlaybackWatchdog
} from '../tts-engine.js';
import {
  toggleListening,
  isSTTSupported,
  insertTextAtCursor,
  onSTTStateChange
} from '../stt-engine.js';
import { getSettings, saveSettings, onSettingsChange } from '../settings-manager.js';
import {
  setBaseMessage,
  setMessage,
  setNarrationState,
  setDictationState,
  setNetworkState
} from './status.js';
import { printDocument } from './print.js';
import { toggleNarration } from './narration.js';
import { groupVoices } from './voices.js';

/* ==========================================================================
 * Playback transport
 * ========================================================================== */

/**
 * The transport is a single toggle: the same button that starts the reading
 * pauses it, and the Space key does the same thing. Two separate buttons
 * only teach the reader which one to press.
 */
function initTransport() {
  el.btnPlay.addEventListener('click', () => {
    const state = toggleNarration();
    if (state === 'paused') {
      setMessage('Paused — press Space to continue', { tone: 'accent', ttl: 2500 });
    } else if (state === 'playing') {
      setMessage('Reading…', { tone: 'accent', ttl: 1500 });
    }
  });
  el.btnStop.addEventListener('click', () => stop('user'));

  el.rateSlider.addEventListener('input', (event) => {
    const value = Number.parseFloat(event.target.value);
    el.rateBadge.textContent = `${value.toFixed(1)}x`;
    setRate(value);
  });

  onTTSStateChange((state) => {
    const { isPlaying, isPaused, starting, currentWordIndex, totalWords, reason } = state;

    // "Starting" covers the window between the press and the moment the
    // speech engine actually begins — tokenizing a large document takes a
    // moment and the button must not look unresponsive.
    el.btnPlay.disabled = starting;
    el.btnStop.disabled = !isPlaying && !isPaused;

    el.btnPlay.classList.toggle('is-busy', Boolean(starting));
    el.btnPlay.setAttribute('aria-busy', starting ? 'true' : 'false');

    // The button shows what it is going to do: pause while the reading
    // runs, play when it is idle or paused.
    const speaking = isPlaying && !isPaused;
    const playSlot = el.btnPlay.querySelector('.btn-icon-slot');
    if (playSlot) {
      const wanted = starting ? icons.spinner : speaking ? icons.pause : icons.play;
      const name = starting ? 'spinner' : speaking ? 'pause' : 'play';
      if (playSlot.dataset.icon !== name) {
        playSlot.dataset.icon = name;
        playSlot.innerHTML = wanted;
      }
    }

    const playLabel = el.btnPlay.querySelector('.play-label');
    if (playLabel) {
      playLabel.textContent = starting ? '…' : speaking ? 'Pause' : isPaused ? 'Resume' : 'Play';
    }

    el.btnPlay.title = starting
      ? 'Starting the reading'
      : speaking
        ? 'Pause reading'
        : isPaused
          ? 'Resume reading'
          : 'Play reading';
    el.btnPlay.setAttribute('aria-label', el.btnPlay.title);

    if (starting) {
      setNarrationState('starting');
      setBaseMessage('Starting…', 'accent');
    } else if (isPlaying && !isPaused) {
      setNarrationState('playing');
      setBaseMessage(`Reading word ${Math.max(0, currentWordIndex) + 1}/${totalWords}`, 'accent');
    } else if (isPaused) {
      setNarrationState('paused');
      setBaseMessage('Paused', 'muted');
    } else {
      setNarrationState('idle');
      setBaseMessage('Click word to listen', 'muted');
    }

    // Reason-specific explanations win over the base message for a while, so
    // the user actually learns what happened.
    if (reason === 'content-replaced') {
      setMessage('Content replaced — playback stopped', { tone: 'warn', ttl: 4000 });
    } else if (reason === 'content-edited') {
      setMessage('Document edited — playback stopped', { tone: 'muted', ttl: 3000 });
    } else if (reason === 'speech-lost') {
      setMessage('Speech engine stopped unexpectedly', { tone: 'warn', ttl: 4000 });
    } else if (reason === 'no-start') {
      setMessage('The speech engine did not start — try again', { tone: 'warn', ttl: 4000 });
    }
  });
}

/* ==========================================================================
 * Voice selection
 * ========================================================================== */

async function initVoiceSelector() {
  const voices = await getAvailableVoices();
  if (!el.voiceSelect) return;

  el.voiceSelect.innerHTML = '';

  if (voices.length === 0) {
    const option = document.createElement('option');
    option.textContent = 'No synthesis voices detected';
    el.voiceSelect.appendChild(option);
    return;
  }

  const groups = groupVoices(voices);

  const appendGroup = (label, list) => {
    if (list.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = label;
    list.forEach(({ voice, index }) => {
      const option = document.createElement('option');
      option.value = index.toString();
      option.textContent = `${voice.name} (${voice.lang})`;
      group.appendChild(option);
    });
    el.voiceSelect.appendChild(group);
  };

  appendGroup('🇹🇭 Thai Voices', groups.thai);
  appendGroup('🌐 Multilingual Voices', groups.multilingual);
  appendGroup('🇺🇸 English Voices', groups.english);
  appendGroup('🗣️ Other Languages', groups.other);

  let defaultIndex = 0;
  if (groups.thai.length > 0) defaultIndex = groups.thai[0].index;
  else if (groups.english.length > 0) defaultIndex = groups.english[0].index;
  else if (groups.multilingual.length > 0) defaultIndex = groups.multilingual[0].index;

  const savedVoiceName = getSettings().voiceName;
  if (savedVoiceName) {
    const found = voices.findIndex((voice) => voice.name === savedVoiceName);
    if (found >= 0) defaultIndex = found;
  }

  el.voiceSelect.value = defaultIndex.toString();
  setVoice(voices[defaultIndex]);

  el.voiceSelect.addEventListener('change', () => {
    const chosen = voices[Number.parseInt(el.voiceSelect.value, 10)];
    if (!chosen) return;
    saveSettings({ voiceName: chosen.name });
    setVoice(chosen);
  });
}

/* ==========================================================================
 * Dictation (speech to text)
 * ========================================================================== */

function initDictation() {
  if (!isSTTSupported()) {
    el.btnMic.disabled = true;
    el.btnMic.title =
      'Speech Recognition is not supported in this browser (Chrome / Edge recommended)';
    return;
  }

  el.btnMic.addEventListener('click', () => {
    toggleListening({
      onResult: (finalText) => {
        if (!finalText) return;
        // insertTextAtCursor dispatches a native `input` event, so the
        // preview and the draft are updated through the normal pipeline.
        insertTextAtCursor(el.editor, finalText);
      },
      onError: (err) => {
        console.warn('STT Error:', err);
      }
    });
  });

  onSTTStateChange(({ isListening }) => {
    setDictationState(isListening);
    el.btnMic.classList.toggle('recording', isListening);
    el.btnMic.innerHTML = isListening
      ? `<span class="btn-icon-slot">${icons.micOff}</span><span class="mic-label">Listening...</span>`
      : `<span class="btn-icon-slot">${icons.mic}</span><span class="mic-label">Dictate</span>`;
  });
}

/* ==========================================================================
 * Theme
 * ========================================================================== */

function initTheme() {
  const systemQuery = window.matchMedia?.('(prefers-color-scheme: light)');

  /** Resolves the preference (which may be "system") into a concrete theme. */
  const resolve = () => {
    const preference = getSettings().theme;
    if (preference === 'system') return systemQuery?.matches ? 'light' : 'dark';
    return preference;
  };

  const apply = () => {
    const theme = resolve();
    document.documentElement.setAttribute('data-theme', theme);
    el.btnTheme.innerHTML = theme === 'dark' ? icons.sun : icons.moon;
    el.btnTheme.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
    );
    el.btnTheme.title = theme === 'dark' ? 'Light theme' : 'Dark theme';
  };

  // Follow the operating system while the preference is "system".
  systemQuery?.addEventListener?.('change', apply);

  el.btnTheme.addEventListener('click', () => {
    saveSettings({ theme: resolve() === 'dark' ? 'light' : 'dark' });
    apply();
  });

  onSettingsChange(apply);
  apply();
}

/* ==========================================================================
 * Printing
 * ========================================================================== */

/**
 * Prints the document — the browser's dialog can also save it as a PDF.
 */
function initPrint() {
  el.btnPrint?.addEventListener('click', () => {
    printDocument();
    setMessage('Printing the document…', { tone: 'muted', ttl: 1500 });
  });
}

/* ==========================================================================
 * Synchronized scrolling
 * ========================================================================== */

const SYNC_ORDER = ['off', 'ratio', 'line'];
const SYNC_LABELS = { off: 'Off', ratio: 'Proportional', line: 'By line' };

function initSyncScrollToggle() {
  const apply = () => {
    const mode = getSettings().syncMode;
    const enabled = mode !== 'off';
    el.btnSyncScroll.classList.toggle('active', enabled);
    el.btnSyncScroll.setAttribute('aria-pressed', String(enabled));
    el.btnSyncScroll.title = `Synced scrolling: ${SYNC_LABELS[mode]}`;
  };

  el.btnSyncScroll.addEventListener('click', () => {
    const current = getSettings().syncMode;
    const next = SYNC_ORDER[(SYNC_ORDER.indexOf(current) + 1) % SYNC_ORDER.length];
    saveSettings({ syncMode: next });
    apply();
  });

  apply();
}

/* ==========================================================================
 * Network state & PWA
 * ==========================================================================
 * The network state is surfaced in the footer, not as a badge in the header:
 * a second status indicator next to the brand was noise, and the footer
 * already carries the "Client Ready" line.
 * ========================================================================== */

function initNetworkStatus() {
  const update = () => setNetworkState(navigator.onLine);

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function initOfflineSupport() {
  if (!('serviceWorker' in navigator)) return;

  // While the app is being worked on, the service worker would keep
  // serving the files of an earlier moment: its cache is only replaced
  // when the app is built again. So in development it goes — and the
  // caches of an earlier session with it.
  if (!import.meta.env.PROD) {
    navigator.serviceWorker
      .getRegistrations?.()
      .then((registrations) => registrations.forEach((registration) => registration.unregister()))
      .catch(() => {});

    if (typeof caches !== 'undefined') {
      caches
        .keys()
        .then((keys) => keys.forEach((key) => caches.delete(key)))
        .catch(() => {});
    }
    return;
  }

  const isLocal =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (window.location.protocol !== 'https:' && !isLocal) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => registration.update())
      .catch(() => {});
  });
}

/* ==========================================================================
 * Bootstrap
 * ========================================================================== */

/**
 * Initializes every header control.
 */
export async function initControls() {
  initTransport();
  initTheme();
  initSyncScrollToggle();
  initDictation();
  initNetworkStatus();
  initOfflineSupport();
  initPlaybackWatchdog();
  initPrint();

  await initVoiceSelector();
}
