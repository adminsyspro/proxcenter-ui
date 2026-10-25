// src/lib/tls/selfSigned.ts
//
// The self-signed certificate: generated on first boot, and on demand from the
// settings page. RSA 2048 so that any client can talk to it.

import { hostname as osHostname } from 'node:os'

import { generateRsaKeys, privateKeyPem, randomSerial, RSA_SIGNING, subjectAltNames, subjectName, x509 } from '@/lib/tls/x509'

export interface SelfSignedOptions {
  commonName: string
  sanNames?: string[]
  days?: number
}

/** Browsers reject a certificate valid for more than 825 days. */
const DEFAULT_DAYS = 825

export async function generateSelfSigned({ commonName, sanNames = [], days = DEFAULT_DAYS }: SelfSignedOptions) {
  const keys = await generateRsaKeys()
  const names = Array.from(new Set([commonName, ...sanNames])).filter(Boolean)

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerial(),
    name: subjectName(commonName),
    notBefore: new Date(),
    notAfter: new Date(Date.now() + days * 86_400_000),
    keys,
    signingAlgorithm: RSA_SIGNING,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      subjectAltNames(names),
    ],
  })

  return { certPem: cert.toString('pem'), keyPem: await privateKeyPem(keys.privateKey) }
}

/**
 * Names for the certificate generated on first boot: whatever APP_URL points
 * at, plus the container hostname and localhost so a direct connection to the
 * appliance does not add a second warning on top of the self-signed one.
 */
export function defaultSelfSignedNames(): { commonName: string; sanNames: string[] } {
  let fromAppUrl = ''

  try {
    if (process.env.APP_URL) fromAppUrl = new URL(process.env.APP_URL).hostname
  } catch {
    // A malformed APP_URL is not a reason to boot without a certificate.
  }

  const commonName = fromAppUrl || osHostname() || 'proxcenter.local'

  const sanNames = Array.from(new Set([commonName, osHostname(), 'localhost', '127.0.0.1'].filter(Boolean)))

  return { commonName, sanNames }
}
