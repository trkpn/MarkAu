/**
 * ============================================================================
 * TRANSLATION — THE PROVIDER
 * ============================================================================
 * The provider is the part that talks to the translator. It runs on the
 * server and in the browser, so it has to work with nothing but the
 * standard fetch.
 *
 * These tests pin down the two things it has to get right: the units must
 * come back in the places they went out, and a broken answer must never be
 * mistaken for a translation.
 */

import { describe, it, expect } from 'vitest';

const {
  assertTarget,
  buildTranslateUrl,
  parseTranslateResponse,
  translateText,
  translateUnits,
  groupUnits,
  splitUnits,
  joinUnits,
  splitLongUnit,
  MAX_BATCH_CHARS,
  MAX_UNIT_CHARS,
  MAX_BATCH_UNITS,
  CLIENTS,
  TranslateError
} = await import('../src/translation-provider.js');
const { TARGET_LANGUAGES } = await import('../src/translation-languages.js');

/**
 * A translator that answers with a fixed shape.
 * @param {object} [options]
 * @returns {typeof fetch}
 */
function fakeTranslator(options = {}) {
  const {
    text = 'แปลแล้ว',
    detected = 'en',
    status = 200,
    contentType = 'application/json'
  } = options;

  return async () =>
    new Response(
      contentType.includes('json')
        ? JSON.stringify({ sentences: [{ trans: text, orig: 'original' }], src: detected })
        : '<html>Error</html>',
      { status, headers: { 'content-type': contentType } }
    );
}

/**
 * A translator that hands back the very text it was given, so that a test
 * can follow a unit through the whole way.
 * @returns {typeof fetch}
 */
