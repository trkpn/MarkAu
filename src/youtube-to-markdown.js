/**
 * ============================================================================
 * YOUTUBE
 * Turns a video into a document.
 *
 * A video has no text, so the document is built from what the page knows
 * about it: the title, the channel, the length, the date, the description
 * and — when it can be had — the transcript.
 *
 * The transcript is the interesting part, because it is the only thing that
 * turns a video into something one can read. It is fetched from the caption
 * track of the video, and YouTube only hands it out when the request looks
 * like it comes from a player. When it is refused, the document is built
 * without it and says so.
 * ============================================================================
 */

/**
 * Pulls a JSON object out of a page, by finding the marker and then
 * balancing the braces.
 *
 * A regular expression cannot do this: the JSON of a page holds braces
 * inside strings, and the first `};` is often in the middle of it.
 *
 * @param {string} html
 * @param {string} marker the text that stands in front of the object
 * @returns {object|null}
 */
export function extractJsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;

  const start = html.indexOf('{', at);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const char = html[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Reads the details of the video out of the page.
 *
 * @param {string} html the HTML of the watch page
 * @returns {{
 *   title: string,
 *   author: string,
 *   channelId: string,
 *   seconds: number,
 *   views: number,
 *   published: string,
 *   description: string,
 *   isLive: boolean
 * }|null}
 */
export function parseVideoDetails(html) {
  const player = extractJsonAfter(html, 'ytInitialPlayerResponse');
  const details = player?.videoDetails;
  if (!details) return null;

  const published =
    html.match(/<meta itemprop="uploadDate" content="([^"]+)"/)?.[1] ||
    html.match(/<meta itemprop="datePublished" content="([^"]+)"/)?.[1] ||
    '';

  return {
    title: details.title || '',
    author: details.author || '',
    channelId: details.channelId || '',
    seconds: Number(details.lengthSeconds) || 0,
    views: Number(details.viewCount) || 0,
    published,
    description: details.shortDescription || '',
    isLive: Boolean(details.isLiveContent)
  };
}

/**
 * Finds the caption track that fits the wanted language.
 *
 * A video often has several: one per language, and one written by hand
 * next to one written by the machine. The written one is preferred.
 *
 * @param {string} html the HTML of the watch page
 * @param {string} [language] the language wanted, e.g. 'en'
 * @returns {{ url: string, language: string, automatic: boolean, name: string }|null}
 */
export function findCaptionTrack(html, language = 'en') {
  const player = extractJsonAfter(html, 'ytInitialPlayerResponse');
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (tracks.length === 0) return null;

  const wanted = String(language || 'en').toLowerCase();
  const sameLanguage = tracks.filter(
    (track) => String(track.languageCode || '').toLowerCase().startsWith(wanted)
  );
  const pool = sameLanguage.length > 0 ? sameLanguage : tracks;

  const written = pool.find((track) => !track.kind);
  const chosen = written || pool[0];

  return {
    url: chosen.baseUrl,
    language: chosen.languageCode || '',
    automatic: Boolean(chosen.kind),
    name: chosen.name?.simpleText || chosen.name?.runs?.[0]?.text || ''
  };
}

/**
 * Reads the timestamped text of a caption track.
 *
 * Three formats are understood: the JSON one YouTube prefers, and the two
 * shapes of XML — the one with the seconds and the one with the
 * milliseconds.
 *
 * @param {string} text the answer of the caption endpoint
 * @returns {Array<{ start: number, text: string }>} the lines, in order
 */
export function parseCaptionTrack(text) {
  const body = String(text || '').trim();
  if (!body) return [];

  // The JSON format: a list of events, each with a start and some words.
  if (body.startsWith('{')) {
    try {
      const payload = JSON.parse(body);
      const events = payload.events || [];

      return events
        .map((event) => ({
          start: Number(event.tStartMs) || 0,
          text: (event.segs || [])
            .map((seg) => seg.utf8 || '')
            .join('')
            .replace(/\s+/g, ' ')
            .trim()
        }))
        .filter((line) => line.text);
    } catch {
      return [];
    }
  }

  const lines = [];

  // The shape with the seconds: <text start="1.5" dur="2">
  const withSeconds = /<text([^>]*)>([\s\S]*?)<\/text>/g;
  let match = withSeconds.exec(body);

  while (match) {
    const start = Number(match[1].match(/start="([\d.]+)"/)?.[1] ?? 0) * 1000;
    const words = cleanCaptionText(match[2]);
    if (words) lines.push({ start, text: words });
    match = withSeconds.exec(body);
  }

  if (lines.length > 0) return lines;

  // The shape with the milliseconds: <p t="1500" d="2000">
  const withMillis = /<p([^>]*)>([\s\S]*?)<\/p>/g;
  match = withMillis.exec(body);

  while (match) {
    const start = Number(match[1].match(/t="([\d.]+)"/)?.[1] ?? 0);
    const words = cleanCaptionText(match[2]);
    if (words) lines.push({ start, text: words });
    match = withMillis.exec(body);
  }

  return lines;
}

/**
 * The words of a piece of a caption, without the marks of the format.
 *
 * @param {string} html
 * @returns {string}
 */
function cleanCaptionText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Puts the words of a transcript into paragraphs.
 *
 * The caption track is a stream of very short pieces. Read as they are,
 * they are unreadable — so the pieces are gathered into sentences.
 *
 * @param {Array<{ start: number, text: string }>} lines
 * @returns {string} the transcript as Markdown
 */
