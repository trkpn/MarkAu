/**
 * ============================================================================
 * REDDIT
 * Turns a thread into a document.
 *
 * A thread is a post and the comments under it. The post is written in
 * Markdown already, so it is taken as it is; the comments are written in
 * HTML, so they are converted.
 *
 * Reddit hands out its data in two shapes, and both are used here:
 *   • JSON — the post and every comment, with their scores and authors
 *   • a feed — the same, as XML, for the times the JSON is not served
 * ============================================================================
 */

/** How many comments are worth reading. */
const MAX_COMMENTS = 40;

/**
 * Reads a thread out of the JSON Reddit serves.
 *
 * @param {string|object} payload the answer of the JSON endpoint
 * @param {string} [pageUrl]
 * @returns {{
 *   title: string,
 *   subreddit: string,
 *   author: string,
 *   score: number,
 *   created: number,
 *   body: string,
 *   comments: Array<{ author: string, score: number, body: string, created: number }>,
 *   url: string,
 *   type: string
 * }|null}
 */
export function parseRedditJson(payload, pageUrl = '') {
  const data = typeof payload === 'string' ? safeJson(payload) : payload;
  if (!data) return null;

  const listings = Array.isArray(data) ? data : [data];
  const post = findPost(listings);
  if (!post) return null;

  const commentListing = listings.find((listing) =>
    listing?.data?.children?.some((child) => child.kind === 't1')
  );

  const comments = (commentListing?.data?.children || [])
    .filter((child) => child.kind === 't1' && child.data?.body)
    .map((child) => ({
      author: child.data.author || '[deleted]',
      score: Number(child.data.score) || 0,
      body: child.data.body || '',
      created: Number(child.data.created_utc) || 0
    }))
    .slice(0, MAX_COMMENTS);

  return {
    title: post.title || '',
    subreddit: post.subreddit || '',
    author: post.author || '[deleted]',
    score: Number(post.score) || 0,
    created: Number(post.created_utc) || 0,
    body: post.selftext || '',
    comments,
    url: pageUrl || `https://www.reddit.com${post.permalink || ''}`,
    type: post.is_self ? 'self' : 'link'
  };
}

/**
 * Reads a thread out of the feed Reddit serves.
 *
 * @param {string} xml the answer of the feed endpoint
 * @param {string} [pageUrl]
 * @returns {object|null} the same shape as the JSON reader
 */
export function parseRedditFeed(xml, pageUrl = '') {
  if (!xml) return null;

  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const entry = doc.querySelector('entry');
  if (!entry) return null;

  const author = entry.querySelector('author > name')?.textContent?.trim() || '';
  const content = entry.querySelector('content')?.textContent || '';
  const category = entry.querySelector('category')?.getAttribute('label') || '';
  const subreddit = category.replace(/^r\//, '');

  return {
    title: entry.querySelector('title')?.textContent?.trim() || '',
    subreddit,
    author: author.replace(/^\/u\//, ''),
    score: 0,
    created: Date.parse(entry.querySelector('updated')?.textContent || '') / 1000 || 0,
    body: '',
    bodyHtml: content,
    comments: [],
    url: pageUrl || entry.querySelector('link')?.getAttribute('href') || '',
    type: 'self'
  };
}

/**
 * Reads the posts of a feed.
 *
 * @param {string} xml the answer of the feed endpoint
 * @returns {Array<{ title: string, author: string, subreddit: string, url: string, created: number }>}
 */
export function parseRedditFeedEntries(xml) {
  if (!xml) return [];

  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const entries = Array.from(doc.querySelectorAll('entry'));

  return entries.map((entry) => ({
    title: entry.querySelector('title')?.textContent?.trim() || '',
    author: (entry.querySelector('author > name')?.textContent?.trim() || '').replace(/^\/u\//, ''),
    subreddit: (entry.querySelector('category')?.getAttribute('label') || '').replace(/^r\//, ''),
    url: entry.querySelector('link')?.getAttribute('href') || '',
    created: Date.parse(entry.querySelector('updated')?.textContent || '') / 1000 || 0
  }));
}

/**
 * Builds the document of the posts of a subreddit.
 *
 * @param {string} subreddit
 * @param {Array<object>} posts the posts of the feed
 * @returns {string}
 */
export function buildSubredditDocument(subreddit, posts) {
  const lines = [`# r/${subreddit}`, ''];
  lines.push(`**Latest posts:** ${posts.length}`);
  lines.push('');

  for (const post of posts) {
    const title = post.title || 'Untitled';
    const link = post.url ? `[${title}](${post.url})` : title;
    const by = post.author ? ` — u/${post.author}` : '';
    lines.push(`- ${link}${by}`);
  }

  return lines.join('\n').trim();
}

/**
 * Builds the document of a thread.
 *
 * @param {object} thread the parsed thread
 * @param {string} [bodyMarkdown] the post body, when it was converted
 * @param {Array<{ author: string, score: number, body: string, created: number }>} [comments]
 *   the comments, with their bodies already converted
 * @returns {string}
 */
export function buildRedditDocument(thread, bodyMarkdown = '', comments = []) {
  const lines = [];

  if (thread.title) {
    lines.push(`# ${thread.title}`);
    lines.push('');
  }

  const facts = [];
  if (thread.subreddit) facts.push(`**Subreddit:** r/${thread.subreddit}`);
  if (thread.author) facts.push(`**By:** u/${thread.author}`);
  if (thread.score) facts.push(`**Score:** ${thread.score}`);
  if (thread.created)
    facts.push(`**Posted:** ${new Date(thread.created * 1000).toISOString().slice(0, 10)}`);
  if (thread.url) facts.push(`**Link:** ${thread.url}`);

  if (facts.length > 0) {
    lines.push(facts.join('  \n'));
    lines.push('');
  }

  if (bodyMarkdown) {
    lines.push(bodyMarkdown);
    lines.push('');
  }

  if (comments.length > 0) {
    lines.push(`## Comments (${comments.length})`);
    lines.push('');

    for (const comment of comments) {
      const head = [`u/${comment.author}`];
      if (comment.score) head.push(`${comment.score} points`);
      lines.push(`### ${head.join(' · ')}`);
      lines.push('');
      lines.push(comment.body);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

/**
 * Finds the post inside the answer of Reddit.
 * @param {Array} listings
 * @returns {object|null}
 */
function findPost(listings) {
  for (const listing of listings) {
    const children = listing?.data?.children || [];
    const found = children.find((child) => child.kind === 't3');
    if (found?.data) return found.data;
  }
  return null;
}

/**
 * Reads JSON without throwing.
 * @param {string} text
 * @returns {object|null}
 */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
