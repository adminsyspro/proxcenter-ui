export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'

import { APP_VERSION } from '@/config/version'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { dumpConfiguration } from '@/lib/config-backup/engine'
import { sealBackup } from '@/lib/config-backup/envelope'
import { backupError, checkPassphrase, currentInstallId, installKeyCheck, requireBackupOperator } from '@/lib/config-backup/http'
import { decryptSecret } from '@/lib/crypto/secret'
import { databaseSchema, prisma } from '@/lib/db/prisma'

// POST /api/v1/admin/config-backup/export { passphrase }
// Answers the encrypted backup file as a download.
async function handlePost(req: NextRequest) {
  const denied = await requireBackupOperator()
  if (denied) return denied

  const body = await req.json().catch(() => null)
  if (!checkPassphrase(body?.passphrase)) return backupError('passphrase-too-short')

  const now = new Date()
  const { payload, secrets } = await dumpConfiguration(prisma, databaseSchema, decryptSecret)
  const file = await sealBackup({ ...payload, keyCheck: installKeyCheck(), sourceInstall: await currentInstallId() }, body.passphrase, APP_VERSION, now)
  const rows = Object.values(payload.tables).reduce((sum, t) => sum + t.length, 0)

  await audit({
    action: 'export',
    category: 'settings',
    resourceType: 'configuration',
    details: { tables: Object.keys(payload.tables).length, rows, secrets, migration: payload.migration },
  })

  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  return new Response(file, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="proxcenter-config-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}

export const POST = withAudit({ category: 'settings', action: 'export', resourceType: 'configuration' }, handlePost)
