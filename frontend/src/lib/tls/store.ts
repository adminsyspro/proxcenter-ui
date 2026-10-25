// src/lib/tls/store.ts
//
// Persistence of the TLS material. Private keys are encrypted at rest with
// APP_SECRET through the same helper as connection passwords, and the
// decrypted form only ever travels to the TLS listener — never to an API
// response, a log line or an audit row.

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret'
import { prisma } from '@/lib/db/prisma'
import {
  assertChainOrder,
  assertKeyMatchesCertificate,
  assertNotExpired,
  normalizeCertificatePem,
  parseCertificate,
} from '@/lib/tls/pem'

export type TlsSource = 'self_signed' | 'uploaded' | 'acme'

export interface CertificateSummary {
  id: string
  source: TlsSource
  commonName: string
  sanNames: string[]
  issuer: string
  serial: string
  fingerprint: string
  notBefore: Date
  notAfter: Date
  isActive: boolean
  createdAt: Date
}

export interface CertificateMaterial {
  id: string
  fingerprint: string
  certPem: string
  chainPem: string | null
  keyPem: string
}

function toSummary(row: any): CertificateSummary {
  return {
    id: row.id,
    source: row.source,
    commonName: row.commonName,
    sanNames: row.sanNames ?? [],
    issuer: row.issuer,
    serial: row.serial,
    fingerprint: row.fingerprint,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    isActive: row.isActive,
    createdAt: row.createdAt,
  }
}

export async function saveCertificate(input: {
  source: TlsSource
  certPem: string
  chainPem?: string | null
  keyPem: string
  activate?: boolean
}): Promise<CertificateSummary> {
  // Normalise FIRST, and persist only the normalised form. `cert_pem` is a
  // plain column: a combined certificate-and-key PEM pasted into the
  // certificate field would otherwise store the private key in clear right
  // next to the encrypted one, and the encryption would protect nothing. The
  // chain field gets the same treatment for the same reason.
  const certPem = normalizeCertificatePem(input.certPem, 'certificate')
  const chainPem = input.chainPem?.trim() ? normalizeCertificatePem(input.chainPem, 'chain') : null

  // Validate before writing: a rejected upload must leave no trace.
  assertKeyMatchesCertificate(certPem, input.keyPem)
  assertChainOrder(certPem, chainPem)
  assertNotExpired(certPem)

  const parsed = parseCertificate(certPem)

  const data = {
    source: input.source,
    commonName: parsed.commonName,
    sanNames: parsed.sanNames,
    certPem,
    chainPem,
    keyEncrypted: encryptSecret(input.keyPem),
    issuer: parsed.issuer,
    serial: parsed.serial,
    fingerprint: parsed.fingerprint,
    notBefore: parsed.notBefore,
    notAfter: parsed.notAfter,
    isActive: Boolean(input.activate),
  }

  // Deactivating the previous row and inserting the new active one must
  // commit together, or a concurrent save/activate can leave the table with
  // zero or two active rows. The `tls_certificates_single_active` partial
  // unique index (migration 20260917160000) is the actual backstop; this
  // transaction just keeps the common case from tripping it.
  const row = input.activate
    ? await prisma.$transaction(async tx => {
        await tx.tlsCertificate.updateMany({ where: { isActive: true }, data: { isActive: false } })

        return tx.tlsCertificate.create({ data })
      })
    : await prisma.tlsCertificate.create({ data })

  return toSummary(row)
}

export async function getActiveSummary(): Promise<CertificateSummary | null> {
  const row = await prisma.tlsCertificate.findFirst({ where: { isActive: true } })

  return row ? toSummary(row) : null
}

export async function loadActiveMaterial(): Promise<CertificateMaterial | null> {
  const row = await prisma.tlsCertificate.findFirst({ where: { isActive: true } })

  if (!row) return null

  return {
    id: row.id,
    fingerprint: row.fingerprint,
    certPem: row.certPem,
    chainPem: row.chainPem,
    keyPem: decryptSecret(row.keyEncrypted),
  }
}

export async function activateCertificate(id: string): Promise<CertificateSummary> {
  const row = await prisma.tlsCertificate.findUnique({ where: { id } })

  if (!row) throw new Error(`unknown certificate ${id}`)

  // Same reasoning as saveCertificate's activate path: the deactivate and
  // the activate must commit together, with the partial unique index as the
  // hard backstop against two rows ending up active at once.
  const updated = await prisma.$transaction(async tx => {
    await tx.tlsCertificate.updateMany({ where: { isActive: true }, data: { isActive: false } })

    return tx.tlsCertificate.update({ where: { id }, data: { isActive: true } })
  })

  return toSummary(updated)
}

export async function listCertificates(limit = 20): Promise<CertificateSummary[]> {
  const rows = await prisma.tlsCertificate.findMany({ orderBy: { createdAt: 'desc' }, take: limit })

  return rows.map(toSummary)
}

export async function countCertificates(): Promise<number> {
  return prisma.tlsCertificate.count()
}
