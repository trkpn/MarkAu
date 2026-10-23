/**
 * ============================================================================
 * URL IMPORT
 * Brings a document in from a web address.
 *
 * An imported document replaces the one that is there, the way opening a
 * file or pasting does: a new text is never mixed into the old one.
 *
 * How the content is reached depends on the source:
 *
 *   • a repository README, a model card, a Markdown file — the content is
 *     already Markdown and is fetched straight from the origin, which allows
 *     it
 *   • a web page — the HTML is fetched (directly, or through the proxy when
 *     the site does not allow a cross-origin read) and reduced to Markdown
 *     in the browser
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { setMarkdown } from '@/app/editor/editor.js';
import { getSettings } from '@/core/settings.js';
import { setMessage } from '@/app/shell/status.js';
import { detectSource, decodeBase64Utf8, SOURCE } from '@/app/import/sources.js';
import {
  beginImport,
  cancelImport,
  currentImportKind,
  endImport,
  isCurrentImport,
  showImportProgress
} from '@/app/import/import-job.js';

const GITHUB_API = 'https://api.github.com';
const RAW_GITHUB = 'https://raw.githubusercontent.com';
const HUGGING_FACE = 'https://huggingface.co';

/** The job the network helpers belong to. */
let activeJob = null;

/**
 * The signal of the import that is running.
 * @returns {AbortSignal|undefined}
 */
function importSignal() {
  return activeJob?.signal;
}

/** The proxy that ships with the app. It is on the same origin. */
const PROXY_ENDPOINT = '/api/fetch';

/** The service used when everything else has failed. */
const READER_FALLBACK = 'https://r.jina.ai/';

/**
 * The least a document may hold to count as a document. Below this, the
 * answer was an empty shell — a page that draws itself with a script, or a
 * refusal dressed up as one.
 */
const MIN_CONTENT = 120;

/**
 * An error whose message is meant to be read by the user.
 */
export class ImportError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * Fetches a URL as text and fails with a readable message.
 *
 * @param {string} url
 * @param {object} [options] passed to fetch
 * @returns {Promise<string>}
 */
async function fetchText(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { signal: importSignal(), ...options });
  } catch {
    throw new ImportError('That address could not be reached.');
  }

  if (!response.ok) {
    throw new ImportError(`That address answered ${response.status}.`);
  }

  return response.text();
}

/**
 * Fetches the text of an address, first directly and then through the
 * proxy of the app.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchTextWithFallback(url) {
  try {
    return await fetchText(url);
  } catch {
    // The address does not allow a direct read — the proxy will have to.
    const proxied = await fetchViaProxy(url);
    if (proxied.status >= 400) {
      throw new ImportError(`That address answered ${proxied.status}.`);
    }
    return proxied.body;
  }
}

/**
 * Tells whether an answer holds text that can be read.
 *
 * A PDF or a picture cannot be turned into Markdown by this app, and
 * pretending otherwise would fill the document with nonsense. The rule
 * matches the one of the proxy: everything is text unless it is certainly
 * not.
 *
 * @param {string} contentType
 * @returns {boolean}
 */
export function isTextual(contentType) {
  if (!contentType) return true;

  const type = String(contentType).toLowerCase();

  const certainlyBinary =
    /^(application\/(pdf|zip|octet-stream|epub\+zip|msword|wordprocessingml|vnd\.ms-word|vnd\.openxmlformats|rtf|x-tar|x-gzip|x-7z-compressed)|image\/(?!svg)|video\/|audio\/|font\/)/;

  return !certainlyBinary.test(type);
}

/**
 * Fetches the HTML of a page, first directly and then through the proxy.
 *
 * @param {string} url
 * @returns {Promise<{ html: string, finalUrl: string, via: string|null }>}
 */
async function fetchHtml(url) {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: importSignal() });
    if (response.ok) {
      const type = response.headers.get('content-type') || '';
      if (!isTextual(type)) {
        throw new ImportError('That address is not a page of text.');
      }
      return { html: await response.text(), finalUrl: response.url || url, via: null };
    }
  } catch (err) {
    // The page does not allow a direct read — the proxy will have to. But
    // an answer that is not text is an answer that is not worth asking for
    // again, and a cancelled import is not an error to fall back from.
    if (err instanceof ImportError || err?.name === 'AbortError') throw err;
  }

  const proxied = await fetchViaProxy(url);
  if (proxied.status >= 400) {
    throw new ImportError(`That page answered ${proxied.status}.`);
  }
  if (!isTextual(proxied.contentType)) {
    throw new ImportError('That address is not a page of text.');
  }

  return { html: proxied.body, finalUrl: proxied.finalUrl || url, via: 'the proxy' };
}

