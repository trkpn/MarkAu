/**
 * ============================================================================
 * DOCX
 * Turns a Word document into a document.
 *
 * A .docx is a zip file that holds the text as XML. The words of the
 * document are in `word/document.xml`; the styles that say which paragraph
 * is a heading and which is a list are in `word/styles.xml`; the numbering
 * of the lists is in `word/numbering.xml`; and the targets of the links are
 * in `word/_rels/document.xml.rels`.
 *
 * All of that is read here, in the browser. The file never goes anywhere
 * else, and no library beyond the zip reader is needed.
 * ============================================================================
 */

import { unzipAsync } from '@/importers/zip.js';
import { reportProgress, throwIfAborted, yieldToMainThread } from '@/core/schedule.js';

/** The namespace of the parts of a Word document. */
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Opens the bundle of a Word document.
 *
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Record<string, Uint8Array>>} the files, by name
 */
export async function unzipDocx(bytes, options = {}) {
  try {
    return await unzipAsync(bytes, options);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('That file is not a Word document.');
  }
}

/**
 * Turns bytes into text.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeXml(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Reads a part of the document as XML.
 *
 * @param {Uint8Array} bytes
 * @param {string} part the name of the part, for the message of an error
 * @returns {XMLDocument}
 */
function parseXml(bytes, part) {
  const doc = new DOMParser().parseFromString(decodeXml(bytes), 'application/xml');
  const failed = doc.getElementsByTagName('parsererror').length > 0;

  if (!doc.documentElement || failed) {
    throw new Error(`The ${part} of that Word document could not be read.`);
  }

  return doc;
}

/**
 * The elements of a node that carry a name.
 *
 * @param {Node|null} node
 * @param {string} name the local name, without its prefix
 * @returns {Element[]}
 */
function elements(node, name) {
  if (!node || !node.getElementsByTagName) return [];
  return Array.from(node.getElementsByTagName('*')).filter(
    (element) => element.localName === name
  );
}

/**
 * The direct children of a node that carry a name.
 *
 * @param {Node|null} node
 * @param {string} name
 * @returns {Element[]}
 */
function childrenOf(node, name) {
  if (!node) return [];

  return Array.from(node.childNodes || []).filter(
    (child) => child.nodeType === 1 && child.localName === name
  );
}

/**
 * The first direct child of a node that carries a name.
 *
 * @param {Node|null} node
 * @param {string} name
 * @returns {Element|null}
 */
function childOf(node, name) {
  return childrenOf(node, name)[0] || null;
}

/**
 * Reads an attribute, with or without its namespace prefix.
 *
 * @param {Element|null} node
 * @param {string} name the local name, without its prefix
 * @returns {string}
 */
function attribute(node, name) {
  if (!node || node.nodeType !== 1) return '';

  const prefixed = node.getAttribute(`w:${name}`);
  if (prefixed !== null) return prefixed;

  const namespaced = node.getAttributeNS?.(WORD_NAMESPACE, name);
  if (namespaced !== null && namespaced !== undefined) return namespaced;

  const found = Array.from(node.attributes || []).find((item) => item.localName === name);
  return found ? found.value : '';
}

/**
 * Reads the styles of the document.
 *
 * @param {Record<string, Uint8Array>} files
 * @returns {Map<string, {
 *   id: string,
 *   name: string,
 *   basedOn: string,
 *   outline: number|null,
 *   numId: string,
 *   ilvl: string
 * }>}
 */
export function readStyles(files) {
  const styles = new Map();
  const bytes = files['word/styles.xml'];
  if (!bytes) return styles;

  const doc = parseXml(bytes, 'styles');

  for (const style of elements(doc, 'style')) {
    const type = attribute(style, 'type');
    if (type && type !== 'paragraph') continue;

    const id = attribute(style, 'styleId');
    if (!id) continue;

    const pPr = childOf(style, 'pPr');
    const outline = attribute(childOf(pPr, 'outlineLvl'), 'val');
    const numPr = childOf(pPr, 'numPr');

    styles.set(id, {
      id,
      name: attribute(childOf(style, 'name'), 'val'),
      basedOn: attribute(childOf(style, 'basedOn'), 'val'),
      outline: outline === '' ? null : Number(outline),
      numId: attribute(childOf(numPr, 'numId'), 'val'),
      ilvl: attribute(childOf(numPr, 'ilvl'), 'val')
    });
  }

  return styles;
}