function echoingTranslator() {
  return async (url) => {
    const q = new URL(url).searchParams.get('q');
    return new Response(JSON.stringify({ sentences: [{ trans: q }], src: 'en' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
}

describe('the language that is asked for', () => {
  it('accepts a language the app knows', () => {
    expect(assertTarget('th')).toBe('th');
    expect(assertTarget('zh-CN')).toBe('zh-CN');
  });

  it('accepts every language the dialog offers', () => {
    // The dialog is filled from the same list — so a language the user can
    // choose must be a language the translator accepts.
    for (const language of TARGET_LANGUAGES) {
      expect(() => assertTarget(language.code)).not.toThrow();
    }
  });

  it('refuses a language it does not know', () => {
    expect(() => assertTarget('xx')).toThrow(TranslateError);
    expect(() => assertTarget('')).toThrow(TranslateError);
  });
});

describe('the address that is built', () => {
  it('asks for the language of the source to be found on its own', () => {
    const url = new URL(buildTranslateUrl('Hello', 'th'));

    expect(url.searchParams.get('sl')).toBe('auto');
    expect(url.searchParams.get('tl')).toBe('th');
    expect(url.searchParams.get('q')).toBe('Hello');
  });

  it('asks for the answer in a shape that can be read', () => {
    const url = new URL(buildTranslateUrl('Hello', 'th'));

    expect(url.searchParams.get('dj')).toBe('1');
    expect(url.searchParams.get('dt')).toBe('t');
  });
});

describe('the answer that comes back', () => {
  it('is read into the text and the language that was found', () => {
    const parsed = parseTranslateResponse({ sentences: [{ trans: 'สวัสดี' }], src: 'en' });

    expect(parsed.text).toBe('สวัสดี');
    expect(parsed.detected).toBe('en');
  });

  it('joins the sentences that came separately', () => {
    const parsed = parseTranslateResponse({
      sentences: [{ trans: 'สวัสดี' }, { trans: 'โลก' }],
      src: 'en'
    });

    expect(parsed.text).toBe('สวัสดีโลก');
  });

  it('is refused when it is not the shape that was expected', () => {
    expect(() => parseTranslateResponse(null)).toThrow(TranslateError);
    expect(() => parseTranslateResponse('nonsense')).toThrow(TranslateError);
  });
});

describe('asking the translator', () => {
  it('answers with the text and the language it found', async () => {
    const result = await translateText('Hello', 'th', {
      fetchImpl: fakeTranslator({ text: 'สวัสดี', detected: 'en' })
    });

    expect(result.text).toBe('สวัสดี');
    expect(result.detected).toBe('en');
  });

  it('does not read an error page as if it were an answer', async () => {
    await expect(
      translateText('Hello', 'th', {
        fetchImpl: fakeTranslator({ status: 400, contentType: 'text/html' })
      })
    ).rejects.toThrow(TranslateError);
  });

  it('says when the translator is busy', async () => {
    await expect(
      translateText('Hello', 'th', { fetchImpl: fakeTranslator({ status: 429 }) })
    ).rejects.toThrow(/busy/i);
  });

  it('tries another client when one is refused', async () => {
    // The clients are counted apart by the translator, and one of them can
    // be refused for hours while the others answer.
    const asked = [];

    const result = await translateText('Hello', 'th', {
      fetchImpl: async (url) => {
        const client = new URL(url).searchParams.get('client');
        asked.push(client);

        if (client === CLIENTS[0]) {
          return new Response('<html>Too many requests</html>', {
            status: 429,
            headers: { 'content-type': 'text/html' }
          });
        }

        return new Response(
          JSON.stringify({ sentences: [{ trans: 'สวัสดี' }], src: 'en' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    });

    expect(result.text).toBe('สวัสดี');
    expect(asked.length).toBeGreaterThan(1);
  });

  it('goes straight to the client that answered last', async () => {
    const asked = [];

    const fetchImpl = async (url) => {
      asked.push(new URL(url).searchParams.get('client'));
      return new Response(
        JSON.stringify({ sentences: [{ trans: 'สวัสดี' }], src: 'en' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    await translateText('One', 'th', { fetchImpl });
    await translateText('Two', 'th', { fetchImpl });

    // The second request goes to the same client as the first.
    expect(asked[1]).toBe(asked[0]);
  });

  it('gives up when every client is refused', async () => {
    const asked = [];

    await expect(
      translateText('Hello', 'th', {
        fetchImpl: async (url) => {
          asked.push(new URL(url).searchParams.get('client'));
          return new Response('<html>Too many requests</html>', {
            status: 429,
            headers: { 'content-type': 'text/html' }
          });
        }
      })
    ).rejects.toThrow(/busy/i);

    // Every client is tried — and none of them twice.
    expect(asked.length).toBe(new Set(asked).size);
  });
});

describe('the units of a request', () => {
  it('are joined by a separator that is not a word', () => {
    expect(joinUnits(['one', 'two'])).toContain('⟦§⟧');
  });

  it('are found apart again', () => {
    expect(splitUnits('one ⟦§⟧ two', 2)).toEqual(['one', 'two']);
  });

  it('cannot be found apart when one of them is missing', () => {
    expect(splitUnits('one ⟦§⟧ two ⟦§⟧ three', 2)).toBeNull();
  });

  it('are grouped so that no request is too large', () => {
    const units = Array.from({ length: 60 }, () => 'a'.repeat(200));
    const groups = groupUnits(units);

    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      expect(group.length).toBeLessThanOrEqual(MAX_BATCH_UNITS);
      expect(group.join('').length).toBeLessThanOrEqual(MAX_BATCH_CHARS + MAX_UNIT_CHARS);
    }
  });

  it('are cut at a space when one of them is too long', () => {
    const pieces = splitLongUnit('word '.repeat(400));

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_UNIT_CHARS);
      expect(piece).not.toMatch(/\s$/);
    }
  });

  it('are cut even when there is no space to cut at', () => {
    const pieces = splitLongUnit('x'.repeat(3000));

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_UNIT_CHARS);
    }
  });

  it('keep the unit a piece came from', () => {
    const groups = groupUnits(['short', 'x'.repeat(3000)]);

    expect(groups[0][0]).toEqual({ unit: 0, text: 'short' });
    // The long unit is cut into pieces, and every one of them remembers
    // the unit it belongs to.
    for (const piece of groups.flat()) {
      expect(typeof piece.unit).toBe('number');
      expect(typeof piece.text).toBe('string');
    }
  });
});

describe('translating a list of units', () => {
  it('gives one answer per unit', async () => {
    const { results } = await translateUnits(['one', 'two'], 'th', {
      fetchImpl: echoingTranslator()
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toContain('one');
    expect(results[1]).toContain('two');
  });

  it('keeps the units in their places', async () => {
    const units = ['alpha', 'beta', 'gamma', 'delta'];
    const { results } = await translateUnits(units, 'th', { fetchImpl: echoingTranslator() });

    units.forEach((unit, index) => {
      expect(results[index]).toContain(unit);
    });
  });

  it('reports the language it found', async () => {
    const { detected } = await translateUnits(['one'], 'th', {
      fetchImpl: fakeTranslator({ detected: 'ja' })
    });

    expect(detected).toBe('ja');
  });

  it('asks for a unit on its own when the units cannot be found apart', async () => {
    // A translator that answers without the separator — the units have to
    // be asked for one by one so that they keep their places.
    const { results } = await translateUnits(['one', 'two'], 'th', {
      fetchImpl: async (url) => {
        const q = new URL(url).searchParams.get('q');
        return new Response(JSON.stringify({ sentences: [{ trans: q }], src: 'en' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    expect(results).toHaveLength(2);
  });

  it('gives one answer per unit even when a unit was cut in two', async () => {
    // A unit that is too long travels in pieces — and the pieces have to
    // be put back together, or the answers of the units after it would
    // land in the wrong places.
    const long = 'word '.repeat(400);
    const units = [long, 'SECOND-UNIT'];

    const { results } = await translateUnits(units, 'th', {
      fetchImpl: echoingTranslator()
    });

    expect(results).toHaveLength(2);
    expect(results[1]).toContain('SECOND-UNIT');
    expect(results[0]).toContain('word');
  });
});
