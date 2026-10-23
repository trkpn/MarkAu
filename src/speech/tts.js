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
 * 7. RIGHT LANGUAGE — the narration speaks in the language of the document
 *    (`th-TH` for Thai), so the engine picks a matching voice and splits the
 *    text at its own sentence and word boundaries. Without it a Thai document
 *    was segmented as English: one enormous chunk that the browser drops
 *    after ~15 seconds, which is what a reading that "stutters and then
 *    stops" sounds like.
 * 8. NO SILENT DEATH — a chunk that the browser drops is retried, not
 *    abandoned: the whole reading only ends when the queue is empty.
 * ============================================================================
 */

import { getSettings } from '@/core/settings.js';
import { announceNarrationStart, onOtherTabNarrationStart } from '@/core/multi-tab.js';
import { TTS_START_WINDOW_CHARS, TTS_WINDOW_CHARS } from '@/core/schedule.js';

// Module-level persistent state (Immune to Garbage Collection)
let speakDebounceTimer = null;
let currentSessionId = 0;

/** The remaining speech chunks, head first. */
let chunkQueue = [];
/** Index of the next chunk to hand to the engine. */
let chunkCursor = 0;
/** Index of the first chunk that has not finished yet. */
let chunkDone = 0;
/** The delayed restart after a chunk failed. */
let chunkTimer = null;
/** The next hand-over to the engine, outside its own event handlers. */
let pumpTimer = null;
/** Every utterance handed to the engine that has not finished yet. */
const liveUtterances = new Set();
/** How many times the current chunk has failed to start. */
let chunkRetries = 0;

// Speech synthesis status
let isPlaying = false;
let isPaused = false;
/** True between the Play press and the moment the engine actually starts. */
let isStarting = false;
let currentWordIndex = -1;

// Token index and speech text
let tokens = []; // Array of { id, element, text, charStart, charEnd }
let tokenIndexById = new Map();
let fullSpeechText = '';
let tokensAreStale = true;
let documentLocale = 'en-US';

// Windowed tokenization
/** Top-level preview blocks that can be spoken, in document order. */
let speechBlocks = [];
/** The blocks whose words are currently in the token table. */
let tokenizedBlocks = new Set();
/** The first and last block covered by the current token window. */
let windowStartBlock = 0;
let windowEndBlock = -1;
/** Whether blocks remain outside the current window. */
let hasMoreSpeech = false;
/** Whether the current token table covers the whole document. */
let tokensCoverDocument = false;
/** A cheap approximation of the whole document's word count. */
let estimatedTotalWords = 0;
/** The DOM walk behind the estimate, made once per document change. */
let cachedWordEstimate = 0;
/** The estimate supplied by the preview, from the Markdown source. */
let documentWordEstimate = 0;

// Active settings
let currentVoice = null;
let currentRate = 1.0;
const currentPitch = 1.0;

// DOM references
let previewContainerRef = null;
let scrollContainerRef = null;

/** Whether the preview follows the word being spoken. */
let autoScrollEnabled = true;
/** When the narrator last moved the preview by itself. */
let lastAutoScrollAt = 0;

// Event listeners / callbacks
const stateListeners = new Set();

