import { describe, it, expect } from 'vitest';
import { onRequest } from '../../functions/api/version.js';
import { BUILD_INFO } from '../../src/core/build-info.js';

describe('/api/version endpoint', () => {
  it('returns version, commit, and build info for GET requests', async () => {
    const request = new Request('https://markau.pages.dev/api/version');
    const response = await onRequest({ request });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');

    const data = await response.json();
    expect(data.app).toBe('MarkAu');
    expect(data.version).toBe(BUILD_INFO.version);
    expect(data.commit).toBe(BUILD_INFO.commit);
    expect(data.buildTime).toBe(BUILD_INFO.buildTime);
  });

  it('uses Cloudflare Pages environment variables when present', async () => {
    const request = new Request('https://markau.pages.dev/api/version');
    const env = {
      CF_PAGES_COMMIT_SHA: 'abcdef1234567890',
      CF_PAGES_BRANCH: 'main'
    };
    const response = await onRequest({ request, env });
    const data = await response.json();

    expect(data.commit).toBe('abcdef1');
    expect(data.cfCommit).toBe('abcdef1234567890');
    expect(data.cfBranch).toBe('main');
  });

  it('rejects POST requests with 405 Method Not Allowed', async () => {
    const request = new Request('https://markau.pages.dev/api/version', { method: 'POST' });
    const response = await onRequest({ request });

    expect(response.status).toBe(405);
    const data = await response.json();
    expect(data.ok).toBe(false);
  });
});
