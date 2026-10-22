/**
 * ============================================================================
 * TTS ENGINE & REAL-TIME WORD HIGHLIGHTING ARCHITECTURE
 * ============================================================================
 *
 * Reliability rules that this engine now guarantees:
 *
 * 1. ZERO-JERK SESSION INVALIDATION — a monotonic Session ID discards every
 *    late asynchronous callback from a cancelled utterance.
 * 2. TOKEN FRESHNESS CONTRACT — the preview DOM is only re-tokenized when it
 *    is actually needed. `markTokensStale()` is called *before* the preview is
 *    rewritten; if narration is running it is stopped right there, so the
 *    utterance can never read text that no longer matches the token table.
 * 3. CHUNKED SPEECH — the document is spoken in chunks (one per sentence by
 *    default) instead of one giant utterance, which long documents need.
 * 4. SELF-HEALING PLAYBACK — a watchdog reconciles the engine state with the
 *    Web Speech API, so a browser that silently drops an utterance cannot
 *    leave the UI stuck in a "playing" state.
 * 5. CORRECT SCROLL TARGET — the auto-scroll uses the real scroll container
 *    and viewport-relative math, not `offsetTop` against a wrong offsetParent.
 * 6. O(1) TOKEN LOOKUP — a Map keeps click-to-speak instant even for
 *    documents with tens of thousands of words.
 * ============================================================================
 */

import { getSettings } from './settings-manager.js';

// Module-level persistent state (Immune to Garbage Collection)
let currentUtterance = null;
let keepAliveTimer = null;
let speakDebounceTimer = null;
let currentSessionId = 0;

/** The remaining speech chunks, head first. */
let chunkQueue = [];

// Speech synthesis status
let isPlaying = false;
let isPaused = false;
/** True between the Play press and the moment the engine actually starts. */
let isStarting = false;
let currentWordIndex = -1;
let currentUtteranceOffset = 0;

// Token index and speech text
let tokens = []; // Array of { id, element, text, charStart, charEnd }
let tokenIndexById = new Map();
let fullSpeechText = '';
let tokensAreStale = true;
let documentLocale = 'en-US';

// Active settings
let currentVoice = null;
let currentRate = 1.0;
const currentPitch = 1.0;

// DOM references
let previewContainerRef = null;
let scrollContainerRef = null;

/** Whether the preview follows the word being spoken. */
let autoScrollEnabled = true;

// Event listeners / callbacks
const stateListeners = new Set();

// Playback health tracking
let playingSince = 0;
let restartAttempts = 0;
let lastWordIndexAtRestart = -1;
let keepAlivePing = false;

/* ==========================================================================
 * State notification
 * ========================================================================== */

/**
 * Register state change listener (for UI updates)
 */
