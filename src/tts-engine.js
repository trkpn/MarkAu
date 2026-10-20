/**
 * ============================================================================
 * TTS ENGINE & REAL-TIME WORD HIGHLIGHTING ARCHITECTURE (ENHANCED)
 * ============================================================================
 *
 * Core Enhancements:
 * 1. Zero-Jerk Session Invalidation: Eliminates all boundary-snapping friction
 *    when clicking different words during active playback by using a monotonic
 *    Session ID and explicitly detaching event listeners from previous utterances.
 * 2. Elegant, Non-Disruptive Word Highlighting: Seamless inline highlight without
 *    layout-shifting transforms or line-height jerks.
 * 3. Exact Utterance Alignment: Preserves 1:1 character index synchronization.
 * 4. Smooth, Jitter-free Viewport Centering: Only gently scrolls when outside margins.
 * 5. 100% English Version Architecture with English defaults and voice prioritizing.
 * 6. Chromium GC protection & Keep-Alive pulse.
 * ============================================================================
 */

// Module-level persistent state (Immune to Garbage Collection)
let currentUtterance = null;
let keepAliveTimer = null;
let speakDebounceTimer = null;
let currentSessionId = 0;

// Speech synthesis status
let isPlaying = false;
let isPaused = false;
let currentWordIndex = -1;
let currentUtteranceOffset = 0;

// Token index and speech text
let tokens = []; // Array of { id, element, text, charStart, charEnd }
let fullSpeechText = '';

// Active settings - English Default
let currentVoice = null;
let currentRate = 1.0;
let currentPitch = 1.0;
let currentLocale = 'en-US';

// DOM container reference
let previewContainerRef = null;

// Event listeners / callbacks
const stateListeners = new Set();

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
 * If currently reading aloud, immediately switches to the new voice
 * and continues from the active word position.
 * @param {SpeechSynthesisVoice} voice
 */
export function setVoice(voice) {
  currentVoice = voice;
  if (voice && voice.lang) {
    currentLocale = voice.lang;
  }
  // Live switch: If actively playing, immediately restart with the new voice from the current word!
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
 * Sets playback pitch (0.5 to 1.5)
 * @param {number} pitch
 */
export function setPitch(pitch) {
  currentPitch = Math.max(0.5, Math.min(1.5, pitch));
  notifyState();
}

/**
 * Inspects content to guess the dominant locale, defaulting to 'en-US'
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

/**
 * ============================================================================
 * WORD TOKENIZATION PIPELINE (Intl.Segmenter + DOM TreeWalker)
 * ============================================================================
 */
export function tokenizeDOMForTTS(rootContainer, locale = 'en-US') {
  previewContainerRef = rootContainer;
  tokens = [];
  fullSpeechText = '';
  currentWordIndex = -1;

  if (!rootContainer) {
    return { tokens, fullSpeechText };
  }

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
    return false;
  };

  // Process math formulas as cohesive speakable tokens
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
  });

  // Discover all readable Text Nodes
  const walker = document.createTreeWalker(
    rootContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (isSkipNode(node)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent.trim()) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const originalText = textNode.textContent;
    if (!originalText) continue;

    const parentBlock = textNode.parentElement?.closest('h1, h2, h3, h4, h5, h6, p, li, blockquote, tr');
    if (parentBlock && fullSpeechText.length > 0 && !fullSpeechText.endsWith('\n') && !fullSpeechText.endsWith(' ')) {
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
      } else {
        fragment.appendChild(document.createTextNode(segText));
        fullSpeechText += segText;
      }
    }

    if (hasTokens && textNode.parentNode) {
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }

  notifyState({ totalWords: tokens.length });
  return { tokens, fullSpeechText };
}

/**
 * Binary search to find token matching speech charIndex
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
 * Highlights the active word span in the DOM with jitter-free auto-scrolling
 */
export function setActiveWord(tokenIndex) {
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

      // Fluid Jitter-free Auto-scroll: Only scroll when outside comfortable viewport band
      if (previewContainerRef) {
        const container = previewContainerRef;
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();

        const topThreshold = containerRect.top + 75;
        const bottomThreshold = containerRect.bottom - 75;

        if (elRect.top < topThreshold || elRect.bottom > bottomThreshold) {
          const relativeOffset = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
          container.scrollTo({
            top: Math.max(0, relativeOffset),
            behavior: 'smooth'
          });
        }
      }
    }
  }

  notifyState({ currentWordIndex });
}

/**
 * Starts reading from a specific word index with zero-jerk session invalidation
 * and Chromium audio buffer flush protection.
 *
 * @param {number} wordIndex
 */