/* ==========================================================================
 * The sources
 * ========================================================================== */

/**
 * The README of a GitHub repository.
 *
 * The API hands the file over as base64, which is decoded here — the result
 * is the Markdown the author wrote, untouched.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchGithubReadme(source) {
  const url = `${GITHUB_API}/repos/${source.owner}/${source.repo}/readme`;

  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: importSignal() });
  } catch {
    throw new ImportError('GitHub could not be reached.');
  }

  if (response.status === 404) {
    throw new ImportError('That repository has no README.');
  }
  if (response.status === 403) {
    throw new ImportError('GitHub is rate limiting this browser — try again in a few minutes.');
  }
  if (!response.ok) {
    throw new ImportError(`GitHub answered ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ImportError('GitHub sent an answer that could not be read.');
  }

  return {
    markdown: decodeBase64Utf8(payload.content),
    title: `${source.owner}/${source.repo}`,
    sourceUrl: `https://github.com/${source.owner}/${source.repo}`,
    note: 'README'
  };
}

/**
 * A file inside a GitHub repository — taken from the raw host, which allows
 * a cross-origin read.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchGithubFile(source) {
  const url = `${RAW_GITHUB}/${source.owner}/${source.repo}/${source.ref}/${source.path}`;
  const markdown = await fetchText(url);

  return {
    markdown,
    title: source.path,
    sourceUrl: `https://github.com/${source.owner}/${source.repo}/blob/${source.ref}/${source.path}`,
    note: 'file'
  };
}

/**
 * The model card of a Hugging Face repository.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchHuggingFaceCard(source) {
  const prefix = source.repoType === 'models' ? '' : `${source.repoType}/`;
  const url = `${HUGGING_FACE}/${prefix}${source.id}/resolve/main/README.md`;

  let response;
  try {
    response = await fetch(url, { signal: importSignal() });
  } catch {
    throw new ImportError('Hugging Face could not be reached.');
  }

  if (response.status === 404) {
    throw new ImportError('That repository has no README card.');
  }
  if (!response.ok) {
    throw new ImportError(`Hugging Face answered ${response.status}.`);
  }

  const markdown = await response.text();

  return {
    markdown,
    title: source.id,
    sourceUrl: `https://huggingface.co/${prefix}${source.id}`,
    note: 'model card'
  };
}

/**
 * A file that is already Markdown.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchRawMarkdown(source) {
  try {
    const markdown = await fetchText(source.url);
    return {
      markdown,
      title: fileNameOf(source.url),
      sourceUrl: source.url,
      note: 'Markdown file'
    };
  } catch (err) {
    // The file may be on a host that does not allow a cross-origin read.
    // The proxy can still reach it.
    const proxied = await fetchViaProxy(source.url);
    return {
      markdown: proxied.body,
      title: fileNameOf(source.url),
      sourceUrl: source.url,
      note: 'Markdown file'
    };
  }
}

/* ==========================================================================
 * YouTube
 * ========================================================================== */