/**
 * The level of a heading, from an outline value.
 *
 * In OOXML an outline level of 0–8 is a heading; 9 means body text, and not
 * a heading at all. The app draws six levels, so a deeper heading is folded
 * into the sixth.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null} 1–6 for a heading, 0 for body text, null when the
 * value says nothing about the outline
 */
function headingFromOutline(value) {
  if (value === '' || value === null || value === undefined) return null;

  const outline = Number(value);
  if (!Number.isFinite(outline) || outline < 0) return null;
  if (outline >= 9) return 0;

  return Math.min(6, Math.floor(outline) + 1);
}

/**
 * The level of a heading, from its style.
 *
 * @param {string} styleId
 * @param {Map<string, object>} styles
 * @returns {number} 0 when the style is not a heading
 */
export function headingLevel(styleId, styles) {
  const seen = new Set();
  let current = styleId;

  while (current && !seen.has(current)) {
    seen.add(current);

    const fromId = current.match(/^Heading[ _]?([1-9])$/i);
    if (fromId) return Math.min(6, Number(fromId[1]));
    if (/^Title$/i.test(current)) return 1;
    if (/^Subtitle$/i.test(current)) return 2;

    const style = styles.get(current);
    if (!style) break;

    const name = String(style.name || '').trim();
    const fromName = name.match(/^Heading\s*([1-9])$/i) || name.match(/^H([1-9])$/i);
    if (fromName) return Math.min(6, Number(fromName[1]));
    if (/^Title$/i.test(name)) return 1;
    if (/^Subtitle$/i.test(name)) return 2;

    if (style.outline !== null) {
      const fromOutline = headingFromOutline(style.outline);
      if (fromOutline !== null) return fromOutline;
    }

    current = style.basedOn;
  }

  return 0;
}

/**
 * The list a paragraph belongs to, through its style.
 *
 * @param {string} styleId
 * @param {Map<string, object>} styles
 * @returns {{ numId: string, ilvl: string }}
 */
function numberingOfStyle(styleId, styles) {
  const seen = new Set();
  let current = styleId;
  let numId = '';
  let ilvl = '';

  while (current && !seen.has(current)) {
    seen.add(current);

    const style = styles.get(current);
    if (!style) break;

    if (!numId) numId = style.numId;
    if (!ilvl) ilvl = style.ilvl;
    if (numId) break;

    current = style.basedOn;
  }

  return { numId, ilvl };
}

/**
 * Reads the numbering of the lists.
 *
 * @param {Record<string, Uint8Array>} files
 * @returns {Map<string, Map<number, { ordered: boolean }>>} by number id
 */
export function readNumbering(files) {
  const numbering = new Map();
  const bytes = files['word/numbering.xml'];
  if (!bytes) return numbering;

  const doc = parseXml(bytes, 'numbering');
  const abstracts = new Map();

  for (const abstract of elements(doc, 'abstractNum')) {
    const levels = new Map();

    for (const level of childrenOf(abstract, 'lvl')) {
      const index = Number(attribute(level, 'ilvl') || 0);
      const format = attribute(childOf(level, 'numFmt'), 'val') || 'decimal';
      levels.set(index, { ordered: !/^(bullet|none)$/i.test(format) });
    }

    abstracts.set(attribute(abstract, 'abstractNumId'), levels);
  }

  for (const number of elements(doc, 'num')) {
    const id = attribute(number, 'numId');
    const abstractId = attribute(childOf(number, 'abstractNumId'), 'val');
    numbering.set(id, abstracts.get(abstractId) || new Map());
  }

  return numbering;
}

/**
 * Reads the targets of the links of the document.
 *
 * @param {Record<string, Uint8Array>} files
 * @returns {Map<string, string>} the target, by relationship id
 */
export function readRelationships(files) {
  const relationships = new Map();
  const bytes = files['word/_rels/document.xml.rels'];
  if (!bytes) return relationships;

  const doc = parseXml(bytes, 'links');

  for (const relationship of elements(doc, 'Relationship')) {
    const id = attribute(relationship, 'Id');
    const target = attribute(relationship, 'Target');
    if (id && target) relationships.set(id, target);
  }

  return relationships;
}

/**
 * Reads the title and the author of the document.
 *
 * @param {Record<string, Uint8Array>} files
 * @returns {{ title: string, author: string }}
 */
