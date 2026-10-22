/**
 * ============================================================================
 * PREVIEW PIPELINE
 * ============================================================================
 * Two clearly separated stages:
 *
 *   RENDER   — Markdown → sanitized HTML → preview DOM
 *   TOKENIZE — preview DOM → speakable words (only when they are needed)
 *
 * The old implementation tokenized the whole document on every keystroke,
 * which meant a large paste froze the main thread for seconds. Tokenization
 * is now lazy and idle-scheduled, and the preview is only rewritten when the
 * rendered HTML actually changed.
 * ============================================================================
 */

import { el } from './dom.js';
import { renderMarkdown } from '../markdown-parser.js';
import { renderMermaidDiagrams, handleDiagramAction } from '../mermaid-renderer.js';
import {
  detectLanguage,
  ensureTokens,
  markTokensStale,
  setScrollContainer,
  setPreviewContainer,
  setAutoScrollEnabled,
  isSpeaking,
  isSpeechPaused,
  handlePreviewClick,
  onTTSStateChange
} from '../tts-engine.js';
import { setSTTLocale } from '../stt-engine.js';
import { getSettings, onSettingsChange } from '../settings-manager.js';
import { onContentChange } from './editor.js';
import { setMessage, clearMessage } from './status.js';
import { toggleNarration } from './narration.js';

let renderTimer = null;
let idleHandle = null;
let idleUsesRaf = false;
let lastHtml = '';
let lastReason = 'edited';
let pendingRender = null;

/**
 * The elements that count as "text" for the click gesture. A click inside
 * one of them starts reading; a click outside them pauses.
 */
const TEXT_BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, blockquote, tr, pre, figcaption, dt, dd';

/** True while the reader has taken over the scroll position. */
let followSuspended = false;

/**
 * Applies the "follow the narration" preference, taking the manual
 * suspension into account.
 */
function applyFollowSetting() {
  setAutoScrollEnabled(getSettings().followWhileReading && !followSuspended);
}

/* ==========================================================================
 * Render pipeline
 * ========================================================================== */

/**
 * Schedules a render, scaled to the document size.
 * @param {'edited'|'replaced'} [reason]
 */
function scheduleRender(reason = 'edited') {
  lastReason = reason;
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }

  const len = el.editor.value.length;
  const delay = len > 80000 ? 380 : len > 25000 ? 240 : 120;

  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderNow(reason);
  }, delay);
}

/**
 * Runs any pending render immediately (used before starting playback, so the
 * narrator never reads a document the editor has already replaced).
 */
export function flushRender() {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  renderNow(lastReason);
}

/**
 * Renders the current document into the preview.
 * @param {'edited'|'replaced'} reason
 */
function renderNow(reason) {
  const settings = getSettings();

  // When the user asked us not to interrupt narration, the DOM rewrite waits
  // until playback ends — otherwise the word highlight would point at a
  // document that is no longer on screen.
  if (isSpeaking() && !settings.autoStopOnReplace) {
    pendingRender = reason;
    return;
  }

  const markdownText = el.editor.value;
  const html = renderMarkdown(markdownText);

  if (html !== lastHtml) {
    // Stop narration BEFORE the DOM is replaced: the running utterance
    // describes the old document and would otherwise keep highlighting
    // words in the new one.
    markTokensStale(reason);
    el.preview.innerHTML = html;
    lastHtml = html;

    // Mermaid diagrams are drawn once the DOM exists — the renderer needs a
    // live document to lay the diagram out.
    renderMermaidDiagrams(el.preview);

    // The rewrite resets the scroll position — put the reader back where
    // they were, once the new content has been laid out.
    if (!positionRestored) setTimeout(restorePosition, 60);

    // Let the outline know the document was re-rendered — the heading
    // elements it holds have just been replaced.
    el.preview.dispatchEvent(new CustomEvent('preview:rendered'));
  }

  setSTTLocale(detectLanguage(markdownText));

  scheduleTokenize();
}