export function onTTSStateChange(listener) {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function notifyState(detail = {}) {
  const state = {
    isPlaying,
    isPaused,
    starting: isStarting,
    currentWordIndex,
    totalWords: tokens.length,
    currentVoice,
    rate: currentRate,
    ...detail
  };
  stateListeners.forEach((fn) => {
    try {
      fn(state);
    } catch (e) {
      console.error('TTS State Listener Error:', e);
    }
  });
}

/* ==========================================================================
 * Voices
 * ========================================================================== */

/**
 * Initializes and retrieves available voices, handling the asynchronous
 * `voiceschanged` event to avoid race conditions.
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export function getAvailableVoices() {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve([]);
      return;
    }

    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      resolve(voices);
      return;
    }

    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);

    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(window.speechSynthesis.getVoices() || []);
    }, 1000);
  });
}

/**
 * Sets the active voice for playback.
 * @param {SpeechSynthesisVoice} voice
 */
export function setVoice(voice) {
  currentVoice = voice;
  if (isPlaying && !isPaused && currentWordIndex >= 0) {
    speakFromWord(currentWordIndex);
  } else {
    notifyState();
  }
}

/**
 * Sets playback rate (0.5x to 2.0x)
 * @param {number} rate
 */
export function setRate(rate) {
  currentRate = Math.max(0.5, Math.min(2.0, rate));
  if (isPlaying && !isPaused && currentWordIndex >= 0) {
    speakFromWord(currentWordIndex);
  } else {
    notifyState();
  }
}

/**
 * Inspects content to guess the dominant locale.
 * @param {string} text
 * @returns {string} Locale code
 */
export function detectLanguage(text) {
  if (!text) return 'en-US';
  const thaiMatches = text.match(/[\u0E00-\u0E7F]/g);
  if (thaiMatches && thaiMatches.length > text.length * 0.25) {
    return 'th-TH';
  }
  return 'en-US';
}

/* ==========================================================================
 * Tokenization pipeline
 * ========================================================================== */

/**
 * Registers the element that actually scrolls the preview. The auto-scroll
 * during narration needs it — the preview container itself is not scrollable.
 * @param {HTMLElement|null} el
 */
export function setScrollContainer(el) {
  scrollContainerRef = el || null;
}

/**
 * Registers the element that holds the rendered preview. It is the root the
 * tokenization walks, so it must be known before the first token pass.
 * @param {HTMLElement|null} el
 */
export function setPreviewContainer(el) {
  previewContainerRef = el || null;
}

/**
 * Turns the automatic "follow the narration" scrolling on or off.
 *
 * The preview module suspends this as soon as the reader scrolls by hand, so
 * the app never drags them back to the word being spoken.
 *
 * @param {boolean} enabled
 */
export function setAutoScrollEnabled(enabled) {
  autoScrollEnabled = Boolean(enabled);
}

/**
 * Splits the speech text into chunks.
 *
 * In `block` mode there is a single chunk (the rest of the document); in
 * `sentence` mode the text is split at sentence boundaries and the chunks
 * are spoken one after the other.
 *
 * @param {string} text
 * @param {string} locale
 * @returns {Array<{ text: string, charStart: number, charEnd: number }>}
 */
export function buildChunks(text, locale = 'en-US') {
  if (!text) return [];

  if (getSettings().speechChunk !== 'sentence') {
    return [{ text, charStart: 0, charEnd: text.length }];
  }

  let segmenter;
  try {
    segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  } catch (err) {
    console.warn(
      `Intl.Segmenter (sentence) failed with locale ${locale}, falling back to 'en'`,
      err
    );
    segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  }

  const chunks = [];
  for (const segment of segmenter.segment(text)) {
    const value = segment.segment;
    if (!value.trim()) continue;
    chunks.push({ text: value, charStart: segment.index, charEnd: segment.index + value.length });
  }
  if (chunks.length > 0) return chunks;
  return text.trim() ? [{ text, charStart: 0, charEnd: text.length }] : [];
}

/**
 * Tokenizes the rendered preview into speakable words.
 *
 * This is deliberately NOT called on every keystroke: the preview module marks
 * the tokens stale and asks for them lazily (see `ensureTokens`).
 *
 * @param {HTMLElement} rootContainer
 * @param {string} locale
 */
function tokenizeDOMForTTS(rootContainer, locale = 'en-US') {
  previewContainerRef = rootContainer;
  documentLocale = locale;
  tokens = [];
  tokenIndexById = new Map();
  fullSpeechText = '';
  currentWordIndex = -1;

  if (!rootContainer) {
    tokensAreStale = false;
    notifyState({ totalWords: 0 });
    return { tokens, fullSpeechText };
  }

  unwrapTokenSpans(rootContainer);

  let segmenter;
  try {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  } catch (err) {
    console.warn(`Intl.Segmenter failed with locale ${locale}, falling back to 'en'`, err);
    segmenter = new Intl.Segmenter('en', { granularity: 'word' });
  }

  let wordCounter = 0;

  const isSkipNode = (node) => {
    if (!node || !node.parentElement) return false;
    const parent = node.parentElement;
    const tag = parent.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return true;
    if (parent.closest('.katex') || parent.closest('[data-math="true"]')) {
      return true;
    }
    // The source of a diagram is code, never prose.
    if (parent.closest('.mermaid-source')) {
      return true;
    }
    // The chrome around a code block is not part of the code.
    if (parent.closest('.code-head') || parent.closest('.code-gutter')) {
      return true;
    }
    // The permalink of a heading is a sign, not a word.
    if (parent.closest('.heading-anchor')) {
      return true;
    }
    // A diagram is a picture, not prose — its labels are only read aloud when
    // the reader asked for it.
    if (!getSettings().readDiagramLabels && parent.closest('.mermaid-block')) {
      return true;
    }
    return false;
  };

  // Math formulas are read as one cohesive token
  const mathElements = rootContainer.querySelectorAll('[data-math="true"]');
  mathElements.forEach((mathEl) => {
    const formula = mathEl.getAttribute('data-formula') || 'formula';
    const wordId = wordCounter++;
    mathEl.classList.add('tts-word', 'tts-math-token');
    mathEl.setAttribute('data-word-id', wordId.toString());

    if (fullSpeechText.length > 0 && !fullSpeechText.endsWith(' ')) {
      fullSpeechText += ' ';
    }
    const cleanFormulaText = ` [formula: ${formula}] `;
    const formulaStart = fullSpeechText.length;
    fullSpeechText += cleanFormulaText;
    const charEnd = fullSpeechText.length;

    tokens.push({
      id: wordId,
      element: mathEl,
      text: formula,
      charStart: formulaStart,
      charEnd
    });
    tokenIndexById.set(wordId, tokens.length - 1);
  });

  // Discover all readable text nodes
  const walker = document.createTreeWalker(rootContainer, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (isSkipNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const originalText = textNode.textContent;
    if (!originalText) continue;

    const parentBlock = textNode.parentElement?.closest(
      'h1, h2, h3, h4, h5, h6, p, li, blockquote, tr'
    );
    if (
      parentBlock &&
      fullSpeechText.length > 0 &&
      !fullSpeechText.endsWith('\n') &&
      !fullSpeechText.endsWith(' ')
    ) {
      fullSpeechText += ' ';
    }

    const segments = segmenter.segment(originalText);
    const fragment = document.createDocumentFragment();
    let hasTokens = false;

    for (const seg of segments) {
      const segText = seg.segment;

      if (seg.isWordLike) {
        hasTokens = true;
        const wordId = wordCounter++;
        const span = document.createElement('span');
        span.className = 'tts-word';
        span.setAttribute('data-word-id', wordId.toString());
        span.textContent = segText;
        fragment.appendChild(span);

        const charStart = fullSpeechText.length;
        fullSpeechText += segText;
        const charEnd = fullSpeechText.length;

        tokens.push({
          id: wordId,
          element: span,
          text: segText,
          charStart,
          charEnd
        });
        tokenIndexById.set(wordId, tokens.length - 1);
      } else {
        fragment.appendChild(document.createTextNode(segText));
        fullSpeechText += segText;
      }
    }

    if (hasTokens && textNode.parentNode) {
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }

  tokensAreStale = false;
  notifyState({ totalWords: tokens.length });
  return { tokens, fullSpeechText };
}

/**
 * Removes the previously injected word wrappers so tokenization stays
 * idempotent — without this a second pass would nest spans inside spans.
 * @param {HTMLElement} root
 */
function unwrapTokenSpans(root) {
  const spans = root.querySelectorAll('span.tts-word:not(.tts-math-token)');
  spans.forEach((span) => {
    span.replaceWith(document.createTextNode(span.textContent));
  });
}

/**
 * Re-tokenizes the preview when the token table is outdated.
 * @returns {Array} the current token list
 */
export function ensureTokens() {
  if (tokensAreStale && previewContainerRef) {
    tokenizeDOMForTTS(previewContainerRef, documentLocale);
  }
  return tokens;
}

/**
 * Marks the token table as outdated.
 *
 * MUST be called *before* the preview DOM is replaced. If narration is
 * running it is stopped here, because the running utterance describes the
 * old document and would otherwise keep highlighting words in the new one.
 *
 * @param {string} [reason] machine-readable reason surfaced to the UI
 */
export function markTokensStale(reason = 'content-changed') {
  tokensAreStale = true;
  if (isPlaying || isPaused) {
    stop(reason);
  }
}

/**
 * Marks the token table as outdated *without* touching the playback.
 *
 * Used when the document itself did not change but the preview did — a
 * diagram that finished drawing, for example. The running utterance still
 * describes the old table, so the caller must not use this while reading.
 */
export function refreshTokens() {
  tokensAreStale = true;
}

/* ==========================================================================
 * Word highlighting
 * ========================================================================== */

/**
 * Binary search to find the token matching a speech charIndex.
 */
function findTokenByCharIndex(targetChar) {
  if (tokens.length === 0) return -1;
  let low = 0;
  let high = tokens.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const token = tokens[mid];

    if (targetChar >= token.charStart && targetChar < token.charEnd) {
      return mid;
    }
    if (targetChar < token.charStart) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (low < tokens.length) {
    return low;
  }
  return tokens.length - 1;
}

/**
 * Highlights the active word and gently scrolls it into view.
 */
function setActiveWord(tokenIndex) {
  if (tokenIndex === currentWordIndex) return;

  // Un-highlight previous word
  if (currentWordIndex >= 0 && currentWordIndex < tokens.length) {
    const prevEl = tokens[currentWordIndex].element;
    if (prevEl) {
      prevEl.classList.remove('active-word', 'speaking-target');
    }
  }

  currentWordIndex = tokenIndex;

  if (tokenIndex >= 0 && tokenIndex < tokens.length) {
    const activeToken = tokens[tokenIndex];
    const el = activeToken.element;
    if (el) {
      el.classList.add('active-word');
      scrollWordIntoView(el);
    }
  }

  notifyState({ currentWordIndex });
}

/**
 * Scrolls the highlighted word into the comfortable reading band of the
 * preview scroller — using viewport-relative math against the real scroller.
 * @param {HTMLElement} el
 */
function scrollWordIntoView(el) {
  if (!autoScrollEnabled) return;

  const scroller = scrollContainerRef;
  if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return;

  const scrollerRect = scroller.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (!elRect.height) return;

  const margin = 72;
  const above = elRect.top < scrollerRect.top + margin;
  const below = elRect.bottom > scrollerRect.bottom - margin;
  if (!above && !below) return;

  const delta = elRect.top - scrollerRect.top - scroller.clientHeight / 2 + elRect.height / 2;
  const target = Math.max(0, scroller.scrollTop + delta);
  scroller.scrollTo({ top: target, behavior: 'smooth' });
}

/* ==========================================================================
 * Playback
 * ==========================================================================
 * The document is spoken in "chunks". In `block` mode there is a single
 * chunk (the rest of the document); in `sentence` mode the text is split at
 * sentence boundaries and the chunks are spoken one after the other.
 *
 * Chunking matters: a single utterance for a 400 kB document exceeds what
 * speech engines accept, and long utterances are read back stuttering or
 * truncated. Each chunk keeps its own character offset, so the word
 * highlight still lines up exactly.
 * ========================================================================== */

/**
 * Prepares the chunk queue so that reading starts at a character offset.
 * @param {number} startChar
 */
function prepareChunks(startChar) {
  const all = buildChunks(fullSpeechText, documentLocale);
  if (all.length === 0) {
    chunkQueue = [];
    return;
  }

  let index = all.findIndex((chunk) => startChar >= chunk.charStart && startChar < chunk.charEnd);
  if (index === -1) index = all.findIndex((chunk) => chunk.charStart > startChar);
  if (index === -1) index = 0;

  const first = all[index];
  // The first chunk starts mid-way, exactly at the requested word.
  const head = {
    charStart: startChar,
    charEnd: first.charEnd,
    text: fullSpeechText.slice(startChar, first.charEnd)
  };

  chunkQueue = [head, ...all.slice(index + 1)];
}

/**
 * Speaks the chunk at the head of the queue.
 * @param {number} sessionId
 */
function speakCurrentChunk(sessionId) {
  const chunk = chunkQueue[0];
  if (!chunk) {
    finishPlayback();
    return;
  }

  currentUtteranceOffset = chunk.charStart;

  const utterance = new SpeechSynthesisUtterance(chunk.text);
  currentUtterance = utterance;
  window.__currentTTSUtterance = utterance;

  if (currentVoice) utterance.voice = currentVoice;
  utterance.rate = currentRate;
  utterance.pitch = currentPitch;

  utterance.onboundary = (event) => {
    if (sessionId !== currentSessionId) return;
    const globalChar = currentUtteranceOffset + event.charIndex;
    const matchedTokenIndex = findTokenByCharIndex(globalChar);
    if (matchedTokenIndex >= 0) setActiveWord(matchedTokenIndex);
  };

  utterance.onstart = () => {
    if (sessionId !== currentSessionId) return;
    isPlaying = true;
    isPaused = false;
    isStarting = false;
    playingSince = Date.now();
    const active = tokens[currentWordIndex];
    if (active?.element) active.element.classList.remove('speaking-target');
    notifyState({ isPlaying: true, isPaused: false, starting: false });
    startKeepAlive();
    clearStartWatchdog();
  };

  utterance.onpause = () => {
    if (sessionId !== currentSessionId) return;
    // The keep-alive heartbeat deliberately pauses/resumes the utterance —
    // that must not surface as a user-visible pause.
    if (keepAlivePing) return;
    isPaused = true;
    notifyState({ isPlaying: true, isPaused: true });
  };

  utterance.onresume = () => {
    if (sessionId !== currentSessionId) return;
    if (keepAlivePing) return;
    isPaused = false;
    notifyState({ isPlaying: true, isPaused: false });
  };

  utterance.onend = () => {
    if (sessionId !== currentSessionId) return;
    cleanupUtterance();
    if (chunkQueue.length > 1) {
      chunkQueue.shift();
      speakCurrentChunk(sessionId);
      return;
    }
    finishPlayback();
  };

  utterance.onerror = (event) => {
    if (sessionId !== currentSessionId) return;
    if (event.error !== 'canceled' && event.error !== 'interrupted') {
      console.warn('SpeechSynthesisUtterance error:', event.error);
    }
    cleanupUtterance();
    finishPlayback();
    notifyState({ isPlaying: false, isPaused: false, currentWordIndex: -1, reason: 'error' });
  };

  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
  window.speechSynthesis.speak(utterance);
}

/**
 * Ends the narration cleanly.
 */
function finishPlayback() {
  cleanupUtterance();
  chunkQueue = [];
  setActiveWord(-1);
  isPlaying = false;
  isPaused = false;
  isStarting = false;
  restartAttempts = 0;
  clearStartWatchdog();
  notifyState({ isPlaying: false, isPaused: false, starting: false, currentWordIndex: -1 });
}

/**
 * Starts reading from a specific word index.
 * @param {number} wordIndex
 */
function speakFromWord(wordIndex = 0) {
  if (!('speechSynthesis' in window)) {
    console.error('Web Speech API is not supported in this browser.');
    return;
  }

  ensureTokens();
  if (tokens.length === 0) return;

  const targetIndex = Math.max(0, Math.min(tokens.length - 1, wordIndex));
  const targetToken = tokens[targetIndex];

  // ZERO-JERK SESSION INVALIDATION
  currentSessionId++;
  const thisSession = currentSessionId;

  cleanupUtterance();

  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }

  if (speakDebounceTimer) {
    clearTimeout(speakDebounceTimer);
    speakDebounceTimer = null;
  }

  setActiveWord(targetIndex);
  if (targetToken.element) {
    targetToken.element.classList.add('speaking-target');
  }

  prepareChunks(targetToken.charStart);

  const head = chunkQueue[0];
  if (!head || !head.text.trim()) {
    if (targetToken.element) {
      targetToken.element.classList.remove('speaking-target');
    }
    return;
  }

  const launchSpeech = () => {
    // A later click during the ~40ms buffer drain discards this launch.
    if (thisSession !== currentSessionId) return;
    speakCurrentChunk(thisSession);
    startStartWatchdog(thisSession);
  };

  // Brief 40ms audio queue drain prevents initial syllable swallowing
  speakDebounceTimer = setTimeout(launchSpeech, 40);
}

/**
 * Play or Resume audio reading.
 */
export function play() {
  if (!('speechSynthesis' in window)) return;

  // Tell the UI *before* the heavy work starts. Tokenizing a large document
  // can take a moment, and without feedback the button looks unresponsive.
  if (!isPlaying && !isPaused) {
    isStarting = true;
    notifyState({ starting: true });
  }

  ensureTokens();

  if (isPaused) {
    const api = window.speechSynthesis;
    // The paused utterance may have been dropped by the browser — only trust
    // the API when it really is still holding the speech.
    if (api.paused) {
      api.resume();
      isPaused = false;
      isPlaying = true;
      isStarting = false;
      playingSince = Date.now();
      notifyState({ isPlaying: true, isPaused: false, starting: false });
      return;
    }
    // Otherwise fall through and re-speak from the current word.
    isPaused = false;
  }

  if (isPlaying) {
    isStarting = false;
    notifyState({ starting: false });
    return;
  }

  const startIndex = currentWordIndex >= 0 ? currentWordIndex : 0;
  restartAttempts = 0;
  lastWordIndexAtRestart = startIndex;
  speakFromWord(startIndex);
}

/**
 * Pause audio reading.
 */
export function pause() {
  if (!('speechSynthesis' in window)) return;
  if (isPlaying && !isPaused) {
    window.speechSynthesis.pause();
    isPaused = true;
    notifyState({ isPlaying: true, isPaused: true });
  }
}

/**
 * Stop audio reading and reset the active word.
 * @param {string} [reason] optional machine-readable reason, surfaced to the UI
 */
export function stop(reason = 'user') {
  if (!('speechSynthesis' in window)) return;
  currentSessionId++;
  if (speakDebounceTimer) {
    clearTimeout(speakDebounceTimer);
    speakDebounceTimer = null;
  }
  chunkQueue = [];
  cleanupUtterance();
  clearStartWatchdog();
  window.speechSynthesis.cancel();
  setActiveWord(-1);
  isPlaying = false;
  isPaused = false;
  isStarting = false;
  restartAttempts = 0;
  notifyState({
    isPlaying: false,
    isPaused: false,
    starting: false,
    currentWordIndex: -1,
    reason
  });
}

/**
 * @returns {boolean} whether narration is currently running
 */
export function isSpeaking() {
  return isPlaying;
}

/**
 * @returns {boolean} whether the engine is warming up (the moment between
 *   the press and the moment the speech actually begins)
 */
export function isNarrationStarting() {
  return isStarting;
}

/**
 * @returns {boolean} whether narration is running but suspended
 */
export function isSpeechPaused() {
  return isPaused;
}

function cleanupUtterance() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (currentUtterance) {
    currentUtterance.onboundary = null;
    currentUtterance.onstart = null;
    currentUtterance.onpause = null;
    currentUtterance.onresume = null;
    currentUtterance.onend = null;
    currentUtterance.onerror = null;
    currentUtterance = null;
  }
  window.__currentTTSUtterance = null;
}

function startKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(() => {
    if (isPlaying && !isPaused && window.speechSynthesis.speaking) {
      keepAlivePing = true;
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
      keepAlivePing = false;
    }
  }, 10000);
}

