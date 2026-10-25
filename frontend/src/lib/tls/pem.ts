// src/lib/tls/pem.ts
//
// Reading and checking PEM material. Everything here uses the native
// crypto.X509Certificate: Node can parse and verify X.509, it just cannot
// forge one (see selfSigned.ts for the generation side).

import { X509Certificate, createPrivateKey } from 'node:crypto'

export type PemErrorCode =
  | 'not_a_certificate'
  | 'key_mismatch'
  | 'passphrase_protected'
  | 'unreadable_key'
  | 'expired'
  | 'broken_chain'
  | 'private_key_in_certificate'

export class PemError extends Error {
  code: PemErrorCode

  constructor(code: PemErrorCode, message: string) {
    super(message)
    this.name = 'PemError'
    this.code = code
  }
}

export interface ParsedCertificate {
  commonName: string
  sanNames: string[]
  issuer: string
  serial: string
  fingerprint: string
  notBefore: Date
  notAfter: Date
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g

/**
 * Any flavour of private-key header: PRIVATE KEY, RSA PRIVATE KEY, EC PRIVATE
 * KEY, ENCRYPTED PRIVATE KEY, OPENSSH PRIVATE KEY, PGP PRIVATE KEY BLOCK.
 */
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/

/** Split a bundle into its individual certificate blocks, in file order. */
export function splitPemChain(pem: string): string[] {
  return pem.match(PEM_BLOCK) ?? []
}

/**
 * What goes into `cert_pem` / `chain_pem`, and only that.
 *
 * Two problems, one answer. Operators routinely paste a COMBINED PEM — the
 * certificate and its private key in one blob, which is what many tools emit —
 * into the certificate field while also filling the key field correctly.
 * Everything validates, and the private key lands in clear in a column that is
 * not the encrypted one, where a database dump hands it over. Pasting a bundle
 * with a `subject=`/`issuer=` preamble, or with the key first, is the same
 * mistake wearing different clothes.
 *
 * So: a private-key block anywhere in this input is refused outright rather
 * than quietly stripped — an operator who pasted a key where a certificate goes
 * needs to know, and the key they pasted should be considered compromised —
 * and what is kept is exactly the certificate blocks, in order, nothing else.
 *
 * The label check below is the friendly half: it names the mistake an operator
 * actually made. It is not the defence. The defence is that EVERY block kept
 * has to parse as a real X.509 certificate, because BEGIN/END CERTIFICATE
 * markers are just text. A second block wearing those markers whose body is a
 * private key with a doubled space, a tab, or a lowercase label slips past any
 * label pattern — and with no separate chain supplied there is no chain
 * validation downstream to catch it, so it lands in cert_pem in clear.
 * Parsing closes that vector and every future variant of it; matching labels
 * only ever closes the variants already thought of.
 *
 * The errors carry no part of the input, deliberately: they reach the UI and
 * the logs.
 */
export function normalizeCertificatePem(pem: string, field: 'certificate' | 'chain' = 'certificate'): string {
  if (PRIVATE_KEY_BLOCK.test(pem)) {
    throw new PemError(
      'private_key_in_certificate',
      `the ${field} field contains a private key; paste only the certificate here and put the key in the private key field`,
    )
  }

  const blocks = splitPemChain(pem)

  if (blocks.length === 0) {
    throw new PemError('not_a_certificate', `the ${field} field holds no PEM certificate`)
  }

  for (let i = 0; i < blocks.length; i++) {
    try {
      readCertificate(blocks[i])
    } catch {
      // Rethrown rather than propagated: readCertificate's message is
      // OpenSSL's, which says nothing about which block of a bundle is at
      // fault. Nothing from the block itself goes into this one.
      throw new PemError(
        'not_a_certificate',
        blocks.length === 1
          ? `the ${field} field is not a PEM certificate`
          : `block ${i + 1} of the ${field} field is wrapped as a certificate but does not parse as one`,
      )
    }
  }

  return `${blocks.join('\n')}\n`
}

function readCertificate(pem: string): X509Certificate {
  try {
    return new X509Certificate(pem)
  } catch (err: any) {
    throw new PemError('not_a_certificate', err?.message || 'not a PEM certificate')
  }
}

/**
 * `subject` comes back as newline-separated RDNs ("CN=a\nO=b"), and
 * `subjectAltName` as a comma-separated list of typed entries
 * ("DNS:a.example.com, IP Address:10.0.0.1"). Both are normalised here so the
 * rest of the code never re-parses them.
 */
export function parseCertificate(certPem: string): ParsedCertificate {
  const cert = readCertificate(certPem)

  const cn = (cert.subject ?? '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('CN='))
    ?.slice(3)

  const sanNames = (cert.subjectAltName ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => entry.replace(/^(DNS|IP Address|IP|URI|email):/i, '').trim())
    .filter(Boolean)

  return {
    commonName: cn || sanNames[0] || '',
    sanNames,
    issuer: cert.issuer ?? '',
    serial: cert.serialNumber ?? '',
    fingerprint: cert.fingerprint256 ?? '',
    notBefore: new Date(cert.validFrom),
    notAfter: new Date(cert.validTo),
  }
}

/** Refuses a certificate whose validity window has already ended. */
export function assertNotExpired(certPem: string): void {
  const cert = readCertificate(certPem)
  const notAfter = new Date(cert.validTo)

  if (notAfter.getTime() <= Date.now()) {
    throw new PemError('expired', `the certificate expired on ${notAfter.toISOString()}`)
  }
}

/**
 * Pairing check. `checkPrivateKey` is the authoritative answer: it compares the
 * public key derived from the private key with the one in the certificate.
 */
export function assertKeyMatchesCertificate(certPem: string, keyPem: string): void {
  const cert = readCertificate(certPem)

  let key
  try {
    key = createPrivateKey(keyPem)
  } catch (err: any) {
    const message = String(err?.message || '')
    // An encrypted key without a passphrase fails deep inside OpenSSL with a
    // decode error. Telling the operator "wrong format" would send them
    // hunting for the wrong problem, so this case gets its own code. On
    // OpenSSL 3 the top-level message is just the last frame ("interrupted
    // or cancelled"); the useful diagnostic ("bad password read", "unable to
    // get passphrase") lives in the opensslErrorStack, so both are checked.
    //
    // "DECODER routines::unsupported" and "PEM routines" are NOT reliable
    // signals here: every malformed-key case on this stack (truncated PEM,
    // garbage between valid markers, a certificate passed as a key, a
    // bit-flipped byte, an empty string) ends in that exact same generic
    // decode failure, so matching on it would misclassify every one of them
    // as passphrase_protected and make unreadable_key unreachable. Only
    // substrings that genuinely indicate "this key is encrypted" belong here.
    const stack = Array.isArray(err?.opensslErrorStack) ? err.opensslErrorStack.join(' ') : ''
    const combined = `${message} ${stack}`
    if (/bad decrypt|bad password|unable to get passphrase|interrupted or cancelled|passphrase/i.test(combined)) {
      throw new PemError('passphrase_protected', 'the private key is protected by a passphrase; decrypt it first')
    }
    throw new PemError('unreadable_key', message || 'unreadable private key')
  }

  if (!cert.checkPrivateKey(key)) {
    throw new PemError('key_mismatch', 'the private key does not match the certificate')
  }
}

/**
 * Walk the bundle leaf-first and check each certificate was issued by the next
 * one. A chain in the wrong order is the single most common upload mistake and
 * produces a browser error that says nothing useful.
 */
export function assertChainOrder(certPem: string, chainPem: string | null): void {
  if (!chainPem?.trim()) return

  const blocks = [certPem, ...splitPemChain(chainPem)]

  for (let i = 0; i < blocks.length - 1; i++) {
    const child = readCertificate(blocks[i])
    const parent = readCertificate(blocks[i + 1])

    if (!child.verify(parent.publicKey)) {
      throw new PemError('broken_chain', `certificate ${i + 1} of the bundle is not signed by the one that follows it`)
    }
  }
}
