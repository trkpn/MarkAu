/**
 * Markdown Engine Specification:
 * - Markdown-it with CommonMark + GFM (Tables, Task lists, Strikethrough, Autolinks)
 * - LaTeX Math rendering via KaTeX ($inline$ & $$block$$)
 * - Code Syntax Highlighting via Highlight.js
 * - XSS Sanitization via DOMPurify preserving KaTeX MathML, SVG, and TTS token attributes
 */
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import katex from 'katex';
import hljsCommon from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { getSettings } from './settings-manager.js';

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

    if (silent) return true;

    const content = state.src.slice(start, end);
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
    state.pos = end + 1;
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
 * Converts markdown raw string to sanitized HTML
 * @param {string} markdownText
 * @param {object} [env={}] Optional render environment
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(markdownText, env = {}) {
  if (!markdownText) return '';
  const rawHtml = md.render(markdownText, env);
  return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
}
