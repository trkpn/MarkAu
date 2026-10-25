/**
 * ============================================================================
 * HEADER OVERFLOW MENU (⋯)
 * ============================================================================
 * On a narrow screen the density system (app/shell/toolbar.js) sheds the
 * least important controls from the single-row header. Without a way back
 * an iPhone user simply lost paste, history, the voice list and more.
 *
 * This menu is the way back: every control the density system hides has a
 * mirror item here, and the voice select physically moves into the menu so
 * there is one select, one source of truth, wherever it currently lives.
 *
 * The menu sits inside the header, so the same data-hide-* attributes that
 * hide a header button show its mirror item here (see the stylesheet). It
 * is fixed to the viewport, so the header's own scrolling row can neither
 * clip it nor shove it around.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';

/**
 * The drop steps whose controls retreat into the menu instead of vanishing.
 * Pure label-collapsing steps (brand, tabs, labels) have nothing to mirror.
 */
const MENU_STEPS = [
  'hideVoice',
  'hidePrint',
  'hideSample',
  'hideCopy',
  'hideImportUrl',
  'hidePaste',
  'hideHistory',
  'hideTranslate',
  'hideNewTab',
  'hideReset'
];

/** The drop-step attribute name as it appears on the header. */
function dataAttr(attr) {
  return `data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function isHidden(attr) {
  return el.appHeader?.getAttribute(dataAttr(attr)) === 'true';
}

/**
 * Syncs the menu with the density state of the header: shows the ⋯ button
 * when anything has retreated into the menu, and moves the voice select
 * between its two homes.
 *
 * Called by the density system after every recalculation.
 */
export function syncHeaderMoreMenu() {
  const header = el.appHeader;
  if (!header) return;

  const voiceHidden = isHidden('hideVoice');
  const anyHidden = MENU_STEPS.some(isHidden);

  header.setAttribute('data-show-more', anyHidden ? 'true' : 'false');

  if (voiceHidden && el.moreVoiceSlot && el.voiceSelect.parentElement !== el.moreVoiceSlot) {
    el.moreVoiceSlot.appendChild(el.voiceSelect);
  } else if (
    !voiceHidden &&
    el.voiceSelectWrapper &&
    el.voiceSelect.parentElement !== el.voiceSelectWrapper
  ) {
    el.voiceSelectWrapper.appendChild(el.voiceSelect);
  }

  if (el.moreVoiceSection) {
    el.moreVoiceSection.hidden = !voiceHidden;
  }
}

/**
 * Initializes the overflow menu.
 */
export function initHeaderMoreMenu() {
  const menu = el.headerMoreMenu;
  const button = el.btnMore;
  if (!menu || !button) return;

  const close = () => {
    menu.setAttribute('hidden', '');
    button.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    menu.removeAttribute('hidden');
    button.setAttribute('aria-expanded', 'true');
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hasAttribute('hidden')) open();
    else close();
  });

  // A tap anywhere outside — the menu included — closes it.
  document.addEventListener('click', (event) => {
    if (!menu.hasAttribute('hidden') && !menu.contains(event.target)) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  // A menu item works by pressing the real button it mirrors, so every
  // handler — confirmations included — is exercised exactly once.
  menu.querySelectorAll('.more-item[data-target]').forEach((item) => {
    item.addEventListener('click', () => {
      close();
      document.getElementById(item.dataset.target)?.click();
    });
  });
}
