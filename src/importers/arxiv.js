/**
 * ============================================================================
 * ARXIV
 * Turns a paper into a document.
 *
 * A paper is a strange thing to read on the web: it is written in LaTeX,
 * laid out for a page of paper, and full of formulas. But arXiv keeps two
 * other forms of every paper, and both of them fit a reader:
 *
 *   • the metadata of the paper — the title, the authors, the summary, the
 *     subjects, the journal it was published in — which the address of the
 *     API gives
 *   • the paper itself as HTML, which arXiv draws from the LaTeX of the
 *     author. Every formula in it still carries the LaTeX it was written
 *     in, so the formulas survive the change into Markdown — and this app
 *     can draw them.
 *
 * Not every paper has the second form: the older ones do not. Then the
 * summary is what there is, and the document says so.
 * ============================================================================
 */

/**
 * The address of the API of arXiv.
 */
export const ARXIV_API = 'https://export.arxiv.org/api/query';

/**
 * Reads the metadata of a paper out of the answer of the API.
 *
 * The answer is an Atom feed — the same shape the feeds of Reddit and
 * Substack have.
 *
 * @param {string} xml
 * @returns {{
 *   id: string,
 *   version: string,
 *   title: string,
 *   summary: string,
 *   authors: string[],
 *   categories: string[],
 *   primaryCategory: string,
 *   published: string,
 *   updated: string,
 *   doi: string,
 *   journalRef: string,
 *   absUrl: string,
 *   pdfUrl: string
 * }|null}
 */
export function parseArxivMetadata(xml) {
  if (!xml) return null;

  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const entry = doc.querySelector('entry');

  // The API answers with an empty feed when it does not know the paper.
  if (!entry) return null;

  const id = entry.querySelector('id')?.textContent?.trim() || '';
  const version = id.match(/v(\d+)$/)?.[1] || '';

  const authors = Array.from(entry.querySelectorAll('author > name'))
    .map((node) => node.textContent?.trim() || '')
    .filter(Boolean);

  const categories = Array.from(entry.querySelectorAll('category'))
    .map((node) => node.getAttribute('term') || '')
    .filter(Boolean);

  const links = Array.from(entry.querySelectorAll('link')).map((node) => ({
    href: node.getAttribute('href') || '',
    rel: node.getAttribute('rel') || '',
    title: node.getAttribute('title') || '',
    type: node.getAttribute('type') || ''
  }));

  const absUrl = links.find((link) => link.rel === 'alternate')?.href || id;
  const pdfUrl = links.find((link) => link.type === 'application/pdf')?.href || '';

  return {
    id: id.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, ''),
    version,
    title: entry.querySelector('title')?.textContent?.trim() || '',
    summary: entry.querySelector('summary')?.textContent?.trim() || '',
    authors,
    categories,
    primaryCategory:
      entry.querySelector('primary_category')?.getAttribute('term') || categories[0] || '',
    published: entry.querySelector('published')?.textContent?.trim() || '',
    updated: entry.querySelector('updated')?.textContent?.trim() || '',
    doi: entry.querySelector('doi')?.textContent?.trim() || '',
    journalRef: entry.querySelector('journal_ref')?.textContent?.trim() || '',
    absUrl,
    pdfUrl
  };
}

/**
 * Tells whether a page is the paper arXiv drew from the LaTeX.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function hasRenderedPaper(html) {
  return Boolean(html) && /class="ltx_document/.test(html);
}

/**
 * Takes the body of a drawn paper out of the page.
 *
 * The title and the authors are left out: the document carries them
 * already, from the metadata of the paper.
 *
 * @param {string} html
 * @returns {string} the HTML of the paper
 */
export function extractPaperHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const paper = doc.querySelector('article.ltx_document') || doc.querySelector('article');
  if (!paper) return '';

  // The heading and the list of authors are in the document already.
  paper.querySelector('h1.ltx_title')?.remove();
  paper.querySelector('.ltx_authors')?.remove();
  paper.querySelector('.ltx_dates')?.remove();

  // The summary is in the document already too, and it is the one of the
  // API — the one of the paper is the same text a second time.
  paper.querySelector('.ltx_abstract')?.remove();

  return paper.innerHTML;
}

/**
 * Makes the LaTeX of a paper fit the renderer of this app.
 *
 * The LaTeX is written for LaTeX, and the renderer of the app knows most
 * of it but not all of it. Two things are different:
 *
 *   • an environment may carry an empty argument — `\begin{array}[]{cc}` —
 *     which LaTeX accepts and the renderer does not
 *   • a formula may point at a label or a reference, which the renderer
 *     has no meaning for
 *
 * @param {string} latex
 * @returns {string}
 */
export function normalizeLatex(latex) {
  return String(latex || '')
    .replace(
      /\\begin\{(array|pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix|cases|aligned|align\*?|gathered|gather\*?|split|subarray|eqnarray\*?)\}\s*\[[^\]]*\]/g,
      '\\begin{$1}'
    )
    .replace(/\\(label|eqref|ref)\{[^}]*\}/g, '')
    .replace(/\\cite\{[^}]*\}/g, '')
    .trim();
}

