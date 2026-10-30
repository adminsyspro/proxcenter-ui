// An in-memory ACME CA for the tests of src/lib/tls/acme.ts and acmeClient.ts.
// It checks what a real CA checks on every request (JWS signature, nonce,
// url, account) so a client that signs or chains requests wrongly fails here
// rather than against Let's Encrypt.

import 'reflect-metadata'

import { createHash, createHmac, createPublicKey, verify, type JsonWebKey } from 'node:crypto'

import * as x509 from '@peculiar/x509'

export const DIRECTORY_URL = 'https://ca.test/dir'
export const LEAF_PEM = '-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----'
export const CHAIN_PEM = '-----BEGIN CERTIFICATE-----\nintermediate\n-----END CERTIFICATE-----'

interface Challenge { type: string; url: string; token: string; status: string; error?: { type: string; detail: string } }
interface Authz { url: string; status: string; identifier: { type: string; value: string }; wildcard?: boolean; challenges: Challenge[] }
interface Order { url: string; status: string; identifiers: { type: string; value: string }[]; authorizations: string[]; finalize: string; certificate?: string }

export interface FakeCaOptions {
  /** Decides whether a challenge the client answered passes, from its key authorization. */
  validate?: (challenge: Challenge, authz: Authz, keyAuthorization: string) => string | null
  eab?: { kid: string; hmacKey: string }
  /** Challenge types offered per authorization. */
  offer?: string[]
  /** Authorizations the account already holds, by identifier value. */
  alreadyValid?: string[]
  /** Answers the next N signed requests with badNonce. */
  badNonces?: number
  /** Polls of the order answered "processing" with this Retry-After before it turns valid. */
  processingPolls?: { count: number; retryAfter: string }
}

const b64uJson = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString())

function thumbprint(jwk: JsonWebKey): string {
  return createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url')
}

