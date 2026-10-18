// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import type { AllowlistEntry } from "./types"

/**
 * Structural pre-match rejections (spec section 8): empty segment (double
 * slash), '.' or '..' segments, trailing slash on a non-root path.
 */
function hasStructuralRejection(pathname: string): boolean {
  if (pathname !== "/" && pathname.endsWith("/")) return true
  const segments = pathname.split("/").slice(1)
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return true
  }
  return false
}

function hasEncodedSlash(value: string): boolean {
  const lower = value.toLowerCase()
  return lower.includes("%2f") || lower.includes("%5c")
}

/**
 * Pre-match rejections: the structural ones plus an encoded slash or
 * backslash anywhere. Only an entry declaring encodedSlashSegment lifts the
 * latter, for that one segment (see matchPattern). Rejection = no match = the
 * existing proxy cookie 401, nothing is disclosed.
 */
export function isRejectedPath(pathname: string): boolean {
  return hasEncodedSlash(pathname) || hasStructuralRejection(pathname)
}

/** Decoded value of the encodedSlashSegment: no backslash, no empty/'.'/'..' sub-segment. */
function isSafeEncodedSlashValue(raw: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return false
  }
  if (decoded.includes("\\")) return false
  return !decoded.split("/").some(part => part === "" || part === "." || part === "..")
}

function matchPattern(entry: AllowlistEntry, pathname: string): Record<string, string> | null {
  if (hasStructuralRejection(pathname)) return null
  const patternSegments = entry.pattern.split("/").slice(1)
  const pathSegments = pathname.split("/").slice(1)
  if (patternSegments.length !== pathSegments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i]
    const value = pathSegments[i]
    const isDynamic = p.startsWith("{") && p.endsWith("}")
    const name = isDynamic ? p.slice(1, -1) : null
    if (hasEncodedSlash(value)) {
      if (name === null || name !== entry.encodedSlashSegment || !isSafeEncodedSlashValue(value)) return null
    }
    if (name !== null) {
      const allowed = entry.segmentEnum?.[name]
      if (allowed && !allowed.includes(value)) return null
      // An escaped spelling (%72uns) is refused, never decoded and compared.
      const excluded = entry.segmentExclude?.[name]
      if (excluded && (value.includes("%") || excluded.includes(value))) return null
      params[name] = value
    } else if (p !== value) {
      return null
    }
  }
  return params
}

export type AllowlistMatch = { ok: boolean; entryId?: string; params?: Record<string, string> }

/** HEAD is served by the GET entry. */
function effectiveMethod(method: string): string {
  return method === "HEAD" ? "GET" : method
}

/** Matcher core, exported for tests that inject synthetic entries. */
export function _matchAgainst(entries: AllowlistEntry[], pathname: string, method: string): AllowlistMatch {
  const wanted = effectiveMethod(method)
  for (const entry of entries) {
    if (entry.method !== wanted) continue
    const params = matchPattern(entry, pathname)
    if (params !== null) return { ok: true, entryId: entry.id, params }
  }
  return { ok: false }
}

/** Re-verification against ONE designated entry (getPrincipal step 10): never a free re-match. */
export function matchEntryParams(entry: AllowlistEntry, pathname: string): Record<string, string> | null {
  return matchPattern(entry, pathname)
}

export function matchesEntry(entry: AllowlistEntry, pathname: string, method: string): boolean {
  return entry.method === effectiveMethod(method) && matchPattern(entry, pathname) !== null
}

export function isWriteEntry(entry: AllowlistEntry): boolean {
  return entry.method !== "GET"
}