// Playback health tracking
/** When the engine last showed a sign of life (start or word boundary). */
let lastProgressAt = 0;
/** When the engine last fired an event of its own (start, boundary or end). */
let lastEventAt = 0;
let restartAttempts = 0;

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
  const token = tokens[currentWordIndex];
  const withinWindow =
    fullSpeechText.length > 0 && token ? token.charEnd / fullSpeechText.length : 0;
  const progress =
    windowEndBlock >= 0 && speechBlocks.length > 0
      ? Math.min(
          1,
          (windowStartBlock + withinWindow * Math.max(1, windowEndBlock - windowStartBlock)) /
            speechBlocks.length
        )
      : tokens.length > 0
        ? Math.max(0, currentWordIndex) / tokens.length
        : 0;

  const state = {
    isPlaying,
    isPaused,
    starting: isStarting,
    currentWordIndex,
    totalWords: estimatedTotalWords || tokens.length,
    totalWordsEstimated: estimatedTotalWords > 0,
    progress,
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
 * Tells the engine which language the document is written in.
 *
 * The voice, the sentence boundaries and the word boundaries all follow it,
 * so a Thai document is not spoken as if it were English.
 *
 * @param {string} locale
 */
export function setDocumentLocale(locale) {
  if (!locale || locale === documentLocale) return;
  documentLocale = locale;
  tokensAreStale = true;
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
  cachedWordEstimate = 0;
  documentWordEstimate = 0;
}

/**
 * Gives the narrator a word-count estimate without walking the preview.
 *
 * The preview knows the length of the Markdown it rendered; reading every
 * word of a book-sized DOM on the first Play would block the page.
 *
 * @param {number} words
 */
export function setSpeechWordEstimate(words) {
  const value = Number(words);
  documentWordEstimate = Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
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
 * How much text one request to the speech engine should carry.
 *
 * One sentence per request sounds natural on paper but not in the ear: the
 * engine finishes a sentence, the next request has to be synthesised, and
 * the reading stumbles to a halt between every one of them — especially
 * with a voice that is fetched over the network. Grouping the sentences of a
 * paragraph into one request keeps the voice going, while a ceiling keeps
 * every request under the ~15 seconds at which Chromium cuts an utterance
 * off. The ceiling follows the playback rate: at half speed a request may
 * only carry half the text.
 *
 * A Latin letter is a fraction of a syllable, a Thai letter is most of one
 * and a Han character is a whole word, so the character budget depends on
 * the writing system; the Latin figure alone makes a Thai or Chinese
 * request take far longer than intended.
 */
const SPEECH_CHARS_PER_SECOND = 14;
const SPEECH_CHUNK_SECONDS = 10;

/** How many characters one second of narration carries, by language. */
const CHARS_PER_SECOND_BY_LANGUAGE = {
  th: 11,
  lo: 11,
  km: 11,
  my: 11,
  ja: 6,
  zh: 6,
  ko: 7
};

/** Where a group of sentences is closed: near the ceiling, to cut rarely. */
const CHUNK_TARGET_RATIO = 0.85;

/**
 * Cuts a character range into requests no longer than the ceiling.
 *
 * The cuts fall on a space when there is one nearby, so a request rarely
 * begins in the middle of a word; the ranges are taken from the source, so
 * the highlighting offsets stay exact.
 *
 * @param {string} text
 * @param {Array<{ charStart: number, charEnd: number }>} groups
 * @param {number} ceiling
 * @param {number} target
 * @returns {Array<{ text: string, charStart: number, charEnd: number }>}
 */
function splitToCeiling(text, groups, ceiling, target) {
  const chunks = [];

  for (const group of groups) {
    let cursor = group.charStart;
    while (group.charEnd - cursor > ceiling) {
      const limit = cursor + ceiling;
      const space = text.lastIndexOf(' ', limit);
      const cut = space > cursor + target / 2 ? space + 1 : limit;
      chunks.push({ charStart: cursor, charEnd: cut, text: text.slice(cursor, cut) });
      cursor = cut;
    }
    if (group.charEnd > cursor) {
      chunks.push({
        charStart: cursor,
        charEnd: group.charEnd,
        text: text.slice(cursor, group.charEnd)
      });
    }
  }

  return chunks;
}

/** How many characters one second of narration carries in a language. */
function charsPerSecond(locale) {
  const language = String(locale || '')
    .slice(0, 2)
    .toLowerCase();
  return CHARS_PER_SECOND_BY_LANGUAGE[language] || SPEECH_CHARS_PER_SECOND;
}

/**
 * Splits the speech text into chunks.
 *
 * In `sentence` mode the text is cut at sentence boundaries and the
 * sentences are grouped into requests that keep the narration continuous.
 * In `block` mode the cuts fall wherever the ceiling lands, but there is
 * still a ceiling: a single request for a whole document is cut off by
 * Chromium after about fifteen seconds.
 *
 * @param {string} text
 * @param {string} locale
 * @param {number} [rate] playback rate, from 0.5 to 2
 * @returns {Array<{ text: string, charStart: number, charEnd: number }>}
 */
export function buildChunks(text, locale = 'en-US', rate = currentRate) {
  if (!text) return [];

  const ceiling = Math.max(40, Math.round(charsPerSecond(locale) * SPEECH_CHUNK_SECONDS * rate));
  const target = Math.round(ceiling * CHUNK_TARGET_RATIO);

  if (getSettings().speechChunk !== 'sentence') {
    const chunks = splitToCeiling(text, [{ charStart: 0, charEnd: text.length }], ceiling, target);
    return chunks.length > 0 ? chunks : [{ text, charStart: 0, charEnd: text.length }];
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

  // Sentences are gathered into groups; the character ranges are taken from
  // the source text, so the highlighting offsets stay exact.
  const groups = [];
  let start = -1;
  let end = -1;

  const close = () => {
    if (start === -1) return;
    groups.push({ charStart: start, charEnd: end, text: text.slice(start, end) });
    start = -1;
    end = -1;
  };

  for (const segment of segmenter.segment(text)) {
    const value = segment.segment;
    const segStart = segment.index;
    const segEnd = segStart + value.length;

    if (!value.trim()) {
      if (start !== -1) end = segEnd;
      continue;
    }

    if (start === -1) {
      start = segStart;
    }
    end = segEnd;

    if (end - start >= target) close();
  }
  close();

  const chunks = splitToCeiling(text, groups, ceiling, target);

  if (chunks.length > 0) return chunks;
  return text.trim() ? [{ text, charStart: 0, charEnd: text.length }] : [];
}

/**
 * A time that stands on its own, the way the transcript of a video writes
 * it: `0:43` or `1:02:03`, with or without brackets.
 */
const TIME_ALONE = /^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*$/;

/**
 * Tokenizes rendered preview text into speakable words.
 *
 * A full pass is used by the explicit `ensureTokens()` API and by the tests.
 * The narrator itself passes a small list of top-level blocks so a book is
 * never walked from beginning to end before the first sentence.
 *
 * @param {HTMLElement} rootContainer
 * @param {string} locale
 * @param {object} [options]
 * @param {HTMLElement[]|null} [options.blocks]
 * @param {boolean} [options.append]
 * @param {number} [options.totalWords]
 */
function tokenizeDOMForTTS(
  rootContainer,
  locale = 'en-US',
  { blocks = null, append = false, totalWords = 0 } = {}
) {
  previewContainerRef = rootContainer;
  documentLocale = locale;

  const previousTokenized = tokenizedBlocks;

  if (!append) {
    tokens = [];
    tokenIndexById = new Map();
    fullSpeechText = '';
    currentWordIndex = -1;
    tokenizedBlocks = new Set();
    estimatedTotalWords = 0;
  }

  if (!rootContainer) {
    tokensAreStale = false;
    notifyState({ totalWords: 0 });
    return { tokens, fullSpeechText };
  }

  let segmenter;
  try {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  } catch (err) {
    console.warn(`Intl.Segmenter failed with locale ${locale}, falling back to 'en'`, err);
    segmenter = new Intl.Segmenter('en', { granularity: 'word' });
  }

  let wordCounter = append ? tokens.length : 0;
  const targets = blocks && blocks.length > 0 ? blocks : [rootContainer];

  if (!append) {
    if (!blocks) {
      // A full pass owns the whole container and may be replacing an older
      // full pass.
      unwrapTokenSpans(rootContainer);
    } else if (previousTokenized.size > 0) {
      previousTokenized.forEach((node) => {
        if (node?.isConnected) unwrapTokenSpans(node);
      });
    }
    // With no previous window there are no wrappers to remove; querying the
    // whole preview here only made the first Play slower.
  } else {
    targets.forEach((target) => unwrapTokenSpans(target));
  }

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
    // The time of a transcript says where the video is, and it is seen
    // rather than heard: a reader does not want the time of every line
    // called out to them.
    const bold = parent.closest('strong, b');
    if (bold && TIME_ALONE.test(bold.textContent || '')) {
      return true;
    }
    // A diagram is a picture, not prose — its labels are only read aloud when
    // the reader asked for it.
    if (!getSettings().readDiagramLabels && parent.closest('.mermaid-block')) {
      return true;
    }
    return false;
  };

  // A formula is read as one cohesive token, at the place where it sits in
  // the document. Reading every formula before the prose would make the
  // narration begin with a formula from somewhere in the middle of the page,
  // and the highlight (and its follow-scroll) would jump there first.
  const addMathToken = (mathEl) => {
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
  };

  for (const target of targets) {
    if (!target || !target.isConnected) continue;
    tokenizedBlocks.add(target);

    const walker = document.createTreeWalker(
      target,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.('[data-math="true"]')) return NodeFilter.FILTER_ACCEPT;
            // Skip whole subtrees whose words are never read, but keep
            // descending into the rest.
            if (
              node.matches?.(
                'script, style, .mermaid-source, .code-head, .code-gutter, .heading-anchor'
              )
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
          if (isSkipNode(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const readableNodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      readableNodes.push(currentNode);
      currentNode = walker.nextNode();
    }

    for (const node of readableNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        addMathToken(node);
        continue;
      }

      const textNode = node;
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
          const span = createWordElement(textNode);
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
  }

  if (!append) {
    estimatedTotalWords = blocks ? Math.max(totalWords, tokens.length) : 0;

    if (!blocks) {
      // A full pass covers every block: the start window can use it as it is.
      tokensCoverDocument = true;
      windowStartBlock = 0;
      windowEndBlock = -1;
      hasMoreSpeech = false;
    } else {
      tokensCoverDocument = false;
    }
  } else if (totalWords > 0) {
    estimatedTotalWords = Math.max(estimatedTotalWords, totalWords);
  }

  tokensAreStale = false;
  notifyState({ totalWords: estimatedTotalWords || tokens.length });
  return { tokens, fullSpeechText };
}

/**
 * Creates the wrapper for one spoken word.
 *
 * Text inside a diagram is SVG; an HTML span would not render there, so the
 * wrapper follows the namespace of the text it replaces.
 *
 * @param {Node} textNode
 * @returns {Element}
 */
function createWordElement(textNode) {
  const inSvg = textNode.parentElement?.namespaceURI === 'http://www.w3.org/2000/svg';
  const word = inSvg
    ? document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
    : document.createElement('span');
  word.setAttribute('class', 'tts-word');
  return word;
}

/**
 * Removes the previously injected word wrappers so tokenization stays
 * idempotent — without this a second pass would nest spans inside spans.
 * @param {HTMLElement} root
 */
function unwrapTokenSpans(root) {
  const spans = root.querySelectorAll('span.tts-word:not(.tts-math-token), tspan.tts-word');
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
 * Tells whether a top-level preview node can carry speech.
 * @param {Node} node
 * @returns {boolean}
 */
function isSpeakableBlock(node) {
  if (!(node instanceof HTMLElement)) return false;

  // Do not read the text of every block here. The first Play calls this over
  // the whole preview; walking the text of a book at that moment is what made
  // the click feel like a hang. Empty blocks are harmless - the tokenizer
  // simply produces no word for them.
  if (node.matches('hr, script, style, template, .heading-anchor')) return false;
  return true;
}

/**
 * The top-level blocks of the preview that carry speakable text.
 *
 * @param {HTMLElement|null} root
 * @returns {HTMLElement[]}
 */
function collectSpeechBlocks(root) {
  if (!root) return [];
  return Array.from(root.children).filter(isSpeakableBlock);
}

/**
 * The number of characters a top-level block would contribute to speech.
 *
 * Used for the start window and for the empty-document guard only; it stops
 * at the first readable block, so a book is not walked twice.
 *
 * @param {HTMLElement} node
 * @returns {number}
 */
function readableChars(node) {
  if (!node) return 0;

  // A diagram's labels are words only when the reader asked for them. The
  // hidden source of the diagram must not make the block look readable.
  if (node.matches?.('.mermaid-block') && !getSettings().readDiagramLabels) return 0;

  const text = node.textContent || '';
  return text.trim() ? text.length : 0;
}

/**
 * Tells whether a top-level block holds text the narrator could read.
 * @param {HTMLElement} node
 * @returns {boolean}
 */
function hasReadableText(node) {
  return readableChars(node) > 0;
}

/**
 * Whether the rendered preview has at least one block the narrator can read.
 *
 * @returns {boolean}
 */
export function hasSpeechContent() {
  if (!previewContainerRef) return false;
  return collectSpeechBlocks(previewContainerRef).some(hasReadableText);
}

/**
 * A cheap estimate of the whole document's word count.
 *
 * The exact number is only known after the document has been tokenized. The
 * player uses this estimate so the progress bar cannot imply that the current
 * window is the whole book.
 *
 * @param {HTMLElement|null} root
 * @returns {number}
 */
function estimateWordCount(root) {
  // The preview supplies the estimate from the Markdown source, so the first
  // Play does not have to read the text of the whole DOM.
  if (documentWordEstimate > 0) return documentWordEstimate;

  // Reading the text of the whole preview for every window would defeat the
  // windowing itself. The document changes only when the tokens are marked
  // stale, so the walk is made once per version.
  if (cachedWordEstimate > 0) return cachedWordEstimate;

  const text = root?.textContent || '';
  cachedWordEstimate = Math.max(1, Math.ceil(text.length / 6));
  return cachedWordEstimate;
}

/**
 * The speech block that contains an element.
 *
 * @param {HTMLElement|null} element
 * @returns {number}
 */
function blockIndexForElement(element) {
  if (!element || !previewContainerRef) return -1;

  let node = element;
  while (node && node.parentElement !== previewContainerRef) {
    node = node.parentElement;
  }

  return node ? speechBlocks.indexOf(node) : -1;
}

/**
 * Chooses the last block of a window that starts at `start`.
 * @param {number} start
 * @returns {number}
 */
function chooseWindowEnd(start) {
  let end = start;
  let chars = 0;

  while (end < speechBlocks.length) {
    chars += speechBlocks[end].textContent?.length || 0;
    end += 1;
    if (end - start >= 4 && chars >= TTS_WINDOW_CHARS) break;
  }

  return Math.min(speechBlocks.length, Math.max(start + 1, end));
}

/**
 * Chooses a small first window so the click is answered quickly.
 *
 * The window grows on its own once the voice is speaking; tokenizing a large
 * part of the page before the first syllable is what made the first Play
 * feel like a hang.
 *
 * @param {number} start
 * @returns {number}
 */
function chooseStartWindowEnd(start) {
  let end = start;
  let chars = 0;
  let readable = 0;

  while (end < speechBlocks.length) {
    const charsInBlock = readableChars(speechBlocks[end]);
    if (charsInBlock > 0) {
      readable += 1;
      chars += charsInBlock;
    }
    end += 1;

    // A few short blocks are still cheaper than one more large paragraph.
    if (readable >= 2 && chars >= TTS_START_WINDOW_CHARS) break;
    if (readable >= 6) break;

    // A run of images or diagrams must not make the first window scan a
    // whole gallery; the next attempt continues after it.
    if (end - start >= 48) break;
  }

  return Math.min(speechBlocks.length, Math.max(start + 1, end));
}

/**
 * Tokenizes a window of blocks, replacing the current token table.
 *
 * @param {number} start
 * @param {number} end
 */
function resetTokenWindow(start, end) {
  windowStartBlock = Math.max(0, start);
  windowEndBlock = Math.min(speechBlocks.length, end);
  hasMoreSpeech = windowEndBlock < speechBlocks.length;
  tokensCoverDocument = false;

  tokenizeDOMForTTS(previewContainerRef, documentLocale, {
    blocks: speechBlocks.slice(windowStartBlock, windowEndBlock),
    totalWords: estimateWordCount(previewContainerRef)
  });
}

/**
 * Starts a token window around an element the reader pointed at.
 *
 * @param {HTMLElement|null} element
 * @returns {boolean} whether a token was produced
 */
function ensureTokenWindowAt(element) {
  if (!previewContainerRef) return false;

  speechBlocks = collectSpeechBlocks(previewContainerRef);
  if (speechBlocks.length === 0) return false;

  let index = blockIndexForElement(element);
  if (index < 0) index = 0;

  resetTokenWindow(index, chooseStartWindowEnd(index));
  return tokens.length > 0;
}

/**
 * The index of the first speech block the reader can see.
 * @returns {number}
 */
function visibleSpeechBlockIndex() {
  if (speechBlocks.length === 0) return 0;

  const scroller = scrollContainerRef;
  if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return 0;
  if (!scroller.clientHeight) return 0;

  const top = scroller.getBoundingClientRect().top + 48;
  let low = 0;
  let high = speechBlocks.length - 1;
  let index = 0;

  // The blocks are in document order, so the last one whose top is above
  // the viewport is the block the reader is looking at. A binary search
  // keeps a jump to the end of a book from measuring every block.
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (speechBlocks[middle].getBoundingClientRect().top <= top) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return index;
}

/**
 * Starts the window at the first block the reader can see.
 *
 * A window that was prepared on idle is reused only while it still covers
 * that block; after a scroll the narrator must not start from a stale place.
 *
 * @returns {boolean} whether a token was produced
 */
function ensureStartWindow() {
  if (!previewContainerRef) return false;
  if (!tokensAreStale && tokens.length > 0 && tokensCoverDocument) return true;

  speechBlocks = collectSpeechBlocks(previewContainerRef);
  if (speechBlocks.length === 0) return false;

  let index = visibleSpeechBlockIndex();

  // A window that still covers the visible block is valid: after a pause it
  // is the table the engine is reading, and replacing it would move the words
  // under the running audio.
  if (!tokensAreStale && tokens.length > 0 && index >= windowStartBlock && index < windowEndBlock) {
    return true;
  }

  // The visible block may be an image, a diagram or a rule. Advance until a
  // window actually produces words instead of failing silently.
  for (let attempt = 0; attempt < 8 && index < speechBlocks.length; attempt += 1) {
    resetTokenWindow(index, chooseStartWindowEnd(index));
    if (tokens.length > 0) return true;
    if (windowEndBlock <= index) break;
    index = windowEndBlock;
  }

  return tokens.length > 0;
}

/**
 * Prepares the first speech window while the page is idle.
 *
 * The tokenization is then already done when the reader presses Play, so the
 * first click does not have to pay for it. If the reader scrolled in the
 * meantime, `ensureStartWindow` notices and rebuilds the window.
 */
export function prepareSpeechWindow() {
  if (!previewContainerRef) return;
  if (isPlaying || isPaused || isStarting) return;

  speechBlocks = collectSpeechBlocks(previewContainerRef);
  if (speechBlocks.length === 0) return;

  if (!tokensAreStale && tokens.length > 0 && tokensCoverDocument) return;

  const index = visibleSpeechBlockIndex();

  // Keep the existing window while it still covers the viewport: the hover
  // wrappers are already there, and re-wrapping on every small scroll would
  // only churn the DOM.
  if (
    !tokensAreStale &&
    tokens.length > 0 &&
    index >= windowStartBlock &&
    index < windowEndBlock
  ) {
    return;
  }

  resetTokenWindow(index, chooseWindowEnd(index));
}

/**
 * Appends the next window while the reader is still speaking.
 *
 * @returns {boolean} whether more text was added
 */
function extendTokenWindow() {
  if (!hasMoreSpeech) return false;

  const start = windowEndBlock;
  const end = chooseWindowEnd(start);
  if (end <= start) {
    hasMoreSpeech = false;
    return false;
  }

  const oldLength = fullSpeechText.length;
  tokenizeDOMForTTS(previewContainerRef, documentLocale, {
    blocks: speechBlocks.slice(start, end),
    append: true,
    totalWords: estimateWordCount(previewContainerRef)
  });

  windowEndBlock = end;
  hasMoreSpeech = end < speechBlocks.length;
  appendChunksForNewText(oldLength);
  return true;
}

/**
 * Adds chunks for speech text that was tokenized after playback started.
 *
 * @param {number} from character offset in `fullSpeechText`
 */
function appendChunksForNewText(from) {
  const text = fullSpeechText.slice(from);
  if (!text.trim()) return;

  const fresh = buildChunks(text, documentLocale, currentRate);
  for (const chunk of fresh) {
    chunkQueue.push({
      ...chunk,
      charStart: chunk.charStart + from,
      charEnd: chunk.charEnd + from
    });
  }
}

/**
 * Re-reads the preview's speech blocks after a progressive render appended
 * more content.
 */
export function refreshSpeechBlocks() {
  if (!previewContainerRef) return;

  const next = collectSpeechBlocks(previewContainerRef);
  if (next.length === speechBlocks.length) return;

  speechBlocks = next;
  hasMoreSpeech = windowEndBlock < speechBlocks.length;
}

/**
 * Adds newly rendered top-level blocks without walking the whole preview.
 *
 * @param {Node[]} nodes
 */
export function appendSpeechBlocks(nodes) {
  if (!nodes || nodes.length === 0) return;
  if (speechBlocks.length === 0) {
    refreshSpeechBlocks();
    return;
  }

  for (const node of nodes) {
    if (isSpeakableBlock(node)) speechBlocks.push(node);
  }

  hasMoreSpeech = windowEndBlock < speechBlocks.length;
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
  windowStartBlock = 0;
  windowEndBlock = -1;
  hasMoreSpeech = false;
  tokensCoverDocument = false;
  estimatedTotalWords = 0;
  cachedWordEstimate = 0;
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
  lastAutoScrollAt = Date.now();
  scroller.scrollTo({ top: target, behavior: 'smooth' });
}

/**
 * @param {number} [windowMs]
 * @returns {boolean} whether the narrator moved the preview recently
 */
export function wasRecentlyAutoScrolling(windowMs = 900) {
  return Date.now() - lastAutoScrollAt < windowMs;
}

/* ==========================================================================
 * Playback
 * ==========================================================================
 * The document is spoken in "chunks" — a paragraph, or as many sentences as
 * fit in one request. Two things matter for how it sounds:
 *
 *   1. The engine's queue is fed ahead. The next request is handed to the
 *      browser while the current one is still being spoken, so the voice
 *      does not fall silent (and go looking for the next sentence) after
 *      every pause. A request that the browser refuses is asked for again
 *      rather than abandoned.
 *   2. The chunks are neither too small nor too long. One sentence per
 *      request is a stall between every sentence; one request for the whole
 *      document is cut off by Chromium after about fifteen seconds. The
 *      ceiling follows the playback rate, and each chunk keeps its own
 *      character offset, so the word highlight still lines up exactly.
 * ========================================================================== */

/** How many times one chunk may be retried before it is skipped. */
const CHUNK_RETRY_LIMIT = 3;
/** How many requests the engine may hold: one speaking, one warming up. */
const PREFETCH_DEPTH = 2;
/** How quiet the engine may be before the watchdog takes it as lost. */
const SILENCE_GRACE_MS = 1800;
/** A chunk is never longer than this; silence past it means a stuck engine. */
const STALL_MS = 13000;
/** The pause before a failed chunk is asked for again. */
const ERROR_RESTART_MS = 150;

/**
 * Prepares the chunk queue so that reading starts at a character offset.
 * @param {number} startChar
 */
function prepareChunks(startChar) {
  const all = buildChunks(fullSpeechText, documentLocale, currentRate);
  chunkCursor = 0;
  chunkDone = 0;
  chunkRetries = 0;

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
 * Keeps the engine's queue fed.
 *
 * One request is spoken while the next one is already waiting in the
 * browser, so the hand-off costs no silence. Every engine event calls this,
 * which makes it safe to call from anywhere.
 *
 * @param {number} sessionId
 */
function pumpChunks(sessionId) {
  if (sessionId !== currentSessionId) return;

  // The token window is filled just in time. No full-document pass is made
  // before the first sentence can be heard.
  if (
    hasMoreSpeech &&
    chunkCursor + PREFETCH_DEPTH >= chunkQueue.length
  ) {
    extendTokenWindow();
  }

  while (chunkCursor >= chunkQueue.length && hasMoreSpeech) {
    if (!extendTokenWindow()) break;
  }

  while (chunkCursor - chunkDone < PREFETCH_DEPTH && chunkCursor < chunkQueue.length) {
    const index = chunkCursor;
    chunkCursor += 1;
    speakChunk(chunkQueue[index], index, sessionId);
  }

  if (chunkDone >= chunkQueue.length && chunkCursor >= chunkQueue.length && !hasMoreSpeech) {
    finishPlayback();
  }
}

/**
 * Schedules the next hand-over outside the engine's own event handlers.
 *
 * Chromium can swallow a `speak()` that is called synchronously from inside
 * `onend` (or `onstart`): the utterance is accepted and never spoken, and
 * the reading only resumes when the watchdog notices the silence. A turn of
 * the loop is enough to leave the event and keep the queue fed.
 *
 * @param {number} sessionId
 * @param {number} [delay]
 */
function schedulePump(sessionId, delay = 0) {
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pumpChunks(sessionId);
  }, delay);
}

/**
 * Hands one chunk to the speech engine.
 *
 * @param {{ text: string, charStart: number, charEnd: number }} chunk
 * @param {number} index position of the chunk in the queue
 * @param {number} sessionId
 */
function speakChunk(chunk, index, sessionId) {
  const utterance = new SpeechSynthesisUtterance(chunk.text);
  liveUtterances.add(utterance);
  window.__currentTTSUtterance = utterance;

  if (currentVoice) utterance.voice = currentVoice;
  // A voice the reader picked explicitly knows its own language; otherwise
  // the document decides.
  utterance.lang = currentVoice?.lang || documentLocale;
  utterance.rate = currentRate;
  utterance.pitch = currentPitch;

  utterance.onboundary = (event) => {
    if (sessionId !== currentSessionId || utterance.__canceled) return;
    lastEventAt = Date.now();
    noteProgress();
    const globalChar = chunk.charStart + event.charIndex;
    const matchedTokenIndex = findTokenByCharIndex(globalChar);
    if (matchedTokenIndex >= 0) setActiveWord(matchedTokenIndex);
  };

  utterance.onstart = () => {
    if (sessionId !== currentSessionId || utterance.__canceled) return;
    lastEventAt = Date.now();
    isPlaying = true;
    isPaused = false;
    isStarting = false;
    noteProgress();
    const active = tokens[currentWordIndex];
    if (active?.element) active.element.classList.remove('speaking-target');
    notifyState({ isPlaying: true, isPaused: false, starting: false });
    clearStartWatchdog();
    // This chunk is playing now — keep the queue one request ahead.
    schedulePump(sessionId);
  };

  utterance.onpause = () => {
    if (sessionId !== currentSessionId || utterance.__canceled) return;
    isPaused = true;
    notifyState({ isPlaying: true, isPaused: true });
  };

  utterance.onresume = () => {
    if (sessionId !== currentSessionId || utterance.__canceled) return;
    lastEventAt = Date.now();
    isPaused = false;
    notifyState({ isPlaying: true, isPaused: false });
  };

  utterance.onend = () => {
    if (sessionId !== currentSessionId || utterance.__canceled) return;
    liveUtterances.delete(utterance);
    // Chunks finish in order; an `onend` from a chunk that was cancelled and
    // handed over again must not count as progress.
    lastEventAt = Date.now();
    if (index === chunkDone) chunkDone += 1;
    chunkRetries = 0;
    noteProgress();
    schedulePump(sessionId);
  };

  utterance.onerror = (event) => {
    if (sessionId !== currentSessionId || utterance.__canceled) return;
    liveUtterances.delete(utterance);
    // A request that failed is over; anything the browser reports for it
    // afterwards is stale and must not move the reading forward.
    utterance.__canceled = true;

    // Our own `cancel()` — a new session, or a chunk handed over again — is
    // not an error.
    if (event.error === 'canceled' || event.error === 'interrupted') return;

    console.warn('SpeechSynthesisUtterance error:', event.error || 'unknown');
    retryFromChunk(index, sessionId);
  };

  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
  window.speechSynthesis.speak(utterance);
}

/**
 * Starts the reading again from a chunk that the engine failed on.
 *
 * The requests already queued behind it are dropped (their `canceled`
 * events are ignored), so the failed chunk is spoken in its place and the
 * rest of the document follows.
 *
 * @param {number} index
 * @param {number} sessionId
 */
function retryFromChunk(index, sessionId) {
  if (sessionId !== currentSessionId) return;

  chunkRetries += 1;

  if (chunkRetries > CHUNK_RETRY_LIMIT) {
    console.warn('Speech chunk skipped after', CHUNK_RETRY_LIMIT, 'retries');
    chunkRetries = 0;
    chunkCursor = Math.max(chunkCursor, index + 1);
    chunkDone = Math.max(chunkDone, index + 1);
    schedulePump(sessionId);
    return;
  }

  cancelEngine();
  chunkCursor = index;
  chunkDone = index;
  clearChunkTimer();
  chunkTimer = setTimeout(() => {
    chunkTimer = null;
    if (sessionId !== currentSessionId) return;
    pumpChunks(sessionId);
  }, ERROR_RESTART_MS * chunkRetries);
}

function clearChunkTimer() {
  if (chunkTimer === null) return;
  clearTimeout(chunkTimer);
  chunkTimer = null;
}

function clearPumpTimer() {
  if (pumpTimer === null) return;
  clearTimeout(pumpTimer);
  pumpTimer = null;
}

/**
 * Records that the engine is alive, so the watchdog does not interfere.
 */
function noteProgress() {
  lastProgressAt = Date.now();
  restartAttempts = 0;
}

/**
 * Ends the narration cleanly.
 */
function finishPlayback() {
  cleanupUtterance();
  clearChunkTimer();
  clearPumpTimer();
  chunkQueue = [];
  chunkCursor = 0;
  chunkDone = 0;
  chunkRetries = 0;
  setActiveWord(-1);

  // A finished session is not a prepared window any more: pressing Play
  // again must start from what the reader can see now, not from the old
  // session's first block.
  tokensAreStale = true;
  windowStartBlock = 0;
  windowEndBlock = -1;
  hasMoreSpeech = false;

  isPlaying = false;
  isPaused = false;
  isStarting = false;
  restartAttempts = 0;
  lastProgressAt = 0;
  lastEventAt = 0;
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

  if (tokensAreStale || tokens.length === 0) {
    if (!ensureStartWindow()) return;
  }
  if (tokens.length === 0) return;

  const targetIndex = Math.max(0, Math.min(tokens.length - 1, wordIndex));
  const targetToken = tokens[targetIndex];

  // ZERO-JERK SESSION INVALIDATION
  currentSessionId++;
  const thisSession = currentSessionId;

  cleanupUtterance();
  clearChunkTimer();
  clearPumpTimer();
  chunkRetries = 0;
  lastEventAt = Date.now();
  // The cross-tab hand-shake is optional.
  if (getSettings().pauseOtherTabs) announceNarrationStart();

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
    pumpChunks(thisSession);
    startStartWatchdog(thisSession);
  };

  // Brief 40ms audio queue drain prevents initial syllable swallowing
  speakDebounceTimer = setTimeout(launchSpeech, 40);
}

/**
 * Play or Resume audio reading.
 */
export function play() {
  if (!('speechSynthesis' in window)) return false;

  // Resuming a pause does not need the token table: the engine is still
  // holding the utterance. Re-tokenizing here would move the words under the
  // running audio.
  if (isPaused) {
    const api = window.speechSynthesis;
    // The paused utterance may have been dropped by the browser — only trust
    // the API when it really is still holding the speech.
    if (api.paused) {
      // Taking the reading back means the other tab has to let go, when the
      // reader asked for the cross-tab hand-shake.
      if (getSettings().pauseOtherTabs) announceNarrationStart();
      api.resume();
      lastEventAt = Date.now();
      isPaused = false;
      isPlaying = true;
      isStarting = false;
      notifyState({ isPlaying: true, isPaused: false, starting: false });
      return true;
    }
    // Otherwise fall through and re-speak from the current word.
    isPaused = false;
  }

  if (!isPlaying) {
    // Nothing to read is not a "starting" state. Do not flash the player when
    // the reader clicks empty space in an empty document.
    if (!hasSpeechContent()) {
      if (isStarting) {
        isStarting = false;
        notifyState({ starting: false });
      }
      return false;
    }

    // Tell the UI *before* the heavy work starts. Tokenizing a large document
    // can take a moment, and without feedback the button looks unresponsive.
    isStarting = true;
    notifyState({ starting: true });
  }

  if (!ensureStartWindow()) {
    isStarting = false;
    notifyState({ starting: false });
    return false;
  }

  if (isPlaying) {
    const api = window.speechSynthesis;
    // The engine believes it is reading. If the API agrees, there is
    // nothing to do; if it does not, the utterance was dropped without an
    // event — heal it instead of leaving a silent "playing" state that only
    // a second press can shake off.
    if (api.speaking || api.pending) {
      isStarting = false;
      notifyState({ starting: false });
      return true;
    }
    speakFromWord(Math.max(0, currentWordIndex));
    return true;
  }

  const startIndex = currentWordIndex >= 0 ? currentWordIndex : 0;
  restartAttempts = 0;
  speakFromWord(startIndex);
  return true;
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
 * Pauses because another tab started narrating. The place in the document
 * is kept: the reader can press Play again in this tab to take over.
 */
function pauseForOtherTab() {
  // The hand-shake is opt-in: without the setting, another tab starting to
  // read does not pause this one.
  if (getSettings().pauseOtherTabs !== true) return;
  if (!isPlaying || isPaused) return;
  window.speechSynthesis.pause();
  isPaused = true;
  notifyState({ isPlaying: true, isPaused: true, reason: 'other-tab' });
}

/**
 * Stop audio reading and reset the active word.
 * @param {string} [reason] optional machine-readable reason, surfaced to the UI
 */
export function stop(reason = 'user') {
  if (!('speechSynthesis' in window)) return;
  currentSessionId++;
  tokensAreStale = true;
  hasMoreSpeech = false;
  if (speakDebounceTimer) {
    clearTimeout(speakDebounceTimer);
    speakDebounceTimer = null;
  }
  clearChunkTimer();
  clearPumpTimer();
  chunkQueue = [];
  chunkCursor = 0;
  chunkDone = 0;
  chunkRetries = 0;
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
  for (const utterance of liveUtterances) {
    utterance.onboundary = null;
    utterance.onstart = null;
    utterance.onpause = null;
    utterance.onresume = null;
    utterance.onend = null;
    utterance.onerror = null;
  }
  liveUtterances.clear();
  window.__currentTTSUtterance = null;
}

/**
 * Silences the engine and makes sure the events of the cancelled utterances
 * are ignored: a browser that reports onend for work it just threw away
 * would otherwise count a chunk that still has to be spoken.
 */
function cancelEngine() {
  for (const utterance of liveUtterances) utterance.__canceled = true;
  window.speechSynthesis.cancel();
}

/* ==========================================================================
 * Start watchdog — the speech engine sometimes never starts
 * ========================================================================== */

/**
 * If the engine does not report `onstart` shortly after the request, the
 * user is left staring at a button that looks stuck. Nudge the chunk once,
 * then say what happened instead of pretending to read.
 */
let startWatchdogTimer = null;

function startStartWatchdog(sessionId, attempt = 0) {
  clearStartWatchdog();
  startWatchdogTimer = setTimeout(() => {
    startWatchdogTimer = null;
    if (sessionId !== currentSessionId) return;
    if (isPlaying || isPaused) return;

    // A slow engine may still be preparing the voice (network voices can
    // take a few seconds on the first sentence) — that is not a failure.
    const api = window.speechSynthesis;
    if ((api.speaking || api.pending) && attempt < 5) {
      startStartWatchdog(sessionId, attempt + 1);
      return;
    }

    // One more try before giving up: the very first `speak()` of a session
    // is the one browsers most often swallow.
    if (attempt === 0 && chunkDone === 0 && chunkQueue.length > 0) {
      isStarting = true;
      notifyState({ starting: true });
      cancelEngine();
      chunkCursor = 0;
      pumpChunks(sessionId);
      startStartWatchdog(sessionId, 1);
      return;
    }

    isStarting = false;
    notifyState({
      isPlaying: false,
      isPaused: false,
      starting: false,
      reason: 'no-start'
    });
  }, 5000);
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
export function reconcileWithSpeechApi() {
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

  // The engine can be paused behind our back (a tab switch, an audio device
  // change): a session that looks like it is playing would otherwise stay
  // silent until the user presses Play again.
  if (api.paused && !isPaused) {
    api.resume();
    lastEventAt = Date.now();
  }

  // The engine reports activity — the reading is alive, whatever the
  // boundary events are doing. Some voices never fire them at all.
  if (api.speaking || api.pending) {
    // A chunk never lasts longer than the stall threshold, so an engine that
    // holds the queue without a single event is stuck, not slow. This also
    // covers a queued request that never starts.
    if (lastEventAt === 0 || Date.now() - lastEventAt <= STALL_MS) {
      noteProgress();
      return;
    }

    if (restartAttempts >= 4) {
      stop('speech-lost');
      return;
    }

    restartAttempts += 1;
    speakFromWord(Math.max(0, currentWordIndex));
    return;
  }

  // The engine can still go quiet between two requests even when the queue
  // is fed; it is only lost when it stays quiet past the grace period.
  if (Date.now() - lastProgressAt < SILENCE_GRACE_MS) return;

  if (restartAttempts >= 4) {
    stop('speech-lost');
    return;
  }

  restartAttempts += 1;

  // Nothing is left to speak: the last onend was swallowed, so just close
  // the session instead of starting the final sentence again.
  if (chunkDone >= chunkQueue.length) {
    finishPlayback();
    return;
  }

  // Text is still queued: wake the engine at the next unspoken chunk
  // instead of starting a new session, which would cancel the reading and
  // repeat a sentence.
  cancelEngine();
  chunkCursor = chunkDone;
  pumpChunks(currentSessionId);
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

  let word = element.matches?.('.tts-word') ? element : element.querySelector?.('.tts-word');

  if (!word) {
    if (!ensureTokenWindowAt(element)) return false;
    word = element.matches?.('.tts-word') ? element : element.querySelector?.('.tts-word');
  }

  if (!word) return false;

  const id = Number.parseInt(word.getAttribute('data-word-id'), 10);
  const index = tokenIndexById.get(id);
  if (index === undefined) return false;

  restartAttempts = 0;
  speakFromWord(index);
  return true;
}

/**
 * Smart Click-to-Speak Handler.
 * @param {MouseEvent} event
 */
export function handlePreviewClick(event) {
  const target = event.target;
  if (!target?.closest) return;

  let wordEl = target.closest('.tts-word');

  if (!wordEl) {
    const parentBlock = target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, tr');

    // The block has not been tokenized yet. Tokenize only this window, not
    // the whole document; a click in chapter forty must not pay for chapters
    // one to thirty-nine.
    if (tokensAreStale || tokens.length === 0 || !parentBlock?.querySelector('.tts-word')) {
      if (!ensureTokenWindowAt(parentBlock || target)) return;
    }

    wordEl = parentBlock?.querySelector('.tts-word');
  }

  if (!wordEl) return;

  const wordIdAttr = wordEl.getAttribute('data-word-id');
  if (wordIdAttr === null) return;

  const wordId = Number.parseInt(wordIdAttr, 10);
  const tokenIdx = tokenIndexById.get(wordId);
  if (tokenIdx !== undefined) {
    restartAttempts = 0;
    speakFromWord(tokenIdx);
  }
}

// Two tabs at once would speak over each other; the one that starts reading
// asks the others to pause. Only the other tabs receive the announcement.
if (typeof window !== 'undefined') {
  onOtherTabNarrationStart(pauseForOtherTab);

  // A page that goes away is not reading any more. Without this, a tab that
  // enters the back/forward cache keeps claiming to play, and the watchdog
  // would restart it on the way back.
  window.addEventListener('pagehide', () => {
    if (isPlaying) stop('pagehide');
  });
}
