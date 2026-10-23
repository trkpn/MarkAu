/**
 * ============================================================================
 * TRANSLATION — THE DIALOG
 * ============================================================================
 * The dialog is where the user says where the text should end up. These
 * tests make sure that it asks for one language only, that it knows what it
 * is about to translate, and that the original of the document survives a
 * translation.
 * ============================================================================
 */

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';

// The jsdom environment has no localStorage of its own — only that one
// piece is replaced, so that the rest of the environment stays real.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  }
};

const MARKUP = `
  <div id="modal-translate" class="modal-backdrop" hidden>
    <div class="modal-card">
      <div class="modal-body">
        <form id="translate-form">
          <label for="select-translate-target">Translate into</label>
          <select id="select-translate-target"></select>
          <p id="translate-scope"></p>
          <p id="translate-error" role="alert"></p>
          <button type="button" id="btn-translate-restore" hidden>Restore the original</button>
          <button type="button" id="btn-translate-cancel">Cancel</button>
          <button type="submit" id="btn-translate-run">Translate</button>
        </form>
      </div>
    </div>
  </div>
  <button id="btn-translate"></button>
  <button id="btn-close-translate"></button>
  <div id="translate-progress" hidden>
    <div id="translate-progress-bar"></div>
    <span id="translate-progress-label"></span>
    <button id="btn-translate-stop">Stop</button>
  </div>
  <textarea id="editor"></textarea>
`;

// The registry of elements is read once, when the module is loaded — so
// the markup has to be in place before that happens.
document.body.innerHTML = MARKUP;

const {
  openDialog,
  closeDialog,
  initTranslate,
  readBackup,
  saveBackup,
  clearBackup,
  runTranslation,
  runTranslationWithRetry
} = await import('../src/app/translate.js');
const { el } = await import('../src/app/dom.js');

describe('the dialog', () => {
  beforeEach(() => {
    storage.clear();
    el.editor.value = '';
    el.modalTranslate.setAttribute('hidden', '');
  });

  it('asks for one language only', () => {
    openDialog();

    const select = el.translateTarget;
    expect(select).toBeTruthy();
    expect(select.options.length).toBeGreaterThan(20);

    // The language of the document is never asked for — there is only one
    // field, and it holds the language the text should end up in.
    const labels = Array.from(document.querySelectorAll('#modal-translate label')).map((node) =>
      node.textContent.trim()
    );
    expect(labels.join(' ').toLowerCase()).not.toContain('from');
  });

  it('says that the whole document will be translated when nothing is selected', () => {
    el.editor.value = 'A paragraph of words.';
    el.editor.setSelectionRange(0, 0);

    openDialog();

    expect(el.translateScope.textContent).toContain('whole document');
  });

  it('says that only the selection will be translated when there is one', () => {
    el.editor.value = 'A paragraph of words.';
    el.editor.setSelectionRange(0, 9);

    openDialog();

    expect(el.translateScope.textContent).toContain('selected text');
    expect(el.translateScope.textContent).toContain('9');
  });

  it('opens and closes', () => {
    openDialog();
    expect(el.modalTranslate.hasAttribute('hidden')).toBe(false);

    closeDialog();
    expect(el.modalTranslate.hasAttribute('hidden')).toBe(true);
  });

  it('offers the original only while there is one to go back to', () => {
    openDialog();
    expect(el.btnTranslateRestore.hidden).toBe(true);

    storage.set(
      'markau_translation_backup',
      JSON.stringify({ markdown: '# The original', target: 'th', at: 1 })
    );

    openDialog();
    expect(el.btnTranslateRestore.hidden).toBe(false);
  });
});

describe('the original of the document', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('is kept so that the translation can be taken back', () => {
    // The backup is written by the translation itself; here only the
    // reading of it is checked, because that is what the button uses.
    expect(readBackup()).toBeNull();

    localStorage.setItem(
      'markau_translation_backup',
      JSON.stringify({ markdown: '# The original', target: 'th', at: 1 })
    );

    const backup = readBackup();
    expect(backup.markdown).toBe('# The original');
    expect(backup.target).toBe('th');
  });

  it('is not read from a broken payload', () => {
    localStorage.setItem('markau_translation_backup', 'not json');

    expect(readBackup()).toBeNull();
  });

  it('is not read when it holds nothing useful', () => {
    localStorage.setItem('markau_translation_backup', JSON.stringify({ target: 'th' }));

    expect(readBackup()).toBeNull();
  });

  it('is kept the first time', () => {
    expect(saveBackup('# The original', 'th')).toBe(true);
    expect(readBackup().markdown).toBe('# The original');
  });

  it('is not thrown away by a second translation', () => {
    // Translating a piece of a document that was translated already must
    // not lose the first original — that is the only way back.
    saveBackup('# The original', 'th');
    expect(saveBackup('# Something else', 'th')).toBe(false);

    expect(readBackup().markdown).toBe('# The original');
  });

  it('is forgotten when it is not wanted any more', () => {
    saveBackup('# The original', 'th');
    clearBackup();

    expect(readBackup()).toBeNull();
  });
});

describe('the button in the header', () => {
  it('opens the dialog', () => {
    initTranslate();

    el.btnTranslate.click();
    expect(el.modalTranslate.hasAttribute('hidden')).toBe(false);
  });
});

