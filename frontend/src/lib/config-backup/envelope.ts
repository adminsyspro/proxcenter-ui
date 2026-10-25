// The configuration backup file: a small JSON envelope whose `data` is the
// gzipped payload encrypted with AES-256-GCM under a key derived from the
// operator's passphrase (scrypt). Only the format marker, the creation date
// and the version that wrote it stay readable without the passphrase.

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

export const BACKUP_FORMAT = 'proxcenter-config-backup'
export const BACKUP_FORMAT_VERSION = 1
export const MIN_PASSPHRASE_LENGTH = 12

// N = 2^15 keeps a derivation around 100 ms; 32 MiB of memory (128 * N * r).
const KDF = { N: 32768, r: 8, p: 1, keyLength: 32 } as const

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT
  version: number
  createdAt: string
  appVersion: string
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string }
  cipher: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

export type EnvelopeErrorCode = 'invalid-file' | 'unsupported-version' | 'wrong-passphrase'

export class EnvelopeError extends Error {
  constructor(public readonly code: EnvelopeErrorCode) {
    super(code)
    this.name = 'EnvelopeError'
  }
}

function deriveKey(passphrase: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, KDF.keyLength, { ...params, maxmem: 256 * params.N * params.r }, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

export async function sealBackup(payload: unknown, passphrase: string, appVersion: string, now = new Date()): Promise<string> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(passphrase, salt, KDF)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))), cipher.final()])

  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    appVersion,
    kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }

  return JSON.stringify(envelope)
}

function parseEnvelope(raw: string): BackupEnvelope {
  let parsed: Partial<BackupEnvelope>
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new EnvelopeError('invalid-file')
  }

  if (!parsed || parsed.format !== BACKUP_FORMAT) throw new EnvelopeError('invalid-file')
  if (parsed.version !== BACKUP_FORMAT_VERSION) throw new EnvelopeError('unsupported-version')
  const kdf = parsed.kdf
  if (
    kdf?.name !== 'scrypt' || !Number.isInteger(kdf.N) || !Number.isInteger(kdf.r) || !Number.isInteger(kdf.p) ||
    typeof kdf.salt !== 'string' || typeof parsed.iv !== 'string' || typeof parsed.tag !== 'string' || typeof parsed.data !== 'string'
  ) {
    throw new EnvelopeError('invalid-file')
  }
  // A forged file must not make the server burn memory on the derivation.
  if (kdf.N > 1 << 20 || kdf.r > 16 || kdf.p > 4) throw new EnvelopeError('invalid-file')

  return parsed as BackupEnvelope
}

export async function openBackup<T = unknown>(raw: string, passphrase: string): Promise<{ payload: T; createdAt: string; appVersion: string }> {
  const envelope = parseEnvelope(raw)
  const { N, r, p, salt } = envelope.kdf
  const key = await deriveKey(passphrase, Buffer.from(salt, 'base64'), { N, r, p })

  let plain: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
  } catch {
    // GCM cannot tell a wrong key from a tampered file; the passphrase is by
    // far the likelier cause.
    throw new EnvelopeError('wrong-passphrase')
  }

  let payload: T
  try {
    payload = JSON.parse(gunzipSync(plain).toString('utf8'))
  } catch {
    throw new EnvelopeError('invalid-file')
  }

  return { payload, createdAt: envelope.createdAt, appVersion: envelope.appVersion }
}
