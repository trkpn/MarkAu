/**
 * ============================================================================
 * TRANSLATION — DOCUMENT PLANNING
 * ============================================================================
 * Turns a Markdown document into a plan the translator can carry out, and
 * turns the answer back into a Markdown document.
 *
 * The whole difficulty of translating a document is that the translator
 * knows nothing about Markdown. Left alone it will happily translate the
 * name of a function, break a link apart, or decide that a table row is a
 * sentence and move half of it somewhere else.
 *
 * So the document is taken apart first:
 *
 *   • the parts that carry meaning on their own — code, formulas, front
 *     matter — are set aside and never sent anywhere
 *   • the parts that only carry structure — the `#` of a heading, the `-`
 *     of a list, the `|` of a table — are lifted off and put back on
 *   • the words in between are marked with a token, so that the translator
 *     moves them around as a whole and cannot split them
 *
 * The tokens are numbered. A token that comes back changed, or missing, or
 * doubled means that the translator did something to the structure — and
 * then the unit is not used. The original text stays. A document that is
 * half-translated is better than a document whose code no longer compiles.
 *
 * A token also remembers whether it has to stay glued to the word next to
 * it. A translator that writes `** bold **` has broken the emphasis, and
 * Markdown would show the stars instead of the bold words — so the space
 * that was put there is taken away again.
 * ============================================================================
 */

/** The token a protected piece of text is replaced by: ⟦12⟧ */
const TOKEN_PATTERN = /⟦(\d+)⟧/g;

/** The patterns of the parts that are set aside and never translated. */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const MATH_BLOCK_RE = /^\s*\$\$\s*$/;
const HTML_LINE_RE = /^\s*</;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const HEADING_RE = /^(\s*)(#{1,6})(\s+)(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\])?(\s*)(.*)$/;
const QUOTE_RE = /^(\s*)(>+)([ \t]*)(.*)$/;
/** A block of code that is indented by four spaces. */
const INDENTED_CODE_RE = /^(?: {4}|\t)\S/;

/** A horizontal rule: a line of three signs and nothing else. */
const RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;

/**
 * The parts inside a line that must not be translated, in the order they
 * are looked for. The first rule that matches a piece of text wins, so the
 * rules that cover the bigger structures come first.
 *
 * Every rule says what it protects. Most of them protect a whole piece of
 * text; the rules for the destination of a link and for the marks of
 * emphasis protect only a part of it, so that the words around stay
 * translatable.
 */
const PROTECTED_PATTERNS = [
  // Inline code: `code`, ``code with ` inside``
  { pattern: /(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, protect: 'all' },
  // Inline math: $formula$
  { pattern: /\$(?!\$)([^$\n]+?)(?<!\$)\$/g, protect: 'all' },
  // An image: the whole thing, the alt text included
  { pattern: /!\[[^\]]*\]\([^)]*\)/g, protect: 'all' },
  // The destination of a link: the text of the link stays translatable
  { pattern: /(\[[^\]]*\])(\([^)]*\))/g, protect: 'group', group: 2 },
  // A footnote reference: [^1]
  { pattern: /\[\^[^\]\s]+\]/g, protect: 'all' },
  // The label of a callout: > [!NOTE]
  { pattern: /\[!(?:note|tip|important|warning|caution)\]/gi, protect: 'all' },
  // An address written the long way: <https://example.com>
  { pattern: /<(?:https?:\/\/|mailto:)[^>\s]+>/g, protect: 'all' },
  // A bare address
  { pattern: /https?:\/\/[^\s<>()[\]]+/g, protect: 'all' },
  // An HTML entity: &amp; &mdash; &#8212;
  { pattern: /&[a-zA-Z][a-zA-Z0-9]*;|&#\d+;/g, protect: 'all' },
  // Strong emphasis: **text**
  { pattern: /(\*\*)([\s\S]*?)(\*\*)/g, protect: 'marks', mark: 1, end: 3 },
  // Emphasis with an underscore: _text_
  { pattern: /(?<![\w\\])(_)([^_\n]*?)(_)(?![\w\\])/g, protect: 'marks', mark: 1, end: 3 },
  // Emphasis with a star: *text*
  { pattern: /(?<![\w*\\])(\*)([^*\n]*?)(\*)(?![\w*\\])/g, protect: 'marks', mark: 1, end: 3 },
  // Struck through: ~~text~~
  { pattern: /(~~)([\s\S]*?)(~~)/g, protect: 'marks', mark: 1, end: 3 }
];

/**
 * Splits a document into its lines, keeping the place each line starts and
 * ends at. The end of a line includes the line ending, so that a range
 * taken from the document always carries it.
 * @param {string} source
 * @returns {Array<{ text: string, start: number, end: number }>}
 */