/**
 * Reads a video.
 *
 * The page of the video knows everything there is to know about it. The
 * transcript is fetched as well, when YouTube is willing to hand it out.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchYoutubeVideo(source) {
  const {
    parseVideoDetails,
    findCaptionTrack,
    parseCaptionTrack,
    transcriptToMarkdown,
    buildVideoDocument
  } = await import('@/importers/youtube.js');

  const { html } = await fetchHtml(source.url);
  const details = parseVideoDetails(html);

  if (!details) {
    throw new ImportError('The page of that video could not be read.');
  }

  const videoUrl = `https://www.youtube.com/watch?v=${source.videoId}`;

  let transcript = '';
  let transcriptNote = '';

  // 1. The address of the app of the app — the one that works. The
  // transcript is fetched by the server, because the address of the player
  // of YouTube does not allow a call from a browser.
  try {
    const response = await fetch(`/api/youtube-transcript?id=${source.videoId}`, {
      signal: importSignal()
    });
    const payload = await response.json();

    if (payload.ok && Array.isArray(payload.lines) && payload.lines.length > 0) {
      transcript = transcriptToMarkdown(payload.lines);
      if (payload.automatic) {
        transcriptNote = '_The transcript was written by the machine._';
      }
    } else if (!payload.ok && payload.error) {
      transcriptNote = payload.error;
    }
  } catch {
    transcriptNote = '';
  }

  // 2. The caption track of the page itself — the other way in.
  if (!transcript) {
    const track = findCaptionTrack(html);
    if (track) {
      try {
        const raw = await fetchTextWithFallback(track.url);
        transcript = transcriptToMarkdown(parseCaptionTrack(raw));
      } catch {
        transcript = '';
      }
    }
  }

  return {
    markdown: buildVideoDocument(details, {
      videoUrl,
      transcript,
      transcriptNote
    }),
    title: details.title,
    sourceUrl: videoUrl,
    note: transcript ? 'video with transcript' : 'video'
  };
}

/**
 * Reads a playlist.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchYoutubePlaylist(source) {
  const { extractJsonAfter, collectPlaylistVideos, formatTime } =
    await import('@/importers/youtube.js');

  const { html } = await fetchHtml(source.url);
  const data = extractJsonAfter(html, 'ytInitialData');

  const videos = data ? collectPlaylistVideos(data) : [];
  if (videos.length === 0) {
    throw new ImportError('The videos of that playlist could not be read.');
  }

  const lines = ['# YouTube playlist', ''];
  lines.push(`**Videos:** ${videos.length}`);
  lines.push('');

  for (const video of videos) {
    const link = `https://www.youtube.com/watch?v=${video.id}`;
    const length = video.seconds ? ` (${formatTime(video.seconds)})` : '';
    lines.push(`- [${video.title}](${link})${length}`);
  }

  return {
    markdown: lines.join('\n'),
    title: 'YouTube playlist',
    sourceUrl: source.url,
    note: 'playlist'
  };
}

/* ==========================================================================
 * Substack
 * ========================================================================== */

/**
 * Reads a post.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchSubstackPost(source) {
  const { html, finalUrl } = await fetchHtml(source.url);
  return buildSubstackFromHtml(html, finalUrl, source.url);
}

/**
 * Turns the page of a post into a document.
 *
 * @param {string} html
 * @param {string} finalUrl the address the page came from
 * @param {string} [sourceUrl] the address to show in the document
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function buildSubstackFromHtml(html, finalUrl, sourceUrl = '') {
  const { parseSubstackPost, buildSubstackDocument } = await import('@/importers/substack.js');
  const { htmlToMarkdownFragment } = await import('@/importers/html.js');

  const post = parseSubstackPost(html, finalUrl);

  if (!post) {
    throw new ImportError('That post could not be read.');
  }

  const body = await htmlToMarkdownFragment(post.bodyHtml, finalUrl);

  return {
    markdown: buildSubstackDocument(post, body),
    title: post.title || 'Substack post',
    sourceUrl: sourceUrl || finalUrl,
    note: post.paywalled ? 'post (partly for subscribers)' : 'post'
  };
}

/* ==========================================================================
 * Reddit
 * ========================================================================== */

