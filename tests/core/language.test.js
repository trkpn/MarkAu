import { describe, it, expect } from 'vitest';
import { detectLanguage } from '@/core/language.js';

/**
 * The narration speaks in the language of the document. Detection has to
 * cover the scripts that identify a language on their own, the languages
 * that share the Latin alphabet, and mixed documents.
 */
describe('detectLanguage', () => {
  it('returns English for an empty document', () => {
    expect(detectLanguage('')).toBe('en-US');
    expect(detectLanguage(undefined)).toBe('en-US');
  });

  it('recognises English', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog.')).toBe('en-US');
  });

  it('recognises Thai', () => {
    expect(detectLanguage('สวัสดีครับ วันนี้อากาศดีมาก เราจะไปเที่ยวทะเลกัน')).toBe('th-TH');
  });

  it('recognises Japanese by its kana, even with Han characters', () => {
    expect(detectLanguage('これは日本語の文章です。東京に行きました。')).toBe('ja-JP');
  });

  it('recognises Chinese', () => {
    expect(detectLanguage('这是一个中文文档。北京是中国的首都。')).toBe('zh-CN');
  });

  it('recognises Korean', () => {
    expect(detectLanguage('안녕하세요. 오늘 날씨가 좋습니다.')).toBe('ko-KR');
  });

  it('recognises Russian and Ukrainian', () => {
    expect(detectLanguage('Это русский текст. Москва — столица России.')).toBe('ru-RU');
    expect(detectLanguage('Це український текст. Київ — столиця України.')).toBe('uk-UA');
  });

  it('recognises Arabic, Persian and Urdu', () => {
    expect(detectLanguage('هذا نص عربي. القاهرة هي عاصمة مصر.')).toBe('ar-SA');
    expect(detectLanguage('این یک متن فارسی است. تهران پایتخت ایران است.')).toBe('fa-IR');
    expect(detectLanguage('یہ اردو متن ہے۔ لاہور پاکستان کا شہر ہے۔')).toBe('ur-PK');
  });

  it('recognises the other scripts', () => {
    expect(detectLanguage('זהו טקסט בעברית. ירושלים היא עיר עתיקה.')).toBe('he-IL');
    expect(detectLanguage('यह हिंदी में लिखा गया है। दिल्ली भारत की राजधानी है।')).toBe('hi-IN');
    expect(detectLanguage('Αυτό είναι ένα ελληνικό κείμενο.')).toBe('el-GR');
    expect(detectLanguage('ນີ້ແມ່ນຂໍ້ຄວາມລາວ')).toBe('lo-LA');
    expect(detectLanguage('ഇത് മലയാളം ആണ്.')).toBe('ml-IN');
    expect(detectLanguage('இது தமிழ் உரை.')).toBe('ta-IN');
    expect(detectLanguage('ఇది తెలుగు పాఠ్యం.')).toBe('te-IN');
    expect(detectLanguage('ಇದು ಕನ್ನಡ ಪಠ್ಯ.')).toBe('kn-IN');
    expect(detectLanguage('এটি বাংলা লেখা।')).toBe('bn-BD');
    expect(detectLanguage('આ ગુજરાતી લખાણ છે.')).toBe('gu-IN');
    expect(detectLanguage('ਇਹ ਪੰਜਾਬੀ ਲਿਖਤ ਹੈ।')).toBe('pa-IN');
    expect(detectLanguage('នេះជាអត្ថបទខ្មែរ។')).toBe('km-KH');
    expect(detectLanguage('ဒါက မြန်မာစာပါ။')).toBe('my-MM');
    expect(detectLanguage('איז דאָ אַ ייִדיש טעקסט')).toBe('he-IL');
    expect(detectLanguage('ეს არის ქართული ტექსტი.')).toBe('ka-GE');
    expect(detectLanguage('Սա հայերեն տեքստ է։')).toBe('hy-AM');
    expect(detectLanguage('ይህ የአማርኛ ጽሑፍ ነው።')).toBe('am-ET');
  });

  it('does not switch language for a foreign name in a Russian text', () => {
    expect(detectLanguage('Киев — столица Украины. Это русский текст о городе Київ.')).toBe(
      'ru-RU'
    );
  });

  it('recognises Latin-script languages by their words', () => {
    expect(
      detectLanguage(
        "Le document est écrit en français. Les mots sont dans la langue de l'auteur, avec les accents qui vont avec."
      )
    ).toBe('fr-FR');

    expect(
      detectLanguage(
        'Das ist ein deutscher Text. Die Wörter sind in der Sprache des Autors und werden mit den richtigen Regeln getrennt.'
      )
    ).toBe('de-DE');

    expect(
      detectLanguage(
        'Este es un texto en español. Las palabras están en el idioma del autor y se separan con las reglas correctas.'
      )
    ).toBe('es-ES');

    expect(
      detectLanguage(
        'Este é um texto em português. As palavras estão na língua do autor e são separadas com as regras certas, não com as de outra língua.'
      )
    ).toBe('pt-BR');

    expect(
      detectLanguage(
        'Questo è un testo in italiano. Le parole sono nella lingua dell autore e vengono divise secondo le regole giuste.'
      )
    ).toBe('it-IT');

    expect(
      detectLanguage(
        'Dit is een Nederlandse tekst. De woorden zijn in de taal van de auteur en worden op de juiste manier gesplitst.'
      )
    ).toBe('nl-NL');

    expect(
      detectLanguage(
        'Ini adalah teks bahasa Indonesia. Kata-kata yang ada di dalamnya menggunakan bahasa penulis dan dibagi dengan aturan yang benar.'
      )
    ).toBe('id-ID');

    expect(
      detectLanguage(
        'Bu bir Türkçe metindir. Sözcükler yazarın dilinde yazılmıştır ve doğru kurallara göre ayrılır, başka bir dilin kurallarına göre değil.'
      )
    ).toBe('tr-TR');

    expect(
      detectLanguage(
        'To jest polski tekst. Słowa są w języku autora i są dzielone według właściwych zasad, a nie zasad innego języka.'
      )
    ).toBe('pl-PL');

    expect(
      detectLanguage(
        'Đây là một văn bản tiếng Việt. Những từ ngữ được viết bằng ngôn ngữ của tác giả và được chia theo đúng quy tắc.'
      )
    ).toBe('vi-VN');

    expect(
      detectLanguage(
        'Tämä on suomenkielinen teksti. Sanat ovat kirjoittajan kielellä ja ne jaetaan oikeiden sääntöjen mukaan.'
      )
    ).toBe('fi-FI');

    expect(
      detectLanguage(
        'Det här är en svensk text. Orden är skrivna på författarens språk och delas enligt de rätta reglerna.'
      )
    ).toBe('sv-SE');

    expect(
      detectLanguage(
        'Toto je český text. Slova jsou v jazyce autora a jsou dělena podle správných pravidel, ne podle jiného jazyka.'
      )
    ).toBe('cs-CZ');

    expect(
      detectLanguage(
        'Acesta este un text în română. Cuvintele sunt în limba autorului și sunt împărțite după regulile corecte.'
      )
    ).toBe('ro-RO');

    expect(
      detectLanguage(
        'Ez egy magyar szöveg. A szavak a szerző nyelvén vannak, és a helyes szabályok szerint vannak felosztva.'
      )
    ).toBe('hu-HU');

    expect(
      detectLanguage(
        'Ovo je hrvatski tekst. Riječi su na jeziku autora i dijele se prema pravilima toga jezika, a ne nekog drugog.'
      )
    ).toBe('hr-HR');

    expect(
      detectLanguage(
        'Aquest és un text en català. Les paraules són en la llengua de l autor i es divideixen segons les regles correctes.'
      )
    ).toBe('ca-ES');
  });

  it('lets the dominant language win in a mixed document', () => {
    const englishWithOneThaiWord = `${'The document is mostly English, which is what matters here. '.repeat(20)}สวัสดี`;
    expect(detectLanguage(englishWithOneThaiWord)).toBe('en-US');

    const thaiWithEnglishTerms = `${'ระบบจะอ่านเอกสารนี้ให้ฟังทีละคำอย่างถูกต้อง '.repeat(12)}JavaScript API`;
    expect(detectLanguage(thaiWithEnglishTerms)).toBe('th-TH');
  });

  it('falls back to English when nothing is recognisable', () => {
    expect(detectLanguage('12345 !!! ???')).toBe('en-US');
  });

  it('does not let a code block change the language of the prose', () => {
    const thai = 'ระบบจะอ่านข้อความนี้ให้ฟังทีละคำอย่างถูกต้อง ';
    const code =
      '```js\nconst greeting = "hello world";\nfunction speak() { return greeting; }\n```';

    expect(detectLanguage(`${thai.repeat(8)}\n\n${code}`)).toBe('th-TH');

    const english = 'The reader follows the document word by word and keeps its place. ';
    const thaiCode = '```js\nconst greeting = "สวัสดีครับ";\n```';

    expect(detectLanguage(`${english.repeat(8)}\n\n${thaiCode}`)).toBe('en-US');
  });
});
