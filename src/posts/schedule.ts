/**
 * Content scheduler — the model behind the calendar. A customer creates an image
 * or video (Creative Studio + editor), then schedules it: pick platforms, a date
 * and time, a caption. At the due minute the scheduler publishes it through the
 * connector to each connected platform. Pure + testable here; the runner + publish
 * live in server.ts. Publishing degrades honestly: a platform that isn't connected
 * holds the post ("connect it to auto-publish") instead of pretending it posted.
 */

export interface Platform {
  id: string;
  label: string;
  /** Connector app slug used to publish (via Pipedream when live). */
  app: string;
  icon: string;
  /** Media this platform accepts. */
  accepts: Array<'image' | 'video'>;
}

export const PLATFORMS: Platform[] = [
  { id: 'facebook', label: 'Facebook', app: 'facebook_pages', icon: '📘', accepts: ['image', 'video'] },
  { id: 'instagram', label: 'Instagram', app: 'instagram_business', icon: '📸', accepts: ['image', 'video'] },
  { id: 'linkedin', label: 'LinkedIn', app: 'linkedin', icon: '💼', accepts: ['image', 'video'] },
  { id: 'twitter', label: 'X (Twitter)', app: 'twitter', icon: '𝕏', accepts: ['image', 'video'] },
  { id: 'google_business', label: 'Google Business', app: 'google_my_business', icon: '📍', accepts: ['image'] },
  { id: 'tiktok', label: 'TikTok', app: 'tiktok', icon: '🎵', accepts: ['video'] },
];

export type PostStatus = 'scheduled' | 'published' | 'partial' | 'held' | 'failed';

export interface PostResult {
  platform: string;
  ok: boolean;
  note: string;
}

export interface ScheduledPost {
  id: string;
  assetUrl: string;
  kind: 'image' | 'video';
  caption: string;
  platforms: string[];
  /** ISO timestamp for when to publish. */
  scheduledAt: string;
  status: PostStatus;
  results?: PostResult[];
  createdAt: string;
  publishedAt?: string;
}

export function platformById(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

/** True when a still-scheduled post's time has arrived. */
export function postDue(p: ScheduledPost, now: Date): boolean {
  if (p.status !== 'scheduled') return false;
  const t = Date.parse(p.scheduledAt);
  return Number.isFinite(t) && t <= now.getTime();
}

/** Roll up per-platform results into one status. */
export function rollupStatus(results: PostResult[]): PostStatus {
  if (!results.length) return 'failed';
  const ok = results.filter((r) => r.ok).length;
  if (ok === results.length) return 'published';
  if (ok > 0) return 'partial';
  // Nothing published: was it because nothing was connected (held), or real failures?
  return results.every((r) => r.note === 'not connected') ? 'held' : 'failed';
}

/** Validate + normalize a create request; returns the post or an error string. */
export function buildPost(input: Partial<ScheduledPost>, now: Date): { post?: ScheduledPost; error?: string } {
  const assetUrl = (input.assetUrl || '').trim();
  if (!assetUrl) return { error: 'Pick an image or video to schedule.' };
  const platforms = (input.platforms || []).filter((p) => !!platformById(p));
  if (!platforms.length) return { error: 'Choose at least one platform.' };
  const t = Date.parse(input.scheduledAt || '');
  if (!Number.isFinite(t)) return { error: 'Pick a valid date and time.' };
  const kind: 'image' | 'video' = input.kind === 'video' ? 'video' : 'image';
  // Drop platforms that don't accept this media type, but keep at least one.
  const okPlatforms = platforms.filter((p) => platformById(p)!.accepts.includes(kind));
  if (!okPlatforms.length) return { error: `None of the chosen platforms accept a ${kind}.` };
  return {
    post: {
      id: input.id || '',
      assetUrl,
      kind,
      caption: (input.caption || '').slice(0, 2200),
      platforms: okPlatforms,
      scheduledAt: new Date(t).toISOString(),
      status: 'scheduled',
      createdAt: now.toISOString(),
    },
  };
}

export function platformsLabel(ids: string[]): string {
  return ids.map((id) => platformById(id)?.label || id).join(', ');
}