/**
 * Reads a thread.
 *
 * Reddit serves its data in two shapes, and both are tried: the JSON of
 * the thread, and the feed of the thread. The page itself is the last
 * resort.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchRedditThread(source) {
  const { parseRedditJson, parseRedditFeed, buildRedditDocument } =
    await import('@/importers/reddit.js');

  const base = `https://www.reddit.com/r/${source.subreddit}/comments/${source.id}/${source.slug}`;
  let lastError = null;

  // 1. The JSON of the thread — the post and the comments.
  try {
    const text = await fetchTextWithFallback(`${base}.json?raw_json=1&limit=100`);
    const thread = parseRedditJson(text, source.url);
    if (thread) {
      return buildRedditResult(thread, buildRedditDocument);
    }
  } catch (err) {
    lastError = err;
  }

  // 2. The feed of the thread.
  try {
    const xml = await fetchTextWithFallback(`${base}.rss`);
    const thread = parseRedditFeed(xml, source.url);
    if (thread) {
      return buildRedditResult(thread, buildRedditDocument);
    }
  } catch (err) {
    lastError = err;
  }

  // 3. The page itself.
  try {
    const { html, finalUrl } = await fetchHtml(source.url);
    const { htmlToMarkdown } = await import('@/importers/html.js');
    const { markdown, title } = await htmlToMarkdown(html, finalUrl);

    // The page of a thread is drawn by a script, so what comes back is
    // often an empty shell. That is not a thread.
    if (markdown.trim().length < MIN_CONTENT) {
      throw new ImportError('That thread could not be read.');
    }

    return {
      markdown,
      title: title || 'Reddit thread',
      sourceUrl: source.url,
      note: 'thread'
    };
  } catch (err) {
    lastError = err;
  }

  // 4. The fallback reader — Reddit refuses many addresses, and this is
  // the last way in.
  if (getSettings().readerFallback) {
    try {
      const result = await fetchViaReaderFallback(source.url);
      return {
        ...result,
        title: result.title || 'Reddit thread',
        note: 'thread (read by the fallback service)'
      };
    } catch (err) {
      lastError = err instanceof ImportError ? err : lastError;
    }
  }

  throw (
    lastError ||
    new ImportError(
      'Reddit did not serve that thread. It usually refuses requests that do not come from a browser — try the fallback reader in the preferences.'
    )
  );
}

/**
 * Puts a thread together: the body of the post and the comments.
 *
 * @param {object} thread the parsed thread
 * @param {Function} buildRedditDocument the builder of the document
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function buildRedditResult(thread, buildRedditDocument) {
  const { htmlToMarkdownFragment } = await import('@/importers/html.js');

  let body = thread.body || '';
  if (!body && thread.bodyHtml) {
    body = await htmlToMarkdownFragment(thread.bodyHtml, thread.url);
  }

  const comments = [];
  for (const comment of thread.comments || []) {
    const text = await htmlToMarkdownFragment(comment.body, thread.url);
    if (text) comments.push({ ...comment, body: text });
  }

  const markdown = buildRedditDocument(thread, body, comments);

  if (markdown.trim().length < MIN_CONTENT) {
    throw new ImportError(
      'Reddit did not serve that thread. It usually refuses requests that do not come from a browser — try the fallback reader in the preferences.'
    );
  }

  return {
    markdown,
    title: thread.title || 'Reddit thread',
    sourceUrl: thread.url || sourceUrlOf(thread),
    note: 'thread'
  };
}

/**
 * The address of a thread that carries none.
 * @param {object} thread
 * @returns {string}
 */
function sourceUrlOf(thread) {
  return thread?.url || '';
}

/**
 * Reads the latest posts of a subreddit.
 *
 * Reddit draws the page of a subreddit with a script, so the list of the
 * posts is taken from the feed of the subreddit instead.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchRedditSubreddit(source) {
  const { parseRedditFeedEntries, buildSubredditDocument } = await import('@/importers/reddit.js');

  const xml = await fetchTextWithFallback(
    `https://www.reddit.com/r/${source.subreddit}/.rss?limit=25`
  );
  const posts = parseRedditFeedEntries(xml);

  if (posts.length === 0) {
    throw new ImportError('Reddit did not serve the posts of that subreddit.');
  }

  return {
    markdown: buildSubredditDocument(source.subreddit, posts),
    title: `r/${source.subreddit}`,
    sourceUrl: source.url,
    note: 'subreddit'
  };
}

/* ==========================================================================
 * arXiv
 * ========================================================================== */

/**
 * Reads a paper.
 *
 * The metadata comes from the API of arXiv, and the paper itself from the
 * form arXiv draws from the LaTeX of the author. Not every paper has that
 * form — the older ones do not — and then the summary is all there is.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchArxivPaper(source) {
  const {
    ARXIV_API,
    parseArxivMetadata,
    hasRenderedPaper,
    extractPaperHtml,
    buildPaperDocument,
    arxivRules
  } = await import('@/importers/arxiv.js');
  const { htmlToMarkdownFragment } = await import('@/importers/html.js');

  // 1. The metadata of the paper. arXiv knows the paper under its full
  // address, so the old form of an address may not be known at all.
  let meta = null;
  try {
    const xml = await fetchTextWithFallback(`${ARXIV_API}?id_list=${source.paperId}`);
    meta = parseArxivMetadata(xml);
  } catch {
    meta = null;
  }

  // 2. The paper itself, when arXiv has drawn it.
  let paperMarkdown = '';
  let paperFromPdf = false;

  try {
    const response = await fetch(`https://arxiv.org/html/${source.paperId}`, {
      signal: importSignal()
    });

    if (response.ok) {
      const html = await response.text();

      if (hasRenderedPaper(html)) {
        const paperHtml = extractPaperHtml(html);
        paperMarkdown = await htmlToMarkdownFragment(
          paperHtml,
          `https://arxiv.org/html/${source.paperId}`,
          {
            rules: arxivRules
          }
        );
      }
    }
  } catch {
    // The drawn paper could not be had — the PDF is the other way in.
  }

  // 3. Not every paper has been drawn into HTML, and some of the older
  // ones are not even known under the address they were given. Their text
  // is still in the PDF, and the PDF is read like any other.
  if (!paperMarkdown) {
    try {
      const { pdfToMarkdown } = await import('@/importers/pdf.js');
      const { bytes } = await fetchBinary(`https://arxiv.org/pdf/${source.paperId}`);
      const pdf = await pdfToMarkdown(bytes, {
        url: `https://arxiv.org/pdf/${source.paperId}`,
        signal: importSignal()
      });

      if (pdf.markdown) {
        paperMarkdown = pdf.markdown;
        paperFromPdf = true;
      }
    } catch {
      // The PDF could not be read either.
    }
  }

  if (!meta && !paperMarkdown) {
    throw new ImportError('arXiv does not know that paper.');
  }

  const metadata = meta || {
    title: `arXiv ${source.paperId}`,
    authors: [],
    categories: [],
    primaryCategory: '',
    published: '',
    updated: '',
    doi: '',
    journalRef: '',
    summary: '',
    absUrl: `https://arxiv.org/abs/${source.paperId}`,
    pdfUrl: `https://arxiv.org/pdf/${source.paperId}`
  };

  return {
    markdown: buildPaperDocument(metadata, {
      paperMarkdown,
      paperMissing: !paperMarkdown,
      paperFromPdf
    }),
    title: metadata.title,
    sourceUrl: metadata.absUrl || `https://arxiv.org/abs/${source.paperId}`,
    note: paperMarkdown ? (paperFromPdf ? 'paper (from the PDF)' : 'paper') : 'paper (summary only)'
  };
}

/* ==========================================================================
 * PDF, books and Word documents
 * ========================================================================== */

