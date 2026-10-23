/**
 * @vitest-environment jsdom
 *
 * The three sites that need their own reader: a video, a post and a thread.
 * Each one is read out of a page that is kept here in the shape the site
 * really sends.
 */
import { describe, it, expect } from 'vitest';

const {
  parseVideoDetails,
  findCaptionTrack,
  parseCaptionTrack,
  transcriptToMarkdown,
  parseChapters,
  buildVideoDocument,
  formatTime,
  extractJsonAfter
} = await import('@/importers/youtube.js');

const { parseSubstackPost, buildSubstackDocument, looksLikeSubstack } =
  await import('@/importers/substack.js');
const { parseRedditJson, parseRedditFeed, buildRedditDocument } =
  await import('@/importers/reddit.js');

/* ==========================================================================
 * YouTube
 * ========================================================================== */

const WATCH_PAGE = `<!doctype html><html><head>
<meta itemprop="uploadDate" content="2024-03-15T10:00:00-07:00">
</head><body>
<script>
var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc123","title":"A Video About Things","lengthSeconds":"212","channelId":"UC1","shortDescription":"0:00 Introduction\\n0:30 The middle of it\\n1:30 The end\\n\\nA description with a link to https://example.com","viewCount":"12345","author":"A Channel","isLiveContent":false},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc123&lang=en&kind=asr","languageCode":"en","kind":"asr","name":{"simpleText":"English (auto-generated)"}},
{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc123&lang=en&manual=1","languageCode":"en","name":{"simpleText":"English"}}
]}}};
</script>
</body></html>`;

describe('reading a video', () => {
  it('finds the details of the video in the page', () => {
    const details = parseVideoDetails(WATCH_PAGE);

    expect(details.title).toBe('A Video About Things');
    expect(details.author).toBe('A Channel');
    expect(details.seconds).toBe(212);
    expect(details.views).toBe(12345);
    expect(details.published).toBe('2024-03-15T10:00:00-07:00');
  });

  it('prefers the caption track that was written by hand', () => {
    const track = findCaptionTrack(WATCH_PAGE, 'en');

    expect(track.language).toBe('en');
    expect(track.automatic).toBe(false);
    expect(track.url).toContain('manual=1');
  });

  it('finds the chapters in the description', () => {
    const chapters = parseChapters('0:00 Introduction\n0:30 The middle of it\n1:30 The end');

    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toEqual({ time: '0:00', seconds: 0, title: 'Introduction' });
    expect(chapters[2].seconds).toBe(90);
  });

  it('writes a length of time the way a person would', () => {
    expect(formatTime(212)).toBe('3:32');
    expect(formatTime(3723)).toBe('1:02:03');
  });

  it('reads the JSON form of a caption track', () => {
    const lines = parseCaptionTrack(
      JSON.stringify({
        events: [
          { tStartMs: 0, segs: [{ utf8: 'Hello' }, { utf8: ' there' }] },
          { tStartMs: 1500, segs: [{ utf8: 'This is a test.' }] }
        ]
      })
    );

    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Hello there');
    expect(lines[1].start).toBe(1500);
  });

  it('reads the XML form of a caption track', () => {
    const lines = parseCaptionTrack(
      '<?xml version="1.0"?><transcript><text start="0" dur="1">Hello there</text>' +
        '<text start="2.5" dur="1">And again</text></transcript>'
    );

    expect(lines).toHaveLength(2);
    expect(lines[1].text).toBe('And again');
    expect(lines[1].start).toBe(2500);
  });

  it('gathers the words of a transcript into sentences', () => {
    const markdown = transcriptToMarkdown([
      { start: 0, text: 'Hello there.' },
      { start: 1200, text: 'This is a test.' },
      { start: 2400, text: 'And one more.' }
    ]);

    expect(markdown).toContain('**[0:00]**');
    expect(markdown).toContain('Hello there.');
    expect(markdown.split('\n\n')).toHaveLength(3);
  });

  it('builds a document of the video', () => {
    const details = parseVideoDetails(WATCH_PAGE);
    const markdown = buildVideoDocument(details, {
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
      transcript: '**[0:00]** Hello there.'
    });

    expect(markdown).toContain('# A Video About Things');
    expect(markdown).toContain('**Channel:** A Channel');
    expect(markdown).toContain('**Length:** 3:32');
    expect(markdown).toContain('**Published:** 2024-03-15');
    expect(markdown).toContain('## Description');
    expect(markdown).toContain('## Chapters');
    expect(markdown).toContain('## Transcript');
    expect(markdown).toContain('Hello there.');
  });

  it('says so when the transcript could not be had', () => {
    const details = parseVideoDetails(WATCH_PAGE);
    const markdown = buildVideoDocument(details, {
      transcriptNote: 'YouTube did not hand out the transcript of this video.'
    });

    expect(markdown).toContain('## Transcript');
    expect(markdown).toContain('did not hand out the transcript');
  });

  it('finds a JSON object that holds braces in its strings', () => {
    const html = 'var data = {"a":{"b":"}"},"c":1}; var other = {"x":2};';

    expect(extractJsonAfter(html, 'var data =')).toEqual({ a: { b: '}' }, c: 1 });
  });
});

