// SSRF guard shared by every AI route that fetches a user-provided
// base URL (Ollama, custom OpenAI-compatible endpoint, etc.). The
// AI test + models routes both load this; future AI proxy routes
// MUST also call validateAIUrl before reaching fetch.

import dns from 'node:dns/promises'

// Cloud provider instance metadata endpoints. Reachable from any host
// in the VPC by IP without auth and historically used to exfiltrate
// IAM credentials via SSRF. AI routes are ADMIN_SETTINGS-gated so the
// realistic remaining threat is a compromised admin pivoting to cloud
// metadata; this set cuts that. Loopback and RFC1918 stay allowed
// because they cover the legitimate "Ollama running on the same host
// / same LAN" use.
//
// SonarCloud's typescript:S1313 (hardcoded IPs) is suppressed inline
// below: these IPs ARE the policy. They are vendor-published
// well-known constants, not configuration, and replacing them with
// env vars would defeat the purpose by making the SSRF allowlist
// user-controllable.
const BLOCKED_HOSTS: ReadonlySet<string> = new Set([
  '169.254.169.254',   // NOSONAR(typescript:S1313): AWS / Azure / GCP / OpenStack IMDS v1+v2 (link-local)
  '100.100.100.200',   // NOSONAR(typescript:S1313): Alibaba Cloud IMDS
  'fd00:ec2::254',     // NOSONAR(typescript:S1313): AWS IMDS over IPv6 (Unique Local Address)
  '192.0.0.192',       // NOSONAR(typescript:S1313): Oracle Cloud Infrastructure IMDS
])

/** Normalize a URL hostname for blocklist comparison: strip the IPv6
 *  brackets that Node's WHATWG URL keeps in `.hostname`, lowercase. */
function normaliseHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

/**
 * Validate and reconstruct a user-provided AI base URL (SSRF protection).
 *
 * Two-step host check:
 * 1. Literal in input: rejects `http://169.254.169.254/` directly.
 * 2. DNS resolution: rejects DNS aliases (e.g. `nip.io` style) that
 *    resolve to a blocked IP at fetch time. Without this an admin
 *    could submit `http://169.254.169.254.nip.io/` and reach the AWS
 *    IMDS endpoint despite step 1.
 *
 * A small TOCTOU window remains between the lookup and the eventual
 * fetch. Closing it cleanly would require a custom HTTP agent that
 * resolves DNS once and refuses redirects across hosts, which is far
 * beyond what these admin-only endpoints warrant. Documented here so
 * a future hardening pass knows where to pick up.
 *
 * Returns origin + pathname (trailing slashes stripped) so callers
 * can safely append a sub-path like `${base}/api/generate` without
 * producing `//api/...` which Ollama 301-redirects to a GET and
 * breaks POST endpoints.
 */
export async function validateAIUrl(input: string): Promise<string> {
  const parsed = new URL(input)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }

  // Step 1 — literal host. Catches `http://169.254.169.254/...` and
  // `http://[fd00:ec2::254]/...` even before any DNS round-trip.
  const literalHost = normaliseHost(parsed.hostname)
  if (BLOCKED_HOSTS.has(literalHost)) {
    throw new Error(`Host ${literalHost} is blocked (cloud metadata endpoint)`)
  }

  // Step 2 — DNS lookup of non-IP hostnames. dns.lookup returns every
  // address the OS resolver would hand to fetch; we reject if any of
  // them is on the blocklist. IPs already match step 1, so we only
  // pay the lookup cost when the user submitted a DNS name.
  if (!/^[\d.]+$|^\[/.test(parsed.hostname)) {
    try {
      const addrs = await dns.lookup(parsed.hostname, { all: true })
      for (const a of addrs) {
        if (BLOCKED_HOSTS.has(a.address.toLowerCase())) {
          throw new Error(`Host ${parsed.hostname} resolves to blocked address ${a.address}`)
        }
      }
    } catch (e) {
      // Re-throw the blocklist error; swallow only NXDOMAIN-style
      // lookup failures so the downstream fetch produces the real
      // network error message the operator expects.
      if ((e instanceof Error) && e.message.startsWith('Host ')) throw e
    }
  }

  let url = `${parsed.origin}${parsed.pathname}`
  while (url.endsWith('/')) url = url.slice(0, -1)
  return url
}