/**
 * Reads a response body as bytes, reporting progress when the browser exposes
 * a stream.
 *
 * @param {Response} response
 * @returns {Promise<Uint8Array>}
 */
async function readResponseBytes(response) {
  const declared = Number(response.headers?.get?.('content-length')) || 0;

  if (!response.body || typeof response.body.getReader !== 'function') {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    showImportProgress(activeJob, {
      phase: 'downloading',
      done: received,
      total: declared || 0
    });
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

/**
 * Fetches a file of bytes.
 *
 * The bytes are not text, so they travel as base64 through the proxy.
 *
 * @param {string} url
 * @returns {Promise<{ bytes: Uint8Array, finalUrl: string }>}
 */
async function fetchBinary(url) {
  try {
    const response = await fetch(url, { signal: importSignal() });
    if (response.ok) {
      const type = response.headers.get('content-type') || '';
      if (!/pdf|epub|docx|wordprocessingml|msword|ms-word|octet-stream|zip/i.test(type)) {
        throw new ImportError('That address is not a file of this kind.');
      }
      return {
        bytes: await readResponseBytes(response),
        finalUrl: response.url || url
      };
    }
  } catch (err) {
    if (err instanceof ImportError || err?.name === 'AbortError') throw err;
  }

  const proxied = await fetchViaProxy(url);
  if (proxied.status >= 400) {
    throw new ImportError(`That address answered ${proxied.status}.`);
  }
  if (proxied.encoding !== 'base64') {
    throw new ImportError('That address is not a file of this kind.');
  }

  const { fromBase64 } = await import('@/importers/pdf.js');
  return { bytes: fromBase64(proxied.body), finalUrl: proxied.finalUrl || url };
}

/**
 * Reads a PDF.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchPdfDocument(source) {
  const { pdfToMarkdown, buildPdfDocument } = await import('@/importers/pdf.js');

  const { bytes, finalUrl } = await fetchBinary(source.url);
  const pdf = await pdfToMarkdown(bytes, {
    url: finalUrl,
    signal: importSignal(),
    onProgress: (progress) => showImportProgress(activeJob, progress)
  });

  return {
    markdown: buildPdfDocument(pdf, finalUrl),
    title: pdf.title || 'PDF document',
    sourceUrl: finalUrl,
    note: `PDF (${pdf.pages} pages)`
  };
}

/**
 * Reads a book in EPUB form.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchEpubBook(source) {
  const { epubToMarkdown, buildEpubDocument } = await import('@/importers/epub.js');
  const { htmlToMarkdownFragment } = await import('@/importers/html.js');

  const { bytes, finalUrl } = await fetchBinary(source.url);

  let book;
  try {
    book = await epubToMarkdown(bytes, {
      url: finalUrl,
      signal: importSignal(),
      onProgress: (progress) => showImportProgress(activeJob, progress),
      toMarkdown: (html, baseUrl) =>
        htmlToMarkdownFragment(html, baseUrl, {
          signal: importSignal(),
          onProgress: (progress) => showImportProgress(activeJob, progress)
        })
    });
  } catch (err) {
    throw new ImportError(err instanceof Error ? err.message : 'That book could not be read.');
  }

  return {
    markdown: buildEpubDocument(book),
    title: book.title,
    sourceUrl: finalUrl,
    note: `book (${book.chapters} chapters)`
  };
}

/**
 * Reads a Word document.
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchDocxDocument(source) {
  const { docxToMarkdown } = await import('@/importers/docx.js');

  const { bytes, finalUrl } = await fetchBinary(source.url);

  let docx;
  try {
    docx = await docxToMarkdown(bytes, {
      url: finalUrl,
      signal: importSignal(),
      onProgress: (progress) => showImportProgress(activeJob, progress)
    });
  } catch (err) {
    throw new ImportError(err instanceof Error ? err.message : 'That document could not be read.');
  }

  return {
    markdown: docx.markdown,
    title: docx.title,
    sourceUrl: finalUrl,
    note: `Word document (${docx.paragraphs} paragraphs)`
  };
}

/* ==========================================================================
 * Web pages
 * ========================================================================== */

/**
 * Asks the proxy of the app for a page.
 *
 * @param {string} url
 * @returns {Promise<{ status: number, finalUrl: string, contentType: string, body: string }>}
 */
async function fetchViaProxy(url) {
  let response;
  try {
    response = await fetch(`${PROXY_ENDPOINT}?url=${encodeURIComponent(url)}`, {
      signal: importSignal()
    });
  } catch {
    throw new ImportError('The proxy of the app could not be reached.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ImportError('The proxy sent an answer that could not be read.');
  }

  if (!payload.ok) {
    throw new ImportError(payload.error || 'The proxy could not fetch that page.');
  }

  return payload;
}

/**
 * Asks a public reader service for the page.
 *
 * This is the last resort: it works when everything else fails, but the
 * address is handed to a third party, so it can be switched off.
 *
 * @param {string} url
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchViaReaderFallback(url) {
  const { readerApiKey } = getSettings();

  const headers = {
    Accept: 'text/plain',
    'X-Return-Format': 'markdown'
  };
  if (readerApiKey) {
    headers.Authorization = `Bearer ${readerApiKey}`;
  }

  let response;
  try {
    response = await fetch(`${READER_FALLBACK}${url}`, { headers, signal: importSignal() });
  } catch {
    throw new ImportError('The fallback reader could not be reached.');
  }

  if (!response.ok) {
    throw new ImportError(`The fallback reader answered ${response.status}.`);
  }

  const markdown = stripReaderHeader(await response.text());
  if (!markdown.trim()) {
    throw new ImportError('The fallback reader found nothing to read.');
  }

  return {
    markdown,
    title: fileNameOf(url),
    sourceUrl: url,
    note: 'read by the fallback service'
  };
}

/**
 * Takes the head off the answer of the reader service.
 *
 * The service writes a small header of its own before the content — the
 * title of the page, the address it came from, the time it was read. It
 * is of no use in the document.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripReaderHeader(text) {
  const body = String(text || '');

  const marker = body.indexOf('Markdown Content:');
  if (marker === -1) return body.trim();

  return body.slice(marker + 'Markdown Content:'.length).trim();
}

/**
 * Reads a web page and turns it into Markdown.
 *
 * The order of the attempts matters:
 *   1. the page itself — free, and nothing leaves the browser
 *   2. the proxy of the app — for the pages that do not allow a cross-origin
 *      read
 *   3. the fallback reader — only if it has been switched on
 *
 * @param {object} source
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
async function fetchWebPage(source) {
  let firstError = null;

  // 1. The page itself, then the proxy of the app.
  try {
    const { html, finalUrl, via } = await fetchHtml(source.url);

    // A publication of Substack often has a domain of its own, so the
    // page itself has to say that it is one.
    const { looksLikeSubstack } = await import('@/importers/substack.js');
    if (looksLikeSubstack(html)) {
      return buildSubstackFromHtml(html, finalUrl, source.url);
    }

    const { markdown, title, strategy } = await convertHtml(html, finalUrl);

    // A page that holds nothing is not a page. Better to say so than to
    // replace the text of the reader with an empty one. A document that
    // is short is not the same thing — a README of two lines is a
    // document — so this check belongs here and not in every import.
    if (markdown.trim().length < MIN_CONTENT) {
      throw new ImportError('That page had nothing to read.');
    }

    return {
      markdown,
      title: title || fileNameOf(source.url),
      sourceUrl: source.url,
      note: strategy === 'article' ? `article${via ? ' (via the proxy)' : ''}` : 'whole page'
    };
  } catch (err) {
    firstError = err instanceof ImportError ? err : new ImportError('That page could not be read.');
  }

  // 2. The fallback reader, if it is allowed.
  if (getSettings().readerFallback) {
    try {
      return await fetchViaReaderFallback(source.url);
    } catch (err) {
      firstError = err instanceof ImportError ? err : firstError;
    }
  }

  throw firstError || new ImportError('That page could not be read.');
}

/**
 * Converts the HTML of a page into Markdown.
 *
 * @param {string} html
 * @param {string} pageUrl
 * @returns {Promise<{ markdown: string, title: string, strategy: string }>}
 */
async function convertHtml(html, pageUrl) {
  const { htmlToMarkdown } = await import('@/importers/html.js');
  return htmlToMarkdown(html, pageUrl, {
    signal: importSignal(),
    onProgress: (progress) => showImportProgress(activeJob, progress)
  });
}

/* ==========================================================================
 * Helpers
 * ========================================================================== */

/**
 * The last part of the path of an address.
 * @param {string} url
 * @returns {string}
 */
function fileNameOf(url) {
  try {
    const { pathname } = new URL(url);
    const name = pathname.split('/').filter(Boolean).pop() || '';
    return name.replace(/\.(html?|php|aspx?)$/i, '') || 'Web page';
  } catch {
    return 'Web page';
  }
}

/**
 * The block of values that may open a Markdown document.
 */
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Reads the values a document opens with.
 *
 * A model card often carries a block of its own — `language: en` and the
 * like. It is taken apart and merged into the header of the document
 * instead of being left inside the text, where it would look like a
 * stray line.
 *
 * @param {string} text
 * @returns {{ data: Record<string, string>, body: string }}
 */
function splitFrontmatter(text) {
  const source = String(text || '');
  const match = source.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: source };

  const data = {};

  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!entry) continue;

    let value = entry[2].trim();
    if (value.length > 1) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }

    data[entry[1].toLowerCase()] = value;
  }

  return { data, body: source.slice(match[0].length) };
}

