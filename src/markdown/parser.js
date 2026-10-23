/**
 * Markdown Engine Specification:
 * - Markdown-it with CommonMark + GFM (Tables, Task lists, Strikethrough, Autolinks)
 * - Footnotes and emoji shortcodes
 * - GitHub-style callouts (`> [!NOTE]`) and linkable headings
 * - LaTeX Math rendering via KaTeX ($inline$ & $$block$$)
 * - Code Syntax Highlighting via Highlight.js
 * - Mermaid diagrams (```mermaid fences) — the source is emitted here, the
 *   diagram itself is drawn by `markdown/mermaid.js`
 * - XSS Sanitization via DOMPurify preserving KaTeX MathML, SVG, and TTS token attributes
 */
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import { bare as emoji } from 'markdown-it-emoji';
import emojiDefs from 'markdown-it-emoji/lib/data/full.mjs';
import emojiShortcuts from 'markdown-it-emoji/lib/data/shortcuts.mjs';
import katex from 'katex';
import hljsCommon from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { getSettings } from '@/core/settings.js';
import { parseFrontmatter } from '@/core/frontmatter.js';

/**
 * The highlighter is swappable: by default only the 36 most common languages
 * are bundled (≈300 kB instead of ≈950 kB). "All languages" is loaded on
 * demand the first time it is actually needed.
 */
let hljs = hljsCommon;
let allLanguagesLoaded = false;

/**
 * Loads the full language set in the background.
 * @returns {Promise<boolean>} whether the full set is now active
 */
export async function loadAllLanguages() {
  if (allLanguagesLoaded) return true;
  try {
    // The full language set lives in its own lazily loaded chunk — it is only
    // fetched when the user actually asks for it.
    const module = await import('highlight.js');
    hljs = module.default || module;
    allLanguagesLoaded = true;
    return true;
  } catch (err) {
    console.warn('Could not load all highlight.js languages:', err);
    return false;
  }
}

/**
 * Custom KaTeX plugin for markdown-it
 * Supports:
 * - Block math: $$ ... $$
 * - Inline math: $ ... $ (ignoring escaped \$ and empty/multi-line cases)
 */
function katexPlugin(md) {
  // Block Math Rule
  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];

    // Must start with '$$'
    if (start + 2 > max) return false;
    if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) !== 0x24) {
      return false;
    }

    const firstLine = state.src.slice(start + 2, max);

    // Single-line block math: $$math$$
    if (firstLine.trim().slice(-2) === '$$' && firstLine.trim().length > 2) {
      if (silent) return true;
      const content = firstLine.trim().slice(0, -2);
      const token = state.push('math_block', 'math', 0);
      token.block = true;
      token.content = content;
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    }

    // Multi-line block math
    let nextLine = startLine;
    let found = false;

    while (!found) {
      nextLine++;
      if (nextLine >= endLine) break;

      const curStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const curMax = state.eMarks[nextLine];

      if (state.src.slice(curStart, curMax).trim() === '$$') {
        found = true;
        break;
      }
    }

    if (!found) return false;
    if (silent) return true;

    const content = state.getLines(startLine + 1, nextLine, state.tShift[startLine], true);
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content;
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  });

  // Inline Math Rule
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false;
    if (state.src.charCodeAt(state.pos + 1) === 0x24 /* $$ is block */) return false;
    // Disallow escaped \$
    if (state.pos > 0 && state.src.charCodeAt(state.pos - 1) === 0x5c) return false;

    const start = state.pos + 1;
    let match = start;
    let end = -1;

    while ((match = state.src.indexOf('$', match)) !== -1) {
      if (state.src.charCodeAt(match - 1) !== 0x5c) {
        end = match;
        break;
      }
      match++;
    }

    if (end === -1) return false;
    // Inline math should not cross paragraph lines
    if (state.src.slice(start, end).includes('\n')) return false;
    if (end === start) return false;

    // An inline rule must advance `state.pos` in validation mode too: the
    // parser walks link labels with it, and a rule that reports a match
    // without moving on makes the whole parse throw.
    state.pos = end + 1;

    if (silent) return true;

    const content = state.src.slice(start, end);
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
    return true;
  });

  // Render rules
  md.renderer.rules.math_block = (tokens, idx) => {
    const formula = tokens[idx].content.trim();
    try {
      const rendered = katex.renderToString(formula, {
        displayMode: true,
        throwOnError: false
      });
      return `<div class="katex-block" data-math="true" data-formula="${md.utils.escapeHtml(formula)}"${md.renderer.renderAttrs(tokens[idx])}>${rendered}</div>`;
    } catch (err) {
      return `<pre class="katex-error">${md.utils.escapeHtml(formula)}</pre>`;
    }
  };

  md.renderer.rules.math_inline = (tokens, idx) => {
    const formula = tokens[idx].content.trim();
    try {
      const rendered = katex.renderToString(formula, {
        displayMode: false,
        throwOnError: false
      });
      return `<span class="katex-inline" data-math="true" data-formula="${md.utils.escapeHtml(formula)}">${rendered}</span>`;
    } catch (err) {
      return `<code class="katex-error">${md.utils.escapeHtml(formula)}</code>`;
    }
  };
}

