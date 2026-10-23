/**
 * ============================================================================
 * PREVIEW PIPELINE
 * ============================================================================
 * Two clearly separated stages:
 *
 *   RENDER   — Markdown → sanitized HTML → preview DOM
 *   TOKENIZE — preview DOM → speakable words (only when they are needed)
 *
 * The document is parsed once, then rendered in balanced top-level groups.
 * The first groups reach the page before the rest of a book has been walked,
 * and a large edit re-renders only the block it touched. Tokenization is
 * windowed in the speech module, so no preview pass tokenizes a whole book.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import {
  parseMarkdownDocument,
  groupMarkdownTokens,
  groupLineRange,
  renderMarkdownGroup
} from '@/markdown/parser.js';
import { detectLanguage } from '@/core/language.js';
import { renderMermaidDiagrams, handleDiagramAction } from '@/markdown/mermaid.js';
import {
  setDocumentLocale,
  markTokensStale,
  setScrollContainer,
  setPreviewContainer,
  setAutoScrollEnabled,
  isSpeaking,
  isSpeechPaused,
  handlePreviewClick,
  onTTSStateChange,
  appendSpeechBlocks
} from '@/speech/tts.js';
import { setSTTLocale } from '@/speech/stt.js';
import { getSettings, onSettingsChange } from '@/core/settings.js';
import { lineAtOffset, onContentChange } from '@/app/editor/editor.js';
import { setMessage, clearMessage } from '@/app/shell/status.js';
import { toggleNarration } from '@/app/preview/narration.js';
import { LARGE_DOC_CHARS, yieldToMainThread } from '@/core/schedule.js';

let renderTimer = null;
let lastReason = 'edited';
let pendingRender = null;
let currentRender = null;
let renderSequence = 0;
let lastRenderedText = null;
let renderCompleted = false;
let totalSourceLines = 1;
let editPatchTimer = null;
/** The render environment of the whole document, for fragment patches. */
let lastRenderEnv = {};

/** The blocks of the preview that carry a source line, in document order. */
let anchors = [];
let anchorsDirty = true;

/** The source line the reader was looking at before a re-render. */
let restoreSourceLine = null;

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
 * @param {'edited'|'replaced'|'translated'} [reason]
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
    renderNow(reason).catch((err) => console.error('Preview render failed:', err));
  }, delay);
}

/**
 * Runs any pending render immediately.
 *
 * @param {object} [options]
 * @param {boolean} [options.force] render even when the text did not change
 * @param {'edited'|'replaced'|'translated'} [options.reason] the reason to
 *   give the render; a setting change must not look like a new document
 * @returns {Promise<void>}
 */
export function flushRender({ force = false, reason = lastReason } = {}) {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  return renderNow(reason, { force });
}

/**
 * @returns {boolean} whether the preview already shows the current text
 */
export function isPreviewCurrent() {
  if (!el.preview || !el.previewWrapper) return false;
  return !currentRender && renderCompleted && lastRenderedText === el.editor.value;
}

/**
 * Waits until the preview has rendered at least through a source line.
 *
 * @param {number} line
 * @returns {Promise<void>}
 */
export function ensureRenderedThrough(line) {
  if (!currentRender && lastRenderedText === el.editor.value && anchors.length > 0) {
    return Promise.resolve();
  }

  if (!currentRender || currentRender.text !== el.editor.value) {
    renderNow(lastReason).catch((err) => console.error('Preview render failed:', err));
  }

  const job = currentRender;
  if (!job || job.renderedThrough >= line) return Promise.resolve();

  return new Promise((resolve) => {
    job.waiters.push({ line, resolve });
  });
}

/**
 * Renders the whole preview, even when a lazy job is already running.
 * @returns {Promise<void>}
 */
export function renderAll() {
  return flushRender({ force: false });
}

/**
 * @returns {boolean} whether the preview still has chunks to append
 */
export function isPreviewRendering() {
  if (!el.preview || !el.previewWrapper) return false;
  return Boolean(currentRender) || !renderCompleted;
}

/**
 * Stops a render job that is no longer wanted.
 */
