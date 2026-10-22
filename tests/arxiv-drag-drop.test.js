/**
 * @vitest-environment jsdom
 *
 * A paper of arXiv and the things that can be dropped on the app.
 */
import { describe, it, expect } from 'vitest';

const {
  parseArxivMetadata,
  hasRenderedPaper,
  extractPaperHtml,
  buildPaperDocument,
  latexMathRule,
  equationTableRule,
  equationCellRule,
  equationNumberRule,
  normalizeLatex,
  arxivRules
} = await import('../src/arxiv-to-markdown.js');

const { detectSource, SOURCE } = await import('../src/app/url-sources.js');
const { kindOfDrag, urlOfDrag, isTextFile, DROP_KIND } = await import('../src/app/drag-drop.js');

/* ==========================================================================
 * arXiv
 * ========================================================================== */

const ARXIV_FEED = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v3</id>
    <title>Distributionally Robust Receive Combining</title>
    <updated>2025-06-17T20:37:32Z</updated>
    <link href="https://arxiv.org/abs/2401.12345v3" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2401.12345v3" rel="related" type="application/pdf" title="pdf"/>
    <summary>This article investigates signal estimation in wireless transmission.</summary>
    <category term="eess.SP" scheme="http://arxiv.org/schemas/atom"/>
    <published>2024-01-22T20:20:48Z</published>
    <arxiv:primary_category term="eess.SP"/>
    <arxiv:journal_ref>IEEE Transactions on Signal Processing, June 2025</arxiv:journal_ref>
    <author><name>Shixiong Wang</name></author>
    <author><name>Wei Dai</name></author>
    <arxiv:doi>10.1109/TSP.2025.3582082</arxiv:doi>
  </entry>
</feed>`;

const ARXIV_PAGE = `<!doctype html><html><body>
<article class="ltx_document ltx_authors_1line">
  <h1 class="ltx_title ltx_title_document">Distributionally Robust Receive Combining</h1>
  <div class="ltx_authors"><span class="ltx_personname">Shixiong Wang</span></div>
  <section class="ltx_section"><h2 class="ltx_title ltx_title_section">1 Introduction</h2>
    <p class="ltx_para">The signal is written as
      <math id="m1" class="ltx_Math" alttext="\\mathbf{y} = \\mathbf{H}\\mathbf{x} + \\mathbf{n}" display="inline"></math>
      and the noise follows.</p>
    <div class="ltx_equation"><math id="m2" class="ltx_Math" alttext="\\mathbb{E}[\\|\\mathbf{n}\\|^2] = \\sigma^2" display="block"></math></div>
  </section>
