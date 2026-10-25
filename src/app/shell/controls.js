/**
 * ============================================================================
 * HEADER CONTROLS
 * ============================================================================
 * Playback transport, voice selection, dictation, theme, sync-scroll toggle,
 * network badge and PWA registration.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { icons } from '@/ui/icons.js';
import {
  stop,
  setRate,
  setVoice,
  getAvailableVoices,
  onTTSStateChange,
  initPlaybackWatchdog
} from '@/speech/tts.js';
import {
  toggleListening,
  isSTTSupported,
  insertTextAtCursor,
  onSTTStateChange
} from '@/speech/stt.js';
import { getSettings, saveSettings, onSettingsChange } from '@/core/settings.js';
import { refreshToolbarDensity } from '@/app/shell/toolbar.js';
import {
  setBaseMessage,
  setMessage,
  setNarrationState,
  setDictationState,
  setNetworkState
} from '@/app/shell/status.js';
import { printDocument } from '@/app/editor/print.js';
import { toggleNarration, cancelPendingStart } from '@/app/preview/narration.js';
import { groupVoices } from '@/speech/voices.js';

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
      setMessage('Paused - press Space to continue', { tone: 'accent', ttl: 2500 });
    } else if (state === 'empty') {
      setMessage('Nothing to read', { tone: 'muted', ttl: 2000 });
    } else if (state === 'playing') {
      setMessage('Reading.', { tone: 'accent', ttl: 1500 });
    }
  });
  el.btnStop.addEventListener('click', () => {
    cancelPendingStart();
    stop('user');
  });

  el.rateSlider.addEventListener('input', (event) => {
    const value = Number.parseFloat(event.target.value);
    el.rateBadge.textContent = `${value.toFixed(1)}x`;
    setRate(value);
  });

  onTTSStateChange((state) => {
    const {
      isPlaying,
      isPaused,
      starting,
      currentWordIndex,
      totalWords,
      progress,
      totalWordsEstimated,
      reason
    } = state;

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
      const place =
        totalWordsEstimated && Number.isFinite(progress)
          ? `${Math.round(Math.max(0, progress) * 100)}%`
          : `${Math.max(0, currentWordIndex) + 1}/${totalWords}`;
      setBaseMessage(`Reading ${place}`, 'accent');
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
    } else if (reason === 'other-tab') {
      setMessage('Paused - another tab is reading. Press Play to take over.', {
        tone: 'muted',
        ttl: 6000
      });
    }
  });
}

/* ==========================================================================
 * Voice selection
 * ==========================================================================
 * iOS Safari populates the voice list late — sometimes only after the
 * first user gesture — so the selector keeps listening and retrying
 * instead of giving up after one attempt. The header select and the
 * picker in the preferences share one population routine and stay in
 * step through the saved settings.
 * ========================================================================== */

/** The voices currently known to the selectors. */
let voicesCache = [];
/** The voice name that was last applied to the engine. */
let appliedVoiceName = null;

/**
 * Picks a sensible default: Thai first, then English, then multilingual.
 * @param {SpeechSynthesisVoice[]} voices
 * @returns {SpeechSynthesisVoice|null}
 */
function pickDefaultVoice(voices) {
  const groups = groupVoices(voices);
  const preferred = groups.thai[0] ?? groups.english[0] ?? groups.multilingual[0] ?? groups.other[0];
  return preferred ? preferred.voice : null;
}

/**
 * Fills a voice <select> with the grouped voice list.
 * @param {HTMLSelectElement} select
 * @param {SpeechSynthesisVoice[]} voices
 */
