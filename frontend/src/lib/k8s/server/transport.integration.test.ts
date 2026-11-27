/**
 * HARD GATE (Task 1): prove that the guarded transport we hand to
 * @kubernetes/client-node enforces BOTH on the real network dial:
 *   1. an SSRF IP guard (blocked IP -> dial refused, fail closed), and
 *   2. cluster TLS (custom CA, servername, rejectUnauthorized true by default).
 *
 * @kubernetes/client-node@1.4.0 is node-fetch v2 based, so buildGuardedTransport
 * returns { agent } (a Node https.Agent). node-fetch honors the `agent` request
 * option, so passing the SAME agent into a raw fetch here exercises the exact
 * transport the client will use. (If the backend were undici/native fetch we would
 * assert via t.dispatcher instead; see the note at the top of ssrf.ts.)
 *
 * This test does NOT touch Postgres, but it lives in the `node` vitest project
 * whose globalSetup needs POSTGRES_TEST_URL_BASE; run the suite with that set.
 */
import { describe, it, expect, afterAll } from 'vitest'
import * as https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import nodeFetch from 'node-fetch'
import { buildGuardedTransport, type GuardedTransportOptions } from './ssrf'

// TEST-ONLY widened type: adds allowLoopbackForTest so test fixtures can bypass
// the SSRF guard on loopback. This field is intentionally absent from the
// production GuardedTransportOptions to prevent prod callers from setting it.
type TestTransportOptions = GuardedTransportOptions & { allowLoopbackForTest?: boolean }

// node-fetch v2 is what the k8s client uses; exercise the agent through it so
// the assertion mirrors the client's real request path, not native fetch.
const fetchVia = (url: string, agent: unknown) =>
  nodeFetch(url, { agent } as any)

// Generate a throwaway self-signed CA/cert (real PEM) with an IP:127.0.0.1 SAN
// so TLS verification can succeed when we dial the loopback fixture server.
function makeSelfSignedPem(): { caPem: string; certPem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'k8s-tls-'))
  const keyFile = path.join(dir, 'tls.key')
  const certFile = path.join(dir, 'tls.crt')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', '/CN=k8s-transport-test',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' })
  const certPem = readFileSync(certFile, 'utf8')
  const keyPem = readFileSync(keyFile, 'utf8')
  // Self-signed: the cert IS its own CA.
  return { caPem: certPem, certPem, keyPem, dir }
}

describe('guarded transport (real dial)', () => {
  const cleanups: Array<() => void> = []
  afterAll(() => cleanups.forEach((c) => c()))

  it('refuses to dial a host that resolves to a blocked IP (fail closed)', async () => {
    // Stand up a real HTTPS server on loopback so that, absent the guard, the
    // dial WOULD succeed. The guard must reject it because 127.0.0.1 is blocked.
    const { keyPem, certPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const server = https.createServer({ key: keyPem, cert: certPem }, (_req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    // Sanity: the server is genuinely reachable, so WITHOUT the guard this dial
    // would succeed. That makes the rejection below attributable to the guard,
    // not to an unreachable host.
    const ungated = await fetchVia(`https://127.0.0.1:${port}/version`, new https.Agent({ rejectUnauthorized: false }))
    expect(ungated.status).toBe(200)

    // insecure:true isolates the SSRF check from TLS: if the request still fails,
    // it is the IP guard refusing the dial, not a TLS error. Assert on the guard
    // message so we know it failed closed for the RIGHT reason (and via the
    // literal-IP createConnection path, since node skips lookup for IP hosts).
    const t = buildGuardedTransport({ insecure: true })
    await expect(
      fetchVia(`https://127.0.0.1:${port}/version`, t.dispatcher ?? t.agent),
    ).rejects.toThrow(/SSRF guard.*blocked IP 127\.0\.0\.1/)
  })

  it('refuses a HOSTNAME that resolves to a blocked IP (lookup-path guard)', async () => {
    // localhost resolves to a loopback address via the local resolver (no
    // external DNS needed). This exercises the `lookup` chokepoint, which fires
    // for hostnames (vs the createConnection path that fires for literal IPs).
    const { keyPem, certPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const server = https.createServer({ key: keyPem, cert: certPem }, (_req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const t = buildGuardedTransport({ insecure: true })
    await expect(
      fetchVia(`https://localhost:${port}/version`, t.dispatcher ?? t.agent),
    ).rejects.toThrow(/SSRF guard.*blocked IP/)
  })

  it('dials and TLS-verifies a permitted IP with a custom CA', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const server = https.createServer({ key: keyPem, cert: certPem }, (_req, res) => {
      res.writeHead(200)
      res.end('verified')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port
    const url = `https://127.0.0.1:${port}/version`

    // 127.0.0.1 is normally blocked; allowLoopbackForTest is a TEST-ONLY override
    // that bypasses the IP guard for the fixture host WITHOUT weakening the
    // production policy. It proves the TLS path, not the policy.

    // (a) Correct CA -> TLS verifies -> 200.
    const good = buildGuardedTransport({ caData: caPem, allowLoopbackForTest: true } as TestTransportOptions)
    const res = await fetchVia(url, good.dispatcher ?? good.agent)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('verified')

    // (b) Wrong CA (a different self-signed cert) -> TLS verification fails.
    const { caPem: wrongCa, dir: wrongDir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(wrongDir, { recursive: true, force: true }))
    const bad = buildGuardedTransport({ caData: wrongCa, allowLoopbackForTest: true } as TestTransportOptions)
    await expect(fetchVia(url, bad.dispatcher ?? bad.agent)).rejects.toThrow()

    // (c) No CA at all -> default trust store does not know our self-signed cert
    //     -> rejectUnauthorized is effectively true by default -> rejected.
    const none = buildGuardedTransport({ allowLoopbackForTest: true } as TestTransportOptions)
    await expect(fetchVia(url, none.dispatcher ?? none.agent)).rejects.toThrow()
  })
})