/**
 * The document that is put into the editor: the content with a small header
 * that says where it came from.
 *
 * @param {{ markdown: string, title: string, sourceUrl: string }} result
 * @returns {string}
 */
export function buildDocument(result) {
  const { data, body } = splitFrontmatter(result.markdown);

  const title = String(data.title || result.title || '')
    .replace(/\s+/g, ' ')
    .trim();
  const source = String(result.sourceUrl || '')
    .replace(/\s+/g, ' ')
    .trim();

  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'title' || key === 'source') continue;
    lines.push(`${key}: ${value}`);
  }
  if (title) lines.push(`title: ${title}`);
  if (source) lines.push(`source: ${source}`);

  const header = lines.length > 0 ? `---\n${lines.join('\n')}\n---\n\n` : '';

  return `${header}${body.trim()}\n`;
}

/**
 * The reason of an error, in a few words.
 * @param {unknown} err
 * @returns {string}
 */
function reasonOf(err) {
  if (err instanceof Error && err.message) return err.message.slice(0, 120);
  return 'unknown error';
}

/* ==========================================================================
 * The public API
 * ========================================================================== */

/**
 * Reads a document from an address.
 *
 * @param {string} input the URL as the user typed it
 * @returns {Promise<{ markdown: string, title: string, sourceUrl: string, note: string }>}
 */
