/**
 * ============================================================================
 * DRAG AND DROP
 * Something can be dropped on the app, and the app knows what to do with it:
 *
 *   • a file of text  → it is opened, the way the file button opens one
 *   • an address      → it is imported, the way the import button imports one
 *   • a piece of text → it lands in the document, the way a paste does
 *
 * The last one is what a drag of a selection inside the editor is, and the
 * browser handles that on its own — so the app keeps its hands off a drag
 * that begins inside the editor.
 *
 * While something is held over the app, a panel says what will happen.
 * ============================================================================
 */

import { el } from './dom.js';
import { openFile, insertText, setMarkdown } from './editor.js';
import { isEditorHidden } from './paste.js';
import { runImport } from './url-import.js';
import { setMessage } from './status.js';

/** How many levels of the page the pointer has entered. */
let dragDepth = 0;

/**
 * The kinds of thing that can be dropped.
 */
export const DROP_KIND = {
  FILE: 'file',
  URL: 'url',
  TEXT: 'text',
  NONE: 'none'
};

/**
 * Tells what is being held over the app.
 *
 * While the pointer moves, the content of the drag cannot be read — only
 * the kinds of it can. That is enough: a file is a file, and a link is a
 * link.
 *
 * @param {DataTransfer|null} dataTransfer
 * @returns {string} one of DROP_KIND
 */
export function kindOfDrag(dataTransfer) {
  const types = dataTransfer ? Array.from(dataTransfer.types || []) : [];

  if (types.includes('Files')) return DROP_KIND.FILE;
  if (types.includes('text/uri-list')) return DROP_KIND.URL;
  if (types.includes('text/plain')) return DROP_KIND.TEXT;
  return DROP_KIND.NONE;
}

/**
 * Reads the address out of what is dropped.
 *
 * @param {DataTransfer|null} dataTransfer
 * @returns {string} the address, or an empty string
 */
export function urlOfDrag(dataTransfer) {
  if (!dataTransfer) return '';

  const list = dataTransfer.getData('text/uri-list');
  if (list) {
    // The list may hold more than one address, and comments start with a
    // number sign.
    const first = list
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#'));
    if (first) return first;
  }

  const text = (dataTransfer.getData('text/plain') || '').trim();
  if (/^(https?:\/\/|www\.)\S+$/i.test(text)) return text;

  return '';
}

/**
 * Tells whether a file is one the app can open.
 *
 * @param {File} file
 * @returns {boolean}
 */
export function isTextFile(file) {
  if (!file) return false;
  if (file.type && /^(text\/|application\/(json|xml|xhtml))/.test(file.type)) return true;
  return /\.(md|markdown|mdown|txt|text)$/i.test(file.name || '');
}

/**
 * Shows the panel that says what will happen.
 * @param {string} kind
 */
function showOverlay(kind) {
  if (!el.dropOverlay) return;

  const messages = {
    [DROP_KIND.FILE]: 'Drop to open the file',
    [DROP_KIND.URL]: 'Drop to import the address',
    [DROP_KIND.TEXT]: 'Drop to put the text into the document'
  };

  if (el.dropOverlayText) {
    el.dropOverlayText.textContent = messages[kind] || 'Drop here';
  }
  el.dropOverlay.removeAttribute('hidden');
}

/**
 * Hides the panel again.
 */
function hideOverlay() {
  el.dropOverlay?.setAttribute('hidden', '');
}

/**
 * Handles what was dropped.
 *
 * @param {DataTransfer|null} dataTransfer
 * @returns {Promise<void>}
 */
export async function handleDrop(dataTransfer) {
  const files = dataTransfer?.files;

  if (files && files.length > 0) {
    const file = files[0];

    // A PDF or a book is read, not opened as text.
    if (isDocumentFile(file)) {
      await readDroppedDocument(file);
      return;
    }

    if (!isTextFile(file)) {
      setMessage('Only text files, PDFs and books can be opened here', {
        tone: 'warn',
        ttl: 3000
      });
      return;
    }

    openFile(file);
    return;
  }

  const url = urlOfDrag(dataTransfer);
  if (url) {
    await runImport(url);
    return;
  }

  const text = (dataTransfer?.getData('text/plain') || '').trim();
  if (text) {
    // The rule of the app: what the user can see decides what happens. In
    // Preview the editor is hidden, so there is no caret to aim at and
    // the text becomes the document.
    const replaceDocument = isEditorHidden();
    insertText(text, { replaceDocument });
    setMessage(
      `Dropped ${text.length.toLocaleString()} characters${
        replaceDocument ? '' : ' (at the cursor)'
      }`,
      { tone: 'accent', ttl: 2500 }
    );
  }
}

