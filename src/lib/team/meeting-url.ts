// ============================================================
// Meeting links on calendar events — pure, unit-testable, no I/O.
//
// The database CHECKs (101, 104) only admit http(s) URLs;
// this mirrors them so the form can explain the problem before the
// insert fails, and adds the convenience of accepting a pasted link
// without its scheme ("meet.google.com/abc-defg-hij").
// ============================================================

/**
 * Normalise what the user typed into a link that is safe to render
 * as an `href`, or null when it is not a web link. Anything with a
 * scheme other than http(s) — `javascript:`, `data:`, `mailto:` — is
 * rejected rather than "fixed".
 */
export function normalizeMeetingUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 2000) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname.includes('.')) return null;
  return url.toString();
}
