// src/lib/tls/x509.ts
//
// Building X.509 objects: Node can parse and verify certificates but not
// create one. @peculiar/x509 encodes the ASN.1 and signs through WebCrypto, so
// key generation and signing stay native and off the event loop.

// @peculiar/x509 2 resolves its algorithms through tsyringe, which needs the
// Reflect metadata API before the library loads.
import 'reflect-metadata'

import { webcrypto } from 'node:crypto'
import { isIP } from 'node:net'

import * as x509 from '@peculiar/x509'

x509.cryptoProvider.set(webcrypto as unknown as Crypto)

/** RSA 2048 with SHA-256: what every TLS client accepts, old ones included. */
const RSA_ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 }

/** The signature that goes with those keys, for certificates and CSRs. */
export const RSA_SIGNING = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as Algorithm

export function generateRsaKeys(): Promise<CryptoKeyPair> {
  return webcrypto.subtle.generateKey(RSA_ALGORITHM, true, ['sign', 'verify']) as Promise<CryptoKeyPair>
}

export async function privateKeyPem(key: CryptoKey): Promise<string> {
  const der = await webcrypto.subtle.exportKey('pkcs8', key as webcrypto.CryptoKey)

  return x509.PemConverter.encode(der, 'PRIVATE KEY')
}

/** type 2 is dNSName and type 7 iPAddress in RFC 5280; the library names them. */
export function subjectAltNames(names: string[]): x509.SubjectAlternativeNameExtension {
  return new x509.SubjectAlternativeNameExtension(names.map(value => ({ type: isIP(value) ? x509.IP : x509.DNS, value }) as x509.JsonGeneralName))
}

/**
 * A subject CN holds at most 64 characters (RFC 5280 ub-common-name). Past
 * that the name lives in the SAN alone, which is what clients check anyway.
 */
export function subjectName(commonName: string): string | undefined {
  return commonName.length <= 64 ? `CN=${commonName}` : undefined
}

/** Positive, never zero, 128 bits: what RFC 5280 asks of a serial. */
export function randomSerial(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16))

  bytes[0] = (bytes[0] & 0x7f) | 0x01

  return Buffer.from(bytes).toString('hex')
}

/** A fresh RSA key and the PKCS#10 request for these names, DER. */
export async function createCsr(domains: string[]): Promise<{ keyPem: string; csrDer: Buffer }> {
  const keys = await generateRsaKeys()
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: subjectName(domains[0]),
    keys,
    signingAlgorithm: RSA_SIGNING,
    extensions: [subjectAltNames(domains)],
  })

  return { keyPem: await privateKeyPem(keys.privateKey), csrDer: Buffer.from(csr.rawData) }
}

export { x509 }