/* ==========================================================================
 * Substack
 * ========================================================================== */

const SUBSTACK_PAGE = `<!doctype html><html><head><title>Blog</title></head><body>
<header>
  <h1 class="post-title">The Real Title</h1>
  <span class="publication-name">The Publication</span>
  <time datetime="2024-05-01T09:00:00Z">May 1</time>
</header>
<div class="available-content">
  <div class="body markup">
    <p>The first paragraph of the post.</p>
    <p>The second one, with a <a href="/other">link</a>.</p>
  </div>
</div>
<div class="paywall" data-testid="paywall" data-component-name="Paywall" role="region" aria-label="Paywall">
  <h2 class="paywall-title">This post is for paid subscribers</h2>
  <div class="paywall-cta"><a href="/subscribe">Subscribe</a></div>
</div>
</body></html>`;

/**
 * A post that is open to everyone. The word "paywall" is in the script of
 * the page — the app of the site knows about it — and that must not be
 * taken for a paywall.
 */
const FREE_SUBSTACK_PAGE = `<!doctype html><html><head><title>Blog</title></head><body>
<script>var config = { paywall: false, showPaywall: true };</script>
<header>
  <h1 class="post-title">An Open Post</h1>
  <span class="publication-name">The Publication</span>
</header>
<div class="available-content">
  <div class="body markup"><p>Everyone may read this.</p></div>
</div>
</body></html>`;

describe('reading a post', () => {
  it('sees a post of a publication with a domain of its own', () => {
    // Most publications do not live on substack.com, so the page itself
    // has to be the one that says what it is.
    const page = `<html><body>
      <div class="post available-content">
        <h1 class="post-title">A Post</h1>
        <div class="body markup"><p>The body.</p></div>
      </div>
      <script>window.__PRELOADED_STATE__ = {"publication_id":458709,"post_id":221357696};</script>
    </body></html>`;

    expect(looksLikeSubstack(page)).toBe(true);
  });

  it('does not take an ordinary page for a post', () => {
    expect(
      looksLikeSubstack('<html><body><article><p>Just a page.</p></article></body></html>')
    ).toBe(false);
    expect(looksLikeSubstack('')).toBe(false);
  });

  it('finds the title, the publication and the body', () => {
    const post = parseSubstackPost(SUBSTACK_PAGE, 'https://blog.example.substack.com/p/a-post');

    expect(post.title).toBe('The Real Title');
    expect(post.publication).toBe('The Publication');
    expect(post.published).toBe('2024-05-01T09:00:00Z');
    expect(post.bodyHtml).toContain('The first paragraph of the post.');
  });

  it('takes the paywall out of the body', () => {
    const post = parseSubstackPost(SUBSTACK_PAGE, 'https://blog.example.substack.com/p/a-post');

    expect(post.bodyHtml).not.toContain('paid subscribers');
    expect(post.paywalled).toBe(true);
  });

  it('does not take a post for one that is paid', () => {
    const post = parseSubstackPost(FREE_SUBSTACK_PAGE, 'https://blog.example.substack.com/p/open');

    expect(post.paywalled).toBe(false);
  });

  it('says so when the post is only partly open', () => {
    const post = parseSubstackPost(SUBSTACK_PAGE, 'https://blog.example.substack.com/p/a-post');
    const document = buildSubstackDocument(post, 'The first paragraph of the post.');

    expect(document).toContain('# The Real Title');
    expect(document).toContain('**Publication:** The Publication');
    expect(document).toContain('**Published:** 2024-05-01');
    expect(document).toContain('for subscribers');
  });
});

