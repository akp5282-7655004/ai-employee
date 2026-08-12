import { describe, expect, it } from 'vitest';
import { PLATFORMS, platformById, postDue, rollupStatus, buildPost, platformsLabel, type ScheduledPost } from '../src/posts/schedule.js';

const base = (o: Partial<ScheduledPost> = {}): ScheduledPost => ({
  id: 'p1', assetUrl: 'https://x/i.png', kind: 'image', caption: 'hi', platforms: ['facebook'],
  scheduledAt: '2026-08-12T10:00:00Z', status: 'scheduled', createdAt: '', ...o,
});

describe('platform catalog', () => {
  it('maps ids and constrains media types (TikTok is video-only, GBP image-only)', () => {
    expect(platformById('tiktok')!.accepts).toEqual(['video']);
    expect(platformById('google_business')!.accepts).toEqual(['image']);
    expect(platformById('nope')).toBeUndefined();
    expect(PLATFORMS.length).toBeGreaterThanOrEqual(5);
  });
});

describe('postDue', () => {
  it('fires only a still-scheduled post whose time has passed', () => {
    const now = new Date('2026-08-12T10:01:00Z');
    expect(postDue(base(), now)).toBe(true);
    expect(postDue(base({ scheduledAt: '2026-08-12T10:05:00Z' }), now)).toBe(false); // future
    expect(postDue(base({ status: 'published' }), now)).toBe(false); // already done
  });
});

describe('rollupStatus', () => {
  it('distinguishes published / partial / held / failed', () => {
    expect(rollupStatus([{ platform: 'facebook', ok: true, note: 'posted' }])).toBe('published');
    expect(rollupStatus([{ platform: 'facebook', ok: true, note: 'posted' }, { platform: 'x', ok: false, note: 'err' }])).toBe('partial');
    expect(rollupStatus([{ platform: 'facebook', ok: false, note: 'not connected' }])).toBe('held');
    expect(rollupStatus([{ platform: 'facebook', ok: false, note: 'boom' }])).toBe('failed');
  });
});

describe('buildPost validation', () => {
  const now = new Date('2026-08-12T09:00:00Z');
  it('rejects missing asset, platforms, or a bad date', () => {
    expect(buildPost({ platforms: ['facebook'], scheduledAt: '2026-08-12T10:00:00Z' }, now).error).toMatch(/image or video/i);
    expect(buildPost({ assetUrl: 'x', scheduledAt: '2026-08-12T10:00:00Z' }, now).error).toMatch(/platform/i);
    expect(buildPost({ assetUrl: 'x', platforms: ['facebook'], scheduledAt: 'nope' }, now).error).toMatch(/date/i);
  });
  it('drops platforms that reject the media type (video → GBP is dropped)', () => {
    const r = buildPost({ assetUrl: 'v.mp4', kind: 'video', platforms: ['google_business', 'facebook'], scheduledAt: '2026-08-12T10:00:00Z' }, now);
    expect(r.post!.platforms).toEqual(['facebook']);
  });
  it('errors when no chosen platform accepts the media', () => {
    expect(buildPost({ assetUrl: 'v.mp4', kind: 'video', platforms: ['google_business'], scheduledAt: '2026-08-12T10:00:00Z' }, now).error).toMatch(/accept a video/i);
  });
  it('normalizes a valid post to scheduled', () => {
    const r = buildPost({ assetUrl: 'i.png', platforms: ['facebook', 'instagram'], scheduledAt: '2026-08-12T10:00:00Z', caption: 'hey' }, now);
    expect(r.post!.status).toBe('scheduled');
    expect(platformsLabel(r.post!.platforms)).toBe('Facebook, Instagram');
  });
});