function readLines(source) {
  const lines = [];
  let start = 0;

  for (let i = 0; i <= source.length; i += 1) {
    if (i === source.length || source[i] === '\n') {
      lines.push({
        text: source.slice(start, i),
        start,
        end: i < source.length ? i + 1 : i
      });
      start = i + 1;
    }
  }

  return lines;
}

/**
 * The text of a line without the carriage return of a Windows line ending.
 * @param {string} text
 * @returns {string}
 */
function stripCarriageReturn(text) {
  return text.endsWith('\r') ? text.slice(0, -1) : text;
}

/**
 * Hands out a token and remembers what it stands for.
 *
 * `glueAfter` says that no space may follow the token, `glueBefore` that
 * none may come before it. A translator that puts a space where there was
 * none has broken the structure, and the space is taken away again.
 *
 * @param {Map<number, object>} registry
 * @param {string} text the text the token stands for
 * @param {{ glueAfter?: boolean, glueBefore?: boolean }} [options]
 * @returns {number} the id of the token
 */
function issueToken(registry, text, options = {}) {
  const id = registry.size;
  registry.set(id, {
    text,
    glueAfter: Boolean(options.glueAfter),
    glueBefore: Boolean(options.glueBefore)
  });
  return id;
}

/**
 * Replaces the protected parts of a piece of text with numbered tokens.
 *
 * @param {string} text
 * @param {Map<number, object>} registry the tokens that were handed out
 * @param {number[]} used the ids of the tokens this text uses
 * @returns {string} the text with the protected parts replaced
 */
export function maskText(text, registry, used) {
  let masked = String(text || '');

  for (const rule of PROTECTED_PATTERNS) {
    masked = masked.replace(rule.pattern, (match, ...groups) => {
      if (rule.protect === 'group') {
        // The whole match stays, but the group that was named is replaced.
        const group = groups[rule.group - 1] ?? '';
        const start = match.indexOf(group);
        const id = issueToken(registry, group, { glueBefore: true });
        used.push(id);
        return match.slice(0, start) + `⟦${id}⟧` + match.slice(start + group.length);
      }

      if (rule.protect === 'marks') {
        // The marks are protected, the words between them are not.
        const open = groups[rule.mark - 1] ?? '';
        const close = groups[rule.end - 1] ?? open;
        const inside = match.slice(open.length, match.length - close.length);

        const openId = issueToken(registry, open, { glueAfter: true });
        const closeId = issueToken(registry, close, { glueBefore: true });
        used.push(openId, closeId);

        return `⟦${openId}⟧${inside}⟦${closeId}⟧`;
      }

      const id = issueToken(registry, match);
      used.push(id);
      return `⟦${id}⟧`;
    });
  }

  return masked;
}

/**
 * Puts the protected parts back into a translated text.
 *
 * @param {string} text the translated text, still carrying its tokens
 * @param {Map<number, object>} registry
 * @returns {string}
 */
export function unmaskText(text, registry) {
  const source = String(text || '');
  const pattern = new RegExp(TOKEN_PATTERN.source, 'g');

  let output = '';
  let cursor = 0;
  let match = pattern.exec(source);

  while (match) {
    const entry = registry.get(Number(match[1]));
    const tokenEnd = match.index + match[0].length;

    if (!entry) {
      output += source.slice(cursor, tokenEnd);
      cursor = tokenEnd;
      match = pattern.exec(source);
      continue;
    }

    // A space that the translator put in front of the token is taken away
    // again when the token has to stay glued to what comes before it.
    let start = match.index;
    if (entry.glueBefore) {
      while (start > cursor && /\s/.test(source[start - 1])) start -= 1;
    }

    output += source.slice(cursor, start);
    output += entry.text;
    cursor = tokenEnd;

    // The same on the other side.
    if (entry.glueAfter) {
      while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    }

    match = pattern.exec(source);
  }

  output += source.slice(cursor);
  return output;
}

/**
 * Tells whether a translated text still carries every token it should.
 *
 * The order of the tokens does not matter — a translator is free to move a
 * word that carries a token to another place in the sentence, and that is
 * usually the right thing to do. But a token that is gone, or that appears
 * twice, means that the structure was damaged.
 *
 * @param {string} text
 * @param {number[]} expected the ids of the tokens the text must carry
 * @returns {boolean}
 */
export function tokensIntact(text, expected) {
  if (!expected || expected.length === 0) return true;

  const seen = new Map();
  const pattern = new RegExp(TOKEN_PATTERN.source, 'g');
  let match = pattern.exec(text);

  while (match) {
    const id = Number(match[1]);
    seen.set(id, (seen.get(id) || 0) + 1);
    match = pattern.exec(text);
  }

  if (seen.size !== expected.length) return false;

  for (const id of expected) {
    if (seen.get(id) !== 1) return false;
  }

  return true;
}