function cancelRender() {
  if (!currentRender) return;
  const job = currentRender;
  job.cancelled = true;
  currentRender = null;
  job.waiters.forEach((waiter) => waiter.resolve());
  job.waiters = [];
}

/**
 * Resolves the callers waiting for a source line.
 *
 * @param {object} job
 * @param {boolean} [all] resolve the waiters whose line was never reached
 *   as well, so a request for a line past the end cannot hang.
 */
function resolveWaiters(job, all = false) {
  if (job.waiters.length === 0) return;

  const remaining = [];
  for (const waiter of job.waiters) {
    if (all || job.renderedThrough >= waiter.line) waiter.resolve();
    else remaining.push(waiter);
  }
  job.waiters = remaining;
}

/**
 * Renders the current document into the preview in balanced slices.
 *
 * @param {'edited'|'replaced'|'translated'} reason
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<void>}
 */
function renderNow(reason, { force = false } = {}) {
  const settings = getSettings();

  // When the user asked us not to interrupt narration, the DOM rewrite waits
  // until playback ends — otherwise the word highlight would point at a
  // document that is no longer on screen.
  if (isSpeaking() && !settings.autoStopOnReplace) {
    pendingRender = reason;
    return Promise.resolve();
  }

  const markdownText = el.editor.value;

  if (!force && currentRender && !currentRender.cancelled && currentRender.text === markdownText) {
    return currentRender.promise;
  }

  if (!force && !currentRender && lastRenderedText === markdownText) {
    return Promise.resolve();
  }

  if (reason === 'replaced') {
    // A new document starts at the top; the old article's ratio means
    // nothing here.
    restoreSourceLine = null;
    positionRestored = true;
    try {
      sessionStorage.removeItem(POSITION_KEY);
    } catch {
      /* storage unavailable */
    }
    el.previewWrapper.scrollTop = 0;
    el.editor.scrollTop = 0;
    el.lineNumbers.scrollTop = 0;
  } else if (positionRestored) {
    restoreSourceLine = getPreviewTopLine();
  }

  cancelRender();
  markTokensStale(reason);

  // The language belongs to the document, not to the last chunk of it: the
  // narrator may start as soon as the first block is on the page.
  const locale = detectLanguage(markdownText);
  setSTTLocale(locale);
  setDocumentLocale(locale);
  lastRenderEnv = {};

  const job = {
    id: renderSequence + 1,
    text: markdownText,
    reason,
    cancelled: false,
    renderedThrough: 0,
    waiters: [],
    promise: null
  };
  renderSequence = job.id;
  currentRender = job;

  el.preview.replaceChildren();
  anchors = [];
  anchorsDirty = true;
  renderCompleted = false;

  job.promise = (async () => {
    const { tokens, env } = parseMarkdownDocument(markdownText);
    const groups = groupMarkdownTokens(tokens);
    lastRenderEnv = env;
    totalSourceLines = markdownText ? markdownText.split('\n').length : 1;

    el.preview.dispatchEvent(
      new CustomEvent('preview:render-start', {
        detail: { groups: groups.length, chars: markdownText.length }
      })
    );

    let sliceStarted = performance.now();

    for (let index = 0; index < groups.length; index += 1) {
      if (job.cancelled || job.id !== renderSequence) return;

      const group = groups[index];
      const range = groupLineRange(group);
      const previousLast = el.preview.lastElementChild;
      const html = renderMarkdownGroup(group, env);

      if (job.cancelled || job.id !== renderSequence) return;

      if (html) el.preview.insertAdjacentHTML('beforeend', html);
      const added = [];
      let addedNode = previousLast ? previousLast.nextElementSibling : el.preview.firstElementChild;
      while (addedNode) {
        added.push(addedNode);
        addedNode = addedNode.nextElementSibling;
      }
      if (isSpeaking() || isSpeechPaused()) appendSpeechBlocks(added);
      const newBlocks = added.flatMap((node) =>
        node.matches?.('.mermaid-block') ? [node] : Array.from(node.querySelectorAll?.('.mermaid-block') || [])
      );
      if (newBlocks.length > 0) renderMermaidDiagrams(el.preview, newBlocks);

      job.renderedThrough = Math.max(job.renderedThrough, range.endLine);
      anchorsDirty = true;
      resolveWaiters(job);

      el.preview.dispatchEvent(
        new CustomEvent('preview:chunk', {
          detail: { ...range, index, groups: groups.length }
        })
      );

      // Rebuilding the anchor cache for every chunk turns a long re-render
      // into an O(n^2) walk. The saved line can only be reached once the
      // render has actually passed it.
      if (restoreSourceLine !== null && job.renderedThrough >= restoreSourceLine) {
        // The line has been rendered. If no anchor covers it (trailing blank
        // lines, for instance), it will never become reachable: stop trying.
        if (!tryRestoreSourceLine()) restoreSourceLine = null;
      }

      if (index < groups.length - 1) {
        const shouldBreak =
          performance.now() - sliceStarted > 8 ||
          (groups.length >= 40 && index % 8 === 7);
        if (shouldBreak) {
          sliceStarted = performance.now();
          await yieldToMainThread();
        }
      }
    }

    if (job.cancelled || job.id !== renderSequence) return;

    lastRenderedText = markdownText;
    renderCompleted = true;
    currentRender = null;
    anchorsDirty = true;
    rebuildAnchorCache();
    resolveWaiters(job, true);

    if (el.activeTokenInfo) {
      const estimate = Math.max(1, Math.ceil(markdownText.length / 6));
      el.activeTokenInfo.textContent = `~${estimate} words`;
    }

    if (restoreSourceLine !== null) {
      tryRestoreSourceLine();
      restoreSourceLine = null;
    } else if (!positionRestored) {
      setTimeout(restorePosition, 60);
    }

    el.preview.dispatchEvent(new CustomEvent('preview:rendered'));
  })();

  return job.promise.catch((err) => {
    if (job.cancelled) return;
    if (job.id === renderSequence) {
      currentRender = null;
      // Do not leave the app in "still rendering" forever. The preview is
      // incomplete, but a later flush is free to try again.
      renderCompleted = true;
      lastRenderedText = null;
    }
    console.error('Preview render failed:', err);
  });
}

