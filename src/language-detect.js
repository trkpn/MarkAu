/**
 * ============================================================================
 * LANGUAGE DETECTION
 * ============================================================================
 * Works out what language a document is written in, so the narration can
 * speak it with a matching voice and split it at that language's own
 * sentence and word boundaries.
 *
 * Nothing is hardcoded to one language and nothing is downloaded:
 *
 *   1. A script histogram. Most of the world's writing systems identify
 *      their language on their own — Thai, Lao, Khmer, Burmese, Japanese,
 *      Korean, Chinese, Arabic, Hebrew, Greek, Cyrillic, the Indic scripts,
 *      Georgian, Armenian and Ethiopic.
 *   2. A short word list + distinctive diacritics for the languages that
 *      share the Latin alphabet (French, German, Spanish, Portuguese,
 *      Italian, Dutch, the Scandinavian languages, Polish, Czech, Romanian,
 *      Hungarian, Croatian, Catalan, Turkish, Vietnamese, Indonesian).
 *
 * When neither is conclusive the answer is `en-US`, which is also what a
 * browser with no matching voice falls back to.
 * ============================================================================
 */

/** Counts the characters of `text` matched by a global regular expression. */
function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

/** Japanese needs its two syllabaries together with the shared Han script. */
const KANA = /[\u3040-\u30FF\u31F0-\u31FF]/g;
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF]/g;

/**
 * Writing systems that stand for one language, most specific first.
 * Chinese is checked after Japanese, because a Japanese text also uses Han.
 */
const SCRIPT_LOCALES = [
  { locale: 'th-TH', pattern: /[\u0E00-\u0E7F]/g },
  { locale: 'lo-LA', pattern: /[\u0E80-\u0EFF]/g },
  { locale: 'my-MM', pattern: /[\u1000-\u109F\uAA60-\uAA7F]/g },
  { locale: 'km-KH', pattern: /[\u1780-\u17FF]/g },
  { locale: 'ko-KR', pattern: /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g },
  { locale: 'zh-CN', pattern: HAN },
  { locale: 'ka-GE', pattern: /[\u10A0-\u10FF]/g },
  { locale: 'hy-AM', pattern: /[\u0530-\u058F]/g },
  { locale: 'he-IL', pattern: /[\u0590-\u05FF]/g },
  { locale: 'ar-SA', pattern: /[\u0600-\u06FF]/g },
  { locale: 'hi-IN', pattern: /[\u0900-\u097F]/g },
  { locale: 'bn-BD', pattern: /[\u0980-\u09FF]/g },
  { locale: 'pa-IN', pattern: /[\u0A00-\u0A7F]/g },
  { locale: 'gu-IN', pattern: /[\u0A80-\u0AFF]/g },
  { locale: 'or-IN', pattern: /[\u0B00-\u0B7F]/g },
  { locale: 'ta-IN', pattern: /[\u0B80-\u0BFF]/g },
  { locale: 'te-IN', pattern: /[\u0C00-\u0C7F]/g },
  { locale: 'kn-IN', pattern: /[\u0C80-\u0CFF]/g },
  { locale: 'ml-IN', pattern: /[\u0D00-\u0D7F]/g },
  { locale: 'si-LK', pattern: /[\u0D80-\u0DFF]/g },
  { locale: 'el-GR', pattern: /[\u0370-\u03FF]/g },
  { locale: 'ru-RU', pattern: /[\u0400-\u04FF]/g },
  { locale: 'am-ET', pattern: /[\u1200-\u137F]/g }
];

/** How much of the text a script has to own before it names the language. */
const SCRIPT_SHARE = 0.25;

/**
 * Letters that tell apart the languages sharing a script.
 *
 * Persian and Urdu both write in the Arabic script; Ukrainian, Serbian and
 * Belarusian in Cyrillic. A distinctive letter beats any word list — but a
 * few of them are needed, so that a single foreign place name cannot switch
 * the language of a whole document.
 */
const SCRIPT_REFINEMENTS = [
  { locale: 'ur-PK', pattern: /[\u0679\u0688\u0691\u06BA\u06D2\u06C1\u06BE]/g },
  { locale: 'fa-IR', pattern: /[\u067E\u0686\u0698\u06AF\u06CC\u06A9]/g },
  { locale: 'uk-UA', pattern: /[\u0456\u0457\u0454\u0491]/gi },
  { locale: 'sr-RS', pattern: /[\u0452\u045B\u045F\u0459\u045A]/g },
  { locale: 'be-BY', pattern: /[\u045E]/g }
];

/** How often a distinguishing letter must appear to be believed. */
const REFINEMENT_MIN = 3;

/** Diacritics that are very close to a language's signature. */
const LATIN_HINTS = [
  {
    locale: 'vi-VN',
    pattern: /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi,
    weight: 4
  },
  { locale: 'tr-TR', pattern: /[ğış]/gi, weight: 3 },
  { locale: 'pl-PL', pattern: /[ąćęłńśźż]/gi, weight: 3 },
  { locale: 'ro-RO', pattern: /[ăâîșț]/gi, weight: 3 },
  { locale: 'hu-HU', pattern: /[őű]/gi, weight: 3 },
  { locale: 'cs-CZ', pattern: /[ěřůťďň]/gi, weight: 2 },
  { locale: 'pt-BR', pattern: /[ãõ]/gi, weight: 2 },
  { locale: 'es-ES', pattern: /[ñ¿¡]/g, weight: 2 },
  { locale: 'de-DE', pattern: /[ß]/g, weight: 2 }
];

