/**
 * ============================================================================
 * HTML → MARKDOWN
 * Turns a web page into the Markdown a reader can actually read.
 *
 * Two steps, in this order:
 *
 *   1. Readability (Mozilla) finds the article inside the page and throws
 *      away everything around it — the navigation, the adverts, the footer,
 *      the cookie banner. This is the same algorithm the reading mode of the
 *      browsers uses.
 *   2. Turndown converts what is left into Markdown, using the GitHub
 *      flavour the app already speaks: tables, strikethrough, task lists.
 *
 * Both libraries are loaded on demand. A visitor who never imports a web
 * page never downloads them.
 *
 * The conversion always happens in the browser. The proxy in front of it only
 * carries the raw HTML; nothing is processed anywhere else.
 * ============================================================================
 */

/** Below this many characters a page is not treated as an article. */
const ARTICLE_MIN_LENGTH = 400;

/**
 * The loaded libraries, kept so the second import does not pay for them
 * again. The Turndown service itself is built fresh for every page: its
 * rules carry the address of the page they belong to.
 * @type {Promise<{ Readability: Function, TurndownService: Function, gfm: object }>|null}
 */
let librariesPromise = null;

/**
 * Resolves a URL that may be relative against the page it came from.
 *
 * @param {string|null} value the attribute as it appears in the HTML
 * @param {string} baseUrl the address of the page
 * @returns {string} the absolute URL, or an empty string when there is none
 */
export function resolveUrl(value, baseUrl) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#')) return '';

  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return trimmed;
  }
}

/**
 * Loads the libraries.
 *
 * The packages ship as CommonJS, so the namespace is unwrapped by hand:
 * the shape a bundler hands back is not the shape the package exports.
 *
 * @returns {Promise<{ Readability: Function, TurndownService: Function, gfm: object }>}
 */
function loadLibraries() {
  if (!librariesPromise) {
    librariesPromise = Promise.all([
      import('@mozilla/readability'),
      import('turndown'),
      import('turndown-plugin-gfm')
    ]).then(([readability, turndown, gfm]) => {
      const gfmExports = gfm.default || gfm;

      return {
        Readability: readability.Readability || readability.default?.Readability,
        TurndownService: turndown.default || turndown,
        gfm: gfmExports.gfm || gfmExports
      };
    });
  }

  return librariesPromise;
}

/**
 * Adds the rules that make the output fit this app.
 *
 * @param {object} turndown the Turndown instance
 * @param {string} pageUrl the address the HTML came from
 */
function applyRules(turndown, pageUrl) {
  // Links and images keep the address they point at, even when the page
  // used a relative one.
  turndown.addRule('absoluteLink', {
    filter: 'a',
    replacement(content, node) {
      const href = resolveUrl(node.getAttribute('href'), pageUrl);
      const text = content.trim();
      if (!href || !text) return text;
      return `[${text}](${href})`;
    }
  });

  turndown.addRule('absoluteImage', {
    filter: 'img',
    replacement(content, node) {
      const src = resolveUrl(node.getAttribute('src'), pageUrl);
      if (!src) return '';
      const alt = (node.getAttribute('alt') || '').replace(/[[\]]/g, '');
      const title = node.getAttribute('title');
      return `![${alt}](${src}${title ? ` "${title}"` : ''})`;
    }
  });

  // A caption belongs to the picture, not to a paragraph of its own.
  turndown.addRule('figure', {
    filter: 'figure',
    replacement(content) {
      return `\n\n${content.trim()}\n\n`;
    }
  });

  // A list inside a table cell breaks the table: the marker of the list
  // ends the row. Inside a cell only the words are kept.
  turndown.addRule('listItemInTableCell', {
    filter(node) {
      if (node.nodeName !== 'LI') return false;
      return Boolean(node.closest('td, th'));
    },
    replacement(content) {
      return `${content.replace(/\s+/g, ' ').trim()} `;
    }
  });

  // A cell of a table is a single line. A paragraph, a list or a line
  // break inside it would end the row, so the content is folded into one
  // line of text.
  turndown.addRule('tableCell', {
    filter: ['td', 'th'],
    replacement(content, node) {
      const siblings = node.parentNode ? node.parentNode.childNodes : [];
      const index = Array.prototype.indexOf.call(siblings, node);
      const prefix = index === 0 ? '| ' : ' ';
      const text = content.replace(/\s*\n+\s*/g, ' ').trim();
      return `${prefix}${text} |`;
    }
  });
}

