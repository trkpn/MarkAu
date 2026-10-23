/**
 * ============================================================================
 * TRANSLATION — THE PLAN OF A DOCUMENT
 * ============================================================================
 * The plan is what stands between a Markdown document and a translator that
 * knows nothing about Markdown. These tests pin down the promises it makes:
 * that code is never sent, that structure is put back, and that a
 * translator which damages a unit cannot damage the document.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';

const {
  buildPlan,
  rebuildDocument,
  maskText,
  unmaskText,
  tokensIntact,
  splitTableRow,
  normalizeEol
} = await import('../src/translation.js');
const { SEPARATOR } = await import('../src/translation-provider.js');

/**
 * The text of a unit as it would be sent to the translator.
 * @param {object} plan
 * @param {number} index
 * @returns {string}
 */
function unitAt(plan, index) {
  return plan.units[index].text;
}

/**
 * Assembles a plan back into a document, pretending every unit came back
 * untouched. Useful for checking that nothing was lost on the way.
 * @param {object} plan
 * @returns {string}
 */
function rebuildUnchanged(plan) {
  return rebuildDocument(
    plan,
    plan.units.map((unit) => ({ text: unit.original, intact: true }))
  );
}

describe('the parts that are never sent to the translator', () => {
  it('leaves the front matter alone', () => {
    const plan = buildPlan('---\ntitle: Hello\nauthor: Tawatchai\n---\n\nThe body.');

    expect(plan.units).toHaveLength(1);
    expect(unitAt(plan, 0)).toBe('The body.');
  });

  it('leaves a fenced block of code alone', () => {
    const plan = buildPlan('Before.\n\n```js\nconst x = 1;\n```\n\nAfter.');

    expect(plan.units).toHaveLength(2);
    expect(unitAt(plan, 0)).toBe('Before.');
    expect(unitAt(plan, 1)).toBe('After.');
  });

  it('leaves a diagram of Mermaid alone', () => {
    const plan = buildPlan('```mermaid\ngraph TD;\n  A-->B;\n```');

    expect(plan.units).toHaveLength(0);
  });

  it('leaves a block of mathematics alone', () => {
    const plan = buildPlan('$$\nE = mc^2\n$$\n\nThe text.');

    expect(plan.units).toHaveLength(1);
    expect(unitAt(plan, 0)).toBe('The text.');
  });

  it('leaves a line of HTML alone', () => {
    const plan = buildPlan('<div class="note">\nHello\n</div>\n\nThe text.');

    expect(plan.units.map((unit) => unit.text)).toContain('The text.');
    expect(plan.units.map((unit) => unit.text)).not.toContain('Hello');
  });
});

describe('the parts that carry structure', () => {
  it('takes the marker of a heading off and puts it back', () => {
    const plan = buildPlan('## The heading');

    expect(unitAt(plan, 0)).toBe('The heading');
    expect(rebuildUnchanged(plan)).toBe('## The heading');
  });

  it('takes the marker of a list item off and puts it back', () => {
    const plan = buildPlan('- The first item\n- The second item');

    expect(unitAt(plan, 0)).toBe('The first item');
    expect(unitAt(plan, 1)).toBe('The second item');
    expect(rebuildUnchanged(plan)).toBe('- The first item\n- The second item');
  });

  it('keeps the mark of a task list', () => {
    const plan = buildPlan('- [ ] Something to do');

    expect(unitAt(plan, 0)).toBe('Something to do');
    expect(rebuildUnchanged(plan)).toBe('- [ ] Something to do');
  });

  it('keeps the mark of a numbered list', () => {
    const plan = buildPlan('1. The first one\n2. The second one');

    expect(unitAt(plan, 0)).toBe('The first one');
    expect(rebuildUnchanged(plan)).toBe('1. The first one\n2. The second one');
  });

  it('keeps the mark of a quotation', () => {
    const plan = buildPlan('> A wise word');

    expect(unitAt(plan, 0)).toBe('A wise word');
    expect(rebuildUnchanged(plan)).toBe('> A wise word');
  });
});