/**
 * The callout kinds and their titles.
 */
const CALLOUT_KINDS = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

/**
 * GitHub-style callouts.
 *
 * A blockquote that starts with `[!NOTE]` (or any other kind) becomes a
 * coloured panel with a title, the way GitHub and Obsidian render them.
 */
function calloutPlugin(md) {
  md.core.ruler.after('inline', 'callouts', (state) => {
    const tokens = state.tokens;
    let index = 0;

    while (index < tokens.length) {
      const open = tokens[index];

      if (open.type !== 'blockquote_open') {
        index++;
        continue;
      }

      const paragraphOpen = tokens[index + 1];
      const inline = tokens[index + 2];
      const paragraphClose = tokens[index + 3];
      const close = tokens[index + 4];

      const isSimpleBlockquote =
        paragraphOpen?.type === 'paragraph_open' &&
        inline?.type === 'inline' &&
        paragraphClose?.type === 'paragraph_close' &&
        close?.type === 'blockquote_close';

      if (!isSimpleBlockquote) {
        index++;
        continue;
      }

      // The marker sits on its own line — the line break after it is part of
      // the marker, not of the text.
      const match = inline.content.match(/^\[!(\w+)\][ \t]*\r?\n?/);
      const kind = match?.[1]?.toLowerCase();

      if (!kind || !CALLOUT_KINDS[kind]) {
        index++;
        continue;
      }

      // The marker is the beginning of the first text run — take it off.
      const first = inline.children?.[0];
      if (first?.type === 'text') {
        first.content = first.content.slice(match[0].length);
        if (!first.content) inline.children.shift();
      }

      // The line break that followed the marker belongs to the marker.
      while (
        inline.children?.[0] &&
        (inline.children[0].type === 'softbreak' ||
          (inline.children[0].type === 'text' && !inline.children[0].content))
      ) {
        inline.children.shift();
      }

      open.type = 'callout_open';
      open.tag = 'div';
      open.attrJoin('class', `callout callout-${kind}`);
      close.type = 'callout_close';
      close.tag = 'div';

      // The title of the callout.
      const titleOpen = new state.Token('callout_title_open', 'p', 1);
      titleOpen.attrJoin('class', 'callout-title');
      const titleText = new state.Token('text', '', 0);
      titleText.content = CALLOUT_KINDS[kind];
      const titleInline = new state.Token('inline', '', 0);
      titleInline.content = CALLOUT_KINDS[kind];
      titleInline.children = [titleText];
      const titleClose = new state.Token('callout_title_close', 'p', -1);

      tokens.splice(index + 1, 0, titleOpen, titleInline, titleClose);
      index += 6;
    }
  });

  md.renderer.rules.callout_open = (tokens, idx) =>
    `<div class="${tokens[idx].attrGet('class') || 'callout'}">\n`;
  md.renderer.rules.callout_close = () => `</div>\n`;
  md.renderer.rules.callout_title_open = (tokens, idx) =>
    `<p class="${tokens[idx].attrGet('class') || 'callout-title'}">`;
  md.renderer.rules.callout_title_close = () => `</p>\n`;
}

/**
 * Turns a heading into a link to itself.
 *
 * The permalink is what makes a heading shareable: the reader can copy the
 * address of the exact section they are looking at.
 */
