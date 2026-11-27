// AGENT INJECTION SEAM (Task 6):
//
// @kubernetes/client-node@1.4.0 builds a fresh https.Agent on every request via
// KubeConfig.createAgent(cluster, agentOptions), called inside
// applySecurityAuthentication. That method then does:
//   context.setAgent(this.createAgent(cluster, agentOptions))
// and IsomorphicFetchHttpLibrary.send() passes request.getAgent() straight to
// node-fetch as the `agent` option.
//
// We inject the guarded transport by monkey-patching createAgent on the
// KubeConfig instance immediately after construction. Our overridden createAgent
// ignores the vanilla agentOptions (TLS creds are already baked into the guarded
// agent via buildGuardedTransport) and returns the pre-built guarded agent every
// time. This means every request the API client makes goes through our agent,
// which carries both the SSRF-blocking lookup/createConnection hooks AND the
// cluster TLS options (ca/cert/key/rejectUnauthorized/servername).
//
// ENCODING: KubeConfig.bufferFromFileOrString decodes caData/certData/keyData as
// BASE64, so anything fed via loadFromOptions must be base64-encoded PEM, not raw
// PEM. We only use caData/certData/keyData for KubeConfig user/cluster objects;
// buildGuardedTransport receives raw PEM directly (no base64).
//
// CACHE: keyed "clusterId:credentialVersion", bounded to MAX_CACHE_SIZE entries,
// TTL of CACHE_TTL_MS. invalidateClusterClients(clusterId) removes every key
// whose prefix is "clusterId:".

import { KubeConfig, CoreV1Api } from '@kubernetes/client-node'
import { stringify as stringifyYaml } from 'yaml'
import { validateServerUrl, buildGuardedTransport, type GuardedTransportOptions } from './ssrf'
import type { SanitizedCredential } from '../types'

type ApiConstructor<T> = new (...args: any[]) => T

export function splitCertKeyPem(combined: string): { certPem: string; keyPem: string } {
  const blocks = combined.match(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g) ?? []
  const certPem = blocks.filter(b => /BEGIN CERTIFICATE/.test(b)).join('\n')
  const keyPem = blocks.filter(b => /BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY/.test(b)).join('\n')
  return { certPem, keyPem }
}

/**
 * buildKubeconfigYaml reconstructs a minimal, self-contained kubeconfig YAML
 * from a stored SanitizedCredential, so a cluster's admin credential can be
 * re-exported from the UI at any time. It is the inverse of sanitizeKubeconfig:
 * the orchestrator holds a provisioned run's kubeconfig in memory only (lost on
 * restart) and an imported cluster never left us a file to hand back, but the
 * registry always keeps the sanitized credential, which is all a working
 * kubeconfig needs. Emits exactly one cluster, one user and one context, with
 * current-context set. caData/certData/keyData are base64-encoded PEM, the
 * encoding kubectl and @kubernetes/client-node both expect (see buildKubeClient
 * and the ENCODING note above).
 */
export function buildKubeconfigYaml(cred: SanitizedCredential): string {
  const ctx = cred.contextName || 'proxcenter'
  const userName = `${ctx}-user`

  const clusterEntry: Record<string, unknown> = { server: cred.apiServerUrl }
  if (cred.insecureSkipTlsVerify) {
    clusterEntry['insecure-skip-tls-verify'] = true
  } else if (cred.caDataPem) {
    clusterEntry['certificate-authority-data'] = Buffer.from(cred.caDataPem, 'utf8').toString('base64')
  }
  if (cred.tlsServerName) clusterEntry['tls-server-name'] = cred.tlsServerName

  const userEntry: Record<string, unknown> = {}
  if (cred.credentialType === 'token') {
    userEntry.token = cred.credential
  } else {
    const { certPem, keyPem } = splitCertKeyPem(cred.credential)
    userEntry['client-certificate-data'] = Buffer.from(certPem, 'utf8').toString('base64')
    userEntry['client-key-data'] = Buffer.from(keyPem, 'utf8').toString('base64')
  }

  return stringifyYaml({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [{ name: ctx, cluster: clusterEntry }],
    users: [{ name: userName, user: userEntry }],
    contexts: [{ name: ctx, context: { cluster: ctx, user: userName } }],
    'current-context': ctx,
  }, { lineWidth: 0 }) // never fold the long base64 cert/key data onto multiple lines
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const MAX_CACHE_SIZE = 100
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  makeApiClient: <T>(apiClass: ApiConstructor<T>) => T
  api: CoreV1Api
  kc: KubeConfig
  expiresAt: number
}

const _cache = new Map<string, CacheEntry>()

function evictExpired(): void {
  const now = Date.now()
  for (const [k, v] of _cache) {
    if (v.expiresAt <= now) _cache.delete(k)
  }
}

