// src/lib/tls/acmeClient.ts
//
// A minimal ACME client (RFC 8555): account with optional external account
// binding, order, HTTP-01 and DNS-01 authorizations, finalization and
// download. Nothing else: no revocation, no key change, no account update.
//
// Requests are signed ES256 with node:crypto and sent with fetch, through the
// outbound proxy of the environment when one is set (HTTPS_PROXY, NO_PROXY).

import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'

import type { Dispatcher } from 'undici'

import { oidcFetchDispatcher } from '@/lib/auth/oidcProxy'

/**
 * Bounds ONE HTTP round trip, which is all an ACME request ever is: a socket
 * that opens and then goes quiet would otherwise hang until the OS gives up,
 * far past the renewal lease. Waiting for the CA to validate is a series of
 * short polls (ACME_POLL_TIMEOUT_MS), never one long request.
 */
export const ACME_REQUEST_TIMEOUT_MS = 60_000

/** How long an authorization or an order may stay pending before giving up. */
export const ACME_POLL_TIMEOUT_MS = 5 * 60_000

const POLL_FIRST_MS = 1_000
const POLL_MAX_MS = 10_000
const RETRY_AFTER_MAX_MS = 30_000

export class AcmeError extends Error {
  constructor(
    message: string,
    readonly type?: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AcmeError'
  }
}

interface Directory {
  newNonce: string
  newAccount: string
  newOrder: string
  meta?: { externalAccountRequired?: boolean }
}

export interface AcmeChallenge {
  type: string
  url: string
  token: string
  status: string
  error?: { type?: string; detail?: string }
}

export interface AcmeAuthorization {
  status: string
  identifier: { type: string; value: string }
  wildcard?: boolean
  challenges: AcmeChallenge[]
}

export interface AcmeOrder {
  status: string
  authorizations: string[]
  finalize: string
  certificate?: string
  error?: { type?: string; detail?: string }
}

interface Jwk {
  crv: string
  kty: string
  x: string
  y: string
}

