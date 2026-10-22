/**
 * ============================================================================
 * VOICES
 * ============================================================================
 *
 * The voice list of the browser is a flat list of dozens of entries. It is
 * sorted into groups here, so the reader can find the voice they want without
 * scrolling through a wall of names.
 * ============================================================================
 */

/**
 * A voice that speaks many languages.
 *
 * The Web Speech API does not say so — Windows marks them by putting
 * "Multilingual" into the name of the voice, and that is the only reliable
 * hint there is.
 *
 * @param {{ name?: string, voiceURI?: string }} voice
 * @returns {boolean}
 */
export function isMultilingualVoice(voice) {
  if (!voice) return false;
  return /multilingual/i.test(voice.name || '') || /multilingual/i.test(voice.voiceURI || '');
}

/**
 * Sorts the voices of the browser into groups.
 *
 * A voice that speaks many languages gets its own group, even when its
 * language is English or Thai — the language says what it sounds like, the
 * group says what it can do.
 *
 * @param {Array<{ name?: string, lang?: string, voiceURI?: string }>} voices
 * @returns {{ thai: object[], multilingual: object[], english: object[], other: object[] }}
 */
export function groupVoices(voices) {
  const groups = { thai: [], multilingual: [], english: [], other: [] };

  voices.forEach((voice, index) => {
    const lang = (voice.lang || '').toLowerCase();
    const entry = { voice, index };

    if (isMultilingualVoice(voice)) {
      groups.multilingual.push(entry);
    } else if (lang.startsWith('th')) {
      groups.thai.push(entry);
    } else if (lang.startsWith('en')) {
      groups.english.push(entry);
    } else {
      groups.other.push(entry);
    }
  });

  return groups;
}