function headingAnchorPlugin(md) {
  md.core.ruler.after('inline', 'heading_anchors', (state) => {
    // The slugs are counted per render: the same document must always get
    // the same ids, or a permalink would stop working after an edit.
    const used = new Map();

    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (token.type !== 'heading_open') continue;

      const inline = state.tokens[index + 1];
      if (!inline || inline.type !== 'inline') continue;

      const text = inline.children
        .filter((child) => child.type === 'text' || child.type === 'code_inline')
        .map((child) => child.content)
        .join('')
        .trim();

      const base = slugify(text);
      const seen = used.get(base) || 0;
      used.set(base, seen + 1);
      const slug = seen === 0 ? base : `${base}-${seen + 1}`;

      token.attrSet('id', slug);

      const link = new state.Token('link_open', 'a', 1);
      link.attrSet('href', `#${slug}`);
      link.attrSet('class', 'heading-anchor');
      link.attrSet('aria-label', `Link to “${text}”`);

      // The sign of the permalink comes from the stylesheet, so the heading
      // keeps its plain text — the outline and the breadcrumb read it.
      const marker = new state.Token('text', '', 0);
      marker.content = '';

      const close = new state.Token('link_close', 'a', -1);

      inline.children.push(link, marker, close);
    }
  });
}

/**
 * Turns a heading into an anchor-friendly slug.
 *
 * Letters, digits and the marks that hang under them (Thai and Devanagari
 * vowels, for instance) are kept — a slug that loses them is no slug.
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

// Initialize MarkdownIt
const md = new MarkdownIt({
  html: true,
  xhtmlOut: false,
  breaks: true,
  linkify: true,
  typographer: true,
  highlight: (str, lang, attrs) => {
    const attrString = attrs || '';
    if (getSettings().highlightMode === 'off') {
      return `<pre class="hljs"${attrString}><code>${md.utils.escapeHtml(str)}</code></pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"${attrString}><code class="language-${lang}">${highlighted}</code></pre>`;
      } catch (e) {
        // Fallback below
      }
    }
    return `<pre class="hljs"${attrString}><code>${md.utils.escapeHtml(str)}</code></pre>`;
  }
});

/**
 * Tags every top-level block with the source line it starts on.
 *
 * This is what makes line-anchored synchronised scrolling possible: the
 * preview can then be positioned on the same paragraph the editor shows.
 */
md.core.ruler.push('source_lines', (state) => {
  for (const token of state.tokens) {
    if (token.level !== 0 || !token.map || token.type === 'inline') continue;
    token.attrSet('data-line', String(token.map[0] + 1));
    token.attrSet('data-line-end', String(token.map[1]));
  }
});

// Custom link validation allowing file:// and vscode:// schemes
const BAD_PROTO_RE = /^(vbscript|javascript):/i;
const GOOD_DATA_RE = /^data:image\/(gif|png|jpeg|webp);/i;
md.validateLink = (url) => {
  const str = url.trim().toLowerCase();
  return BAD_PROTO_RE.test(str) ? false : str.startsWith('data:') ? GOOD_DATA_RE.test(str) : true;
};

/**
 * Converts local file:// URLs to VS Code protocol URLs
 * e.g. file:///c:/path/to/file.py#L511 -> vscode://file/c:/path/to/file.py:511
 *      file:///c:/path/to/file.py#L511-L520 -> vscode://file/c:/path/to/file.py:511
 * @param {string} url
 * @returns {string}
 */
