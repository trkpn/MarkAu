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
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

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
      return `<div class="katex-block" data-math="true" data-formula="${md.utils.escapeHtml(formula)}">${rendered}</div>`;
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
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="language-${lang}">${highlighted}</code></pre>`;
      } catch (e) {
        // Fallback
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  }
});

// Register Plugins
md.use(taskLists, { enabled: true, label: true, labelAfter: true });
md.use(katexPlugin);

// DOMPurify Configuration allowing KaTeX MathML and SVGs
const DOMPURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_TAGS: [
    'math', 'semantics', 'annotation', 'mtext', 'mi', 'mo', 'mn',
    'mrow', 'msup', 'msub', 'msubsup', 'mfrac', 'mover', 'munder',
    'munderover', 'mtable', 'mtr', 'mtd', 'msqrt', 'mroot',
    'svg', 'path', 'line', 'polygon', 'circle', 'rect'
  ],
  ADD_ATTR: [
    'aria-hidden', 'data-word-id', 'data-math', 'data-formula',
    'target', 'rel', 'viewBox', 'xmlns', 'fill', 'stroke',
    'stroke-width', 'stroke-linecap', 'stroke-linejoin'
  ]
};

/**
 * Converts markdown raw string to sanitized HTML
 * @param {string} markdownText
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(markdownText) {
  if (!markdownText) return '';
  const rawHtml = md.render(markdownText);
  return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
}