export function readDocxMetadata(files) {
  const bytes = files['docProps/core.xml'];
  if (!bytes) return { title: '', author: '' };

  try {
    const doc = parseXml(bytes, 'properties');
    const text = (name) =>
      String(elements(doc, name)[0]?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();

    return { title: text('title'), author: text('creator') };
  } catch {
    return { title: '', author: '' };
  }
}

/**
 * Tells whether a property of a run is switched on.
 *
 * @param {Element|null} properties
 * @param {string} name
 * @returns {boolean}
 */
function switchedOn(properties, name) {
  const property = childOf(properties, name);
  if (!property) return false;

  const value = attribute(property, 'val').toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

/**
 * Escapes the characters that Markdown would read as a mark.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeText(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/([\\`*_[\]<>~$])/g, '\\$1');
}

/**
 * Escapes the marks that only have a meaning at the start of a line.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeLineStarts(text) {
  return String(text || '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)(\d+)([.)])(\s)/, '$1$2\\$3$4')
        .replace(/^(\s*)([#>+\-*])(\s)/, '$1\\$2$3')
        // A line of only dashes or only equals signs is a thematic break or
        // a setext underline, not the paragraph the Word document had.
        .replace(/^(\s*)(-{3,}|={3,})(\s*)$/, '$1\\$2$3')
    )
    .join('\n');
}

/**
 * Wraps a run in a pair of marks, keeping the spaces outside of them.
 *
 * @param {string} text
 * @param {string} opening
 * @param {string} [closing]
 * @returns {string}
 */
function wrap(text, opening, closing = opening) {
  const match = String(text || '').match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match || !match[2]) return text;
  return `${match[1]}${opening}${match[2]}${closing}${match[3]}`;
}

/**
 * Describes an image inside a run.
 *
 * @param {Element} node
 * @returns {string} the alternative text, or an empty string
 */
function imageAlt(node) {
  const properties = elements(node, 'docPr')[0];
  if (!properties) return '';
  return String(attribute(properties, 'descr') || attribute(properties, 'name') || '').trim();
}

/**
 * Turns a run of text into Markdown.
 *
 * @param {Element} run
 * @param {object} context
 * @returns {string}
 */
function renderRun(run) {
  let text = '';
  let image = '';

  for (const child of Array.from(run.childNodes || [])) {
    if (child.nodeType !== 1) continue;

    switch (child.localName) {
      case 't':
        text += escapeText(child.textContent || '');
        break;
      case 'tab':
        text += '\t';
        break;
      case 'br':
      case 'cr':
        text += '  \n';
        break;
      case 'noBreakHyphen':
        text += '-';
        break;
      case 'drawing':
      case 'pict':
      case 'object':
        image = image || imageAlt(child);
        break;
      default:
        break;
    }
  }

  if (image && !text.trim()) {
    return `_(${escapeText(image)})_`;
  }

  if (!text) return '';

  const properties = childOf(run, 'rPr');
  const style = attribute(childOf(properties, 'rStyle'), 'val');

  let bold = switchedOn(properties, 'b');
  let italic = switchedOn(properties, 'i');
  let strike = switchedOn(properties, 'strike') || switchedOn(properties, 'dstrike');
  const underline = switchedOn(properties, 'u');
  const vertical = attribute(childOf(properties, 'vertAlign'), 'val');

  if (/Strong|Bold/i.test(style)) bold = true;
  if (/Emphasis|Italic/i.test(style)) italic = true;
  if (/Strike/i.test(style)) strike = true;

  if (bold) text = wrap(text, '**');
  if (italic) text = wrap(text, '_');
  if (strike) text = wrap(text, '~~');
  if (underline) text = wrap(text, '<u>', '</u>');
  if (vertical === 'superscript') text = wrap(text, '<sup>', '</sup>');
  if (vertical === 'subscript') text = wrap(text, '<sub>', '</sub>');

  return text;
}

/**
 * Turns the target of a link into something Markdown accepts.
 *
 * @param {string} target
 * @returns {string}
 */
function linkTarget(target) {
  return String(target || '')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * Turns a hyperlink into Markdown.
 *
 * @param {Element} link
 * @param {object} context
 * @returns {string}
 */
function renderHyperlink(link, context) {
  const id = attribute(link, 'id');
  const anchor = attribute(link, 'anchor');

  let target = id ? context.relationships.get(id) || '' : '';
  if (!target && anchor) target = `#${anchor}`;

  const text = renderInline(link, context).trim();

  if (!target) return text;
  return `[${text || escapeText(target)}](${linkTarget(target)})`;
}

/**
 * Turns the content of an element into Markdown, run by run.
 *
 * @param {Element} node
 * @param {object} context
 * @returns {string}
 */
function renderInline(node, context) {
  let output = '';

  for (const child of Array.from(node.childNodes || [])) {
    if (child.nodeType !== 1) continue;

    switch (child.localName) {
      case 'r':
        output += renderRun(child);
        break;
      case 'hyperlink':
        output += renderHyperlink(child, context);
        break;
      case 'ins':
      case 'moveTo':
      case 'smartTag':
      case 'customXml':
      case 'dir':
      case 'bdo':
      case 'fldSimple':
        output += renderInline(child, context);
        break;
      case 'sdt':
        output += renderInline(childOf(child, 'sdtContent') || child, context);
        break;
      case 'p':
        output += renderInline(child, context);
        break;
      case 'del':
      case 'moveFrom':
      case 'instrText':
      case 'fldChar':
      case 'bookmarkStart':
      case 'bookmarkEnd':
      case 'proofErr':
      case 'commentRangeStart':
      case 'commentRangeEnd':
      case 'commentReference':
        break;
      default:
        break;
    }
  }

  return output;
}

/**
 * The properties of a paragraph that decide how it is written.
 *
 * @param {Element} paragraph
 * @param {object} context
 * @returns {{ heading: number, numId: string, ilvl: number }}
 */
function paragraphProperties(paragraph, context) {
  const properties = childOf(paragraph, 'pPr');
  const styleId = attribute(childOf(properties, 'pStyle'), 'val');

  let heading = headingLevel(styleId, context.styles);

  const outline = attribute(childOf(properties, 'outlineLvl'), 'val');
  const fromOutline = headingFromOutline(outline);
  if (fromOutline !== null) heading = fromOutline;

  const numPr = childOf(properties, 'numPr');
  let numId = attribute(childOf(numPr, 'numId'), 'val');
  let ilvl = attribute(childOf(numPr, 'ilvl'), 'val');

  if (!numId) {
    const fromStyle = numberingOfStyle(styleId, context.styles);
    numId = fromStyle.numId;
    if (!ilvl) ilvl = fromStyle.ilvl;
  }

  if (numId === '0') numId = '';

  return {
    heading,
    numId,
    ilvl: Number(ilvl || 0)
  };
}

/**
 * Writes one line of a list.
 *
 * @param {number} level
 * @param {boolean} ordered
 * @param {string} text
 * @returns {string}
 */
function renderListItem(level, ordered, text) {
  const indent = '    '.repeat(Math.max(0, Math.min(level, 8)));
  const marker = ordered ? '1.' : '-';
  const body = text.trim().replace(/\n/g, `  \n${indent}    `);

  return `${indent}${marker} ${body}`;
}

/**
 * Writes a table as a table of Markdown.
 *
 * @param {Element} table
 * @param {object} context
 * @returns {string}
 */
function renderTable(table, context) {
  const rows = childrenOf(table, 'tr').map((row) => {
    return childrenOf(row, 'tc').map((cell) => {
      const parts = [];

      for (const child of Array.from(cell.childNodes || [])) {
        if (child.nodeType !== 1) continue;

        if (child.localName === 'p') {
          const text = escapeLineStarts(renderInline(child, context).trim()).replace(
            /\s*\n\s*/g,
            '<br>'
          );
          if (text) parts.push(text);
        } else if (child.localName === 'sdt') {
          const content = childOf(child, 'sdtContent');
          if (content) {
            for (const inner of childrenOf(content, 'p')) {
              const text = escapeLineStarts(renderInline(inner, context).trim()).replace(
                /\s*\n\s*/g,
                '<br>'
              );
              if (text) parts.push(text);
            }
          }
        }
      }

      return parts.join('<br>').replace(/\|/g, '\\|');
    });
  });

  const filled = rows.filter((row) => row.length > 0);
  if (filled.length === 0) return '';

  const columns = Math.max(...filled.map((row) => row.length));
  const cell = (row, index) => row[index] || '';

  const lines = [];
  lines.push(`| ${filled[0].concat(Array(columns - filled[0].length).fill('')).join(' | ')} |`);
  lines.push(`| ${Array(columns).fill('---').join(' | ')} |`);

  for (const row of filled.slice(1)) {
    const values = [];
    for (let index = 0; index < columns; index += 1) values.push(cell(row, index));
    lines.push(`| ${values.join(' | ')} |`);
  }

  return lines.join('\n');
}

/**
 * Writes the body of the document.
 *
 * @param {Element} body
 * @param {object} context
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {(progress: { phase: string, done: number }) => void} [options.onProgress]
 * @returns {Promise<string[]>} the blocks of the document
 */
async function renderBlocks(body, context, { signal, onProgress } = {}) {
  const blocks = [];
  let list = [];
  let visited = 0;
  let sliceStarted = performance.now();

  const flushList = () => {
    if (list.length > 0) {
      blocks.push(list.join('\n'));
      list = [];
    }
  };

  const tick = async () => {
    visited += 1;

    if (visited % 100 === 0) {
      reportProgress(onProgress, { phase: 'converting', done: visited });
    }

    if (visited % 200 === 0 || performance.now() - sliceStarted > 8) {
      sliceStarted = performance.now();
      await yieldToMainThread();
      throwIfAborted(signal);
    }
  };

  const visit = async (node) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType !== 1) continue;
      throwIfAborted(signal);

      if (child.localName === 'p') {
        const { heading, numId, ilvl } = paragraphProperties(child, context);
        const text = escapeLineStarts(renderInline(child, context).trim());

        if (!text) continue;

        if (heading > 0) {
          flushList();
          blocks.push(`${'#'.repeat(heading)} ${text}`);
          await tick();
          continue;
        }

        if (numId) {
          const level = context.numbering.get(numId)?.get(ilvl);
          const ordered = level ? level.ordered : true;
          list.push(renderListItem(ilvl, ordered, text));
          await tick();
          continue;
        }

        flushList();
        blocks.push(text);
        await tick();
      } else if (child.localName === 'tbl') {
        flushList();
        const table = renderTable(child, context);
        if (table) blocks.push(table);
        await tick();
      } else if (['sdt', 'customXml', 'ins', 'moveTo'].includes(child.localName)) {
        await visit(child.localName === 'sdt' ? childOf(child, 'sdtContent') || child : child);
      }
    }
  };

  await visit(body);
  flushList();

  return blocks;
}