/* ==========================================================================
 * Start watchdog — the speech engine sometimes never starts
 * ========================================================================== */

/**
 * If the engine does not report `onstart` shortly after the request, the
 * user is left staring at a button that looks stuck. Say so instead.
 */
let startWatchdogTimer = null;

function startStartWatchdog(sessionId) {
  clearStartWatchdog();
  startWatchdogTimer = setTimeout(() => {
    startWatchdogTimer = null;
    if (sessionId !== currentSessionId) return;
    if (isPlaying || isPaused) return;

    isStarting = false;
    notifyState({
      isPlaying: false,
      isPaused: false,
      starting: false,
      reason: 'no-start'
    });
  }, 4000);
}

function clearStartWatchdog() {
  if (startWatchdogTimer === null) return;
  clearTimeout(startWatchdogTimer);
  startWatchdogTimer = null;
}

/* ==========================================================================
 * Watchdog — keeps the engine and the UI in sync with reality
 * ========================================================================== */

/**
 * Reconciles the engine state with the Web Speech API.
 *
 * Browsers drop utterances without firing `onend` (background tab throttling,
 * a speech engine reset, an OS audio route change). Without this the UI would
 * keep claiming it is reading while nothing is audible.
 */
function reconcileWithSpeechApi() {
  if (!('speechSynthesis' in window)) return;
  const api = window.speechSynthesis;

  if (isPaused) {
    if (!api.paused && !api.speaking && !api.pending) {
      // The paused utterance vanished — try to continue from the same word.
      isPaused = false;
      if (currentWordIndex >= 0) {
        speakFromWord(currentWordIndex);
      } else {
        notifyState({
          isPlaying: false,
          isPaused: false,
          currentWordIndex: -1,
          reason: 'speech-lost'
        });
      }
    }
    return;
  }

  if (!isPlaying) return;

  // Grace period right after start: the API may not report `speaking` yet.
  if (Date.now() - playingSince < 1500) return;

  if (!api.speaking && !api.pending) {
    if (currentWordIndex === lastWordIndexAtRestart) {
      restartAttempts += 1;
    } else {
      restartAttempts = 0;
      lastWordIndexAtRestart = currentWordIndex;
    }

    if (restartAttempts > 3) {
      stop('speech-lost');
      return;
    }

    speakFromWord(Math.max(0, currentWordIndex));
  }
}

