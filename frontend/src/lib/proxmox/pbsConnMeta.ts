import { prisma } from '@/lib/db/prisma'
import { decryptSecret } from '@/lib/crypto/secret'

/** Default PBS API port, the one PVE assumes when a `pbs:` storage omits it. */
export const PBS_DEFAULT_PORT = 8007

export interface PbsMeta {
  conn: { baseUrl: string; apiToken: string; insecureDev: boolean }
  /** Bare host, no scheme and no port — what PVE stores in `server`. */
  host: string
  /** Port read from the connection URL, so a PBS off 8007 still resolves. */
  port: number
  fingerprint: string
  /** `user@realm` owning the stored root token, the parent of any sub-token. */
  rootUser: string
}

export function parsePbsUser(apiToken: string): string {
  const m = apiToken.match(/^([^!]+)!/)
  if (!m) throw new Error('Unexpected PBS root token format; expected user@realm!tokenid:secret')

  return m[1]
}

/**
 * Splits `https://pbs.example.com:8007/` into its host and its port.
 *
 * Sliced rather than matched: an `/^(.*):(\d+)$/` style pattern backtracks
 * polynomially on a long run of colons or digits (CodeQL js/polynomial-redos).
 */
export function pbsHostPort(baseUrl: string): { host: string; port: number } {
  const withoutScheme = baseUrl.replace(/^https?:\/\//, '')
  const slash = withoutScheme.indexOf('/')
  const authority = slash < 0 ? withoutScheme : withoutScheme.slice(0, slash)
  const colon = authority.lastIndexOf(':')
  const portText = colon < 0 ? '' : authority.slice(colon + 1)

  if (!portText || !/^\d{1,5}$/.test(portText)) return { host: authority, port: PBS_DEFAULT_PORT }

  return { host: authority.slice(0, colon), port: Number(portText) }
}

/**
 * Reads a PBS connection row and returns everything the PVE side needs to
 * mount it as a `pbs:` storage: an API client, the bare host/port, the
 * certificate fingerprint and the owner of the stored token.
 *
 * The fingerprint is mandatory: PVE refuses a `pbs:` storage whose
 * certificate it cannot pin, and the failure surfaces as an opaque probe
 * error rather than as a missing field.
 */
export async function resolvePbsMeta(pbsConnectionId: string): Promise<PbsMeta> {
  const row = await prisma.connection.findUnique({
    where: { id: pbsConnectionId },
    select: { baseUrl: true, fingerprint: true, apiTokenEnc: true, insecureTLS: true, type: true },
  })

  if (!row || row.type !== 'pbs') throw new Error(`PBS connection not found: ${pbsConnectionId}`)
  if (!row.fingerprint) throw new Error('PBS fingerprint missing — capture it on the connection first')

  const apiToken = decryptSecret(row.apiTokenEnc)
  const { host, port } = pbsHostPort(row.baseUrl)

  return {
    conn: { baseUrl: row.baseUrl, apiToken, insecureDev: !!row.insecureTLS },
    host,
    port,
    fingerprint: row.fingerprint,
    rootUser: parsePbsUser(apiToken),
  }
}
