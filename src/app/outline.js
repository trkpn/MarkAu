/**
 * ============================================================================
 * DOCUMENT OUTLINE (TABLE OF CONTENTS)
 * ============================================================================
 * A floating panel with the document's headings. Clicking a heading jumps the
 * preview to it and starts reading from there.
 *
 * The outline is built from the `data-line` anchors the Markdown renderer
 * already produces, so no second parse is needed.
 * ============================================================================
 */

import { el } from './dom.js';
import { speakFromElement } from '../tts-engine.js';
import { jumpToLine } from './preview.js';
import { setMessage } from './status.js';

const HEADING_TAGS = ['H1', 'H2', 'H3'];

/** The headings of the current document. */
let headings = [];
let rebuildTimer = null;

/**
 * Reads the headings out of the rendered preview.
 * @returns {Array<{ el: HTMLElement, line: number, level: number, text: string }>}
 */
function readHeadings() {
  const nodes = Array.from(el.preview.querySelectorAll('[data-line]'));
  return nodes
    .filter((node) => HEADING_TAGS.includes(node.tagName))
    .map((node) => ({
      el: node,
      line: Number(node.dataset.line) || 1,
      level: Number(node.tagName.slice(1)),
      text: node.textContent.trim() || 'Untitled'
    }));
}

/**
 * Renders the outline list.
 */
function renderOutline() {
  const list = el.outlineList;
  if (!list) return;

  list.innerHTML = '';

  if (headings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'outline-empty';
    empty.textContent = 'No headings in this document.';
    list.appendChild(empty);
    return;
  }

  for (const heading of headings) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'outline-item';
    item.dataset.level = String(heading.level);
    item.textContent = heading.text;
    item.title = heading.text;
    item.addEventListener('click', () => {
      jumpToLine(heading.line);
      closeOutline();
      if (!speakFromElement(heading.el)) {
        setMessage(`Jumped to "${heading.text}"`, { tone: 'accent', ttl: 2000 });
      }
    });
    list.appendChild(item);
  }
}

/**
 * Rebuilds the outline after the document changed.
 */
export function rebuildOutline() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    headings = readHeadings();
    renderOutline();
    updateBreadcrumb();
  }, 250);
}

/**
 * Opens the outline panel.
 */
function openOutline() {
  if (!el.outlinePanel) return;
  el.outlinePanel.hidden = false;
  el.outlineToggle?.setAttribute('aria-expanded', 'true');
}

/**
 * Closes the outline panel.
 */
function closeOutline() {
  if (!el.outlinePanel) return;
  el.outlinePanel.hidden = true;
  el.outlineToggle?.setAttribute('aria-expanded', 'false');
}

/**
 * Toggles the outline panel.
 */
function toggleOutline() {
  if (el.outlinePanel?.hidden) openOutline();
  else closeOutline();
}

/**
 * The heading the preview is currently showing.
 *
 * The live DOM is queried on purpose: the preview is re-rendered whenever the
 * document changes, which replaces the heading elements. A cached list would
 * point at detached nodes and report the wrong section.
 *
 * @returns {object|null}
 */
function currentHeading() {
  const nodes = Array.from(el.preview.querySelectorAll('[data-line]')).filter((node) =>
    HEADING_TAGS.includes(node.tagName)
  );
  if (nodes.length === 0) return null;

  const scrollerTop = el.previewWrapper.scrollTop;
  let current = nodes[0];
  for (const node of nodes) {
    if (node.offsetTop <= scrollerTop + 24) current = node;
    else break;
  }
  return { el: current, text: current.textContent.trim() };
}

/**
 * Shows the current heading in the header breadcrumb.
 */
function updateBreadcrumb() {
  const breadcrumb = el.breadcrumb;
  if (!breadcrumb) return;

  const heading = currentHeading();
  if (!heading) {
    breadcrumb.textContent = '';
    breadcrumb.hidden = true;
    return;
  }

  breadcrumb.hidden = false;
  breadcrumb.textContent = heading.text;
  breadcrumb.title = heading.text;
}

/**
 * Initializes the outline panel and the breadcrumb.
 */
export function initOutline() {
  el.outlineToggle?.addEventListener('click', toggleOutline);
  el.outlineClose?.addEventListener('click', closeOutline);

  // Clicking outside the panel closes it
  el.outlinePanel?.addEventListener('click', (event) => {
    if (event.target === el.outlinePanel) closeOutline();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && el.outlinePanel && !el.outlinePanel.hidden) {
      closeOutline();
    }
  });

  el.previewWrapper?.addEventListener('scroll', updateBreadcrumb, { passive: true });

  // The preview replaces its content on every render, so the heading list
  // has to be rebuilt from the fresh DOM.
  el.preview?.addEventListener('preview:rendered', rebuildOutline);

  rebuildOutline();
}
