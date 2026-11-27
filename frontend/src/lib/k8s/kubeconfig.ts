import { parse as parseYaml } from 'yaml'
import type { SanitizedCredential } from './types'

const MAX_BYTES = 512 * 1024

const FORBIDDEN_USER_KEYS = [
  'exec', 'auth-provider', 'tokenFile', 'client-key', 'client-certificate',
  'username', 'password', 'as', 'as-uid', 'as-groups', 'act-as',
]

function b64ToPem(data: unknown): string | undefined {
  if (typeof data !== 'string' || !data) return undefined
  try { return Buffer.from(data, 'base64').toString('utf8') } catch { return undefined }
}

export function listKubeconfigContexts(text: string): { ok: boolean; error?: string; value?: string[] } {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'empty' }
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { ok: false, error: 'too large' }
  let doc: any
  try { doc = parseYaml(text) } catch { return { ok: false, error: 'invalid yaml' } }
  const contexts = Array.isArray(doc?.contexts) ? doc.contexts : []
  const names = contexts.map((c: any) => c?.name).filter((n: any) => typeof n === 'string')
  if (names.length === 0) return { ok: false, error: 'no contexts' }
  return { ok: true, value: names }
}

export function sanitizeKubeconfig(
  text: string,
  contextName: string,
  opts: { allowInsecure?: boolean } = {},
): { ok: boolean; error?: string; rejections?: string[]; value?: SanitizedCredential } {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'empty' }
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { ok: false, error: 'too large' }
  let doc: any
  try { doc = parseYaml(text) } catch { return { ok: false, error: 'invalid yaml' } }

  const ctx = (doc?.contexts || []).find((c: any) => c?.name === contextName)
  if (!ctx) return { ok: false, error: 'unknown context' }
  const cluster = (doc?.clusters || []).find((c: any) => c?.name === ctx?.context?.cluster)?.cluster
  const user = (doc?.users || []).find((u: any) => u?.name === ctx?.context?.user)?.user
  if (!cluster || !user) return { ok: false, error: 'incomplete context' }

  const rejections: string[] = []

  // Cluster-side checks
  const server = cluster.server
  if (typeof server !== 'string' || !server.startsWith('https://')) rejections.push('server must be https')
  if (cluster['proxy-url']) rejections.push('proxy-url not allowed')
  if (cluster['certificate-authority']) rejections.push('CA file reference not allowed (use certificate-authority-data)')

  const insecure = cluster['insecure-skip-tls-verify'] === true
  if (insecure && !opts.allowInsecure) rejections.push('insecure-skip-tls-verify requires explicit opt-in')

  // User-side forbidden keys
  for (const k of FORBIDDEN_USER_KEYS) {
    if (user[k] !== undefined) rejections.push(`unsupported auth field: ${k}`)
  }

  // Reject any user-block key that is neither a known credential field nor an already-named forbidden key
  const ALLOWED_USER_KEYS = new Set(['token', 'client-certificate-data', 'client-key-data'])
  for (const k of Object.keys(user)) {
    if (!ALLOWED_USER_KEYS.has(k) && !FORBIDDEN_USER_KEYS.includes(k)) {
      rejections.push(`unknown auth field: ${k}`)
    }
  }

  // Determine credential type from the allowed fields only
  const token = typeof user.token === 'string' ? user.token : undefined
  const certData = b64ToPem(user['client-certificate-data'])
  const keyData = b64ToPem(user['client-key-data'])

  let credentialType: 'token' | 'client_cert' | undefined
  let credential: string | undefined
  if (token && !certData && !keyData) {
    credentialType = 'token'; credential = token
  } else if (certData && keyData && !token) {
    credentialType = 'client_cert'; credential = `${certData}\n${keyData}`
  } else if (!token && !certData && !keyData) {
    rejections.push('no supported credential (token or client cert) found')
  } else {
    rejections.push('ambiguous credential (provide exactly one of token or client cert)')
  }

  if (rejections.length > 0) return { ok: false, rejections }

  return {
    ok: true,
    value: {
      apiServerUrl: server,
      caDataPem: insecure ? undefined : b64ToPem(cluster['certificate-authority-data']),
      tlsServerName: typeof cluster['tls-server-name'] === 'string' ? cluster['tls-server-name'] : undefined,
      insecureSkipTlsVerify: insecure,
      credentialType: credentialType!,
      credential: credential!,
      contextName,
    },
  }
}