/* ==========================================================================
 * Reddit
 * ========================================================================== */

const REDDIT_JSON = JSON.stringify([
  {
    kind: 'Listing',
    data: {
      children: [
        {
          kind: 't3',
          data: {
            title: 'A post about code',
            author: 'alice',
            subreddit: 'programming',
            score: 42,
            created_utc: 1700000000,
            selftext: 'The body, written **in markdown**.',
            permalink: '/r/programming/comments/abc123/a_post/',
            is_self: true
          }
        }
      ]
    }
  },
  {
    kind: 'Listing',
    data: {
      children: [
        {
          kind: 't1',
          data: {
            author: 'bob',
            score: 7,
            body: '<p>A <strong>comment</strong> with a <a href="/x">link</a>.</p>',
            created_utc: 1700000100
          }
        }
      ]
    }
  }
]);

describe('reading a thread', () => {
  it('finds the post and the comments', () => {
    const thread = parseRedditJson(
      REDDIT_JSON,
      'https://www.reddit.com/r/programming/comments/abc123/a_post/'
    );

    expect(thread.title).toBe('A post about code');
    expect(thread.subreddit).toBe('programming');
    expect(thread.author).toBe('alice');
    expect(thread.score).toBe(42);
    expect(thread.body).toBe('The body, written **in markdown**.');
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].author).toBe('bob');
  });

  it('builds a document of the thread', () => {
    const thread = parseRedditJson(
      REDDIT_JSON,
      'https://www.reddit.com/r/programming/comments/abc123/a_post/'
    );
    const document = buildRedditDocument(
      thread,
      thread.body,
      thread.comments.map((comment) => ({ ...comment, body: 'A **comment** with a [link](/x).' }))
    );

    expect(document).toContain('# A post about code');
    expect(document).toContain('**Subreddit:** r/programming');
    expect(document).toContain('**By:** u/alice');
    expect(document).toContain('**Score:** 42');
    expect(document).toContain('The body, written **in markdown**.');
    expect(document).toContain('## Comments (1)');
    expect(document).toContain('### u/bob · 7 points');
  });

  it('reads the feed of a thread as well', () => {
    const feed = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <author><name>/u/alice</name></author>
          <updated>2024-05-01T09:00:00Z</updated>
          <id>t3_abc123</id>
          <category term="programming" label="r/programming"/>
          <content type="html">&lt;div class="md"&gt;&lt;p&gt;The body of the post.&lt;/p&gt;&lt;/div&gt;</content>
          <title>A post about code</title>
        </entry>
      </feed>`;

    const thread = parseRedditFeed(
      feed,
      'https://www.reddit.com/r/programming/comments/abc123/a_post/'
    );

    expect(thread.title).toBe('A post about code');
    expect(thread.subreddit).toBe('programming');
    expect(thread.author).toBe('alice');
    expect(thread.bodyHtml).toContain('The body of the post.');
  });
});