describe('the parts that must survive the translation', () => {
  it('marks inline code and gives it back', () => {
    const plan = buildPlan('Run `npm install` first.');
    const unit = plan.units[0];

    expect(unit.text).not.toContain('npm install');
    expect(unit.text).toContain('⟦0⟧');
    expect(unit.original).toBe('Run `npm install` first.');

    const restored = unmaskText('เรียก ⟦0⟧ ก่อน', plan.registry);
    expect(restored).toBe('เรียก `npm install` ก่อน');
  });

  it('marks the destination of a link but not its text', () => {
    const plan = buildPlan('Read [the guide](https://example.com/guide) now.');
    const unit = plan.units[0];

    expect(unit.text).toContain('the guide');
    expect(unit.text).not.toContain('example.com');
    expect(unit.original).toBe('Read [the guide](https://example.com/guide) now.');
  });

  it('marks an image as a whole', () => {
    const plan = buildPlan('Look: ![a diagram](diagram.png) here.');
    const unit = plan.units[0];

    expect(unit.text).not.toContain('diagram.png');
    expect(unit.text).not.toContain('a diagram');
  });

  it('marks a footnote reference', () => {
    const plan = buildPlan('A claim[^1] here.');

    expect(plan.units[0].text).not.toContain('[^1]');
  });

  it('marks the label of a callout', () => {
    const plan = buildPlan('> [!NOTE] Something worth knowing');

    expect(plan.units[0].text).not.toContain('[!NOTE]');
  });

  it('marks a formula written inline', () => {
    const plan = buildPlan('The value $x^2 + y^2$ matters.');

    expect(plan.units[0].text).not.toContain('x^2 + y^2');
  });

  it('marks the marks of emphasis', () => {
    const plan = buildPlan('This is **bold** and *italic* and ~~gone~~.');

    expect(plan.units[0].text).not.toContain('**');
    expect(plan.units[0].text).not.toContain('~~');
    expect(plan.units[0].original).toBe('This is **bold** and *italic* and ~~gone~~.');
  });
});

describe('a table', () => {
  it('translates its cells and keeps its columns', () => {
    const plan = buildPlan('| Head one | Head two |\n| --- | --- |\n| Value A | Value B |');

    expect(plan.units.map((unit) => unit.text)).toEqual([
      'Head one',
      'Head two',
      'Value A',
      'Value B'
    ]);
  });

  it('puts the row back together', () => {
    const plan = buildPlan('| Head one | Head two |\n| --- | --- |\n| Value A | Value B |');

    expect(rebuildUnchanged(plan)).toBe(
      '| Head one | Head two |\n| --- | --- |\n| Value A | Value B |'
    );
  });

  it('splits a row into its cells and its pipes', () => {
    expect(splitTableRow('| A | B |')).toEqual([
      { kind: 'pipe', text: '|' },
      { kind: 'cell', text: ' A ' },
      { kind: 'pipe', text: '|' },
      { kind: 'cell', text: ' B ' },
      { kind: 'pipe', text: '|' }
    ]);
  });

  it('splits a row that has no outer pipes', () => {
    expect(splitTableRow('A | B')).toEqual([
      { kind: 'cell', text: 'A ' },
      { kind: 'pipe', text: '|' },
      { kind: 'cell', text: ' B' }
    ]);
  });
});

describe('when the translator damages a unit', () => {
  it('knows that a token is missing', () => {
    expect(tokensIntact('the ⟦0⟧ text', [0])).toBe(true);
    expect(tokensIntact('the text', [0])).toBe(false);
    expect(tokensIntact('the ⟦0⟧ text ⟦0⟧', [0])).toBe(false);
    expect(tokensIntact('the ⟦0⟧ text', [0, 1])).toBe(false);
  });

  it('does not mind that the tokens moved', () => {
    // A translator may put the word that carries a token somewhere else in
    // the sentence — that is usually the right thing to do.
    expect(tokensIntact('⟦1⟧ โลก ⟦0⟧ สวัสดี', [0, 1])).toBe(true);
  });

  it('keeps the original text of a unit that was damaged', () => {
    const plan = buildPlan('A line of words.');
    const damaged = [{ text: 'โครงสร้างเสีย', intact: false }];

    expect(rebuildDocument(plan, damaged)).toBe('A line of words.');
  });

  it('uses the translation of a unit that came back whole', () => {
    const plan = buildPlan('A line of words.');
    const whole = [{ text: 'บรรทัดของคำ', intact: true }];

    expect(rebuildDocument(plan, whole)).toBe('บรรทัดของคำ');
  });
});

