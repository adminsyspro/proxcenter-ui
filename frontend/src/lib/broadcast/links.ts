// src/lib/broadcast/links.ts
//
// Zero imports, same convention as src/lib/broadcast/types.ts: nothing
// client-side should have to name a heavier module (e.g. schemas.ts, which
// pulls in zod and every other API schema) just to reach one pure function.

/**
 * Banner links are rendered as an anchor in every user's browser, so the
 * scheme must be pinned. `new URL()` happily accepts `javascript:` and
 * `data:`, and a leading `//` is protocol-relative — it looks like a path
 * but navigates off-site. Same reasoning as haRedirect.ts:18-24.
 */
export function isSafeBannerLink(value: string): boolean {
  if (!value) return false
  // Control characters (including newlines) can smuggle a second value past
  // naive consumers; reject them before any parsing.
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return false
  }
  if (value.includes('\\')) return false
  if (value.startsWith('//')) return false
  if (value.startsWith('/')) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