/**
 * Tokenizes the preview during idle time so the word counter stays accurate
 * without competing with typing. Large documents get a longer grace period so
 * the token pass only runs when the browser is genuinely idle.
 */
function scheduleTokenize() {
  cancelTokenize();

  const run = () => {
    idleHandle = null;
    const tokens = ensureTokens();
    if (el.activeTokenInfo) {
      el.activeTokenInfo.textContent = `${tokens.length} words ready`;
    }
  };

  const size = el.editor.value.length;
  const timeout = size > 80000 ? 3000 : size > 25000 ? 1200 : 600;

  if (typeof window.requestIdleCallback === 'function') {
    idleUsesRaf = true;
    idleHandle = window.requestIdleCallback(run, { timeout });
  } else {
    idleUsesRaf = false;
    idleHandle = setTimeout(run, size > 25000 ? 600 : 150);
  }
}

function cancelTokenize() {
  if (idleHandle === null) return;
  if (idleUsesRaf && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(idleHandle);
  } else {
    clearTimeout(idleHandle);
  }
  idleHandle = null;
}

/**
 * Re-renders the preview from scratch (used when a setting that affects the
 * rendered output changes).
 */
export function refreshPreview() {
  lastHtml = '';
  flushRender();
}

/* ==========================================================================
 * Synchronized scrolling
 * ==========================================================================
 * Three modes:
 *   off   — the panes scroll independently
 *   ratio — proportional scrolling (approximate)
 *   line  — anchored on the source line, so the same paragraph stays aligned
 * ========================================================================== */

/**
 * Scrolls a pane and marks the next scroll event of that pane as our own.
 *
 * A boolean is used rather than comparing the scroll position: the browser
 * clamps the position when the content is not tall enough yet, and a value
 * comparison would then fail to recognise the echo — which sends the two
 * panes into a feedback loop.
 */
function scrollPane(node, key, top) {
  suppressScroll[key] = true;
  node.scrollTop = top;
}

const suppressScroll = { editor: false, preview: false };

/* --------------------------------------------------------------- anchors -- */

/**
 * The preview blocks that carry a source line, in document order.
 *
 * Each entry also knows how many source lines the block spans, which is what
 * makes a line-accurate mapping possible.
 *
 * @returns {Array<{ el: HTMLElement, line: number, lines: number }>}
 */
function getAnchors() {
  const elements = Array.from(el.preview.querySelectorAll('[data-line]'));
  if (elements.length === 0) return [];

  const totalLines = el.editor.value.split('\n').length;

  return elements.map((node, index) => {
    const line = Number(node.dataset.line) || 1;
    const next = elements[index + 1];
    // The block reaches up to the next block's first line; the last block
    // reaches the end of the document.
    const end = next ? Number(next.dataset.line) - 1 : totalLines;
    return { el: node, line, lines: Math.max(1, end - line + 1) };
  });
}

/**
 * The height of one editor line in pixels.
 * @returns {number}
 */
