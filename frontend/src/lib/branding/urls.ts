const UPLOAD_PATH = '/api/v1/settings/branding/uploads/'

/**
 * Drop the reader-specific qualifiers before an upload URL is persisted. The
 * form sends back the URLs the GET qualified for that reader; the row stores
 * the bare upload path and the owner is derived again on every read.
 */
export function unscopedBrandingUrl(url: string): string {
  if (!url) return url
  const normalized = url.replace(/^\/uploads\/branding\//, UPLOAD_PATH)
  if (!normalized.startsWith(UPLOAD_PATH)) return normalized

  const parsed = new URL(normalized, 'http://localhost')
  parsed.searchParams.delete('tenant')
  parsed.searchParams.delete('scope')
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

/** Scope only local uploaded assets; external branding URLs remain untouched. */
export function scopedBrandingUrl(url: string, ownerTenantId: string, sessionTenantId: string): string {
  if (!url) return url
  const normalized = url.replace(/^\/uploads\/branding\//, UPLOAD_PATH)
  if (!normalized.startsWith(UPLOAD_PATH)) return normalized

  const parsed = new URL(normalized, 'http://localhost')

  // The serving route validates this owner against the current session and
  // inherited settings. The separate scope forces existing img/favicon nodes
  // to reload after a tenant switch, even if the filename did not change.
  parsed.searchParams.set('tenant', ownerTenantId)
  parsed.searchParams.set('scope', sessionTenantId)
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