export function createFakeCa(options: FakeCaOptions = {}) {
  const nonces = new Set<string>()
  const accounts = new Map<string, { url: string; jwk: JsonWebKey }>()
  const authzs = new Map<string, Authz>()
  const orders = new Map<string, Order>()
  const challengesByUrl = new Map<string, { challenge: Challenge; authz: Authz }>()
  let seq = 0
  let badNonces = options.badNonces ?? 0
  let processingPolls = options.processingPolls?.count ?? 0
  const state = { csrNames: [] as string[], requests: [] as string[], eabChecked: false }

  const nonce = () => {
    const n = `n${++seq}`

    nonces.add(n)

    return n
  }

  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const json = typeof body === 'string' ? body : JSON.stringify(body)

    return new Response(status === 204 ? null : json, {
      status,
      headers: { 'Replay-Nonce': nonce(), 'Content-Type': typeof body === 'string' ? 'application/pem-certificate-chain' : 'application/json', ...headers },
    })
  }

  const problem = (status: number, type: string, detail: string) =>
    reply(status, { type: `urn:ietf:params:acme:error:${type}`, detail }, { 'Content-Type': 'application/problem+json' })

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input)
    const method = init.method ?? 'GET'

    state.requests.push(`${method} ${new URL(url).pathname}`)

    if (url === DIRECTORY_URL) {
      return reply(200, {
        newNonce: 'https://ca.test/nonce', newAccount: 'https://ca.test/account', newOrder: 'https://ca.test/order',
        meta: options.eab ? { externalAccountRequired: true } : {},
      })
    }

    if (method === 'HEAD') return reply(200, '')

    const jws = JSON.parse(String(init.body))
    const header = b64uJson(jws.protected)
    const payload = jws.payload ? b64uJson(jws.payload) : ''

    if (header.url !== url) return problem(400, 'malformed', 'url mismatch')
    if (!nonces.delete(header.nonce)) return problem(400, 'badNonce', 'unknown nonce')
    if (badNonces > 0) {
      badNonces--

      return problem(400, 'badNonce', 'stale nonce')
    }

    const jwk: JsonWebKey | undefined = header.jwk ?? [...accounts.values()].find(a => a.url === header.kid)?.jwk

    if (!jwk) return problem(400, 'accountDoesNotExist', 'no such account')

    const signed = verify('sha256', Buffer.from(`${jws.protected}.${jws.payload}`), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(jws.signature, 'base64url'))

    if (!signed) return problem(400, 'malformed', 'bad signature')

    if (url === 'https://ca.test/account') {
      const id = thumbprint(jwk)
      const existing = accounts.get(id)

      if (existing) return reply(200, { status: 'valid' }, { Location: existing.url })

      if (options.eab) {
        const binding = payload.externalAccountBinding

        if (!binding) return problem(400, 'externalAccountRequired', 'EAB required')

        const expected = createHmac('sha256', Buffer.from(options.eab.hmacKey, 'base64url')).update(`${binding.protected}.${binding.payload}`).digest('base64url')
        const bindingHeader = b64uJson(binding.protected)

        if (expected !== binding.signature || bindingHeader.kid !== options.eab.kid || bindingHeader.url !== url) return problem(400, 'unauthorized', 'bad EAB')
        if (JSON.stringify(b64uJson(binding.payload)) !== JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })) return problem(400, 'unauthorized', 'EAB key mismatch')
        state.eabChecked = true
      }

      const account = { url: `https://ca.test/acct/${accounts.size + 1}`, jwk }

      accounts.set(id, account)

      return reply(201, { status: 'valid' }, { Location: account.url })
    }

    if (url === 'https://ca.test/order') {
      const id = ++seq
      const order: Order = {
        url: `https://ca.test/order/${id}`, status: 'pending', identifiers: payload.identifiers,
        authorizations: [], finalize: `https://ca.test/order/${id}/finalize`,
      }

      for (const identifier of payload.identifiers) {
        const wildcard = identifier.value.startsWith('*.')
        const value = wildcard ? identifier.value.slice(2) : identifier.value
        const authzUrl = `https://ca.test/authz/${++seq}`
        const authz: Authz = {
          url: authzUrl, status: options.alreadyValid?.includes(identifier.value) ? 'valid' : 'pending',
          identifier: { type: identifier.type, value }, ...(wildcard ? { wildcard: true } : {}),
          challenges: (options.offer ?? ['http-01', 'dns-01']).map(type => ({ type, url: `${authzUrl}/${type}`, token: `tok-${seq}-${type}`, status: 'pending' })),
        }

        authzs.set(authzUrl, authz)
        for (const challenge of authz.challenges) challengesByUrl.set(challenge.url, { challenge, authz })
        order.authorizations.push(authzUrl)
      }

      orders.set(order.url, order)

      return reply(201, order, { Location: order.url })
    }

    const authz = authzs.get(url)

    if (authz) return reply(200, authz)

    const answered = challengesByUrl.get(url)

    if (answered) {
      const { challenge, authz: parent } = answered
      const error = options.validate ? options.validate(challenge, parent, `${challenge.token}.${thumbprint(jwk)}`) : null

      challenge.status = error ? 'invalid' : 'valid'
      parent.status = error ? 'invalid' : 'valid'
      if (error) challenge.error = { type: 'urn:ietf:params:acme:error:unauthorized', detail: error }

      return reply(200, challenge)
    }

    const finalizing = [...orders.values()].find(o => o.finalize === url)

    if (finalizing) {
      if (finalizing.authorizations.some(a => authzs.get(a)?.status !== 'valid')) return problem(403, 'orderNotReady', 'authorizations pending')

      const csr = new x509.Pkcs10CertificateRequest(Buffer.from(payload.csr, 'base64url'))
      const san = csr.extensions.find((e): e is x509.SubjectAlternativeNameExtension => e instanceof x509.SubjectAlternativeNameExtension)

      state.csrNames = san ? san.names.items.map(n => n.value) : []
      finalizing.status = 'processing'

      return reply(200, finalizing)
    }

    const order = orders.get(url)

    if (order) {
      if (order.status === 'processing') {
        if (processingPolls > 0) {
          processingPolls--

          return reply(200, order, { 'Retry-After': options.processingPolls!.retryAfter })
        }

        order.status = 'valid'
        order.certificate = `${order.url}/cert`
      }

      return reply(200, order)
    }

    if (url.endsWith('/cert')) return reply(200, `${LEAF_PEM}\n${CHAIN_PEM}\n`)

    return problem(404, 'malformed', `no route for ${url}`)
  }

  return { fetch: fetchImpl as typeof fetch, state, thumbprint }
}