function getEditorLineHeight() {
  const lineHeight = Number.parseFloat(getComputedStyle(el.editor).lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
  const total = el.editor.value.split('\n').length;
  return total > 0 ? (el.editor.scrollHeight - 32) / total : 20;
}

/**
 * The source line currently at the top of the editor.
 * @returns {number}
 */
function getEditorTopLine() {
  const lineHeight = getEditorLineHeight();
  const padding = Number.parseFloat(getComputedStyle(el.editor).paddingTop) || 0;
  return Math.floor(Math.max(0, el.editor.scrollTop - padding) / lineHeight) + 1;
}

/**
 * Scrolls the editor so that a source line sits at the top.
 * @param {number} line
 */
function scrollEditorToLine(line) {
  const lineHeight = getEditorLineHeight();
  const padding = Number.parseFloat(getComputedStyle(el.editor).paddingTop) || 0;
  scrollPane(el.editor, 'editor', Math.max(0, (line - 1) * lineHeight + padding));
  el.lineNumbers.scrollTop = el.editor.scrollTop;
}

/**
 * Scrolls the preview so that the given source line sits at the top.
 *
 * The position inside a block is interpolated in *source lines* — the same
 * unit the editor uses — and then expressed as a share of the block's height
 * in the preview. Mixing pixels and lines here is what made the alignment
 * drift.
 *
 * @param {number} line
 */
function scrollPreviewToLine(line) {
  const anchors = getAnchors();
  if (anchors.length === 0) return;

  let index = 0;
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].line <= line) index = i;
    else break;
  }

  const block = anchors[index];
  const blockTop = block.el.offsetTop;
  const blockHeight = block.el.offsetHeight || 1;

  // How far into the block the requested line sits, measured in source lines.
  const within = Math.min(1, Math.max(0, (line - block.line) / block.lines));
  const offset = within * blockHeight;

  scrollPane(el.previewWrapper, 'preview', Math.max(0, blockTop + offset - 16));
}

/**
 * Scrolls the preview to a source line (used by the outline).
 * @param {number} line
 */
export function jumpToLine(line) {
  scrollPreviewToLine(line);
}

/**
 * The source line currently at the top of the preview.
 * @returns {number}
 */
function getPreviewTopLine() {
  const anchors = getAnchors();
  if (anchors.length === 0) return 1;

  const scrollerTop = el.previewWrapper.scrollTop;
  let current = anchors[0];
  for (const anchor of anchors) {
    if (anchor.el.offsetTop <= scrollerTop + 8) current = anchor;
    else break;
  }
  return current.line;
}

/* ------------------------------------------------------------------ wiring -- */

/**
 * Wires the synchronized scrolling with a precise echo detection.
 */
function initSyncScroll() {
  // A real gesture always wins over a pending programmatic scroll.
  const releaseSuppression = (key) => () => {
    suppressScroll[key] = false;
  };

  const handleScroll = (key, node) => {
    if (suppressScroll[key]) {
      // This is the echo of our own programmatic scroll.
      suppressScroll[key] = false;
      return;
    }

    if (key === 'editor') {
      el.lineNumbers.scrollTop = el.editor.scrollTop;
    }

    const mode = getSettings().syncMode;
    if (mode === 'off') return;

    // The update happens synchronously: deferring it to the next animation
    // frame adds a visible lag and would not run at all in a tab that is not
    // being painted. The echo detection above already prevents a feedback
    // loop.
    if (mode === 'line') {
      if (key === 'editor') {
        scrollPreviewToLine(getEditorTopLine());
      } else {
        scrollEditorToLine(getPreviewTopLine());
      }
      return;
    }

    // Proportional scrolling
    const max =
      key === 'editor'
        ? el.editor.scrollHeight - el.editor.clientHeight
        : el.previewWrapper.scrollHeight - el.previewWrapper.clientHeight;

    if (max <= 0) return;
    const ratio = node.scrollTop / max;

    const editorMax = el.editor.scrollHeight - el.editor.clientHeight;
    const previewMax = el.previewWrapper.scrollHeight - el.previewWrapper.clientHeight;

    if (key === 'editor') {
      if (previewMax > 0) scrollPane(el.previewWrapper, 'preview', ratio * previewMax);
    } else if (editorMax > 0) {
      scrollPane(el.editor, 'editor', ratio * editorMax);
      el.lineNumbers.scrollTop = el.editor.scrollTop;
    }
  };

  el.editor.addEventListener('scroll', () => handleScroll('editor', el.editor), { passive: true });
  el.previewWrapper.addEventListener('scroll', () => handleScroll('preview', el.previewWrapper), {
    passive: true
  });

  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((type) => {
    el.editor.addEventListener(type, releaseSuppression('editor'), { passive: true });
    el.previewWrapper.addEventListener(type, releaseSuppression('preview'), { passive: true });
  });
}

