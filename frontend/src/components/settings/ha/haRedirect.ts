// Post-deploy destination (design decision 3, FQDN preservation): a
// converted install keeps its external URL (reverse proxy / OIDC); only
// fresh IP-only installs land on the VIP. Flat return shape on purpose
// (tsconfig strict:false makes discriminated unions unreliable).
export interface CompletionTarget {
  url: string
  external: boolean
}

export function resolveCompletionTarget(
  externalUrl: string | undefined | null,
  vip: string,
): CompletionTarget {
  const vipUrl = `http://${vip}:3000`
  const trimmed = (externalUrl || '').trim()
  if (!trimmed) return { url: vipUrl, external: false }

  try {
    const parsed = new URL(trimmed)
    // The resolved URL is assigned to window.location once the conversion
    // completes, so only http(s) may pass: new URL() happily accepts
    // `javascript:` and `data:`, which would execute in the admin's browser.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: vipUrl, external: false }
    }
    // An "external" URL that already points at the VIP is the fresh-install
    // fallback the backend writes; keep the VIP copy and target.
    if (parsed.hostname === vip) return { url: vipUrl, external: false }
    return { url: trimmed, external: true }
  } catch {
    return { url: vipUrl, external: false }
  }
}
