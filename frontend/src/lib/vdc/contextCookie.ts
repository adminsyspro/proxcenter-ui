// src/lib/vdc/contextCookie.ts
// Isomorphic bits of the vDC context: the cookie name and the client-side
// read/write helpers. The server-side validation lives in ./context.ts
// (which imports next/headers and must NOT be pulled into client bundles).

export const VDC_CONTEXT_COOKIE = 'pc_vdc_context'

/** Client-side read. Returns the raw vdcId or null (unset / not a browser). */
export function readVdcContextCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${VDC_CONTEXT_COOKIE}=([^;]+)`)
  )
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Client-side write. `null` clears the cookie (= "All vDCs"). Callers decide
 * whether to reload — the header switcher does, the /my-vdc cards don't.
 */
export function setVdcContextCookie(vdcId: string | null): void {
  if (typeof document === 'undefined') return
  if (vdcId) {
    document.cookie = `${VDC_CONTEXT_COOKIE}=${encodeURIComponent(vdcId)}; path=/; max-age=31536000; SameSite=Lax`
  } else {
    document.cookie = `${VDC_CONTEXT_COOKIE}=; path=/; max-age=0`
  }
}