/**
 * Tells whether a file is a document the app can read — a PDF or a book.
 *
 * @param {File} file
 * @returns {boolean}
 */
export function isDocumentFile(file) {
  if (!file) return false;
  if (file.type === 'application/pdf' || file.type === 'application/epub+zip') return true;
  return /\.(pdf|epub)$/i.test(file.name || '');
}

/**
 * Reads a document that was dropped on the app.
 *
 * The file is already here, so it does not have to be fetched from
 * anywhere.
 *
 * @param {File} file
 * @returns {Promise<void>}
 */
async function readDroppedDocument(file) {
  setMessage('Reading…', { tone: 'muted' });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name || 'document';

    let markdown = '';
    let title = name;
    let note = 'document';

    if (/\.pdf$/i.test(name)) {
      const { pdfToMarkdown, buildPdfDocument } = await import('../pdf-to-markdown.js');
      const pdf = await pdfToMarkdown(bytes, { url: name });
      markdown = buildPdfDocument(pdf, '');
      title = pdf.title || name;
      note = `PDF (${pdf.pages} pages)`;
    } else if (/\.epub$/i.test(name)) {
      const { epubToMarkdown } = await import('../epub-to-markdown.js');
      const { htmlToMarkdownFragment } = await import('../html-to-markdown.js');
      const book = await epubToMarkdown(bytes, {
        url: name,
        toMarkdown: (html, baseUrl) => htmlToMarkdownFragment(html, baseUrl)
      });
      markdown = book.markdown;
      title = book.title || name;
      note = `book (${book.chapters} chapters)`;
    }

    setMarkdown(markdown, 'replaced');
    setMessage(`Read ${note} — ${title}`, { tone: 'accent', ttl: 3500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'That document could not be read.';
    setMessage(message, { tone: 'warn', ttl: 4000 });
  }
}

/**
 * True when the drag began inside the editor — a selection of the text of
 * the document, which the browser puts back on its own.
 *
 * @param {Event} event
 * @returns {boolean}
 */
function beganInEditor(event) {
  const target = event.target;
  return Boolean(target && target.closest && target.closest('#editor'));
}

/**
 * Initializes the drop handling.
 */
export function initDragDrop() {
  const root = document.body;
  if (!root) return;

  root.addEventListener('dragenter', (event) => {
    const kind = kindOfDrag(event.dataTransfer);
    if (kind === DROP_KIND.NONE) return;

    event.preventDefault();
    dragDepth += 1;
    showOverlay(kind);
  });

  root.addEventListener('dragover', (event) => {
    const kind = kindOfDrag(event.dataTransfer);
    if (kind === DROP_KIND.NONE) return;

    // Without this the browser opens the address that is dropped.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });

  root.addEventListener('dragleave', (event) => {
    if (kindOfDrag(event.dataTransfer) === DROP_KIND.NONE) return;

    dragDepth = Math.max(0, dragDepth - 1);

    // When the pointer leaves the window, the coordinates leave with it.
    // The panel has to go then, or it stays over the app for good.
    const outside =
      event.clientX <= 0 ||
      event.clientY <= 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight;

    if (outside || dragDepth === 0) {
      dragDepth = 0;
      hideOverlay();
    }
  });

  // A drag that began in this app ends here — and the panel has to go
  // with it, wherever the pointer was let go.
  document.addEventListener('dragend', () => {
    dragDepth = 0;
    hideOverlay();
  });

  root.addEventListener('drop', async (event) => {
    const kind = kindOfDrag(event.dataTransfer);
    if (kind === DROP_KIND.NONE) return;

    // A drag of the text of the document belongs to the browser.
    if (beganInEditor(event) && kind === DROP_KIND.TEXT) return;

    event.preventDefault();
    dragDepth = 0;
    hideOverlay();
    await handleDrop(event.dataTransfer);
  });
}