function evictOldest(): void {
  // Map iteration order is insertion order; evict the oldest entry.
  const firstKey = _cache.keys().next().value
  if (firstKey !== undefined) _cache.delete(firstKey)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// hasAgentSeam: returns true when the KubeConfig instance exposes the private
// createAgent method that we override to inject the guarded transport. Exported
// so the unit test can simulate the seam being absent without constructing a
// full KubeConfig. Re-verify after any @kubernetes/client-node upgrade.
export function hasAgentSeam(kc: unknown): boolean {
  return typeof (kc as any).createAgent === 'function'
}

export interface BuildKubeClientInput {
  clusterId: string
  credentialVersion: number
  server: string
  cred: { type: 'client_cert' | 'token'; value: string }
  caData?: string     // raw PEM (not base64)
  serverName?: string
  insecure?: boolean
  skipCache?: boolean
}

export interface BuildKubeClientResult {
  ok: boolean
  error?: string
  makeApiClient?: <T>(apiClass: ApiConstructor<T>) => T
  /** @deprecated use makeApiClient(CoreV1Api) - kept for back-compat */
  api?: CoreV1Api
  /** The guarded KubeConfig instance (agent already injected). Pass to Metrics. */
  kc?: KubeConfig
}

export function buildKubeClient(
  input: BuildKubeClientInput,
): BuildKubeClientResult {
  // 1. Validate server URL (must be https).
  const urlCheck = validateServerUrl(input.server)
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error }

  // 2. Cache lookup (skipped for ephemeral one-off clients like pre-save validation).
  const cacheKey = `${input.clusterId}:${input.credentialVersion}`
  if (!input.skipCache) {
    // Invariant: callers MUST bump credentialVersion whenever any connection field
    // (server, caData, serverName, insecure, or the credential) changes, or a
    // stale client will be served until TTL expires.
    evictExpired()
    const cached = _cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, makeApiClient: cached.makeApiClient, api: cached.api, kc: cached.kc }
    }
  }

  // 3. Build guarded transport (raw PEM, not base64).
  let certPem: string | undefined
  let keyPem: string | undefined
  if (input.cred.type === 'client_cert') {
    const split = splitCertKeyPem(input.cred.value)
    certPem = split.certPem
    keyPem = split.keyPem
  }

  const transportOpts: GuardedTransportOptions = {
    ...(input as any),   // pass through test-only flags (e.g. allowLoopbackForTest)
    caData: input.caData,
    certData: certPem,
    keyData: keyPem,
    serverName: input.serverName,
    insecure: input.insecure,
  }
  const { agent } = buildGuardedTransport(transportOpts)

  // 4. Build KubeConfig with in-memory credentials.
  //    caData/certData/keyData inside KubeConfig objects must be BASE64-encoded
  //    PEM (the library's bufferFromFileOrString decodes them as base64).
  const clusterObj: { name: string; server: string; skipTLSVerify?: boolean; caData?: string; tlsServerName?: string } = {
    name: 'proxcenter',
    server: input.server,
  }
  if (input.insecure) clusterObj.skipTLSVerify = true
  if (input.caData) clusterObj.caData = Buffer.from(input.caData).toString('base64')
  if (input.serverName) clusterObj.tlsServerName = input.serverName

  const userObj: { name: string; token?: string; certData?: string; keyData?: string } = {
    name: 'proxcenter-user',
  }
  if (input.cred.type === 'token') {
    userObj.token = input.cred.value
  } else if (certPem && keyPem) {
    userObj.certData = Buffer.from(certPem).toString('base64')
    userObj.keyData = Buffer.from(keyPem).toString('base64')
  }

  const kc = new KubeConfig()
  kc.loadFromOptions({
    clusters: [{ name: 'proxcenter', caData: clusterObj.caData, skipTLSVerify: clusterObj.skipTLSVerify, server: clusterObj.server, tlsServerName: clusterObj.tlsServerName }],
    users: [userObj],
    contexts: [{ name: 'proxcenter-ctx', cluster: 'proxcenter', user: 'proxcenter-user' }],
    currentContext: 'proxcenter-ctx',
  })

  // 5. Inject guarded agent: override createAgent so it always returns our
  //    pre-built guarded agent rather than a new vanilla https.Agent.
  //    This is the single seam where the agent flows into RequestContext via
  //    applySecurityAuthentication -> context.setAgent(this.createAgent(...)).
  //    Fail CLOSED if the seam is absent (e.g. after a library upgrade that
  //    renames or removes the private method). Without this check the assignment
  //    would be a no-op and the library would fall back to a vanilla https.Agent
  //    with no SSRF hooks, silently bypassing the guard.
  if (!hasAgentSeam(kc)) {
    return { ok: false, error: 'k8s client transport seam unavailable' }
  }
  ;(kc as any).createAgent = () => agent

  // 6. Build a factory so any API class shares the guarded KubeConfig.
  const makeApiClient = <T>(apiClass: ApiConstructor<T>): T =>
    kc.makeApiClient(apiClass as unknown as Parameters<typeof kc.makeApiClient>[0]) as T
  const api = makeApiClient(CoreV1Api)

  // 7. Store in cache (bounded). Skip when caller requested a one-off client.
  if (!input.skipCache) {
    if (_cache.size >= MAX_CACHE_SIZE) evictOldest()
    _cache.set(cacheKey, { makeApiClient, api, kc, expiresAt: Date.now() + CACHE_TTL_MS })
  }

  return { ok: true, makeApiClient, api, kc }
}

export function invalidateClusterClients(clusterId: string): void {
  const prefix = `${clusterId}:`
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) _cache.delete(k)
  }
}
