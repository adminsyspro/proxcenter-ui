// src/lib/tls/acme.ts
//
// ACME ordering. One account per directory URL, its key encrypted at rest like
// every other secret here. HTTP-01 is served by /api/acme/challenge/[token],
// rewritten from /.well-known/acme-challenge/; DNS-01 goes through the DNS
// provider configured in the settings (src/lib/tls/dns/solver.ts).

import { isIP } from 'node:net'

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret'
import { prisma } from '@/lib/db/prisma'
import { type AcmeChallenge, AcmeClient, type AcmeClientOptions, AcmeError, dns01Value, generateAccountKeyPem } from '@/lib/tls/acmeClient'
import { dropChallenge, putChallenge } from '@/lib/tls/challengeStore'
import type { DnsChallengeHandlers } from '@/lib/tls/dns/solver'
import { splitPemChain } from '@/lib/tls/pem'
import { createCsr } from '@/lib/tls/x509'

export interface OrderInput {
  directoryUrl: string
  email: string
  domains: string[]
  eab: { kid: string; hmacKey: string } | null
  /** Which challenge to answer; `dns` is required for dns-01. */
  challenge?: 'http-01' | 'dns-01'
  dns?: DnsChallengeHandlers
  onStep?: (step: string) => void
  /** Tests only: how the client reaches the CA and waits between polls. */
  transport?: Pick<AcmeClientOptions, 'fetch' | 'sleep'>
}

export interface OrderResult {
  certPem: string
  chainPem: string | null
  keyPem: string
}

/** The account key is generated once per directory and never rotated here. */
async function accountKeyFor(directoryUrl: string, email: string): Promise<{ key: string; accountUrl: string | null }> {
  const row = await prisma.tlsAcmeAccount.findUnique({ where: { directoryUrl } })

  if (row) return { key: decryptSecret(row.keyEncrypted), accountUrl: row.accountUrl ?? null }

  const key = generateAccountKeyPem()

  await prisma.tlsAcmeAccount.create({
    data: { directoryUrl, email, keyEncrypted: encryptSecret(key), termsAgreedAt: new Date() },
  })

  return { key, accountUrl: null }
}

interface PendingChallenge {
  authzUrl: string
  domain: string
  challenge: AcmeChallenge
  keyAuthorization: string
}

export async function orderCertificate(input: OrderInput): Promise<OrderResult> {
  const { directoryUrl, email, domains, eab, onStep, challenge: challengeType = 'http-01', dns, transport } = input

  if (domains.length === 0) throw new Error('an ACME order needs at least one domain')
  if (challengeType === 'dns-01' && !dns) throw new Error('a DNS-01 order needs a DNS provider')

  onStep?.('account')

  const { key: accountKey, accountUrl: existingAccountUrl } = await accountKeyFor(directoryUrl, email)
  const client = new AcmeClient({ directoryUrl, accountKeyPem: accountKey, ...transport })
  // Registering again with the same key returns the existing account (RFC
  // 8555 §7.3.1), so this also survives a CA that forgot the account.
  const accountUrl = await client.register(email, eab)

  // The column exists to give an operator something concrete to point a CA's
  // support desk at.
  if (accountUrl !== existingAccountUrl) {
    await prisma.tlsAcmeAccount.update({ where: { directoryUrl }, data: { accountUrl } })
  }

  onStep?.('csr')

  const { keyPem, csrDer } = await createCsr(domains)

  onStep?.('order')

  const { url: orderUrl, order } = await client.newOrder(
    domains.map(value => ({ type: isIP(value) ? ('ip' as const) : ('dns' as const), value })),
  )

  const pending: PendingChallenge[] = []

  for (const authzUrl of order.authorizations) {
    const authz = await client.getAuthorization(authzUrl)

    if (authz.status === 'valid') continue

    // Exactly the challenge type the operator configured: answering another
    // would hang until the CA times out on a challenge nobody serves.
    const challenge = authz.challenges.find(c => c.type === challengeType)

    if (!challenge) throw new AcmeError(`the CA offers no ${challengeType} challenge for ${authz.identifier.value}`)

    // For a wildcard the identifier is the base name, which is also where the
    // DNS-01 record goes.
    pending.push({ authzUrl, domain: authz.identifier.value, challenge, keyAuthorization: client.keyAuthorization(challenge.token) })
  }

  const published: PendingChallenge[] = []

  try {
    // Published together, as the DNS solver expects: a wildcard and its apex
    // share one record name, and the solver serializes the writes itself.
    await Promise.all(
      pending.map(async item => {
        if (challengeType === 'dns-01') await dns!.create(item.domain, dns01Value(item.keyAuthorization))
        else await putChallenge(item.challenge.token, item.keyAuthorization, item.domain)
        published.push(item)
      }),
    )

    // HTTP-01 reachability was checked by the preflight before the order, and
    // DNS-01 propagation by the solver on every authoritative server: the CA
    // can be asked straight away.
    for (const item of pending) await client.respond(item.challenge)
    for (const item of pending) await client.waitForAuthorization(item.authzUrl)
  } finally {
    await Promise.all(
      published.map(async item => {
        try {
          if (challengeType === 'dns-01') await dns!.remove(item.domain, dns01Value(item.keyAuthorization))
          else await dropChallenge(item.challenge.token)
        } catch (err: any) {
          // A leftover record is harmless; the certificate is what matters.
          console.warn(`[tls] could not remove the ${challengeType} challenge of ${item.domain}:`, err?.message || err)
        }
      }),
    )
  }

  const issued = await client.finalize(order, orderUrl, csrDer)
  const blocks = splitPemChain(await client.downloadCertificate(issued))

  if (blocks.length === 0) throw new Error('the CA returned no certificate')

  onStep?.('done')

  return {
    certPem: blocks[0],
    chainPem: blocks.length > 1 ? blocks.slice(1).join('\n') : null,
    keyPem,
  }
}
