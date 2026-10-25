/**
 * @vitest-environment jsdom
 *
 * A control the density system sheds from the header must stay reachable:
 * it reappears in the ⋯ menu, and the voice select physically moves there
 * so there is one select wherever it currently lives.
 */
import { describe, it, expect, beforeEach } from 'vitest';

function installMarkup() {
  document.body.innerHTML = `
    <header class="app-header">
      <div class="zone-left"></div>
      <div class="zone-right">
        <div class="voice-select-wrapper">
          <select id="voice-select"><option value="">Loading voices…</option></select>
        </div>
        <button id="btn-more">⋯</button>
      </div>
      <div id="header-more-menu" class="header-more-menu" hidden>
        <div class="more-menu-section" id="more-voice-section" hidden>
          <div id="more-voice-slot"></div>
        </div>
        <button class="more-item" data-target="btn-paste">Paste</button>
      </div>
    </header>
    <button id="btn-paste"></button>`;
}

installMarkup();

const { el } = await import('@/app/shell/dom.js');
const { syncHeaderMoreMenu, initHeaderMoreMenu } = await import('@/app/shell/more-menu.js');

// The app initializes the menu once; the tests share that same instance.
initHeaderMoreMenu();

describe('syncHeaderMoreMenu', () => {
  beforeEach(() => {
    const header = el.appHeader;
    for (const attr of Array.from(header.attributes)) {
      if (attr.name.startsWith('data-')) header.removeAttribute(attr.name);
    }
    // Put the voice select back in its header home.
    el.voiceSelectWrapper.appendChild(el.voiceSelect);
    el.headerMoreMenu.setAttribute('hidden', '');
  });

  it('shows the ⋯ button when a control was shed', () => {
    el.appHeader.setAttribute('data-hide-paste', 'true');

    syncHeaderMoreMenu();

    expect(el.appHeader.getAttribute('data-show-more')).toBe('true');
  });

  it('keeps the ⋯ button away when everything fits', () => {
    syncHeaderMoreMenu();

    expect(el.appHeader.getAttribute('data-show-more')).toBe('false');
  });

  it('moves the voice select into the menu when the header hid it', () => {
    el.appHeader.setAttribute('data-hide-voice', 'true');

    syncHeaderMoreMenu();

    expect(el.voiceSelect.parentElement).toBe(el.moreVoiceSlot);
    expect(el.moreVoiceSection.hidden).toBe(false);
  });

  it('brings the voice select back to the header when there is room again', () => {
    el.appHeader.setAttribute('data-hide-voice', 'true');
    syncHeaderMoreMenu();

    el.appHeader.removeAttribute('data-hide-voice');
    syncHeaderMoreMenu();

    expect(el.voiceSelect.parentElement).toBe(el.voiceSelectWrapper);
    expect(el.moreVoiceSection.hidden).toBe(true);
  });
});

describe('initHeaderMoreMenu', () => {
  beforeEach(() => {
    el.headerMoreMenu.setAttribute('hidden', '');
    el.btnMore.setAttribute('aria-expanded', 'false');
    el.appHeader.setAttribute('data-show-more', 'true');
  });

  it('opens and closes with the ⋯ button', () => {
    el.btnMore.click();
    expect(el.headerMoreMenu.hasAttribute('hidden')).toBe(false);
    expect(el.btnMore.getAttribute('aria-expanded')).toBe('true');

    el.btnMore.click();
    expect(el.headerMoreMenu.hasAttribute('hidden')).toBe(true);
  });

  it('a menu item presses the real button it mirrors', () => {
    let pressed = 0;
    el.btnPaste.addEventListener('click', () => {
      pressed += 1;
    });

    el.btnMore.click();
    el.headerMoreMenu.querySelector('.more-item[data-target="btn-paste"]').click();

    expect(pressed).toBe(1);
    // The menu closed itself after choosing.
    expect(el.headerMoreMenu.hasAttribute('hidden')).toBe(true);
  });

  it('closes when a tap lands outside the menu', () => {
    el.btnMore.click();
    expect(el.headerMoreMenu.hasAttribute('hidden')).toBe(false);

    document.body.click();
    expect(el.headerMoreMenu.hasAttribute('hidden')).toBe(true);
  });
});