describe('a translation of many parts', () => {
  /**
   * A translator that answers with every unit it was given, marked — and
   * that lets a test watch the document change between the requests.
   * @param {() => void} onRequest called before each answer
   * @param {string[]} seen collects the document as it was at each request
   * @returns {typeof fetch}
   */
  function watchfulTranslator(onRequest, seen) {
    return async (input, init) => {
      const url = String(typeof input === 'string' ? input : input?.url);

      if (url.includes('/api/translate')) {
        // The document as it stands before this part is translated.
        seen.push(el.editor.value);
        onRequest();

        const body = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            ok: true,
            detected: 'en',
            results: body.units.map((unit) => `TH<${unit}>`)
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ sentences: [{ trans: 'TH<direct>' }], src: 'en' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
  }

  it('shows the parts that are done before the last one is translated', async () => {
    initTranslate();
    storage.clear();

    // A document long enough to need more than one request.
    const paragraph = 'A paragraph of words that goes on for a while. ';
    el.editor.value = [
      '# The first heading',
      '',
      paragraph.repeat(30),
      '',
      '## The second heading',
      '',
      paragraph.repeat(30),
      '',
      '### The third heading',
      '',
      paragraph.repeat(30)
    ].join('\n');
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    const seen = [];
    globalThis.fetch = watchfulTranslator(() => {}, seen);

    el.editor.setSelectionRange(0, 0);
    await runTranslation();

    // The document is translated in parts, not in one go.
    expect(seen.length).toBeGreaterThan(1);

    // The document as the user saw it, part by part: nothing is
    // translated at the beginning, and every part that comes back adds to
    // what is there — so the translation is seen to grow instead of
    // appearing all at once.
    const counts = seen.map((text) => (text.match(/TH</g) || []).length);
    const final = (el.editor.value.match(/TH</g) || []).length;

    expect(counts[0]).toBe(0);

    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThan(counts[index - 1]);
    }

    // And the last part was still missing when the last request went out.
    expect(counts[counts.length - 1]).toBeLessThan(final);
  });

  it('says how far it has come', async () => {
    initTranslate();
    storage.clear();

    const paragraph = 'A paragraph of words that goes on for a while. ';
    el.editor.value = [
      '# The first heading',
      '',
      paragraph.repeat(30),
      '',
      '## The second heading',
      '',
      paragraph.repeat(30)
    ].join('\n');
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    const labels = [];
    globalThis.fetch = watchfulTranslator(() => {
      labels.push(el.translateProgressLabel.textContent);
    }, []);

    el.editor.setSelectionRange(0, 0);
    await runTranslation();

    // The bar says what it is doing and how far it has come.
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0]).toMatch(/Translating — \d+ of \d+ parts/);

    // And it is put away when the work is done.
    expect(el.translateProgress.hasAttribute('hidden')).toBe(true);
  });

  it('stops when the user asks it to', async () => {
    initTranslate();
    storage.clear();

    const paragraph = 'A paragraph of words that goes on for a while. ';
    el.editor.value = [
      '# The first heading',
      '',
      paragraph.repeat(30),
      '',
      '## The second heading',
      '',
      paragraph.repeat(30),
      '',
      '### The third heading',
      '',
      paragraph.repeat(30)
    ].join('\n');
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    let requests = 0;
    globalThis.fetch = watchfulTranslator(() => {
      requests += 1;
      // The user stops it after the first part.
      if (requests === 1) el.btnTranslateStop.click();
    }, []);

    el.editor.setSelectionRange(0, 0);
    const finished = await runTranslation();

    expect(finished).toBe(false);
    // What was translated before the stop is still there.
    expect(el.editor.value).toContain('TH<');
    expect(el.translateProgress.hasAttribute('hidden')).toBe(true);
  });
});

describe('when the translator refuses', () => {
  it('tries again instead of giving up at once', async () => {
    // A refusal is not a failure of the document — it is the translator
    // saying that it is busy. The browser has a second way in, and when
    // that one is refused as well the request is made again.
    let attempts = 0;

    globalThis.fetch = async (input) => {
      const url = String(typeof input === 'string' ? input : input?.url);

      if (url.includes('/api/translate')) {
        attempts += 1;
        return new Response(
          JSON.stringify({ ok: false, error: 'The translator is busy right now.' }),
          { status: 429, headers: { 'content-type': 'application/json' } }
        );
      }

      // The browser's own way in refuses the first time, and answers the
      // second time.
      attempts += 1;
      if (attempts <= 2) {
        return new Response(
          JSON.stringify({ ok: false, error: 'The translator is busy right now.' }),
          { status: 429, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ sentences: [{ trans: 'แปลแล้ว' }], src: 'en' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    el.editor.value = 'A paragraph of words.';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    const done = await runTranslationWithRetry(3);

    expect(done).toBe(true);
    expect(attempts).toBeGreaterThan(1);
  });

  it('gives up after the last attempt and says so', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: false, error: 'The translator is busy right now.' }), {
        status: 429,
        headers: { 'content-type': 'application/json' }
      });

    el.editor.value = 'A paragraph of words.';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    const done = await runTranslationWithRetry(1);

    expect(done).toBe(false);
    expect(el.translateError.textContent).toContain('busy');
  });

  it('knows that the translator is busy even when the answer is not JSON', async () => {
    // A refusal often comes as a page of HTML — a captcha, a page of the
    // network. The status says what happened even when the body cannot
    // be read.
    globalThis.fetch = async () =>
      new Response('<html>Too many requests</html>', {
        status: 429,
        headers: { 'content-type': 'text/html' }
      });

    el.editor.value = 'A paragraph of words.';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    const done = await runTranslationWithRetry(1);

    expect(done).toBe(false);
    expect(el.translateError.textContent).toContain('busy');
  });
});