export function speakFromWord(wordIndex = 0) {
  if (!('speechSynthesis' in window)) {
    console.error('Web Speech API is not supported in this browser.');
    return;
  }

  if (tokens.length === 0) return;
  const targetIndex = Math.max(0, Math.min(tokens.length - 1, wordIndex));
  const targetToken = tokens[targetIndex];

  // ==========================================================================
  // ZERO-JERK SESSION INVALIDATION:
  // Increment session counter so any late asynchronous events from previously
  // cancelled utterances are permanently discarded!
  // ==========================================================================
  currentSessionId++;
  const thisSession = currentSessionId;

  // Explicitly detach event listeners from the previous utterance immediately!
  cleanupUtterance();

  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }

  if (speakDebounceTimer) {
    clearTimeout(speakDebounceTimer);
    speakDebounceTimer = null;
  }

  // Set the active word to the target word once, cleanly without snap-back
  setActiveWord(targetIndex);
  if (targetToken.element) {
    targetToken.element.classList.add('speaking-target');
  }

  currentUtteranceOffset = targetToken.charStart;
  const speechText = fullSpeechText.slice(currentUtteranceOffset);

  if (!speechText.trim()) {
    return;
  }

  const launchSpeech = () => {
    // If a subsequent click occurred during the ~40ms buffer drain, discard this launch!
    if (thisSession !== currentSessionId) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(speechText);
    currentUtterance = utterance;
    window.__currentTTSUtterance = utterance;

    if (currentVoice) {
      utterance.voice = currentVoice;
    }
    utterance.rate = currentRate;
    utterance.pitch = currentPitch;

    utterance.onboundary = (event) => {
      // Guard against stale events
      if (thisSession !== currentSessionId) return;

      const charIndexInSlice = event.charIndex;
      const globalChar = currentUtteranceOffset + charIndexInSlice;
      const matchedTokenIndex = findTokenByCharIndex(globalChar);
      if (matchedTokenIndex >= 0) {
        setActiveWord(matchedTokenIndex);
      }
    };

    utterance.onstart = () => {
      if (thisSession !== currentSessionId) return;
      isPlaying = true;
      isPaused = false;
      if (targetToken.element) {
        targetToken.element.classList.remove('speaking-target');
      }
      notifyState({ isPlaying: true, isPaused: false });
      startKeepAlive();
    };

    utterance.onpause = () => {
      if (thisSession !== currentSessionId) return;
      isPaused = true;
      notifyState({ isPlaying: true, isPaused: true });
    };

    utterance.onresume = () => {
      if (thisSession !== currentSessionId) return;
      isPaused = false;
      notifyState({ isPlaying: true, isPaused: false });
    };

    utterance.onend = () => {
      if (thisSession !== currentSessionId) return;
      cleanupUtterance();
      setActiveWord(-1);
      notifyState({ isPlaying: false, isPaused: false, currentWordIndex: -1 });
    };

    utterance.onerror = (event) => {
      if (thisSession !== currentSessionId) return;
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        console.warn('SpeechSynthesisUtterance error:', event.error);
      }
      cleanupUtterance();
      setActiveWord(-1);
      notifyState({ isPlaying: false, isPaused: false, currentWordIndex: -1 });
    };

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
  };

  // Brief 40ms audio queue drain prevents initial syllable swallowing
  speakDebounceTimer = setTimeout(launchSpeech, 40);
}

/**
 * Play or Resume audio reading
 */
export function play() {
  if (!('speechSynthesis' in window)) return;

  if (isPaused) {
    window.speechSynthesis.resume();
    isPaused = false;
    isPlaying = true;
    notifyState({ isPlaying: true, isPaused: false });
    return;
  }

  if (isPlaying) {
    return;
  }

  const startIndex = currentWordIndex >= 0 ? currentWordIndex : 0;
  speakFromWord(startIndex);
}

/**
 * Pause audio reading
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
 * Stop audio reading and reset active word
 */
export function stop() {
  if (!('speechSynthesis' in window)) return;
  currentSessionId++;
  if (speakDebounceTimer) {
    clearTimeout(speakDebounceTimer);
    speakDebounceTimer = null;
  }
  cleanupUtterance();
  window.speechSynthesis.cancel();
  setActiveWord(-1);
  isPlaying = false;
  isPaused = false;
  notifyState({ isPlaying: false, isPaused: false, currentWordIndex: -1 });
}

function cleanupUtterance() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (currentUtterance) {
    // Explicitly unbind all listeners so garbage collection / OS thread cannot trigger callbacks
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
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 10000);
}

/**
 * Smart Click-to-Speak Handler
 */
export function handlePreviewClick(event) {
  const target = event.target;
  let wordEl = target.closest('.tts-word');

  if (!wordEl && target && target.closest) {
    const parentBlock = target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, tr');
    if (parentBlock) {
      wordEl = parentBlock.querySelector('.tts-word');
    }
  }

  if (wordEl) {
    const wordIdAttr = wordEl.getAttribute('data-word-id');
    if (wordIdAttr !== null) {
      const wordId = parseInt(wordIdAttr, 10);
      const tokenIdx = tokens.findIndex((t) => t.id === wordId);
      if (tokenIdx >= 0) {
        speakFromWord(tokenIdx);
      }
    }
  }
}