describe('the document as a whole', () => {
  it('survives a round trip through the plan', () => {
    const document = [
      '---',
      'title: A document',
      '---',
      '',
      '# The heading',
      '',
      'Some **bold** words with `code` in them.',
      '',
      '- A list item',
      '- Another one',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '> A quotation'
    ].join('\n');

    expect(rebuildUnchanged(buildPlan(document))).toBe(document);
  });

  it('gives every line of a Windows document the same ending', () => {
    const plan = buildPlan('First line\r\nSecond line');

    expect(plan.eol).toBe('\r\n');
    expect(normalizeEol('First line\nSecond line', plan.eol)).toBe('First line\r\nSecond line');
  });

  it('has a separator that is not a token', () => {
    // The separator that joins two units into one request must not be
    // mistaken for one of the tokens that protect the structure.
    expect(SEPARATOR).not.toMatch(/⟦\d+⟧/);
  });

  it('keeps a paragraph that is wrapped over several lines as it is', () => {
    // The lines of a paragraph stay separate: a translator that is handed
    // a piece of a sentence cannot make a sentence out of it.
    const plan = buildPlan('A sentence that is\nwrapped over two lines.');

    expect(plan.units).toHaveLength(2);
    expect(plan.units[0].text).toBe('A sentence that is');
    expect(plan.units[1].text).toBe('wrapped over two lines.');
  });

  it('does not repeat the text of a wrapped paragraph when it puts it back', () => {
    const plan = buildPlan('A sentence that is\nwrapped over two lines.');
    const output = rebuildUnchanged(plan);

    expect(output).toBe('A sentence that is\nwrapped over two lines.');
  });

  it('keeps a line that holds nothing but structure', () => {
    // A callout label on its own line is structure, not words.
    const plan = buildPlan('> [!NOTE]\n> A note worth reading.');

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0].text).toBe('A note worth reading.');
    expect(rebuildUnchanged(plan)).toBe('> [!NOTE]\n> A note worth reading.');
  });

  it('keeps a block of code that is indented by four spaces', () => {
    const plan = buildPlan('A paragraph.\n\n    const x = 1;\n');

    expect(plan.units.map((unit) => unit.text)).toEqual(['A paragraph.']);
    expect(rebuildUnchanged(plan)).toBe('A paragraph.\n\n    const x = 1;\n');
  });

  it('keeps a quotation whatever the space behind the sign', () => {
    // The sign of a quotation is followed by any number of spaces — and
    // the words have to be found in the right place every time.
    for (const source of [
      '>no space\n',
      '> one space\n',
      '>  two spaces\n',
      '>   three spaces\n',
      '>no space at all here\n'
    ]) {
      const plan = buildPlan(source);
      const words = source.replace(/^>\s*/, '').trim();

      expect(plan.units).toHaveLength(1);
      expect(plan.units[0].text).toBe(words);
      expect(rebuildUnchanged(plan)).toBe(source);
    }
  });

  it('keeps a horizontal rule out of the translator', () => {
    const plan = buildPlan('A paragraph.\n\n---\n\nAnother paragraph.');

    expect(plan.units.map((unit) => unit.text)).toEqual(['A paragraph.', 'Another paragraph.']);
  });
});

describe('masking on its own', () => {
  it('hands out a token for every protected part', () => {
    const registry = new Map();
    const used = [];

    const masked = maskText('a `code` and a [link](https://x.test)', registry, used);

    expect(registry.size).toBe(2);
    expect(used).toEqual([0, 1]);
    expect(masked).toBe('a ⟦0⟧ and a [link]⟦1⟧');
  });

  it('gives the protected parts back', () => {
    const registry = new Map();
    const used = [];
    maskText('a `code` here', registry, used);

    expect(unmaskText('a ⟦0⟧ here', registry)).toBe('a `code` here');
  });
});
