// src/lib/tls/urlCoherence.ts
//
// Turning TLS on while APP_URL or NEXTAUTH_URL still say http:// breaks auth
// redirects and drops `secure` cookies, and the symptom (a login loop) points
// nowhere near the cause. The TLS tab refuses to enable until both agree.

export interface UrlCoherenceResult {
  ok: boolean
  issues: string[]
}

function inspect(name: string, value: string | undefined, issues: string[]) {
  if (!value) {
    issues.push(`${name} is not set`)

    return
  }

  try {
    if (new URL(value).protocol !== 'https:') issues.push(`${name} is still http://`)
  } catch {
    issues.push(`${name} is not a valid URL`)
  }
}

export function checkPublicUrlCoherence(env: NodeJS.ProcessEnv = process.env): UrlCoherenceResult {
  const issues: string[] = []

  inspect('APP_URL', env.APP_URL, issues)
  inspect('NEXTAUTH_URL', env.NEXTAUTH_URL, issues)

  return { ok: issues.length === 0, issues }
}