/**
 * The most common short words of each language.
 *
 * Only words of at least three letters are listed: one- and two-letter
 * words are shared by so many languages that they add noise, not signal.
 */
const STOP_WORDS = {
  'en-US':
    'the and for that with this from have not are was were you they their which will can has had but all one out about into than then them these those there what when where how who why'.split(
      ' '
    ),
  'fr-FR':
    'les des une est dans que qui pas sur avec elle nous vous sont mais plus par comme pour tout être fait cette aussi entre leur dont'.split(
      ' '
    ),
  'de-DE':
    'der die das und ist nicht eine mit den dem des auf für von sich sind auch werden wird bei aus durch oder aber wie noch nach nur kann'.split(
      ' '
    ),
  'es-ES':
    'los las del que una por con para sus como más pero este esta entre cuando todo esta hay muy sin sobre también hasta'.split(
      ' '
    ),
  'pt-BR':
    'que não uma para com uma dos das mais como mas foi ele ela são pela pelo isso isto quando muito também sem sobre'.split(
      ' '
    ),
  'it-IT':
    'che una del della dei delle gli sono come più anche questo questa quando molto senza tra fra perché quindi essere'.split(
      ' '
    ),
  'nl-NL':
    'het een van dat zijn voor met niet aan ook als dan maar bij door uit wordt worden deze dit nog wel geen'.split(
      ' '
    ),
  'tr-TR':
    'bir için ile olarak çok daha gibi kadar ama veya değil var yok her sonra önce göre'.split(' '),
  'id-ID':
    'yang dan dengan untuk tidak ini dari dalam akan pada juga saya kamu mereka adalah bisa sudah atau karena oleh ada'.split(
      ' '
    ),
  'pl-PL':
    'nie jest się jak ale przez dla czy już być który która które oraz ten ta tego jej jego tylko jeszcze'.split(
      ' '
    ),
  'sv-SE':
    'och att det som ett på är av för med den till inte om har jag men när eller kan var från'.split(
      ' '
    ),
  'da-DK':
    'og at det som et på er til af for med den ikke der var mig sig men har om kan hun'.split(' '),
  'nb-NO':
    'og jeg det at ett på er til av for med den ikke der var meg seg men har om kan hun'.split(' '),
  'fi-FI':
    'että oli hän mutta niin kun myös jos sen mitä tai nyt vain ovat tämä joka kuin sitten olla jo'.split(
      ' '
    ),
  'cs-CZ':
    'jsou byl byla který která které nebo také jen když ještě být jako při před pod nad'.split(' '),
  'ro-RO': 'este sunt care pentru din nu mai dar sau lui fost prin după când acest această'.split(
    ' '
  ),
  'hu-HU': 'hogy nem egy meg csak már mint volt lesz vagy még pedig azok ezt azt'.split(' '),
  'hr-HR':
    'koji koja koje ali ili nije biti kao što već samo još kada između prema toga time zbog nakon prije također ovaj ovo kojim kojem kroz zato jer'.split(
      ' '
    ),
  'ca-ES': 'els les que una amb però aquest aquesta del dels als com més per quan'.split(' ')
};

/**
 * Inspects the text's script and words and returns a BCP-47 locale tag.
 *
 * @param {string} text
 * @returns {string} locale, `en-US` when nothing is conclusive
 */
export function detectLanguage(text) {
  if (!text) return 'en-US';

  // Code is not prose: a Thai document with a long JavaScript sample in it
  // is still Thai.
  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  if (!prose.trim()) return 'en-US';

  const letters = countMatches(prose, /\p{L}/gu);
  if (!letters) return 'en-US';

  const kana = countMatches(prose, KANA);
  const han = countMatches(prose, HAN);
  const cjk = kana + han;
  if (cjk > 0 && cjk / letters >= SCRIPT_SHARE && kana / cjk >= 0.1) {
    return 'ja-JP';
  }

  let best = null;
  for (const { locale, pattern } of SCRIPT_LOCALES) {
    const matches = countMatches(prose, pattern);
    if (matches > 0 && (!best || matches > best.matches)) {
      best = { locale, matches };
    }
  }

  if (best && best.matches / letters >= SCRIPT_SHARE) {
    const refined = SCRIPT_REFINEMENTS.map(({ locale, pattern }) => ({
      locale,
      matches: countMatches(prose, pattern)
    })).sort((a, b) => b.matches - a.matches)[0];

    if (refined && refined.matches >= REFINEMENT_MIN) return refined.locale;
    return best.locale;
  }

  return detectLatin(prose) || 'en-US';
}

/**
 * Scores the languages written in the Latin alphabet.
 *
 * @param {string} text
 * @returns {string|null} the best locale, or null when nothing scores
 */
function detectLatin(text) {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) || [];
  const bag = new Map();
  for (const word of words) {
    bag.set(word, (bag.get(word) || 0) + 1);
  }

  const scores = new Map();
  const add = (locale, points) => scores.set(locale, (scores.get(locale) || 0) + points);

  for (const { locale, pattern, weight } of LATIN_HINTS) {
    const matches = countMatches(text, pattern);
    if (matches > 0) add(locale, matches * weight);
  }

  for (const [locale, list] of Object.entries(STOP_WORDS)) {
    let points = 0;
    for (const word of list) {
      points += bag.get(word) || 0;
    }
    if (points > 0) add(locale, points);
  }

  let best = null;
  for (const [locale, points] of scores) {
    if (!best || points > best.points) best = { locale, points };
  }

  // A single accidental word is not a language.
  return best && best.points >= 2 ? best.locale : null;
}