export interface AcmeClientOptions {
  directoryUrl: string
  /** EC P-256 private key, PEM (PKCS#8 or SEC1). */
  accountKeyPem: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const b64u = (data: Buffer | string) => Buffer.from(data).toString('base64url')

/** A fresh EC P-256 account key, PKCS#8 PEM. */
export function generateAccountKeyPem(): string {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

function jwkOf(key: KeyObject): Jwk {
  const { crv, kty, x, y } = createPublicKey(key).export({ format: 'jwk' }) as Jwk

  if (kty !== 'EC' || crv !== 'P-256') throw new AcmeError('the ACME account key must be EC P-256')

  return { crv, kty, x, y }
}

/** RFC 7638: the members in lexicographic order, no whitespace. */
export function jwkThumbprint(jwk: Jwk): string {
  return b64u(createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest())
}

/** The TXT value of a DNS-01 challenge (RFC 8555 §8.4). */
export function dns01Value(keyAuthorization: string): string {
  return b64u(createHash('sha256').update(keyAuthorization).digest())
}

function problemMessage(body: any, fallback: string): string {
  const detail = typeof body?.detail === 'string' ? body.detail : ''
  const sub = Array.isArray(body?.subproblems)
    ? body.subproblems.map((p: any) => p?.detail).filter(Boolean).join('; ')
    : ''

  return [detail || fallback, sub].filter(Boolean).join(': ')
}

export class AcmeClient {
  private readonly key: KeyObject
  private readonly jwk: Jwk
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private directory: Directory | null = null
  private nonce: string | null = null
  private kid: string | null = null

  constructor(private readonly options: AcmeClientOptions) {
    this.key = createPrivateKey(options.accountKeyPem)
    this.jwk = jwkOf(this.key)
    this.fetchImpl = options.fetch ?? fetch
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  get accountUrl(): string | null {
    return this.kid
  }

  keyAuthorization(token: string): string {
    return `${token}.${jwkThumbprint(this.jwk)}`
  }

  private async http(url: string, init: RequestInit): Promise<Response> {
    const dispatcher: Dispatcher | undefined = this.options.fetch ? undefined : oidcFetchDispatcher(null, url)

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(ACME_REQUEST_TIMEOUT_MS),
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit)
    } catch (err: any) {
      const reason = err?.name === 'TimeoutError' ? `no answer within ${ACME_REQUEST_TIMEOUT_MS / 1000} s` : err?.cause?.message || err?.message || String(err)

      throw new AcmeError(`${new URL(url).host} unreachable (${reason})`)
    }
  }

  private async getDirectory(): Promise<Directory> {
    if (this.directory) return this.directory

    const res = await this.http(this.options.directoryUrl, { method: 'GET' })

    if (!res.ok) throw new AcmeError(`the ACME directory answered HTTP ${res.status}`, undefined, res.status)

    const body = (await res.json().catch(() => null)) as Directory | null

    if (!body?.newNonce || !body.newAccount || !body.newOrder) throw new AcmeError('the URL does not point at an ACME directory')
    this.directory = body

    return body
  }

  private async freshNonce(): Promise<string> {
    if (this.nonce) {
      const nonce = this.nonce

      this.nonce = null

      return nonce
    }

    const res = await this.http((await this.getDirectory()).newNonce, { method: 'HEAD' })
    const nonce = res.headers.get('replay-nonce')

    if (!nonce) throw new AcmeError('the CA returned no nonce')

    return nonce
  }

  private jws(url: string, payload: unknown, nonce: string, header: Record<string, unknown>): string {
    const protectedB64 = b64u(JSON.stringify({ alg: 'ES256', nonce, url, ...header }))
    const payloadB64 = payload === '' ? '' : b64u(JSON.stringify(payload))
    const signature = sign('sha256', Buffer.from(`${protectedB64}.${payloadB64}`), { key: this.key, dsaEncoding: 'ieee-p1363' })

    return JSON.stringify({ protected: protectedB64, payload: payloadB64, signature: b64u(signature) })
  }

  /**
   * One signed POST. `payload` '' is a POST-as-GET. A badNonce answer is
   * retried once with the nonce it carries, as RFC 8555 §6.5 expects.
   */
  private async post(url: string, payload: unknown, opts: { jwk?: boolean; accept?: string } = {}): Promise<{ res: Response; body: any }> {
    for (let attempt = 0; ; attempt++) {
      const header = opts.jwk ? { jwk: this.jwk } : { kid: this.kid }

      if (!opts.jwk && !this.kid) throw new AcmeError('no ACME account yet')

      const res = await this.http(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/jose+json', ...(opts.accept ? { Accept: opts.accept } : {}) },
        body: this.jws(url, payload, await this.freshNonce(), header),
      })

      this.nonce = res.headers.get('replay-nonce') ?? null

      const text = await res.text()
      let body: any = text

      if ((res.headers.get('content-type') ?? '').includes('json') && text) {
        try {
          body = JSON.parse(text)
        } catch {
          // Leave the raw text: the error below quotes it.
        }
      }

      if (res.ok) return { res, body }

      const type = typeof body?.type === 'string' ? body.type : undefined

      if (type === 'urn:ietf:params:acme:error:badNonce' && attempt === 0) continue

      throw new AcmeError(problemMessage(body, `HTTP ${res.status} from ${new URL(url).pathname}`), type, res.status)
    }
  }