/**
 * Re-renders the preview from scratch (used when a setting that affects the
 * rendered output changes).
 */
export function refreshPreview() {
  cancelRender();
  lastRenderedText = null;
  renderCompleted = false;
  // A settings change is not a new document: it must not throw the reader
  // back to the top (renderNow resets the position for 'replaced').
  flushRender({ force: true, reason: 'edited' });
}

/**
 * The offsets at which each source line starts.
 * @param {string} text
 * @returns {number[]}
 */
function sourceLineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

/**
 * Moves the source-line attributes of a rendered fragment to their place in
 * the whole document. A fragment parsed on its own starts at line 1; inserting
 * it as it is would make the outline, the scroll sync and the next translation
 * window point at the wrong block.
 *
 * @param {HTMLElement} holder
 * @param {number} lineOffset zero-based offset of the fragment's first line
 */
function rebaseSourceLines(holder, lineOffset) {
  if (!holder || lineOffset === 0) return;

  holder.querySelectorAll('[data-line]').forEach((node) => {
    const line = Number(node.dataset.line);
    if (Number.isFinite(line) && line > 0) {
      node.dataset.line = String(line + lineOffset);
    }

    const end = Number(node.dataset.lineEnd);
    if (Number.isFinite(end) && end > 0) {
      node.dataset.lineEnd = String(end + lineOffset);
    }
  });
}

/**
 * The top-level element that represents an anchor in the preview.
 *
 * A fenced code block is anchored to the inner `<code>` (that is where
 * markdown-it writes the attributes), but the block the reader sees is the
 * whole `.code-block` panel. Replacing the inner element would leave the
 * header and the gutter behind and nest a second panel inside the first.
 *
 * @param {HTMLElement} node
 * @returns {HTMLElement}
 */
function anchorTarget(node) {
  if (node.matches('code[data-line]')) {
    const block = node.closest('.code-block');
    if (block && el.preview.contains(block)) return block;
  }
  return node;
}

/**
 * Re-renders only the blocks that overlap a changed source line range.
 *
 * Translation writes one visible window at a time. Replacing the whole
 * preview for every window would throw away the reader's position and walk
 * the rest of the book again; this keeps every untouched block exactly as it
 * is.
 *
 * @param {number} startLine
 * @param {number} endLine
 * @returns {boolean} whether the preview was patched
 */