</article>
</body></html>`;

describe('reading a paper', () => {
  it('reads the metadata out of the answer of the API', () => {
    const meta = parseArxivMetadata(ARXIV_FEED);

    expect(meta.id).toBe('2401.12345');
    expect(meta.version).toBe('3');
    expect(meta.title).toBe('Distributionally Robust Receive Combining');
    expect(meta.authors).toEqual(['Shixiong Wang', 'Wei Dai']);
    expect(meta.primaryCategory).toBe('eess.SP');
    expect(meta.published).toBe('2024-01-22T20:20:48Z');
    expect(meta.journalRef).toContain('IEEE Transactions');
    expect(meta.doi).toBe('10.1109/TSP.2025.3582082');
    expect(meta.pdfUrl).toContain('/pdf/2401.12345v3');
  });

  it('knows a paper that arXiv has drawn', () => {
    expect(hasRenderedPaper(ARXIV_PAGE)).toBe(true);
    expect(hasRenderedPaper('<html><body>no paper here</body></html>')).toBe(false);
  });

  it('takes the body of the paper, without the title and the authors', () => {
    const html = extractPaperHtml(ARXIV_PAGE);

    expect(html).toContain('Introduction');
    expect(html).not.toContain('ltx_title_document');
    expect(html).not.toContain('ltx_authors');
  });

  it('takes the summary out of the paper, so it is not there twice', () => {
    const page = `<html><body><article class="ltx_document">
      <div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6><p>The summary of the paper.</p></div>
      <section class="ltx_section"><p>The body of the paper.</p></section>
    </article></body></html>`;

    const html = extractPaperHtml(page);

    expect(html).not.toContain('The summary of the paper.');
    expect(html).toContain('The body of the paper.');
  });

  it('puts the formula of a paper back into LaTeX', () => {
    const node = document.createElement('math');
    node.setAttribute('alttext', '\\mathbf{y} = \\mathbf{H}\\mathbf{x}');
    node.setAttribute('display', 'inline');

    const inline = latexMathRule.replacement('', node);
    expect(inline).toBe('$\\mathbf{y} = \\mathbf{H}\\mathbf{x}$');

    node.setAttribute('display', 'block');
    expect(latexMathRule.replacement('', node)).toContain('$$');
  });

  it('builds the document of a paper', () => {
    const meta = parseArxivMetadata(ARXIV_FEED);
    const document = buildPaperDocument(meta, { paperMarkdown: '## 1 Introduction\n\nThe body.' });

    expect(document).toContain('# Distributionally Robust Receive Combining');
    expect(document).toContain('**Authors:** Shixiong Wang, Wei Dai');
    expect(document).toContain('**Subject:** eess.SP');
    expect(document).toContain('**DOI:** 10.1109/TSP.2025.3582082');
    expect(document).toContain('**Paper:** [arXiv](https://arxiv.org/abs/2401.12345v3)');
    expect(document).toContain('## Abstract');
    expect(document).toContain('## The paper');
  });

  it('says so when only the summary could be read', () => {
    const meta = parseArxivMetadata(ARXIV_FEED);
    const document = buildPaperDocument(meta, { paperMissing: true });

    expect(document).toContain('## Abstract');
    expect(document).toContain('has not drawn this paper into HTML');
    expect(document).not.toContain('## The paper');
  });

  it('sees a paper of arXiv', () => {
    expect(detectSource('https://arxiv.org/abs/2401.12345')?.type).toBe(SOURCE.ARXIV_PAPER);
    expect(detectSource('https://arxiv.org/abs/2401.12345v3')?.paperId).toBe('2401.12345');
    expect(detectSource('https://arxiv.org/pdf/2401.12345')?.type).toBe(SOURCE.ARXIV_PAPER);
    expect(detectSource('https://arxiv.org/html/2401.12345')?.type).toBe(SOURCE.ARXIV_PAPER);
  });

  it('leaves the home page of arXiv a page', () => {
    expect(detectSource('https://arxiv.org/')?.type).toBe(SOURCE.WEB_PAGE);
    expect(detectSource('https://arxiv.org/list/cs.AI/recent')?.type).toBe(SOURCE.WEB_PAGE);
  });
});

describe('the LaTeX of a paper', () => {
  it('takes the empty argument of an environment away', () => {
    // LaTeX takes it, the renderer of the app does not.
    expect(normalizeLatex('\\begin{array}[]{cc}a&b\\end{array}')).toBe(
      '\\begin{array}{cc}a&b\\end{array}'
    );
    expect(normalizeLatex('\\begin{pmatrix}[]{}x\\end{pmatrix}')).toBe(
      '\\begin{pmatrix}{}x\\end{pmatrix}'
    );
  });

  it('takes the labels and the references away', () => {
    expect(normalizeLatex('x\\label{eq:1}')).toBe('x');
    expect(normalizeLatex('see \\eqref{eq:1}')).toBe('see');
    expect(normalizeLatex('see \\cite{doe2020}')).toBe('see');
  });

  it('reads the formula out of the note inside it', () => {
    const math = document.createElement('math');
    math.setAttribute('display', 'block');
    const annotation = document.createElement('annotation');
    annotation.setAttribute('encoding', 'application/x-tex');
    annotation.textContent = '\\begin{array}[]{cc}a\\end{array}';
    math.appendChild(annotation);

    const result = latexMathRule.replacement('', math);
    expect(result).toContain('$$');
    expect(result).toContain('\\begin{array}{cc}');
  });

  it('takes the table of an equation for the formula it holds', () => {
    const table = document.createElement('table');
    table.setAttribute('class', 'ltx_equation ltx_eqn_table');

    expect(equationTableRule.filter(table)).toBe(true);
    expect(equationTableRule.replacement('$$x$$')).toContain('$$x$$');

    const ordinary = document.createElement('table');
    ordinary.setAttribute('class', 'ltx_tabular');
    expect(equationTableRule.filter(ordinary)).toBe(false);
  });

  it('does not write the cells of an equation as cells of a table', () => {
    const table = document.createElement('table');
    table.setAttribute('class', 'ltx_equation ltx_eqn_table');
    const cell = document.createElement('td');
    table.appendChild(cell);

    expect(equationCellRule.filter(cell)).toBe(true);
    expect(equationCellRule.replacement('$$x$$')).toBe('$$x$$');
  });

  it('takes the number of an equation away', () => {
    const number = document.createElement('span');
    number.setAttribute('class', 'ltx_tag ltx_tag_equation');

    expect(equationNumberRule.replacement('(1)')).toBe('');
  });

  it('has all the rules a paper needs', () => {
    expect(arxivRules).toHaveLength(4);
    expect(arxivRules.map((rule) => rule.key)).toContain('latexMath');
  });
});

/* ==========================================================================
 * Drag and drop
 * ========================================================================== */

/**
 * A stand-in for the drag that the browser hands over.
 */
function fakeTransfer({ types = [], uri = '', text = '' } = {}) {
  return {
    types,
    getData: (kind) => (kind === 'text/uri-list' ? uri : text)
  };
}

describe('knowing what is dropped', () => {
  it('sees a file', () => {
    expect(kindOfDrag(fakeTransfer({ types: ['Files'] }))).toBe(DROP_KIND.FILE);
  });

  it('sees a link', () => {
    expect(kindOfDrag(fakeTransfer({ types: ['text/uri-list', 'text/plain'] }))).toBe(DROP_KIND.URL);
  });

  it('sees a piece of text', () => {
    expect(kindOfDrag(fakeTransfer({ types: ['text/plain'] }))).toBe(DROP_KIND.TEXT);
  });

  it('sees nothing', () => {
    expect(kindOfDrag(fakeTransfer({ types: [] }))).toBe(DROP_KIND.NONE);
    expect(kindOfDrag(null)).toBe(DROP_KIND.NONE);
  });

  it('reads the address out of a link', () => {
    const transfer = fakeTransfer({
      types: ['text/uri-list'],
      uri: 'https://arxiv.org/abs/2401.12345'
    });

    expect(urlOfDrag(transfer)).toBe('https://arxiv.org/abs/2401.12345');
  });

  it('skips the comments in the list of addresses', () => {
    const transfer = fakeTransfer({
      types: ['text/uri-list'],
      uri: '# a comment\nhttps://example.com/page'
    });

    expect(urlOfDrag(transfer)).toBe('https://example.com/page');
  });

  it('takes a text that is an address as one', () => {
    const transfer = fakeTransfer({ types: ['text/plain'], text: 'https://example.com/page' });

    expect(urlOfDrag(transfer)).toBe('https://example.com/page');
  });

  it('leaves ordinary text alone', () => {
    const transfer = fakeTransfer({ types: ['text/plain'], text: 'just some words' });

    expect(urlOfDrag(transfer)).toBe('');
  });

  it('knows a file of text', () => {
    expect(isTextFile({ name: 'notes.md', type: '' })).toBe(true);
    expect(isTextFile({ name: 'notes.txt', type: '' })).toBe(true);
    expect(isTextFile({ name: 'notes', type: 'text/markdown' })).toBe(true);
    expect(isTextFile({ name: 'photo.png', type: 'image/png' })).toBe(false);
    expect(isTextFile(null)).toBe(false);
  });
});