  /** Creates the account, or finds the one this key already has (RFC 8555 §7.3). */
  async register(email: string, eab: { kid: string; hmacKey: string } | null): Promise<string> {
    const directory = await this.getDirectory()

    if (directory.meta?.externalAccountRequired && !eab) {
      throw new AcmeError('this certificate authority requires an external account binding (key ID and HMAC key)')
    }

    const payload: Record<string, unknown> = { termsOfServiceAgreed: true }

    if (email) payload.contact = [`mailto:${email}`]
    if (eab) payload.externalAccountBinding = this.externalAccountBinding(directory.newAccount, eab)

    const { res } = await this.post(directory.newAccount, payload, { jwk: true })
    const location = res.headers.get('location')

    if (!location) throw new AcmeError('the CA returned no account URL')
    this.kid = location

    return location
  }

  /** RFC 8555 §7.3.4: the account key, signed HS256 with the key the CA issued. */
  private externalAccountBinding(url: string, eab: { kid: string; hmacKey: string }) {
    const protectedB64 = b64u(JSON.stringify({ alg: 'HS256', kid: eab.kid, url }))
    const payloadB64 = b64u(JSON.stringify(this.jwk))
    // CAs hand the key out base64url; Node's base64 decoder reads both alphabets.
    const signature = createHmac('sha256', Buffer.from(eab.hmacKey, 'base64')).update(`${protectedB64}.${payloadB64}`).digest()

    return { protected: protectedB64, payload: payloadB64, signature: b64u(signature) }
  }

  async newOrder(identifiers: { type: 'dns' | 'ip'; value: string }[]): Promise<{ url: string; order: AcmeOrder }> {
    const { res, body } = await this.post((await this.getDirectory()).newOrder, { identifiers })
    const url = res.headers.get('location')

    if (!url) throw new AcmeError('the CA returned no order URL')

    return { url, order: body as AcmeOrder }
  }

  async getAuthorization(url: string): Promise<AcmeAuthorization> {
    return (await this.post(url, '')).body as AcmeAuthorization
  }

  /** Tells the CA the challenge is ready to be checked. */
  async respond(challenge: AcmeChallenge): Promise<void> {
    await this.post(challenge.url, {})
  }

  /** Polls an authorization until it is valid; fails with the CA's reason. */
  async waitForAuthorization(url: string): Promise<AcmeAuthorization> {
    return this.poll(url, (authz: AcmeAuthorization) => {
      if (authz.status === 'valid') return true
      if (authz.status === 'pending' || authz.status === 'processing') return false

      const failed = authz.challenges?.find(c => c.error)

      throw new AcmeError(
        `${authz.identifier?.value}: ${failed?.error?.detail || `authorization ${authz.status}`}`,
        failed?.error?.type,
      )
    })
  }

  async finalize(order: AcmeOrder, orderUrl: string, csrDer: Buffer): Promise<AcmeOrder> {
    await this.post(order.finalize, { csr: b64u(csrDer) })

    return this.poll(orderUrl, (current: AcmeOrder) => {
      if (current.status === 'valid') return true
      if (current.status === 'processing' || current.status === 'ready' || current.status === 'pending') return false

      throw new AcmeError(problemMessage(current.error, `order ${current.status}`), current.error?.type)
    })
  }

  /** The certificate and its chain, PEM. */
  async downloadCertificate(order: AcmeOrder): Promise<string> {
    if (!order.certificate) throw new AcmeError('the order is valid but carries no certificate URL')

    const { body } = await this.post(order.certificate, '', { accept: 'application/pem-certificate-chain' })

    return String(body)
  }

  private async poll<T>(url: string, done: (body: T) => boolean): Promise<T> {
    const deadline = Date.now() + ACME_POLL_TIMEOUT_MS
    let wait = POLL_FIRST_MS

    for (;;) {
      const { res, body } = await this.post(url, '')

      if (done(body as T)) return body as T
      if (Date.now() + wait > deadline) throw new AcmeError(`still pending after ${ACME_POLL_TIMEOUT_MS / 60_000} minutes at the CA`)

      const retryAfter = Number(res.headers.get('retry-after'))

      await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, RETRY_AFTER_MAX_MS) : wait)
      wait = Math.min(wait * 2, POLL_MAX_MS)
    }
  }
}
