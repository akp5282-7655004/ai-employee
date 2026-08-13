/**
 * Templated.io — a library of professionally-designed, commercially-licensed
 * templates. Miles fills each template's named layers with the shop's brand
 * (colors, logo) and offer, and Templated returns a finished, on-brand image.
 *
 * This is the "good designs, minor modifications" path: the designs come from a
 * real template library (curated in the Templated dashboard), and Miles only
 * swaps in the brand + offer. Enabled by setting TEMPLATED_API_KEY; every call
 * degrades to null / empty so the UI stays honest when the key is absent.
 *
 * Template layer-name convention (name your layers this way in the Templated
 * dashboard and Miles auto-fills them): `offer`, `headline`, `company`, `phone`,
 * `cta` (text layers) and `logo` (image layer). Any layer Miles doesn't know is
 * left as the template designed it.
 */
const BASE = process.env.TEMPLATED_API_BASE || 'https://api.templated.io/v1';

export function templatedReady(): boolean {
  return !!process.env.TEMPLATED_API_KEY;
}

export interface TemplateSummary {
  id: string;
  name: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export interface RenderLayer {
  text?: string;
  color?: string;
  background?: string;
  image_url?: string;
}

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

/** List the account's templates (the design library the shop chose). */
export async function templatedListTemplates(): Promise<TemplateSummary[]> {
  const key = process.env.TEMPLATED_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`${BASE}/templates`, { headers: authHeaders(key) });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const rows: any[] = Array.isArray(data)
      ? (data as any[])
      : ((data as any)?.templates ?? (data as any)?.data ?? []);
    return rows
      .map((t) => ({
        id: String(t?.id ?? t?.template_id ?? t?.uuid ?? ''),
        name: String(t?.name ?? t?.title ?? 'Template'),
        thumbnail: t?.thumbnail ?? t?.thumbnail_url ?? t?.preview_url ?? t?.image_url,
        width: typeof t?.width === 'number' ? t.width : undefined,
        height: typeof t?.height === 'number' ? t.height : undefined,
      }))
      .filter((t) => t.id);
  } catch {
    return [];
  }
}

/**
 * Render one template with the given layer values. Templated renders
 * synchronously (~2s) and returns the image URL; if a job comes back pending we
 * poll a few times. Returns the finished image URL, or null on any failure.
 */
export async function templatedRender(
  templateId: string,
  layers: Record<string, RenderLayer>,
): Promise<string | null> {
  const key = process.env.TEMPLATED_API_KEY;
  if (!key || !templateId) return null;
  try {
    const res = await fetch(`${BASE}/render`, {
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify({ template: templateId, layers }),
    });
    if (!res.ok) return null;
    let data: any = await res.json();
    let url: unknown = data?.url ?? data?.render_url ?? data?.result?.url;
    const id = data?.id ?? data?.render_id;
    let tries = 0;
    while (!url && id && ['pending', 'processing', 'queued'].includes(String(data?.status)) && tries < 10) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(`${BASE}/render/${id}`, { headers: authHeaders(key) });
      if (poll.ok) {
        data = await poll.json();
        url = data?.url ?? data?.render_url ?? data?.result?.url;
      }
      tries += 1;
    }
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}
