/**
 * ============================================================================
 * PDF
 * Turns a PDF into a document.
 *
 * A PDF holds the text of a page, but it holds it as a drawing: letters
 * placed at coordinates. The reader of the browser (pdf.js, the one the
 * viewers of every browser use) knows how to pick the letters out of that
 * drawing again.
 *
 * What comes out is the prose of the document. What does not come out are
 * the formulas — they are drawings too, and there is no text to pick up.
 * A document that was written in LaTeX therefore reads well as prose and
 * has holes where its equations were.
 *
 * The reader is loaded on demand: a document that is never imported never
 * pays for it.
 * ============================================================================
 */

/**
 * The reader of PDFs, loaded once.
 * @type {Promise<object>|null}
 */
let pdfjsPromise = null;

/**
 * Loads the reader.
 *
 * @returns {Promise<object>} the library
 */
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      // The work of reading a PDF happens in a worker of its own, so that a
      // long document does not freeze the interface.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url
      ).href;

      return pdfjs;
    });
  }

  return pdfjsPromise;
}

/**
 * Turns the bytes of a PDF into a document.
 *
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {string} [options.url] where the PDF came from
 * @param {number} [options.maxPages] how many pages to read
 * @returns {Promise<{ markdown: string, title: string, pages: number }>}
 */
export async function pdfToMarkdown(bytes, { url = '', maxPages = 0 } = {}) {
  const pdfjs = await loadPdfjs();

  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = document.numPages;
  const limit = maxPages > 0 ? Math.min(pages, maxPages) : pages;

  const info = await document.getMetadata().catch(() => null);
  const title =
    (info?.info?.Title || '').trim() ||
    (info?.metadata?.title || '').trim() ||
    nameFromUrl(url);

  const lines = [];
  const texts = [];

  for (let page = 1; page <= limit; page += 1) {
    const one = await document.getPage(page);
    const content = await one.getTextContent();

    const text = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) texts.push(text);
    lines.push(`## Page ${page}`, '', text, '');
  }

  return {
    markdown: lines.join('\n').trim(),
    title,
    pages
  };
}

/**
 * Builds the document of a PDF.
 *
 * @param {{ markdown: string, title: string, pages: number }} pdf
 * @param {string} [sourceUrl]
 * @returns {string}
 */
export function buildPdfDocument(pdf, sourceUrl = '') {
  const lines = [];

  const title = pdf.title || 'PDF document';
  lines.push(`# ${title}`);
  lines.push('');

  const facts = [];
  if (pdf.pages) facts.push(`**Pages:** ${pdf.pages}`);
  if (sourceUrl) facts.push(`**Source:** ${sourceUrl}`);
  if (facts.length > 0) {
    lines.push(facts.join('  \n'));
    lines.push('');
  }

  lines.push(
    '_The text of the document was taken out of the pages. The formulas of a document are drawings, and there is no text in them to take._'
  );
  lines.push('');

  lines.push(pdf.markdown);

  return lines.join('\n').trim();
}

/**
 * The name of a file, taken from its address.
 *
 * @param {string} url
 * @returns {string}
 */
function nameFromUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';

  try {
    const { pathname } = new URL(value);
    const name = pathname.split('/').filter(Boolean).pop() || '';
    return name.replace(/\.pdf$/i, '');
  } catch {
    // Not an address — a file that was dropped, most likely.
    return value.replace(/\.pdf$/i, '');
  }
}

/**
 * Turns base64 into bytes.
 *
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function fromBase64(base64) {
  const binary = atob(String(base64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
