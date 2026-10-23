/**
 * @vitest-environment jsdom
 *
 * The two kinds of file that are not text: a PDF and a book in EPUB form.
 */
import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';

const { detectSource, SOURCE } = await import('../src/app/url-sources.js');
const { fromBase64, buildPdfDocument } = await import('../src/pdf-to-markdown.js');
const { readBookManifest, unzip, epubToMarkdown } = await import('../src/epub-to-markdown.js');
const { fetchThroughProxy } = await import('../server/proxy-core.js');

/**
 * Builds a small book in EPUB form, so the reader can be tried out.
 * @returns {Uint8Array}
 */
function buildBook() {
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>A Small Book</dc:title>
    <dc:creator>Someone</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

  const chapterOne = `<html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1>The first chapter</h1><p>The words of the first chapter.</p></body></html>`;

  const chapterTwo = `<html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1>The second chapter</h1><p>The words of the second chapter.</p></body></html>`;

  const encoder = new TextEncoder();
  const files = {
    mimetype: encoder.encode('application/epub+zip'),
    'META-INF/container.xml': encoder.encode(container),
    'OEBPS/content.opf': encoder.encode(opf),
    'OEBPS/ch1.xhtml': encoder.encode(chapterOne),
    'OEBPS/ch2.xhtml': encoder.encode(chapterTwo)
  };

  // The zip is written here, so the test does not need a file of its own.
  return buildZip(files);
}

/**
 * Writes a zip file out of a set of files.
 *
 * @param {Record<string, Uint8Array>} files
 * @returns {Uint8Array}
 */
function buildZip(files) {
  return zipSync(files);
}

describe('seeing a file of a kind', () => {
  it('sees a PDF', () => {
    const source = detectSource('https://example.com/papers/thing.pdf');

    expect(source.type).toBe(SOURCE.PDF_DOCUMENT);
  });

  it('sees a book', () => {
    const source = detectSource('https://example.com/books/thing.epub');

    expect(source.type).toBe(SOURCE.EPUB_BOOK);
  });

  it('does not mistake a PDF of arXiv for a plain PDF', () => {
    // arXiv knows the paper, and knows more about it than a PDF does.
    expect(detectSource('https://arxiv.org/pdf/1706.03762')?.type).toBe(SOURCE.ARXIV_PAPER);
  });
});

describe('reading a PDF', () => {
  it('turns base64 back into bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const base64 = Buffer.from(bytes).toString('base64');

    expect(Array.from(fromBase64(base64))).toEqual(Array.from(bytes));
  });

  it('builds a document of a PDF', () => {
    const document = buildPdfDocument(
      { markdown: '## Page 1\n\nThe words.', title: 'A Paper', pages: 1 },
      'https://example.com/a.pdf'
    );

    expect(document).toContain('# A Paper');
    expect(document).toContain('**Pages:** 1');
    expect(document).toContain('The words.');
    expect(document).toContain('formulas');
  });
});

describe('reading a book', () => {
  it('opens the bundle of the book', async () => {
    const files = await unzip(buildBook());

    expect(Object.keys(files)).toContain('META-INF/container.xml');
    expect(Object.keys(files)).toContain('OEBPS/content.opf');
  });

  it('reads the name of the book, its author and the order of the chapters', () => {
    const files = {
      'META-INF/container.xml': new TextEncoder().encode(
        '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
      ),
      'OEBPS/content.opf': new TextEncoder().encode(`<package>
        <metadata><title>A Small Book</title><creator>Someone</creator><language>en</language></metadata>
        <manifest>
          <item id="ch1" href="ch1.xhtml"/>
          <item id="ch2" href="ch2.xhtml"/>
        </manifest>
        <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
      </package>`)
    };

    const manifest = readBookManifest(files);

    expect(manifest.title).toBe('A Small Book');
    expect(manifest.author).toBe('Someone');
    expect(manifest.chapters).toEqual(['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml']);
  });

  it('turns the chapters of the book into a document', async () => {
    const book = await epubToMarkdown(buildBook(), {
      toMarkdown: async (html) =>
        html
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
    });

    expect(book.title).toBe('A Small Book');
    expect(book.chapters).toBe(2);
    expect(book.markdown).toContain('The words of the first chapter.');
    expect(book.markdown).toContain('The words of the second chapter.');
  });

  it('says so when the file is not a book', async () => {
    await expect(epubToMarkdown(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe('the proxy and the files that are not text', () => {
  it('carries a PDF as base64', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x01]);

    const result = await fetchThroughProxy('https://example.com/a.pdf', {
      fetchImpl: async () =>
        new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
    });

    expect(result.encoding).toBe('base64');
    expect(Array.from(fromBase64(result.body))).toEqual(Array.from(bytes));
  });

  it('carries a page as text', async () => {
    const result = await fetchThroughProxy('https://example.com/a.html', {
      fetchImpl: async () =>
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
    });

    expect(result.encoding).toBe('text');
    expect(result.body).toBe('<html></html>');
  });

  it('carries a feed of arXiv as text, for it is a kind of xml', async () => {
    const result = await fetchThroughProxy('https://export.arxiv.org/api/query?id_list=1', {
      fetchImpl: async () =>
        new Response('<feed/>', {
          status: 200,
          headers: { 'content-type': 'application/atom+xml; charset=utf-8' }
        })
    });

    expect(result.encoding).toBe('text');
    expect(result.body).toBe('<feed/>');
  });
});