function convertFileToVsCode(url) {
  if (!/^file:\/\//i.test(url)) return url;

  let raw = url.replace(/^file:\/\//i, '');
  // For Windows drive paths (e.g. /c:/...), remove leading slash for clean VS Code URI
  if (raw.startsWith('/') && /^[a-zA-Z]:/.test(raw.slice(1))) {
    raw = raw.slice(1);
  } else if (!raw.startsWith('/')) {
    raw = '/' + raw;
  }

  const hashIdx = raw.indexOf('#');
  let filePath = raw;
  let line = '';

  if (hashIdx !== -1) {
    filePath = raw.slice(0, hashIdx);
    const hash = raw.slice(hashIdx + 1);
    const lineMatch = hash.match(/^L?(\d+)/i);
    if (lineMatch) {
      line = ':' + lineMatch[1];
    }
  }

  return 'vscode://file' + (filePath.startsWith('/') ? '' : '/') + filePath + line;
}

// Intercept link_open to apply VS Code scheme conversion if enabled
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex('href');
  if (hrefIndex >= 0) {
    const href = token.attrs[hrefIndex][1];
    const shouldConvertToVsCode =
      env && typeof env.openFileInVsCode === 'boolean'
        ? env.openFileInVsCode
        : getSettings().openFileInVsCode !== false;

    if (shouldConvertToVsCode && /^file:\/\//i.test(href)) {
      token.attrs[hrefIndex][1] = convertFileToVsCode(href);
      token.attrSet('title', 'Open file in Visual Studio Code');
    }
  }

  // External links open in a new tab and never leak the opener reference.
  const finalHref = hrefIndex >= 0 ? token.attrs[hrefIndex][1] : '';
  if (/^https?:\/\//i.test(finalHref)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }

  return defaultLinkOpen(tokens, idx, options, env, self);
};

// Register Plugins
md.use(taskLists, { enabled: true, label: true, labelAfter: true });
md.use(katexPlugin);
md.use(footnote);
// The full list of shortcodes, but rendered as the character itself — the
// picture variant would need the network, and this app works offline.
md.use(emoji, { defs: emojiDefs, shortcuts: emojiShortcuts });
md.use(calloutPlugin);
md.use(headingAnchorPlugin);

/**
 * Mermaid fences become a placeholder instead of a code block.
 *
 * The source is kept in the DOM (hidden) and the diagram is drawn later by
 * the Mermaid renderer, because Mermaid needs a live document to measure and
 * lay out its labels. Keeping the source also means a diagram still shows
 * its code when the renderer cannot be loaded.
 */
const defaultFence =
  md.renderer.rules.fence ||
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

/**
 * Reads a `key="value"` pair out of a fence info string.
 * @param {string} info
 * @param {string} key
 * @returns {string} the value, or an empty string
 */
function readFenceAttribute(info, key) {
  const match = info.match(new RegExp(`${key}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? match[1] : '';
}

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = (token.info || '').trim();
  const language = info.split(/\s+/)[0].toLowerCase();

  if (language !== 'mermaid') {
    return withCodeHeader(defaultFence(tokens, idx, options, env, self), token, language);
  }

  const source = token.content.replace(/\n$/, '');
  const caption = readFenceAttribute(info, 'caption');

  return (
    `<figure class="mermaid-block" data-mermaid="true"${self.renderAttrs(token)}>` +
    (caption
      ? `<figcaption class="mermaid-caption">${md.utils.escapeHtml(caption)}</figcaption>`
      : '') +
    `<div class="mermaid-viewport"><div class="mermaid-canvas"></div></div>` +
    `<pre class="mermaid-source" hidden><code class="language-mermaid">${md.utils.escapeHtml(source)}</code></pre>` +
    `</figure>`
  );
};

/**
 * Wraps a code block in a panel with a header and a line-number gutter.
 *
 * The header carries the language and a copy button; the gutter is a column
 * of numbers next to the code, which keeps the code itself untouched.
 * @param {string} html the rendered code block
 * @param {object} token the fence token
 * @param {string} language
 * @returns {string}
 */
function withCodeHeader(html, token, language) {
  const lines = token.content.replace(/\n$/, '').split('\n').length;
  const gutter =
    lines > 1
      ? `<div class="code-gutter" aria-hidden="true">${Array.from(
          { length: lines },
          (_, index) => index + 1
        ).join('\n')}</div>`
      : '';

  return (
    `<div class="code-block" data-language="${md.utils.escapeHtml(language || 'text')}">` +
    `<div class="code-head"><span class="code-lang">${md.utils.escapeHtml(language || 'text')}</span>` +
    `<button type="button" class="code-copy" data-code-copy aria-label="Copy the code">Copy</button></div>` +
    `<div class="code-body">${gutter}${html}</div>` +
    `</div>`
  );
}

// DOMPurify Configuration allowing KaTeX MathML, SVGs, file:// and vscode:// URLs
const DOMPURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|file|vscode):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  ADD_TAGS: [
    'math',
    'semantics',
    'annotation',
    'mtext',
    'mi',
    'mo',
    'mn',
    'mrow',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'mover',
    'munder',
    'munderover',
    'mtable',
    'mtr',
    'mtd',
    'msqrt',
    'mroot',
    'svg',
    'path',
    'line',
    'polygon',
    'circle',
    'rect'
  ],
  ADD_ATTR: [
    'aria-hidden',
    'aria-label',
    'aria-pressed',
    'data-word-id',
    'data-math',
    'data-formula',
    'data-line',
    'target',
    'rel',
    'title',
    'viewBox',
    'xmlns',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin'
  ]
};

/**
 * Parses a document into Markdown-it tokens without rendering them.
 *
 * The parse is done once for the whole document. Footnotes, heading slugs and
 * the line maps are document-wide facts, so a chunk that was parsed on its
 * own would be wrong.
 *
 * @param {string} markdownText
 * @param {object} [env={}]
 * @returns {{ body: string, tokens: object[], env: object }}
 */
export function parseMarkdownDocument(markdownText, env = {}) {
  const { body } = parseFrontmatter(markdownText);
  const tokens = markdownText ? md.parse(body, env) : [];
  return { body, tokens, env };
}

/**
 * Groups tokens so every group is a balanced top-level fragment.
 *
 * A paragraph, a list, a table, a blockquote and the footnote section each
 * stay whole. Rendering such a group on its own is safe for the sanitizer;
 * cutting inside a list would produce half an element.
 *
 * @param {object[]} tokens
 * @returns {object[][]}
 */
export function groupMarkdownTokens(tokens) {
  const groups = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];

    if (token.level !== 0) {
      index += 1;
      continue;
    }

    if (token.nesting === 0 || token.nesting === undefined) {
      groups.push(tokens.slice(index, index + 1));
      index += 1;
      continue;
    }

    if (token.nesting === 1) {
      let end = index + 1;

      while (end < tokens.length) {
        const candidate = tokens[end];
        if (candidate.level === 0 && candidate.nesting === -1) {
          end += 1;
          break;
        }
        end += 1;
      }

      groups.push(tokens.slice(index, end));
      index = end;
      continue;
    }

    // A stray closing token is not rendered on its own.
    index += 1;
  }

  return groups;
}

/**
 * The source line range a token group covers.
 *
 * @param {object[]} group
 * @returns {{ startLine: number, endLine: number }}
 */
export function groupLineRange(group) {
  let start = null;
  let end = null;

  for (const token of group) {
    if (!token.map) continue;
    if (start === null || token.map[0] < start) start = token.map[0];
    if (end === null || token.map[1] > end) end = token.map[1];
  }

  return {
    startLine: start === null ? 1 : start + 1,
    endLine: end === null ? (start === null ? 1 : start + 1) : end
  };
}

/**
 * Renders and sanitizes one balanced token group.
 *
 * @param {object[]} group
 * @param {object} [env={}]
 * @returns {string}
 */
export function renderMarkdownGroup(group, env = {}) {
  if (!group || group.length === 0) return '';
  const rawHtml = md.renderer.render(group, md.options, env);
  return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
}

/**
 * Renders a whole document from an already-parsed token list.
 *
 * @param {object[]} tokens
 * @param {object} [env={}]
 * @returns {string}
 */
export function renderMarkdownTokens(tokens, env = {}) {
  if (!tokens || tokens.length === 0) return '';
  const rawHtml = md.renderer.render(tokens, md.options, env);
  return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
}

/**
 * Converts markdown raw string to sanitized HTML
 *
 * The front matter is taken out first: it is metadata, not content, and it
 * must not show up in the preview.
 * @param {string} markdownText
 * @param {object} [env={}] Optional render environment
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(markdownText, env = {}) {
  if (!markdownText) return '';
  const { body } = parseFrontmatter(markdownText);
  const rawHtml = md.render(body, env);
  return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
}

/**
 * Reads the front matter of a document.
 * @param {string} markdownText
 * @returns {Record<string, string>} the values of the block
 */
export function getDocumentMeta(markdownText) {
  return parseFrontmatter(markdownText).data;
}