function fillVoiceOptions(select, voices) {
  if (!select) return;

  select.innerHTML = '';

  if (voices.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Loading voices…';
    select.appendChild(option);
    return;
  }

  const groups = groupVoices(voices);

  const appendGroup = (label, list) => {
    if (list.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = label;
    list.forEach(({ voice }) => {
      const option = document.createElement('option');
      option.value = voice.name;
      option.textContent = `${voice.name} (${voice.lang})`;
      group.appendChild(option);
    });
    select.appendChild(group);
  };

  appendGroup('🇹🇭 Thai Voices', groups.thai);
  appendGroup('🌐 Multilingual Voices', groups.multilingual);
  appendGroup('🇺🇸 English Voices', groups.english);
  appendGroup('🗣️ Other Languages', groups.other);
}

/**
 * Puts both voice selects on the saved voice, or on the first option when
 * the saved one is not among the voices this browser offers.
 */
function syncVoiceSelects() {
  const savedName = getSettings().voiceName;
  for (const select of [el.voiceSelect, el.settingsVoiceSelect]) {
    if (!select) continue;
    if (savedName && voicesCache.some((voice) => voice.name === savedName)) {
      select.value = savedName;
    } else if (select.options.length > 0) {
      select.selectedIndex = 0;
    }
  }
}

/**
 * Applies a voice list to the selectors. When the list brings the voice
 * the engine should use, it is applied — but a voice that is already
 * active is left alone, so a late list never restarts a running reading.
 * @param {SpeechSynthesisVoice[]} voices
 * @returns {boolean} whether any voices were found
 */
function applyVoices(voices) {
  voicesCache = voices;

  for (const select of [el.voiceSelect, el.settingsVoiceSelect]) {
    fillVoiceOptions(select, voices);
  }

  if (voices.length === 0) {
    syncVoiceSelects();
    return false;
  }

  const savedName = getSettings().voiceName;
  const voice =
    voices.find((candidate) => candidate.name === savedName) ?? pickDefaultVoice(voices);

  if (voice && voice.name !== appliedVoiceName) {
    appliedVoiceName = voice.name;
    setVoice(voice);
  }

  syncVoiceSelects();
  // A filled selector is wider than the loading placeholder.
  refreshToolbarDensity();
  return true;
}

/**
 * Marks the selects as permanently empty — every retry has failed.
 */
function markVoicesMissing() {
  voicesCache = [];
  for (const select of [el.voiceSelect, el.settingsVoiceSelect]) {
    if (!select) continue;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No synthesis voices on this device';
    select.appendChild(option);
  }
  refreshToolbarDensity();
}

/**
 * Initializes the voice selectors.
 *
 * The wait is deliberately not awaited: on a phone the first list can take
 * seconds, and the rest of the header must not stand behind it. The
 * selectors start with a loading placeholder and fill themselves in when
 * the voices arrive — through `voiceschanged`, through polling, or after
 * the first tap, whichever the browser offers first.
 */
function initVoiceSelector() {
  const selects = [el.voiceSelect, el.settingsVoiceSelect].filter(Boolean);
  if (selects.length === 0) return;

  const onVoiceChosen = (event) => {
    const voice = voicesCache.find((candidate) => candidate.name === event.target.value);
    if (!voice) return;
    saveSettings({ voiceName: voice.name });
    appliedVoiceName = voice.name;
    setVoice(voice);
    syncVoiceSelects();
  };
  selects.forEach((select) => select.addEventListener('change', onVoiceChosen));

  let retries = 0;
  let pollTimer = null;

  const stopRetrying = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    document.removeEventListener('pointerdown', retryOnGesture, true);
  };

  async function retryOnGesture() {
    // iOS releases the voice list to a page it has seen a gesture in. The
    // list is read on the next tick, once the engine has had its moment.
    if (await applyVoices(await getAvailableVoices())) stopRetrying();
  }

  const retry = async () => {
    if (await applyVoices(await getAvailableVoices())) {
      stopRetrying();
    } else if (retries >= 30) {
      stopRetrying();
      markVoicesMissing();
    }
  };

  // The list can also change later (a system voice pack installed while
  // the app is open), so the event is kept for the whole session.
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
    applyVoices(window.speechSynthesis.getVoices() || []);
  });

  // A tap anywhere may unlock the list — the retry rides along.
  document.addEventListener('pointerdown', retryOnGesture, true);

  (async () => {
    const found = applyVoices(await getAvailableVoices());
    if (found) {
      stopRetrying();
    } else {
      pollTimer = setInterval(retry, 1000);
    }
  })();

  // The selector's width changes when the voices fill it in.
  onSettingsChange(syncVoiceSelects);
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

  // Not awaited: on a phone the voice list can take seconds, and the rest
  // of the header must not stand behind it. The selectors fill in later.
  initVoiceSelector();
}