export function patchPreviewLines(startLine, endLine) {
  if (!el.preview || !el.previewWrapper) return false;
  if (!renderCompleted || !lastRenderedText) {
    scheduleRender('translated');
    return false;
  }

  const text = el.editor.value;
  const starts = sourceLineStarts(text);
  if (starts.length !== totalSourceLines) {
    lastRenderedText = null;
    renderCompleted = false;
    scheduleRender('translated');
    return false;
  }

  const list = getAnchors();
  const affected = list.filter(
    (anchor) => anchor.line <= endLine && anchor.endLine >= startLine
  );

  if (affected.length === 0) {
    // The fallback render must not be mistaken for a finished one: a later
    // patch would set lastRenderedText and cancel it.
    lastRenderedText = null;
    renderCompleted = false;
    scheduleRender('translated');
    return false;
  }

  markTokensStale('content-edited');

  let patched = false;

  for (const anchor of [...affected].reverse()) {
    if (anchor.el.closest('.footnotes') || anchor.el.matches('.footnotes, .footnotes-sep')) {
      lastRenderedText = null;
      renderCompleted = false;
      scheduleRender('translated');
      return false;
    }

    const from = starts[anchor.line - 1] ?? 0;
    const to = anchor.endLine < starts.length ? starts[anchor.endLine] : text.length;
    const fragment = text.slice(from, to);

    // A footnote reference needs the footnote definitions from the rest of
    // the document; a group parsed on its own would lose the link.
    if (/\[\^[^\]\s]+\]/.test(fragment)) {
      lastRenderedText = null;
      renderCompleted = false;
      scheduleRender('translated');
      return false;
    }

    // Reference-style links are defined elsewhere in the document too. The
    // environment of the last full parse carries them, so a fragment does
    // not turn `[text][ref]` into literal text.
    const baseEnv = lastRenderEnv || {};
    const env = {
      ...baseEnv,
      references: { ...(baseEnv.references || {}) }
    };
    const { tokens, env: parsedEnv } = parseMarkdownDocument(fragment, env);
    const groups = groupMarkdownTokens(tokens);

    const holder = document.createElement('div');
    for (const group of groups) {
      holder.insertAdjacentHTML('beforeend', renderMarkdownGroup(group, parsedEnv));
    }

    rebaseSourceLines(holder, anchor.line - 1);

    const target = anchorTarget(anchor.el);
    const oldHeading = /^H[1-6]$/.test(target.tagName) ? target.id : '';
    const newHeading = holder.querySelector('h1, h2, h3, h4, h5, h6');
    if (oldHeading && newHeading) {
      newHeading.id = oldHeading;
      const permalink = newHeading.querySelector('.heading-anchor');
      if (permalink) permalink.setAttribute('href', `#${oldHeading}`);
    }

    const newBlocks = Array.from(holder.children);
    const diagrams = newBlocks.flatMap((node) =>
      node.matches?.('.mermaid-block') ? [node] : Array.from(node.querySelectorAll?.('.mermaid-block') || [])
    );

    target.replaceWith(...newBlocks);
    if (diagrams.length > 0) renderMermaidDiagrams(el.preview, diagrams);
    patched = true;
  }

  lastRenderedText = text;
  renderCompleted = true;
  anchorsDirty = true;
  rebuildAnchorCache();

  if (el.activeTokenInfo) {
    const estimate = Math.max(1, Math.ceil(text.length / 6));
    el.activeTokenInfo.textContent = `~${estimate} words`;
  }

  el.preview.dispatchEvent(new CustomEvent('preview:rendered'));
  return patched;
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
 * Rebuilds the anchor cache after new blocks were added or replaced.
 */
function rebuildAnchorCache() {
  if (!anchorsDirty) return;

  const elements = Array.from(el.preview.querySelectorAll('[data-line]'));

  anchors = elements.map((node, index) => {
    const line = Number(node.dataset.line) || 1;
    const next = elements[index + 1];
    const declaredEnd = Number(node.dataset.lineEnd);
    const end = Number.isFinite(declaredEnd) && declaredEnd > 0
      ? declaredEnd
      : next
        ? Number(next.dataset.line) - 1
        : totalSourceLines;

    return {
      el: node,
      line,
      endLine: Math.max(line, end),
      lines: Math.max(1, end - line + 1)
    };
  });

  anchorsDirty = false;
}