/**
 * Builds a converter for one page.
 *
 * @param {object} libraries the loaded libraries
 * @param {string} pageUrl the address the HTML came from
 * @returns {object} a Turndown service
 */
function createTurndown({ TurndownService, gfm }, pageUrl) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    preformattedCode: true
  });

  if (gfm) turndown.use(gfm);
  applyRules(turndown, pageUrl);

  return turndown;
}

/**
 * Removes the parts of a page that never belong in a document.
 * @param {Document} doc
 */
function stripNoise(doc) {
  const junk = doc.querySelectorAll(
    'script, style, noscript, iframe, template, svg, canvas, object, embed, link'
  );
  junk.forEach((node) => node.remove());
}

/**
 * Converts a piece of HTML — not a whole page — into Markdown.
 *
 * The site readers use this for the part of a page they care about: the
 * body of a post, a comment, the text of a video description.
 *
 * @param {string} html
 * @param {string} baseUrl the address the fragment came from
 * @param {object} [options]
 * @param {Array<{ key: string, filter: unknown, replacement: Function }>} [options.rules]
 *   extra rules for the converter — a site that carries its own marks can
 *   say what to do with them
 * @returns {Promise<string>}
 */
export async function htmlToMarkdownFragment(html, baseUrl, { rules = [] } = {}) {
  if (!html) return '';
  const libraries = await loadLibraries();
  const turndown = createTurndown(libraries, baseUrl);

  for (const rule of rules) {
    if (rule && rule.key) turndown.addRule(rule.key, rule);
  }

  return tidy(turndown.turndown(html));
}

/**
 * Converts a web page into Markdown.
 *
 * @param {string} html the raw HTML of the page
 * @param {string} pageUrl the address the HTML came from
 * @returns {Promise<{ markdown: string, title: string, strategy: 'article'|'page' }>}
 */
export async function htmlToMarkdown(html, pageUrl) {
  const libraries = await loadLibraries();
  const { Readability } = libraries;

  // A document built by DOMParser is inert: nothing in it runs, and no
  // image inside it is fetched, until the nodes are moved into the page.
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // The base address makes every relative link inside the page absolute.
  const base = doc.createElement('base');
  base.href = pageUrl;
  doc.head.prepend(base);

  stripNoise(doc);

  let markdown = '';
  let title = '';
  let strategy = 'page';

  try {
    const article = new Readability(doc, {
      charThreshold: 250,
      // The classes are kept: the language of a code block is written in
      // them, and without it every block would come out unlabelled.
      keepClasses: true
    }).parse();

    if (article && article.content && article.textContent.length >= ARTICLE_MIN_LENGTH) {
      markdown = article.content;
      title = article.title || '';
      strategy = 'article';
    }
  } catch (err) {
    console.warn('Readability could not parse the page:', err);
  }

  // A page that is not an article — a landing page, a feed — still has
  // something worth reading. The whole body is converted instead.
  if (!markdown) {
    markdown = doc.body ? doc.body.innerHTML : '';
  }

  const turndown = createTurndown(libraries, pageUrl);

  return {
    markdown: withTitle(tidy(turndown.turndown(markdown)), title),
    title,
    strategy
  };
}

/**
 * Puts the title of the article back on top of the document.
 *
 * The reader drops a heading that repeats the title of the page — the
 * title is shown separately there. Here the title is the only heading the
 * document gets, so it is written back in.
 *
 * @param {string} markdown
 * @param {string} title
 * @returns {string}
 */
function withTitle(markdown, title) {
  const heading = String(title || '').replace(/\s+/g, ' ').trim();
  if (!heading) return markdown;
  if (markdown.startsWith('#')) return markdown;

  return `# ${heading}\n\n${markdown}`;
}

/**
 * Removes the leftovers of the conversion: empty lines in a row and the
 * whitespace that no Markdown needs.
 * @param {string} text
 * @returns {string}
 */
export function tidy(text) {
  return String(text || '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