/**
 * Splits a table row into the pieces it is made of: the cells with their
 * words, and the pipes between them.
 *
 * The pieces come in the order they stand in the row, so that the row can
 * be put back together exactly as it was.
 *
 * @param {string} row
 * @returns {Array<{ kind: 'cell'|'pipe', text: string }>}
 */
export function splitTableRow(row) {
  const text = String(row || '');
  const pieces = [];
  let cursor = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '|') continue;

    if (i > cursor) {
      pieces.push({ kind: 'cell', text: text.slice(cursor, i) });
    }
    pieces.push({ kind: 'pipe', text: '|' });
    cursor = i + 1;
  }

  if (cursor < text.length) {
    pieces.push({ kind: 'cell', text: text.slice(cursor) });
  }

  return pieces;
}

/**
 * Builds the plan of a document.
 *
 * The plan is a list of parts — either a piece of text that stays as it
 * is, or a reference to a unit that is to be translated — and the list of
 * the units themselves.
 *
 * @param {string} markdown
 * @returns {{ parts: Array<object>, units: Array<object>, registry: Map<number, object>, eol: string }}
 */
export function buildPlan(markdown) {
  const source = String(markdown || '');
  const lines = readLines(source);

  const parts = [];
  const units = [];
  const registry = new Map();

  let literal = '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';

  const pushLiteral = (text) => {
    literal += text;
  };

  const flushLiteral = () => {
    if (literal) {
      parts.push({ literal });
      literal = '';
    }
  };

  /**
   * Adds a unit of text that is to be translated.
   *
   * A unit that carries no words at all — a line that holds nothing but the
   * label of a callout, for instance — is not sent anywhere. There is
   * nothing to translate in it, and a translator that is handed a bare
   * token is likely to drop it.
   *
   * @param {string} text the text of the unit
   * @returns {number|null} the index of the unit, or null when there was
   *   nothing to translate
   */
  const addUnit = (text) => {
    const used = [];
    const masked = maskText(text, registry, used);

    // What is left of the text once the protected parts are taken away.
    const words = masked.replace(TOKEN_PATTERN, '').trim();
    if (!words) return null;

    flushLiteral();
    const index = units.length;
    units.push({ text: masked, expected: used, original: text });
    parts.push({ unit: index });
    return index;
  };

  /**
   * Puts a piece of the source into the plan as it is.
   * @param {number} from
   * @param {number} to
   */
  const keepRange = (from, to) => {
    pushLiteral(source.slice(from, to));
  };

  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const text = stripCarriageReturn(line.text);

    // The front matter, at the very top of the document only.
    if (index === 0 && /^---\s*$/.test(text)) {
      let end = index + 1;
      while (end < lines.length && !/^---\s*$/.test(stripCarriageReturn(lines[end].text))) {
        end += 1;
      }
      if (end < lines.length) {
        end += 1;
        keepRange(line.start, lines[end - 1].end);
        index = end;
        continue;
      }
    }

    // A horizontal rule — three signs and nothing else. It is structure,
    // not words.
    if (RULE_RE.test(text)) {
      keepRange(line.start, line.end);
      index += 1;
      continue;
    }

    // A fenced block of code — including the diagrams of Mermaid.
    const fence = FENCE_RE.exec(text);
    if (fence) {
      const marker = fence[1];
      let end = index + 1;
      while (end < lines.length) {
        const candidate = stripCarriageReturn(lines[end].text).trim();
        if (candidate.startsWith(marker[0].repeat(marker.length)) && /^[\s`~]*$/.test(candidate)) {
          end += 1;
          break;
        }
        end += 1;
      }
      keepRange(line.start, lines[end - 1].end);
      index = end;
      continue;
    }

    // A block of mathematics.
    if (MATH_BLOCK_RE.test(text)) {
      let end = index + 1;
      while (end < lines.length && !MATH_BLOCK_RE.test(stripCarriageReturn(lines[end].text))) {
        end += 1;
      }
      if (end < lines.length) end += 1;
      keepRange(line.start, lines[end - 1].end);
      index = end;
      continue;
    }

    // A line of HTML — it is read as code, not as prose.
    if (HTML_LINE_RE.test(text)) {
      let end = index + 1;
      while (
        end < lines.length &&
        stripCarriageReturn(lines[end].text).trim() !== '' &&
        !FENCE_RE.test(stripCarriageReturn(lines[end].text))
      ) {
        end += 1;
      }
      keepRange(line.start, lines[end - 1].end);
      index = end;
      continue;
    }

    // A table. Its rows are translated cell by cell, so that the columns
    // keep their places.
    if (TABLE_ROW_RE.test(text)) {
      let end = index;
      while (end < lines.length && TABLE_ROW_RE.test(stripCarriageReturn(lines[end].text))) {
        end += 1;
      }

      for (let row = index; row < end; row += 1) {
        const rowLine = lines[row];
        const rowText = stripCarriageReturn(rowLine.text);

        // The line that separates the head of a table from its body is
        // structure, not words.
        if (TABLE_DIVIDER_RE.test(rowText)) {
          keepRange(rowLine.start, rowLine.end);
          continue;
        }

        const pieces = splitTableRow(rowText);
        let cursor = rowLine.start;

        for (const piece of pieces) {
          if (piece.kind === 'pipe') {
            keepRange(cursor, cursor + 1);
            cursor += 1;
            continue;
          }

          const lead = /^\s*/.exec(piece.text)[0];
          const trail = /\s*$/.exec(piece.text)[0];
          const core = piece.text.slice(lead.length, piece.text.length - trail.length);

          // The spaces around the words are structure; they stay.
          keepRange(cursor, cursor + lead.length);
          cursor += lead.length;

          if (core) {
            const coreStart = cursor;
            const added = addUnit(core);
            if (added === null) {
              // Nothing to translate in this cell — it stays as it is.
              keepRange(coreStart, coreStart + core.length);
            }
          } else {
            keepRange(cursor, cursor + core.length);
          }
          cursor += core.length;

          keepRange(cursor, cursor + trail.length);
          cursor += trail.length;
        }

        // Whatever is left of the row after the last pipe.
        keepRange(cursor, rowLine.end);
      }

      index = end;
      continue;
    }

    // A blank line — the space between two paragraphs.
    if (text.trim() === '') {
      keepRange(line.start, line.end);
      index += 1;
      continue;
    }

    // A block of code that is indented by four spaces. It has no fence of
    // its own, so it is recognised by the indentation alone.
    if (INDENTED_CODE_RE.test(text)) {
      let end = index;
      while (end < lines.length) {
        const candidate = stripCarriageReturn(lines[end].text);
        if (candidate.trim() === '' || !INDENTED_CODE_RE.test(candidate)) break;
        end += 1;
      }

      keepRange(line.start, lines[end - 1].end);
      index = end;
      continue;
    }

    // Anything else is prose. One line is one unit: a line that is wrapped
    // over several lines is put back as it was, so that the shape of the
    // document survives the translation.
    const heading = HEADING_RE.exec(text);
    const list = LIST_RE.exec(text);
    const quote = QUOTE_RE.exec(text);

    let prefix = '';
    let body = text;

    if (heading) {
      prefix = heading[1] + heading[2] + heading[3];
      body = heading[4];
    } else if (list) {
      prefix = list[1] + list[2] + list[3] + (list[4] || '') + (list[5] || '');
      body = list[6];
    } else if (quote) {
      prefix = quote[1] + quote[2] + quote[3];
      body = quote[4];
    }

    const lead = /^\s*/.exec(body)[0];
    const trail = /\s*$/.exec(body)[0];
    const words = body.slice(lead.length, body.length - trail.length);

    if (!words) {
      // A line that is only a marker — nothing to translate.
      keepRange(line.start, line.end);
      index += 1;
      continue;
    }

    // The marker is put back on afterwards; only the words are sent.
    const bodyStart = line.start + prefix.length;

    keepRange(line.start, bodyStart + lead.length);

    const added = addUnit(words);
    if (added === null) {
      // A line that holds nothing but structure — such as the label of a
      // callout — stays as it is.
      keepRange(bodyStart + lead.length, bodyStart + lead.length + words.length);
    }

    // The spaces behind the words and the line ending.
    keepRange(bodyStart + lead.length + words.length, line.end);

    index += 1;
  }

  flushLiteral();

  return { parts, units, registry, eol };
}

/**
 * Puts a translated document back together.
 *
 * @param {{ parts: Array<object>, units: Array<object> }} plan
 * @param {Array<{ text: string, intact: boolean }>} results one per unit
 * @returns {string} the document
 */
export function rebuildDocument(plan, results) {
  let output = '';

  for (const part of plan.parts) {
    if (part.literal !== undefined) {
      output += part.literal;
      continue;
    }

    const unit = plan.units[part.unit];
    const result = results[part.unit];

    // A unit whose structure was damaged is left as it was.
    if (result && result.intact) {
      output += result.text;
    } else {
      output += unit.original;
    }
  }

  return output;
}

/**
 * Gives every line of a document the same line ending.
 *
 * A document that came with Windows line endings would otherwise end up
 * with a mixture of the two, because the units are joined into one line.
 *
 * @param {string} text
 * @param {string} eol
 * @returns {string}
 */
export function normalizeEol(text, eol) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  return eol === '\n' ? normalized : normalized.replace(/\n/g, '\r\n');
}