/**
 * The preview blocks that carry a source line, in document order.
 *
 * @returns {Array<{ el: HTMLElement, line: number, endLine: number, lines: number }>}
 */
function getAnchors() {
  rebuildAnchorCache();
  return anchors;
}

/**
 * Finds the anchor covering a vertical position in the preview.
 *
 * @param {number} y
 * @returns {{ index: number, block: object|null, line: number }}
 */
function anchorAtY(y) {
  const list = getAnchors();
  if (list.length === 0) return { index: -1, block: null, line: 1 };

  let low = 0;
  let high = list.length - 1;
  let index = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle].el.offsetTop <= y) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const block = list[index];
  const height = block.el.offsetHeight || 1;
  const within = Math.min(1, Math.max(0, (y - block.el.offsetTop) / height));
  const line = Math.min(
    block.endLine,
    block.line + Math.floor(within * Math.max(1, block.lines))
  );

  return { index, block, line };
}

/**
 * The source line currently at the top of the preview.
 * @returns {number}
 */
function getPreviewTopLine() {
  return anchorAtY(el.previewWrapper.scrollTop + 8).line;
}

/**
 * The source line range currently visible.
 *
 * @returns {{ startLine: number, endLine: number, topBlock: object|null, bottomBlock: object|null }}
 */
export function getVisibleSourceRange() {
  if (!el.preview || !el.previewWrapper) {
    return { startLine: 1, endLine: 1, topBlock: null, bottomBlock: null };
  }

  const list = getAnchors();
  if (list.length === 0) {
    return { startLine: 1, endLine: 1, topBlock: null, bottomBlock: null };
  }

  const top = anchorAtY(el.previewWrapper.scrollTop + 8);
  const bottomY = el.previewWrapper.scrollTop + el.previewWrapper.clientHeight;
  const bottom = anchorAtY(bottomY);

  return {
    startLine: top.line,
    endLine: Math.max(top.line, bottom.line),
    topBlock: top.block,
    bottomBlock: bottom.block
  };
}

/**
 * The height of one editor line in pixels.
 * @returns {number}
 */
function getEditorLineHeight() {
  const lineHeight = Number.parseFloat(getComputedStyle(el.editor).lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
  const total = totalSourceLines;
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
 * @returns {boolean} whether the line could be reached
 */
function scrollPreviewToLine(line) {
  const list = getAnchors();
  if (list.length === 0) return false;

  let low = 0;
  let high = list.length - 1;
  let index = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle].line <= line) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const block = list[index];
  if (line > block.endLine && index === list.length - 1) return false;

  const blockTop = block.el.offsetTop;
  const blockHeight = block.el.offsetHeight || 1;

  // How far into the block the requested line sits, measured in source lines.
  const within = Math.min(1, Math.max(0, (line - block.line) / block.lines));
  const offset = within * blockHeight;

  scrollPane(el.previewWrapper, 'preview', Math.max(0, blockTop + offset - 16));
  return true;
}

/**
 * Scrolls the preview to a source line (used by the outline).
 * @param {number} line
 */
export function jumpToLine(line) {
  el.preview.dispatchEvent(new CustomEvent('preview:user-navigation'));

  if (currentRender && currentRender.renderedThrough < line) {
    ensureRenderedThrough(line)
      .then(() => scrollPreviewToLine(line))
      .catch((err) => console.error('Could not reach the line:', err));
    return;
  }

  if (!scrollPreviewToLine(line) && currentRender) {
    ensureRenderedThrough(line)
      .then(() => scrollPreviewToLine(line))
      .catch((err) => console.error('Could not reach the line:', err));
  }
}

/**
 * Re-applies the source line the reader was looking at while chunks arrive.
 * @returns {boolean} whether the line could be reached
 */
