// The post-sign-in destination read from `?callbackUrl=`.
//
// Only a path inside this application is accepted: it must start with a single
// "/" and must not start with "//" or "/\" (both read as a scheme-relative
// URL by browsers). Anything else, including an absolute URL, a missing value
// or a non-string, falls back to "/".
//
// Zero imports on purpose: Login.jsx (client) and proxy.ts both use it.

const DEFAULT_CALLBACK = "/"

export function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_CALLBACK
  const value = raw.trim()
  if (value.length === 0 || value.length > 2048) return DEFAULT_CALLBACK
  if (!value.startsWith("/")) return DEFAULT_CALLBACK
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_CALLBACK
  // Control characters and whitespace have no place in a path.
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return DEFAULT_CALLBACK
  return value
}