export function transcriptToMarkdown(lines) {
  if (!lines || lines.length === 0) return '';

  const paragraphs = [];
  let buffer = '';
  let start = lines[0].start;

  for (const line of lines) {
    if (!buffer) start = line.start;
    buffer += `${line.text} `;

    // A sentence ends a paragraph. So does a stretch of words that is long
    // enough to be tiring to read: the words of a song have no full stops
    // at all, and without this they would end up in one piece.
    if (/[.!?]["')\]]?\s*$/.test(line.text) || buffer.length > 220) {
      paragraphs.push({ start, text: buffer.trim() });
      buffer = '';
    }
  }

  if (buffer.trim()) paragraphs.push({ start, text: buffer.trim() });

  return paragraphs
    .map((paragraph) => `**[${formatTime(paragraph.start / 1000)}]** ${paragraph.text}`)
    .join('\n\n');
}

/**
 * Writes a number of seconds as a length of time.
 *
 * @param {number} seconds
 * @returns {string} e.g. '3:33' or '1:02:03'
 */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Finds the chapters of a video in its description.
 *
 * A chapter is a line that starts with a time — '0:00 Introduction' — and
 * every chapter of a video looks like that.
 *
 * @param {string} description
 * @returns {Array<{ time: string, seconds: number, title: string }>}
 */
export function parseChapters(description) {
  const chapters = [];

  for (const line of String(description || '').split('\n')) {
    const match = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:)]?\s+(.+?)\s*$/);
    if (!match) continue;

    const parts = match[1].split(':').map(Number);
    const seconds =
      parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];

    chapters.push({ time: match[1], seconds, title: match[2] });
  }

  return chapters;
}

/**
 * Turns a length of time written as text into seconds.
 *
 * @param {string} text e.g. '16:09'
 * @returns {number}
 */
export function timeToSeconds(text) {
  const parts = String(text || '')
    .split(':')
    .map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Gathers the videos of a playlist.
 *
 * The shape of the data of a playlist page changes from time to time — the
 * videos used to sit in a list of their own, and now they sit in boxes like
 * everything else. Both are looked for, by looking for the pieces
 * themselves instead of by a fixed path.
 *
 * @param {object} data the data of the page
 * @returns {Array<{ id: string, title: string, seconds: number }>}
 */
export function collectPlaylistVideos(data) {
  const found = [];
  const seen = new Set();

  const add = (id, title, seconds) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    found.push({ id, title: title || id, seconds: seconds || 0 });
  };

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.playlistVideoRenderer) {
      const renderer = node.playlistVideoRenderer;
      add(
        renderer.videoId,
        renderer.title?.runs?.[0]?.text || renderer.title?.simpleText,
        Number(renderer.lengthSeconds) || 0
      );
    }

    if (node.lockupViewModel) {
      const renderer = node.lockupViewModel;
      const title = renderer.metadata?.lockupMetadataViewModel?.title?.content || '';

      // The length is written on the badge over the picture.
      const badge =
        renderer.contentImage?.thumbnailViewModel?.overlays?.[0]
          ?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text;

      add(renderer.contentId, title, badge ? timeToSeconds(badge) : 0);
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };

  walk(data);
  return found;
}

/**
 * Builds the document of a video.
 *
 * @param {object} details the details of the video
 * @param {object} [options]
 * @param {string} [options.videoUrl] the address of the video
 * @param {string} [options.transcript] the transcript, when there is one
 * @param {string} [options.transcriptNote] why there is no transcript
 * @returns {string}
 */
export function buildVideoDocument(details, { videoUrl = '', transcript = '', transcriptNote = '' } = {}) {
  const lines = [];

  lines.push(`# ${details.title}`);
  lines.push('');

  const facts = [];
  if (details.author) facts.push(`**Channel:** ${details.author}`);
  if (details.seconds) facts.push(`**Length:** ${formatTime(details.seconds)}`);
  if (details.published) facts.push(`**Published:** ${details.published.slice(0, 10)}`);
  if (details.views) facts.push(`**Views:** ${details.views.toLocaleString('en-US')}`);
  if (videoUrl) facts.push(`**Watch:** ${videoUrl}`);

  if (facts.length > 0) {
    lines.push(facts.join('  \n'));
    lines.push('');
  }

  const chapters = parseChapters(details.description);

  if (details.description) {
    lines.push('## Description');
    lines.push('');
    lines.push(details.description.trim());
    lines.push('');
  }

  if (chapters.length > 0) {
    lines.push('## Chapters');
    lines.push('');
    for (const chapter of chapters) {
      const link = videoUrl
        ? `[${chapter.time}](${videoUrl}&t=${chapter.seconds})`
        : chapter.time;
      lines.push(`- ${link} — ${chapter.title}`);
    }
    lines.push('');
  }

  if (transcript) {
    lines.push('## Transcript');
    lines.push('');
    if (transcriptNote) {
      lines.push(transcriptNote);
      lines.push('');
    }
    lines.push(transcript);
    lines.push('');
  } else if (transcriptNote) {
    lines.push('## Transcript');
    lines.push('');
    lines.push(`_${transcriptNote}_`);
    lines.push('');
  }

  return lines.join('\n').trim();
}
