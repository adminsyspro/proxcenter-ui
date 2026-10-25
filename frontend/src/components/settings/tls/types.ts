import type { TlsSettings } from '@/lib/tls/schema'

export interface ActiveCertificateDto {
  id: string
  source: string
  commonName: string
  sanNames: string[]
  issuer: string
  fingerprint: string
  notBefore: string
  notAfter: string
}

export interface TlsPayload {
  settings: TlsSettings
  eabConfigured: boolean
  /** Secret DNS-01 fields holding a value; the values themselves never leave the server. */
  dnsSecretsConfigured: string[]
  active: ActiveCertificateDto | null
  listener: { listening: boolean; port: number | null }
  tlsPort: number
  urlCoherence: { ok: boolean; issues: string[] }
}

export interface CertificateHistoryDto {
  id: string
  source: string
  commonName: string
  fingerprint: string
  notBefore: string
  notAfter: string
  isActive: boolean
}
