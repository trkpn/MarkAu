/**
 * ============================================================================
 * THE NAME OF THE TAB
 * ============================================================================
 * A browser tab shows the document's name, not the app's name - that is what
 * makes several tabs usable: the tab strip becomes the list of open
 * documents. The first heading is the name; a title in the front matter, or
 * the first line of a document without headings, is the fallback.
 *
 * The tab that is reading says so: a play mark in front of the name and a
 * green dot on the favicon. With two or three tabs open, the one that is
 * speaking is the one that looks different.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { onContentChange } from '@/app/editor/editor.js';
import { onTTSStateChange } from '@/speech/tts.js';
import { parseFrontmatter } from '@/core/frontmatter.js';

const APP_NAME = 'MarkAu';
const MAX_TITLE_LENGTH = 60;
const REFRESH_DELAY_MS = 300;

/** The name the document gives itself, without the reading marker. */
let documentName = APP_NAME;
/** Whether this tab is the one narrating right now. */
let reading = false;
let refreshTimer = null;

/**
 * Cleans the Markdown out of a heading or a line of text.
 * @param {string} text
 * @returns {string}
 */
function cleanInline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)([^*_]+)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shortens a name to what a tab can show.
 * @param {string} text
 * @returns {string}
 */
function fit(text) {
  if (text.length <= MAX_TITLE_LENGTH) return text;
  return `${text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * Reads the name of the document: front matter, then the first heading, then
 * the first line that is not a fence.
 * @param {string} markdown
 * @returns {string} the name, or an empty string when the document has none
 */
export function titleFromMarkdown(markdown) {
  const { data, body } = parseFrontmatter(markdown || '');

  if (data.title) {
    const fromFrontMatter = cleanInline(data.title);
    if (fromFrontMatter) return fit(fromFrontMatter);
  }

  const lines = body.split(/\r?\n/);
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^\s{0,3}#{1,6}[ \t]+(.+?)\s*#*\s*$/);
    if (!heading) continue;

    const text = cleanInline(heading[1]);
    if (text) return fit(text);
  }

  inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const text = cleanInline(
      line
        .trim()
        .replace(/^>\s*/, '')
        .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    );
    if (text) return fit(text);
  }

  return '';
}

/**
 * The title of the tab, with the reading marker when this tab is speaking.
 * @param {string} base
 * @param {boolean} isReading
 * @returns {string}
 */
export function composeTabTitle(base, isReading) {
  const name = base || APP_NAME;
  const marker = isReading ? '▶ ' : '';
  if (name === APP_NAME) return `${marker}${APP_NAME}`;
  return `${marker}${name} — ${APP_NAME}`;
}

/**
 * A small favicon drawn by the app itself: three sound bars, and a green dot
 * while this tab is reading.
 * @param {boolean} isReading
 * @returns {string} a data URI
 */
function favicon(isReading) {
  const dot = isReading
    ? '<circle cx="24.5" cy="24.5" r="7" fill="#22c55e" stroke="#0b1220" stroke-width="2.5"/>'
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="8" fill="#2563eb"/>` +
    `<g fill="#ffffff">` +
    `<rect x="8" y="13" width="3" height="7" rx="1.5"/>` +
    `<rect x="14.5" y="9" width="3" height="15" rx="1.5"/>` +
    `<rect x="21" y="12" width="3" height="9" rx="1.5"/>` +
    `</g>${dot}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Sets the favicon link, creating it when the page has none.
 * @param {boolean} isReading
 */
function applyFavicon(isReading) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    link.setAttribute('type', 'image/svg+xml');
    document.head.appendChild(link);
  }
  link.setAttribute('href', favicon(isReading));
}

/**
 * Writes the current name and marker into the tab.
 */
function renderTitle() {
  const next = composeTabTitle(documentName, reading);
  if (document.title !== next) document.title = next;
  applyFavicon(reading);
}

/**
 * Re-reads the name of the document from the editor.
 */
export function refreshDocumentTitle() {
  const markdown = el.editor?.value ?? '';
  const named = titleFromMarkdown(markdown);
  // An empty tab says what it is; a document that is only pictures keeps the
  // app name, because it has no words to be named after.
  const next = named || (markdown.trim() ? APP_NAME : 'New document');
  if (next !== documentName) {
    documentName = next;
    renderTitle();
  }
}

/**
 * Schedules a refresh for after the typing stops.
 */
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshDocumentTitle();
  }, REFRESH_DELAY_MS);
}

/**
 * Starts following the document and the narration.
 */
export function initDocumentTitle() {
  refreshDocumentTitle();
  renderTitle();

  onContentChange(() => scheduleRefresh());
  onTTSStateChange(({ isPlaying, isPaused }) => {
    const next = Boolean(isPlaying) && !isPaused;
    if (next === reading) return;
    reading = next;
    renderTitle();
  });
}