/**
 * The name of a file, taken from its address or from its path.
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
    return name.replace(/\.docx$/i, '');
  } catch {
    return value.replace(/^.*[\\/]/, '').replace(/\.docx$/i, '');
  }
}

/**
 * Takes the marks out of a heading, for the title of the document.
 *
 * @param {string} text
 * @returns {string}
 */
function plainText(text) {
  return String(text || '')
    .replace(/\\(.)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Folds the whitespace of a title without changing its marks.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanTitle(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turns a Word document into Markdown.
 *
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {string} [options.url] where the document came from
 * @param {(progress: { phase: string, done: number }) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ markdown: string, title: string, paragraphs: number }>}
 */
export async function docxToMarkdown(bytes, { url = '', onProgress, signal } = {}) {
  reportProgress(onProgress, { phase: 'unpacking', done: 0 });
  const files = await unzipDocx(bytes, { signal });
  throwIfAborted(signal);

  if (!files['word/document.xml']) {
    throw new Error('That file is not a Word document.');
  }

  const context = {
    styles: readStyles(files),
    numbering: readNumbering(files),
    relationships: readRelationships(files)
  };

  reportProgress(onProgress, { phase: 'reading', done: 0 });
  const documentXml = parseXml(files['word/document.xml'], 'text');
  const body = elements(documentXml, 'body')[0] || documentXml.documentElement;

  const blocks = await renderBlocks(body, context, { signal, onProgress });
  throwIfAborted(signal);

  const metadata = readDocxMetadata(files);
  const first = blocks[0] || '';
  const firstHeading = first.match(/^#{1,6}\s+(.+)$/)?.[1] || '';

  const title =
    cleanTitle(metadata.title) || plainText(firstHeading) || nameFromUrl(url) || 'Word document';

  // A document that already opens with a heading carries its own title. The
  // title of the file must not be written over it as a second heading.
  const headingAlreadyThere = Boolean(firstHeading);

  const titleHeading = headingAlreadyThere
    ? blocks[0]
    : `# ${escapeText(cleanTitle(title)) || 'Word document'}`;
  const rest = headingAlreadyThere ? blocks.slice(1) : blocks;

  const lines = [];
  lines.push(titleHeading);
  lines.push('');

  const facts = [];
  if (metadata.author) facts.push(`**Author:** ${escapeText(cleanTitle(metadata.author))}`);
  if (/^https?:\/\//i.test(url)) facts.push(`**Source:** ${url}`);
  if (facts.length > 0) {
    lines.push(facts.join('  \n'));
    lines.push('');
  }

  if (rest.length > 0) {
    lines.push(rest.join('\n\n'));
  }

  return {
    markdown: lines.join('\n').trim(),
    title: cleanTitle(title) || 'Word document',
    paragraphs: blocks.length
  };
}

/**
 * Builds the document of a Word file.
 *
 * @param {{ markdown: string }} docx
 * @returns {string}
 */
export function buildDocxDocument(docx) {
  return docx.markdown;
}