/**
 * The rule that turns a formula into LaTeX again.
 *
 * arXiv draws the formulas of a paper as MathML, but keeps the LaTeX they
 * were written in — in the formula itself and in a note inside it. The
 * formula is put back the way it was written, and the app draws it.
 */
export const latexMathRule = {
  key: 'latexMath',
  filter: 'math',
  replacement(content, node) {
    const source =
      node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ||
      node.getAttribute('alttext');

    const latex = normalizeLatex(source);
    if (!latex) return content;

    // A formula that holds an environment has to stand on its own: the
    // renderer knows environments only in a display formula.
    const display = node.getAttribute('display') === 'block' || /\\begin\{/.test(latex);

    return display ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`;
  }
};

/**
 * The rule for the table an equation stands in.
 *
 * arXiv lays an equation out in a table of its own, to place it in the
 * middle of the line. That table is not a table of data — it is a
 * formula, and it is taken as one.
 */
export const equationTableRule = {
  key: 'equationTable',
  filter(node) {
    if (node.nodeName !== 'TABLE') return false;
    const classes = node.getAttribute('class') || '';
    return /ltx_eqn_table|ltx_equation/.test(classes);
  },
  replacement(content) {
    return `\n\n${content.trim()}\n\n`;
  }
};

/**
 * The rule for the cells of that table.
 *
 * They hold the formula and the space around it. They are not cells of a
 * table of data, so they are not written as cells.
 */
export const equationCellRule = {
  key: 'equationCell',
  filter(node) {
    if (node.nodeName !== 'TD' && node.nodeName !== 'TH') return false;
    return Boolean(node.closest('table.ltx_eqn_table, table.ltx_equation'));
  },
  replacement(content) {
    return content.trim();
  }
};

/**
 * The rule for the number of an equation.
 *
 * The number belongs to the paper, not to the formula — and it would
 * otherwise end up inside it.
 */
export const equationNumberRule = {
  key: 'equationNumber',
  filter(node) {
    const classes = node.getAttribute?.('class') || '';
    return /ltx_tag_equation|ltx_eqn_eqno/.test(classes);
  },
  replacement() {
    return '';
  }
};

/**
 * All the rules a paper needs.
 */
export const arxivRules = [equationTableRule, equationCellRule, equationNumberRule, latexMathRule];

/**
 * Builds the document of a paper.
 *
 * @param {object} meta the metadata of the paper
 * @param {object} [options]
 * @param {string} [options.paperMarkdown] the paper itself, when it could be had
 * @param {boolean} [options.paperMissing] the paper has no drawn form
 * @param {boolean} [options.paperFromPdf] the paper was read out of its PDF,
 *   which means the formulas are not in it
 * @returns {string}
 */
export function buildPaperDocument(
  meta,
  { paperMarkdown = '', paperMissing = false, paperFromPdf = false } = {}
) {
  const lines = [];

  lines.push(`# ${meta.title}`);
  lines.push('');

  const facts = [];
  if (meta.authors.length > 0) facts.push(`**Authors:** ${meta.authors.join(', ')}`);
  if (meta.published) facts.push(`**Published:** ${meta.published.slice(0, 10)}`);
  if (meta.updated) facts.push(`**Revised:** ${meta.updated.slice(0, 10)}`);
  if (meta.primaryCategory) facts.push(`**Subject:** ${meta.primaryCategory}`);
  if (meta.journalRef) facts.push(`**Journal:** ${meta.journalRef}`);
  if (meta.doi) facts.push(`**DOI:** ${meta.doi}`);

  const links = [];
  if (meta.absUrl) links.push(`[arXiv](${meta.absUrl})`);
  if (meta.pdfUrl) links.push(`[PDF](${meta.pdfUrl})`);
  if (meta.id) links.push(`[HTML](https://arxiv.org/html/${meta.id})`);
  if (links.length > 0) facts.push(`**Paper:** ${links.join(' · ')}`);

  if (facts.length > 0) {
    lines.push(facts.join('  \n'));
    lines.push('');
  }

  if (meta.summary) {
    lines.push('## Abstract');
    lines.push('');
    lines.push(meta.summary);
    lines.push('');
  }

  if (paperMarkdown) {
    lines.push('## The paper');
    lines.push('');

    if (paperFromPdf) {
      lines.push(
        '_The text of the paper was taken out of its PDF. The formulas are drawings, and there is no text in them to take._'
      );
      lines.push('');
    }

    lines.push(paperMarkdown);
    lines.push('');
  } else if (paperMissing) {
    lines.push('---');
    lines.push('');
    lines.push(
      '_arXiv has not drawn this paper into HTML, so only the summary could be read. The links above lead to the paper itself._'
    );
  }

  return lines.join('\n').trim();
}
