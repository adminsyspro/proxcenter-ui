export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { authOptions } from '@/lib/auth/config'
import { restoreConfiguration, summarizeBackup } from '@/lib/config-backup/engine'
import { backupError, currentInstallId, installKeyCheck, openUpload, requireBackupOperator } from '@/lib/config-backup/http'
import { encryptSecret } from '@/lib/crypto/secret'
import { databaseSchema, prisma } from '@/lib/db/prisma'

// POST /api/v1/admin/config-backup/import (multipart: file, passphrase)
// Replaces the configuration with the file's, in one transaction.
async function handlePost(req: NextRequest) {
  const denied = await requireBackupOperator()
  if (denied) return denied

  // Taken before the restore: the users table is replaced and every session
  // goes with it, so the audit row could not find its author afterwards.
  const session = await getServerSession(authOptions)

  const opened = await openUpload(req)
  if (opened instanceof Response) return opened

  // A file written by a newer ProxCenter may hold columns and rows whose
  // meaning this version does not know; update first, then restore.
  const summary = await summarizeBackup(prisma, databaseSchema, opened.payload)
  if (summary.compatibility === 'newer') return backupError('newer-schema', 409)

  const restored = await restoreConfiguration(prisma, databaseSchema, opened.payload, encryptSecret)
  // API tokens only survive on the key that peppered their hash.
  const apiTokensInvalid = opened.payload.keyCheck !== installKeyCheck() && (opened.payload.tables.api_tokens?.length ?? 0) > 0
  // Licences, install identity and portal pairing stay with each install, so a
  // file from another instance leaves its licences to be taken over.
  const local = await currentInstallId()
  const otherInstall = Boolean(opened.payload.sourceInstall && local && opened.payload.sourceInstall !== local)
  const result = { ...restored, apiTokensInvalid, otherInstall }

  await audit({
    action: 'import',
    category: 'settings',
    resourceType: 'configuration',
    userId: session?.user?.id,
    userEmail: session?.user?.email ?? undefined,
    details: { createdAt: opened.createdAt, appVersion: opened.appVersion, ...result },
  })

  return NextResponse.json({ data: result })
}

export const POST = withAudit({ category: 'settings', action: 'import', resourceType: 'configuration' }, handlePost)