/* ==========================================================================
 * Reading position
 * ==========================================================================
 * The scroll position of the preview is remembered so the app can pick up
 * where the reader left off.
 * ========================================================================== */

const POSITION_KEY = 'markau_position';

/**
 * The key the reading position had before the app was renamed. It is moved
 * over, so the reader picks up where they left off.
 */
const LEGACY_POSITION_KEY = 'markaudio_position';

let positionTimer = null;
let positionRestored = false;

/**
 * Moves the reading position over from the key it had before the rename.
 */
function adoptLegacyPosition() {
  try {
    if (localStorage.getItem(POSITION_KEY)) return;

    const legacy = localStorage.getItem(LEGACY_POSITION_KEY);
    if (!legacy) return;

    localStorage.setItem(POSITION_KEY, legacy);
    localStorage.removeItem(LEGACY_POSITION_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Stores the current reading position.
 */
function savePosition() {
  if (!getSettings().rememberPosition) return;
  const max = el.previewWrapper.scrollHeight - el.previewWrapper.clientHeight;
  if (max <= 0) return;
  try {
    localStorage.setItem(POSITION_KEY, (el.previewWrapper.scrollTop / max).toFixed(4));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Restores the stored reading position.
 *
 * It is applied once the preview has been laid out; the preview is rewritten
 * on every render, so the position is re-applied until the reader scrolls
 * away from it.
 */
function restorePosition() {
  if (positionRestored) return;
  if (!getSettings().rememberPosition) return;

  let ratio = 0;
  try {
    ratio = Number.parseFloat(localStorage.getItem(POSITION_KEY) || '0');
  } catch {
    ratio = 0;
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return;

  const max = el.previewWrapper.scrollHeight - el.previewWrapper.clientHeight;
  if (max <= 0) return;

  scrollPane(el.previewWrapper, 'preview', ratio * max);
  positionRestored = true;
}

/**
 * Schedules a position save.
 */
function schedulePositionSave() {
  if (positionTimer) clearTimeout(positionTimer);
  positionTimer = setTimeout(() => {
    positionTimer = null;
    savePosition();
  }, 400);
}

/* ==========================================================================
 * Link handling
 * ========================================================================== */

/**
 * Copies the code of a code block to the clipboard.
 * @param {HTMLElement} button the copy button
 */
function copyCode(button) {
  const block = button.closest('.code-block');
  const code = block?.querySelector('code')?.textContent ?? '';
  if (!code) return;

  navigator.clipboard
    ?.writeText(code)
    .then(() => {
      button.textContent = 'Copied';
      button.classList.add('is-copied');
      setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('is-copied');
      }, 1500);
    })
    .catch(() => {
      setMessage('Could not copy the code', { tone: 'warn', ttl: 2500 });
    });
}

/**
 * Intercepts a link click so the app never navigates away from itself.
 * @param {HTMLAnchorElement} linkEl
 */
function handleLinkClick(linkEl) {
  // A link inside a Mermaid diagram is an SVG anchor, which carries the
  // target in `xlink:href` instead of `href`.
  const href = linkEl.getAttribute('href') || linkEl.getAttribute('xlink:href');
  if (!href) return;

  // A link to a place inside the document — a heading, a footnote.
  if (href.startsWith('#')) {
    const target = el.preview.querySelector(
      `#${CSS.escape(decodeURIComponent(href.slice(1)))}`
    );
    if (!target) return;
    target.scrollIntoView({ behavior: getSettings().smoothScrollActive ? 'smooth' : 'auto' });
    return;
  }

  if (/^file:\/\//i.test(href)) {
    // Browsers block file:// navigation — offer the path on the clipboard.
    navigator.clipboard?.writeText(href).catch(() => {});
    setMessage('📋 Copied file path to clipboard (browser blocks file:// directly)', {
      tone: 'accent',
      ttl: 3500
    });
    return;
  }

  if (/^vscode:\/\//i.test(href)) {
    // Hand the URL to the operating system's protocol handler.
    const opened = window.open(href, '_blank', 'noopener');
    if (!opened) {
      navigator.clipboard?.writeText(href).catch(() => {});
      setMessage('📋 Copied VS Code link to clipboard', { tone: 'accent', ttl: 3500 });
    }
    return;
  }

  if (/^https?:\/\//i.test(href)) {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

/* ==========================================================================
 * Bootstrap
 * ========================================================================== */

/**
 * Initializes the preview pipeline.
 */
export function initPreview() {
  setScrollContainer(el.previewWrapper);
  setPreviewContainer(el.preview);
  applyFollowSetting();
  adoptLegacyPosition();

  onContentChange(({ reason }) => scheduleRender(reason));

  // The "follow the narration" preference applies immediately
  onSettingsChange(() => applyFollowSetting());

  // A deferred render (narration was running) is flushed once playback ends.
  onTTSStateChange(({ isPlaying }) => {
    if (isPlaying) {
      // A fresh narration always re-engages the follow.
      followSuspended = false;
      applyFollowSetting();
    }
    if (!isPlaying && pendingRender) {
      const reason = pendingRender;
      pendingRender = null;
      renderNow(reason);
    }
  });

  initSyncScroll();

  // A diagram that finished drawing adds words to the document — the word
  // count and the narration have to learn them.
  el.preview.addEventListener('preview:diagram-rendered', () => {
    scheduleTokenize();
  });

  // Remember the reading position, and yield to the reader when they scroll
  // by hand while the narration is running.
  el.previewWrapper.addEventListener(
    'scroll',
    () => {
      if (suppressScroll.preview) return; // our own scroll

      // A genuine gesture means the reader has moved on — stop restoring.
      positionRestored = true;
      schedulePositionSave();

      if (followSuspended) return;
      if (!isSpeaking() && !isSpeechPaused()) return;

      followSuspended = true;
      applyFollowSetting();
      setMessage('Follow paused — click a word to read from there', { tone: 'muted', ttl: 3000 });
    },
    { passive: true }
  );
  window.addEventListener('beforeunload', savePosition);

  el.preview.addEventListener('click', (event) => {
    // The tools around a diagram handle their own clicks.
    const tool = event.target.closest('[data-mermaid-action]');
    if (tool) {
      event.preventDefault();
      handleDiagramAction(tool.dataset.mermaidAction, tool.closest('.mermaid-block'));
      return;
    }

    // The copy button of a code block.
    const copyButton = event.target.closest('[data-code-copy]');
    if (copyButton) {
      event.preventDefault();
      copyCode(copyButton);
      return;
    }

    const linkEl = event.target.closest('a');
    if (linkEl) {
      event.preventDefault();
      handleLinkClick(linkEl);
      return;
    }

    // Inside a diagram the click belongs to the diagram — a node can carry
    // its own link, and nothing here is a reading gesture.
    if (event.target.closest('.mermaid-block')) {
      return;
    }

    // A click on a word (or inside a text block) starts reading from there.
    const isWord = Boolean(event.target.closest('.tts-word'));
    const isBlock = Boolean(event.target.closest(TEXT_BLOCK_SELECTOR));

    if (isWord || isBlock) {
      if (followSuspended) {
        // The reader took over with a click — the follow resumes with it.
        followSuspended = false;
        applyFollowSetting();
        clearMessage();
      }
      setMessage('🔊 Starting from here...', { tone: 'accent', ttl: 1500 });
      handlePreviewClick(event);
      return;
    }

    // Empty space outside the text does exactly what the Space key does:
    // the reading starts, pauses and resumes again.
    const state = toggleNarration();
    if (state === 'paused') {
      setMessage('Paused — press Space to continue', { tone: 'accent', ttl: 2500 });
    } else {
      setMessage('Reading…', { tone: 'accent', ttl: 1500 });
    }
  });

  renderNow('edited');

  // Restore the reading position once the first render has been laid out
  setTimeout(restorePosition, 0);
}
