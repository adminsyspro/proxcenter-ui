// Shared plumbing of the /api/v1/admin/config-backup routes.

import { createHmac } from 'node:crypto'

import { NextResponse } from 'next/server'

import { requireSuperAdminCaller } from '@/lib/auth/totp-admin'
import { prisma } from '@/lib/db/prisma'
import { requireProviderTenant } from '@/lib/tenant'

import { EnvelopeError, MIN_PASSPHRASE_LENGTH, openBackup } from './envelope'
import { isBackupPayload, type BackupPayload } from './engine'

/** Upper bound of an uploaded backup; branding images are the bulk of a real one. */
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024

export type BackupErrorCode =
  | 'passphrase-too-short'
  | 'missing-file'
  | 'file-too-large'
  | 'invalid-file'
  | 'unsupported-version'
  | 'wrong-passphrase'
  | 'newer-schema'

export function backupError(code: BackupErrorCode, status = 400) {
  return NextResponse.json({ error: code, code }, { status })
}

/**
 * The whole configuration, every credential included, goes through these
 * routes: a super admin standing in the provider tenant, and a person rather
 * than an API token (requireSuperAdminCaller needs a session user).
 */
export async function requireBackupOperator(): Promise<Response | null> {
  return (await requireProviderTenant()) ?? (await requireSuperAdminCaller())
}

/**
 * Fingerprint of this install's APP_SECRET, never the key itself. API tokens
 * are stored as an HMAC peppered with that key and cannot be re-peppered
 * without the token, so a restore onto another key must say they are dead.
 */
export function installKeyCheck(): string {
  return createHmac('sha256', process.env.APP_SECRET ?? '').update('proxcenter-config-backup/key-check').digest('hex').slice(0, 16)
}

/**
 * This install's identity, the row the orchestrator reads (oldest first). It
 * is not in the backup on purpose: copied elsewhere it would make a clone the
 * licence portal refuses. Comparing it tells a restore onto another instance,
 * whose licences have to be taken over from proxcenter.io.
 */
export async function currentInstallId(): Promise<string | null> {
  const row = await prisma.installIdentity.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } })
  return row?.id ?? null
}

export function checkPassphrase(passphrase: unknown): passphrase is string {
  return typeof passphrase === 'string' && passphrase.length >= MIN_PASSPHRASE_LENGTH
}

export interface OpenedUpload {
  payload: BackupPayload
  createdAt: string
  appVersion: string
}

/** Reads the multipart upload (`file`, `passphrase`) and decrypts it. */
export async function openUpload(req: Request): Promise<OpenedUpload | Response> {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return backupError('missing-file')
  }

  const file = form.get('file')
  const passphrase = form.get('passphrase')
  if (!(file instanceof Blob) || file.size === 0) return backupError('missing-file')
  if (file.size > MAX_BACKUP_BYTES) return backupError('file-too-large', 413)
  if (typeof passphrase !== 'string' || passphrase.length === 0) return backupError('wrong-passphrase')

  try {
    const opened = await openBackup(await file.text(), passphrase)
    if (!isBackupPayload(opened.payload)) return backupError('invalid-file')
    return { payload: opened.payload, createdAt: opened.createdAt, appVersion: opened.appVersion }
  } catch (err) {
    if (err instanceof EnvelopeError) return backupError(err.code)
    throw err
  }
}