function tryRestoreSourceLine() {
  if (restoreSourceLine === null) return false;

  if (scrollPreviewToLine(restoreSourceLine)) {
    restoreSourceLine = null;
    return true;
  }

  return false;
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
 * Reads the reading position of this tab, falling back to the position the
 * app kept before positions were per tab.
 * @returns {string|null}
 */
function readPosition() {
  try {
    const own = sessionStorage.getItem(POSITION_KEY);
    if (own !== null) return own;
  } catch {
    /* storage unavailable */
  }

  try {
    return localStorage.getItem(POSITION_KEY);
  } catch {
    return null;
  }
}

/**
 * Moves the reading position into this tab's storage, from either the shared
 * key or the key it had before the rename.
 */
function adoptLegacyPosition() {
  try {
    if (sessionStorage.getItem(POSITION_KEY) !== null) return;

    const shared = localStorage.getItem(POSITION_KEY);
    const legacy = localStorage.getItem(LEGACY_POSITION_KEY);
    const value = shared || legacy;
    if (!value) return;

    sessionStorage.setItem(POSITION_KEY, value);
    localStorage.removeItem(POSITION_KEY);
    localStorage.removeItem(LEGACY_POSITION_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Stores the current reading position for this tab only: two tabs can show
 * two different documents, and neither should drag the other's view.
 */
function savePosition() {
  if (!getSettings().rememberPosition) return;
  const max = el.previewWrapper.scrollHeight - el.previewWrapper.clientHeight;
  if (max <= 0) return;
  try {
    sessionStorage.setItem(POSITION_KEY, (el.previewWrapper.scrollTop / max).toFixed(4));
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
  if (!renderCompleted) return;

  let ratio = 0;
  try {
    ratio = Number.parseFloat(readPosition() || '0');
  } catch {
    ratio = 0;
  }
  if (!Number.isFinite(ratio) || ratio <= 0) {
    positionRestored = true;
    return;
  }

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

/**
 * Saves the position right away. The tab can be hidden or closed before the
 * debounce has run, and the reader would then come back to the wrong place.
 */
function flushPosition() {
  if (positionTimer) {
    clearTimeout(positionTimer);
    positionTimer = null;
  }
  savePosition();
}

/**
 * Forgets the reading position of this tab. A tab that opens empty must not
 * jump to the place another article was left at.
 */
export function forgetTabPosition() {
  if (positionTimer) {
    clearTimeout(positionTimer);
    positionTimer = null;
  }
  positionRestored = false;
  try {
    sessionStorage.removeItem(POSITION_KEY);
  } catch {
    /* storage unavailable */
  }
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
    const target = el.preview.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`);
    if (!target) return;
    el.preview.dispatchEvent(new CustomEvent('preview:user-navigation'));
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

  onContentChange(({ reason, editOffset }) => {
    // Translation patches the affected blocks itself after it has written
    // the source; a full render here would defeat the lazy path.
    if (reason === 'translated') return;

    if (reason === 'replaced' && editPatchTimer) {
      clearTimeout(editPatchTimer);
      editPatchTimer = null;
    }

    if (
      reason === 'edited' &&
      Number.isFinite(editOffset) &&
      el.editor.value.length >= LARGE_DOC_CHARS &&
      (!isSpeaking() || getSettings().autoStopOnReplace)
    ) {
      if (editPatchTimer) clearTimeout(editPatchTimer);
      editPatchTimer = setTimeout(() => {
        editPatchTimer = null;

        if (el.editor.value.length < LARGE_DOC_CHARS) {
          scheduleRender('edited');
          return;
        }

        // The line is worked out here, not in the input event: walking a
        // book-sized document on every keystroke would make typing lag.
        const editLine = lineAtOffset(el.editor.value, editOffset);
        if (!patchPreviewLines(editLine - 2, editLine + 2)) scheduleRender('edited');
      }, 120);
      return;
    }

    scheduleRender(reason);
  });

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

  // Keep the last position even if the tab is closed or hidden before the
  // debounce has run.
  window.addEventListener('pagehide', flushPosition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPosition();
  });

  // A diagram that finished drawing adds words to the document — the word
  // count and the narration can learn them when they are next needed.
  el.preview.addEventListener('preview:diagram-rendered', () => {
    // Tokenization is now windowed; nothing is precomputed while idle.
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