let watchdogTimer = null;

/**
 * Starts the background watchdog (state reconciliation + tab visibility).
 */
export function initPlaybackWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(reconcileWithSpeechApi, 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      reconcileWithSpeechApi();
    }
  });
}

/* ==========================================================================
 * Click-to-Speak
 * ========================================================================== */

/**
 * Starts reading at the first word inside an element.
 *
 * Used by the outline: jumping to a heading and reading from there.
 *
 * @param {HTMLElement} element
 * @returns {boolean} whether a word was found
 */
export function speakFromElement(element) {
  if (!element) return false;

  ensureTokens();

  const word = element.matches?.('.tts-word') ? element : element.querySelector?.('.tts-word');
  if (!word) return false;

  const id = Number.parseInt(word.getAttribute('data-word-id'), 10);
  const index = tokenIndexById.get(id);
  if (index === undefined) return false;

  restartAttempts = 0;
  lastWordIndexAtRestart = index;
  speakFromWord(index);
  return true;
}

/**
 * Smart Click-to-Speak Handler.
 * @param {MouseEvent} event
 */
export function handlePreviewClick(event) {
  ensureTokens();

  const target = event.target;
  let wordEl = target.closest?.('.tts-word');

  if (!wordEl && target?.closest) {
    const parentBlock = target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, tr');
    if (parentBlock) {
      wordEl = parentBlock.querySelector('.tts-word');
    }
  }

  if (!wordEl) return;

  const wordIdAttr = wordEl.getAttribute('data-word-id');
  if (wordIdAttr === null) return;

  const wordId = Number.parseInt(wordIdAttr, 10);
  const tokenIdx = tokenIndexById.get(wordId);
  if (tokenIdx !== undefined) {
    restartAttempts = 0;
    lastWordIndexAtRestart = tokenIdx;
    speakFromWord(tokenIdx);
  }
}