export async function importFromUrl(input) {
  const source = detectSource(input);
  if (!source) {
    throw new ImportError('That does not look like a web address.');
  }

  switch (source.type) {
    case SOURCE.GITHUB_REPO:
      return fetchGithubReadme(source);
    case SOURCE.GITHUB_FILE:
      return fetchGithubFile(source);
    case SOURCE.HF_MODEL:
    case SOURCE.HF_DATASET:
    case SOURCE.HF_SPACE:
      return fetchHuggingFaceCard(source);
    case SOURCE.RAW_MARKDOWN:
      return fetchRawMarkdown(source);
    case SOURCE.YOUTUBE_VIDEO:
      return fetchYoutubeVideo(source);
    case SOURCE.YOUTUBE_PLAYLIST:
      return fetchYoutubePlaylist(source);
    case SOURCE.SUBSTACK_POST:
      return fetchSubstackPost(source);
    case SOURCE.REDDIT_THREAD:
      return fetchRedditThread(source);
    case SOURCE.REDDIT_SUBREDDIT:
      return fetchRedditSubreddit(source);
    case SOURCE.ARXIV_PAPER:
      return fetchArxivPaper(source);
    case SOURCE.PDF_DOCUMENT:
      return fetchPdfDocument(source);
    case SOURCE.EPUB_BOOK:
      return fetchEpubBook(source);
    case SOURCE.DOCX_DOCUMENT:
      return fetchDocxDocument(source);
    default:
      return fetchWebPage(source);
  }
}

