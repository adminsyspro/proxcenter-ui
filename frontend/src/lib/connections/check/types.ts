// src/lib/connections/check/types.ts
//
// Shapes shared by the "Check connection" probes, their runner, the route and
// the dialog. The route answers `{ items: CheckItem[] }`; the dialog turns each
// `hint` code into a sentence from `settings.connectionCheck.hints` with
// `params` interpolated, so nothing here is user-facing text.

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip'

export type CheckProbe = 'api' | 'tls' | 'privileges' | 'version' | 'clock' | 'quorum' | 'ssh'

export const CHECK_PROBE_ORDER: CheckProbe[] = ['api', 'tls', 'privileges', 'version', 'clock', 'quorum', 'ssh']

/** Values the dialog interpolates; `features` style lists carry feature ids. */
export type CheckParams = Record<string, string | number | string[]>

export interface CheckItem {
  /** Unique within one run: `<probe>` or `<probe>.<target>`. */
  id: string
  probe: CheckProbe
  status: CheckStatus
  /** Code under `settings.connectionCheck.hints`. */
  hint: string
  params: CheckParams
}

/** One host that ProxCenter may fail over to (ManagedHost row with an ip). */
export interface FallbackHost {
  node: string
  ip: string
}

/** Per-node SSH override as stored on ManagedHost. */
export interface SshNodeOverride {
  node: string
  sshAddress: string | null
  sshPort: number | null
}

export interface SshSettings {
  enabled: boolean
  user: string
  port: number
  key?: string
  password?: string
  passphrase?: string
  overrides: SshNodeOverride[]
}

/**
 * Everything the probes need, resolved by the route from the connection row.
 * No Prisma access happens below this boundary, which keeps the probes unit
 * testable with plain objects.
 */
export interface CheckContext {
  connectionId: string
  /** The client options the rest of the app uses (`pveFetch`). */
  conn: { id: string; baseUrl: string; apiToken: string; insecureDev: boolean; behindProxy: boolean }
  fallbackHosts: FallbackHost[]
  /** SHA256 fingerprint pinned on the connection (`AA:BB:...`), if any. */
  pinnedFingerprint: string | null
  ssh: SshSettings
}

export interface PveNode {
  node: string
  status?: string
}

export interface CertificateInfo {
  validFrom: string
  validTo: string
  /** SHA256 of the DER certificate, `AA:BB:...` uppercase. */
  fingerprint: string
  /** Whether Node's trust store accepted the chain. */
  authorized: boolean
  authorizationError?: string
}

export interface DirectGetResult {
  statusCode: number
  data: unknown
}

export interface SshExecResult {
  success: boolean
  output?: string
  error?: string
}

/**
 * Transport seams. Production wires undici, tls, pveFetch and ssh2 (see
 * transport.ts); tests pass fakes.
 */
export interface CheckDeps {
  /** GET on one explicit base URL, never through the failover logic. */
  directGet: (baseUrl: string, path: string, timeoutMs: number) => Promise<DirectGetResult>
  /** GET through the regular client (failover included), returns `data`. */
  pveGet: <T>(path: string, timeoutMs?: number) => Promise<T>
  readCertificate: (baseUrl: string, timeoutMs: number) => Promise<CertificateInfo>
  resolveSshEndpoint: (node: string) => Promise<{ host: string; port: number }>
  sshExec: (opts: { host: string; port: number; command: string; timeoutMs: number }) => Promise<SshExecResult>
  now: () => number
}
