/**
 * The transcript of a video.
 *
 * It is read on the server, because the address of the player of YouTube
 * does not allow a call from a browser.
 */
import { describe, it, expect } from 'vitest';

const { assertVideoId, chooseTrack, fetchTranscript, handleTranscriptRequest, TranscriptError } =
  await import('../../server/youtube-transcript.js');
const { parseCaptionTrack } = await import('@/importers/youtube.js');

/**
 * The answer of the player, with two caption tracks: one written by a
 * person and one written by the machine.
 */
const PLAYER_ANSWER = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=ja&kind=asr',
          languageCode: 'ja',
          kind: 'asr',
          name: { simpleText: 'Japanese (auto-generated)' }
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en',
          languageCode: 'en',
          name: { simpleText: 'English' }
        }
      ]
    }
  }
};

describe('the address of a video', () => {
  it('is checked', () => {
    expect(assertVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(() => assertVideoId('')).toThrow(TranscriptError);
    expect(() => assertVideoId('not an id')).toThrow(TranscriptError);
    expect(() => assertVideoId('http://evil.example/')).toThrow(TranscriptError);
  });
});

describe('choosing a caption track', () => {
  const tracks = [
    { language: 'ja', automatic: true, name: 'Japanese' },
    { language: 'en', automatic: false, name: 'English' },
    { language: 'en', automatic: true, name: 'English (auto)' }
  ];

  it('takes the track that was written by a person', () => {
    expect(chooseTrack(tracks, 'en').automatic).toBe(false);
  });

  it('takes the language that was asked for', () => {
    expect(chooseTrack(tracks, 'ja').language).toBe('ja');
  });

  it('takes something when there is nothing of the language', () => {
    expect(chooseTrack([{ language: 'de', automatic: true }], 'en')).toBeTruthy();
  });

  it('takes nothing when there is nothing', () => {
    expect(chooseTrack([], 'en')).toBeNull();
  });
});

describe('reading the captions', () => {
  it('reads the shape with the seconds', () => {
    const lines = parseCaptionTrack(
      '<timedtext><body><text start="1.5" dur="2">Hello there</text></body></timedtext>'
    );

    expect(lines).toEqual([{ start: 1500, text: 'Hello there' }]);
  });

  it('reads the shape with the milliseconds', () => {
    const lines = parseCaptionTrack(
      '<timedtext format="3"><body><p t="1360" d="1680">[♪♪♪]</p><p t="18640" d="3240">We are no strangers to love</p></body></timedtext>'
    );

    expect(lines).toHaveLength(2);
    expect(lines[0].start).toBe(1360);
    expect(lines[1].text).toBe('We are no strangers to love');
  });

  it('reads the shape of JSON', () => {
    const lines = parseCaptionTrack(
      JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'Hello' }] }] })
    );

    expect(lines).toEqual([{ start: 0, text: 'Hello' }]);
  });

  it('takes the marks of the format away', () => {
    const lines = parseCaptionTrack('<p t="0">It&#39;s here &amp; there</p>');

    expect(lines[0].text).toBe("It's here & there");
  });
});

describe('fetching the transcript', () => {
  it('asks the player and reads the captions', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });

      if (options.method === 'POST') {
        return new Response(JSON.stringify(PLAYER_ANSWER), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(
        '<timedtext format="3"><body><p t="0" d="1000">The words of the video</p></body></timedtext>',
        { status: 200, headers: { 'content-type': 'text/xml' } }
      );
    };

    const transcript = await fetchTranscript('dQw4w9WgXcQ', { fetchImpl });

    expect(transcript.language).toBe('en');
    expect(transcript.automatic).toBe(false);
    expect(transcript.lines[0].text).toBe('The words of the video');
    expect(calls[0].method).toBe('POST');
  });

  it('says so when the video has no captions', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ playabilityStatus: { status: 'OK' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });

    await expect(fetchTranscript('dQw4w9WgXcQ', { fetchImpl })).rejects.toThrow(/no captions/);
  });

  it('answers with the lines of the transcript', async () => {
    const fetchImpl = async (url, options = {}) => {
      if (options.method === 'POST') {
        return new Response(JSON.stringify(PLAYER_ANSWER), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('<timedtext><body><p t="0">Words</p></body></timedtext>', {
        status: 200
      });
    };

    const response = await handleTranscriptRequest(
      new Request('https://markau.pages.dev/api/youtube-transcript?id=dQw4w9WgXcQ'),
      { fetchImpl }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.lines[0].text).toBe('Words');
  });

  it('answers with the reason when there is nothing', async () => {
    const response = await handleTranscriptRequest(
      new Request('https://markau.pages.dev/api/youtube-transcript?id=bad')
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBeTruthy();
  });
});