/**
 * Runs an import and puts the result into the document.
 *
 * @param {string} input
 * @returns {Promise<boolean>} whether the import worked
 */
export async function runImport(input) {
  const value = String(input || '').trim();
  if (!value) {
    showError('Type an address first.');
    return false;
  }

  const job = beginImport('Importing', 'url');
  activeJob = job;
  setBusy(true);
  setMessage('Fetching…', { tone: 'muted' });

  try {
    const result = await importFromUrl(value);
    if (!isCurrentImport(job)) return false;

    const markdown = buildDocument(result);
    if (!isCurrentImport(job)) return false;

    // An import brings in a document, so it becomes the document. It is
    // not a piece of text that is put somewhere in the text that is
    // already there — that would only mix the two.
    closeDialog();
    setMarkdown(markdown, 'replaced');

    const chars = markdown.length.toLocaleString();
    setMessage(`Imported ${result.note || 'content'} — ${chars} characters`, {
      tone: 'accent',
      ttl: 3500
    });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError' || !isCurrentImport(job)) {
      return false;
    }

    if (!(err instanceof ImportError)) {
      // Something unexpected went wrong. The reason is worth knowing, and
      // it is worth telling — a silent "it did not work" helps nobody.
      console.error('Import failed:', err);
    }

    const message =
      err instanceof ImportError
        ? err.message
        : `That address could not be read (${reasonOf(err)}).`;
    showError(message);
    setMessage(message, { tone: 'warn', ttl: 5000 });
    return false;
  } finally {
    const wasCurrent = endImport(job);
    if (activeJob === job) activeJob = null;

    // A document opened from the picker or a drop cancels this job but does
    // not own the URL dialog's busy state: it has to be cleared here. A newer
    // URL import owns it and will clear it when it is done.
    if (wasCurrent || currentImportKind() !== 'url') {
      setBusy(false);
    }
  }
}

/* ==========================================================================
 * The dialog
 * ========================================================================== */

/**
 * Opens the import dialog.
 */
export function openDialog() {
  if (!el.modalUrlImport) return;
  el.modalUrlImport.removeAttribute('hidden');
  if (el.urlImportError) el.urlImportError.textContent = '';
  if (el.urlImportInput) {
    el.urlImportInput.value = '';
    el.urlImportInput.focus();
  }
}

/**
 * Closes the import dialog.
 */
export function closeDialog() {
  el.modalUrlImport?.setAttribute('hidden', '');
}

/**
 * Shows a message inside the dialog.
 * @param {string} message
 */
function showError(message) {
  if (el.urlImportError) el.urlImportError.textContent = message;
}

/**
 * Switches the dialog between the idle and the working state.
 * @param {boolean} busy
 */
function setBusy(busy) {
  if (el.btnUrlImportSubmit) {
    el.btnUrlImportSubmit.disabled = busy;
    el.btnUrlImportSubmit.textContent = busy ? 'Fetching…' : 'Import';
  }
  if (el.urlImportInput) el.urlImportInput.disabled = busy;
}

/**
 * Initializes the import dialog and its button.
 */
export function initUrlImport() {
  el.btnImportUrl?.addEventListener('click', openDialog);
  el.btnCloseUrlImport?.addEventListener('click', closeDialog);
  el.btnUrlImportCancel?.addEventListener('click', () => {
    // Keep `activeJob` pointing at the aborted job while it unwinds: every
    // later fetch and every conversion reads the signal from it and stops.
    cancelImport('url');
    setBusy(false);
    closeDialog();
  });

  el.modalUrlImport?.addEventListener('click', (event) => {
    if (event.target === el.modalUrlImport) closeDialog();
  });

  el.urlImportForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    runImport(el.urlImportInput.value);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && el.modalUrlImport && !el.modalUrlImport.hasAttribute('hidden')) {
      closeDialog();
    }
  });
}
