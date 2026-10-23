/**
 * ============================================================================
 * TRANSLATION LANGUAGES
 * ============================================================================
 * The languages the app can translate into.
 *
 * Only the TARGET language is ever chosen. The language of the document is
 * detected by the translator itself — the user says where the text should
 * end up, not where it comes from.
 *
 * The codes are the ones the translator understands. A few of them are not
 * plain two-letter codes: Chinese comes in two scripts, and the translator
 * tells them apart with `zh-CN` and `zh-TW`.
 * ============================================================================
 */

/**
 * A language the app can translate into.
 * @typedef {{ code: string, name: string, english: string }} TargetLanguage
 */

/** @type {TargetLanguage[]} */
export const TARGET_LANGUAGES = [
  { code: 'th', name: 'ไทย', english: 'Thai' },
  { code: 'en', name: 'English', english: 'English' },
  { code: 'zh-CN', name: '中文（简体）', english: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: '中文（繁體）', english: 'Chinese (Traditional)' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'ko', name: '한국어', english: 'Korean' },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'ms', name: 'Bahasa Melayu', english: 'Malay' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch' },
  { code: 'pl', name: 'Polski', english: 'Polish' },
  { code: 'ru', name: 'Русский', english: 'Russian' },
  { code: 'uk', name: 'Українська', english: 'Ukrainian' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish' },
  { code: 'ar', name: 'العربية', english: 'Arabic' },
  { code: 'he', name: 'עברית', english: 'Hebrew' },
  { code: 'fa', name: 'فارسی', english: 'Persian' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil' },
  { code: 'te', name: 'తెలుగు', english: 'Telugu' },
  { code: 'mr', name: 'मराठी', english: 'Marathi' },
  { code: 'ur', name: 'اردو', english: 'Urdu' },
  { code: 'sw', name: 'Kiswahili', english: 'Swahili' },
  { code: 'af', name: 'Afrikaans', english: 'Afrikaans' },
  { code: 'am', name: 'አማርኛ', english: 'Amharic' },
  { code: 'ca', name: 'Català', english: 'Catalan' },
  { code: 'da', name: 'Dansk', english: 'Danish' },
  { code: 'el', name: 'Ελληνικά', english: 'Greek' },
  { code: 'et', name: 'Eesti', english: 'Estonian' },
  { code: 'eu', name: 'Euskara', english: 'Basque' },
  { code: 'fi', name: 'Suomi', english: 'Finnish' },
  { code: 'gl', name: 'Galego', english: 'Galician' },
  { code: 'gu', name: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'he-il', name: 'עברית (ישראל)', english: 'Hebrew (Israel)' },
  { code: 'hr', name: 'Hrvatski', english: 'Croatian' },
  { code: 'hu', name: 'Magyar', english: 'Hungarian' },
  { code: 'is', name: 'Íslenska', english: 'Icelandic' },
  { code: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'lt', name: 'Lietuvių', english: 'Lithuanian' },
  { code: 'lv', name: 'Latviešu', english: 'Latvian' },
  { code: 'ml', name: 'മലയാളം', english: 'Malayalam' },
  { code: 'mk', name: 'Македонски', english: 'Macedonian' },
  { code: 'mn', name: 'Монгол', english: 'Mongolian' },
  { code: 'nb', name: 'Norsk bokmål', english: 'Norwegian (Bokmål)' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  { code: 'ro', name: 'Română', english: 'Romanian' },
  { code: 'si', name: 'සිංහල', english: 'Sinhala' },
  { code: 'sk', name: 'Slovenčina', english: 'Slovak' },
  { code: 'sl', name: 'Slovenščina', english: 'Slovenian' },
  { code: 'sq', name: 'Shqip', english: 'Albanian' },
  { code: 'sr', name: 'Српски', english: 'Serbian' },
  { code: 'sv', name: 'Svenska', english: 'Swedish' },
  { code: 'tl', name: 'Tagalog', english: 'Tagalog' },
  { code: 'uk-UA', name: 'Українська (Україна)', english: 'Ukrainian (Ukraine)' },
  { code: 'zu', name: 'isiZulu', english: 'Zulu' }
];

/** The language the app starts with. */
export const DEFAULT_TARGET = 'th';

/**
 * Finds a language by its code.
 * @param {string} code
 * @returns {TargetLanguage|null}
 */
export function findLanguage(code) {
  const wanted = String(code || '').trim();
  return TARGET_LANGUAGES.find((language) => language.code === wanted) || null;
}

/**
 * The name of a language, in that language, for the messages of the app.
 * @param {string} code
 * @returns {string}
 */
export function languageName(code) {
  const language = findLanguage(code);
  return language ? language.name : String(code || '');
}

/**
 * The name of a language in English — used when the detected language of a
 * document is not one of the targets.
 * @param {string} code
 * @returns {string}
 */
export function languageEnglishName(code) {
  const language = findLanguage(code);
  if (language) return language.english;

  // The translator answers with `zh-CN` and `zh-TW` for the two scripts of
  // Chinese; the target list knows them, but a detected language may be one
  // of the plain forms.
  const aliases = {
    zh: 'Chinese',
    'zh-Hans': 'Chinese (Simplified)',
    'zh-Hant': 'Chinese (Traditional)',
    iw: 'Hebrew',
    jw: 'Javanese',
    no: 'Norwegian',
    'pt-BR': 'Portuguese (Brazil)',
    'pt-PT': 'Portuguese (Portugal)',
    he: 'Hebrew',
    sr: 'Serbian',
    'sr-Latn': 'Serbian (Latin)'
  };

  const wanted = String(code || '').trim();
  return aliases[wanted] || wanted;
}
