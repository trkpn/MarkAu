/**
 * ============================================================================
 * DOCUMENT FILES
 * Reads the files that are not Markdown: a PDF, a book in EPUB form and a
 * Word document.
 *
 * The drop handler and the file picker both come through here, so a file
 * behaves the same way however it was opened.
 * ============================================================================
 */

/**
 * Tells whether a file is a document the app can read — a PDF, a book in
 * EPUB form or a Word document.
 *
 * @param {File} file
 * @returns {boolean}
 */
export function isDocumentFile(file) {
  if (!file) return false;

  const type = String(file.type || '').toLowerCase();
  if (type === 'application/pdf' || type === 'application/epub+zip') return true;
  if (/wordprocessingml/.test(type)) return true;

  return /\.(pdf|epub|docx)$/i.test(file.name || '');
}

/**
 * Reads a file as bytes, yielding between chunks when the browser exposes a
 * stream.
 *
 * @param {File} file
 * @param {object} [options]
 * @param {(progress: { phase: string, done: number, total: number }) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Uint8Array>}
 */
async function readFileBytes(file, { onProgress, signal } = {}) {
  if (!file.stream || typeof file.stream !== 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }

  const reader = file.stream().getReader();
  const total = Number(file.size) || 0;
  const chunks = [];
  let received = 0;

  while (true) {
    if (signal?.aborted) {
      const error = new Error('The work was stopped.');
      error.name = 'AbortError';
      throw error;
    }

    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.({ phase: 'reading file', done: received, total });
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

/**
 * Reads a document file and turns it into Markdown.
 *
 * @param {File} file
 * @param {object} [options]
 * @param {(progress: { phase: string, done?: number, total?: number }) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ markdown: string, title: string, note: string }>}
 */
export async function readDocumentFile(file, { onProgress, signal } = {}) {
  const bytes = await readFileBytes(file, { onProgress, signal });
  const name = file.name || 'document';
  const type = String(file.type || '').toLowerCase();

  if (signal?.aborted) {
    const error = new Error('The work was stopped.');
    error.name = 'AbortError';
    throw error;
  }

  if (/\.pdf$/i.test(name) || type === 'application/pdf') {
    const { pdfToMarkdown, buildPdfDocument } = await import('@/importers/pdf.js');
    const pdf = await pdfToMarkdown(bytes, { url: name, onProgress, signal });

    return {
      markdown: buildPdfDocument(pdf, ''),
      title: pdf.title || name,
      note: `PDF (${pdf.pages} pages)`
    };
  }

  if (/\.epub$/i.test(name) || type === 'application/epub+zip') {
    const { epubToMarkdown } = await import('@/importers/epub.js');
    const { htmlToMarkdownFragment } = await import('@/importers/html.js');

    const book = await epubToMarkdown(bytes, {
      url: name,
      onProgress,
      signal,
      toMarkdown: (html, baseUrl) => htmlToMarkdownFragment(html, baseUrl, { signal })
    });

    return {
      markdown: book.markdown,
      title: book.title || name,
      note: `book (${book.chapters} chapters)`
    };
  }

  if (/\.docx$/i.test(name) || /wordprocessingml/.test(type)) {
    const { docxToMarkdown } = await import('@/importers/docx.js');
    const docx = await docxToMarkdown(bytes, { url: name, onProgress, signal });

    return {
      markdown: docx.markdown,
      title: docx.title || name,
      note: `Word document (${docx.paragraphs} paragraphs)`
    };
  }

  throw new Error('That file is not a document this app can read.');
}
