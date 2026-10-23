/**
 * ============================================================================
 * PRINTING
 * ============================================================================
 *
 * The browser's print dialog is the app's PDF exporter: it prints the
 * *rendered* document — diagrams, callouts and footnotes included — not the
 * Markdown source.
 *
 * The print stylesheet (see `style.css`) hides the application chrome and
 * prints the preview alone, in ink-friendly colours.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { getDocumentMeta } from '@/markdown/parser.js';
import { flushRender } from '@/app/preview/preview.js';

/** The name of the app — the fallback title of a printed document. */
const APP_TITLE = 'MarkAu';

/**
 * The title of the document: the front matter, the first heading, or the
 * name of the app.
 * @returns {string}
 */
export function getDocumentTitle() {
  const meta = getDocumentMeta(el.editor.value);
  if (meta.title) return meta.title;

  const heading = el.editor.value.split('\n').find((line) => line.startsWith('# '));
  return heading ? heading.slice(2).trim() : APP_TITLE;
}

/**
 * Prints the current document.
 */
export async function printDocument() {
  // The preview has to be current, or the printout shows an older version.
  await flushRender();

  const previous = document.title;
  const title = getDocumentTitle();
  if (title) document.title = title;

  const restore = () => {
    document.title = previous;
  };

  window.addEventListener('afterprint', restore, { once: true });
  window.print();

  // Not every browser fires `afterprint` — the title has to come back
  // either way.
  setTimeout(restore, 2000);
}
