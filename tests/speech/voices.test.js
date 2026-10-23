import { describe, it, expect } from 'vitest';

const { groupVoices, isMultilingualVoice } = await import('@/speech/voices.js');

describe('voice groups', () => {
  const voices = [
    { name: 'Microsoft David - English (United States)', lang: 'en-US' },
    { name: 'Microsoft Zira - English (United States)', lang: 'en-US' },
    { name: 'Microsoft Suksawat - Thai (Thailand)', lang: 'th-TH' },
    { name: 'Microsoft Multilingual Voice', lang: 'en-US' },
    { name: 'Microsoft Multilingual Online (Natural) - English (United States)', lang: 'en-US' },
    { name: 'Microsoft Multilingual Online (Natural) - Thai (Thailand)', lang: 'th-TH' },
    { name: 'Google Deutsch', lang: 'de-DE' }
  ];

  it('puts the multilingual voices into their own group', () => {
    const groups = groupVoices(voices);

    expect(groups.multilingual).toHaveLength(3);
    expect(groups.multilingual.map((entry) => entry.voice.name)).toContain(
      'Microsoft Multilingual Voice'
    );
  });

  it('keeps a multilingual voice out of the Thai and English groups', () => {
    const groups = groupVoices(voices);

    expect(groups.thai.map((entry) => entry.voice.name)).toEqual([
      'Microsoft Suksawat - Thai (Thailand)'
    ]);
    expect(groups.english).toHaveLength(2);
  });

  it('collects the other languages', () => {
    const groups = groupVoices(voices);

    expect(groups.other).toHaveLength(1);
    expect(groups.other[0].voice.name).toBe('Google Deutsch');
  });

  it('remembers the position of every voice', () => {
    const groups = groupVoices(voices);

    expect(groups.multilingual[0].index).toBe(3);
    expect(groups.other[0].index).toBe(6);
  });

  it('recognises a multilingual voice by its id as well', () => {
    expect(isMultilingualVoice({ name: 'Something', voiceURI: 'Microsoft Multilingual' })).toBe(
      true
    );
    expect(isMultilingualVoice({ name: 'Microsoft David - English (United States)' })).toBe(false);
    expect(isMultilingualVoice(null)).toBe(false);
  });

  it('does not choke on a voice without a language', () => {
    const groups = groupVoices([{ name: 'Nameless' }]);

    expect(groups.other).toHaveLength(1);
  });
});
