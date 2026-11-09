/** Map a profile industry onto a home-services pack category. Unknown trades stay unset. */
export function categoryForIndustry(industry: string | undefined): string {
  const t = (industry || '').toLowerCase();
  if (t.includes('paint')) return 'painting';
  if (t.includes('plumb')) return 'plumbing';
  if (t.includes('hvac') || t.includes('air condition')) return 'hvac';
  if (t.includes('electric')) return 'electrical';
  if (t.includes('roof')) return 'roofing';
  if (t.includes('landscap') || t.includes('lawn')) return 'landscaping';
  return '';
}
