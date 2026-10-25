export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { summarizeBackup } from '@/lib/config-backup/engine'
import { openUpload, requireBackupOperator } from '@/lib/config-backup/http'
import { databaseSchema, prisma } from '@/lib/db/prisma'

// POST /api/v1/admin/config-backup/inspect (multipart: file, passphrase)
// Opens the file and describes it, without touching the configuration.
export async function POST(req: NextRequest) {
  const denied = await requireBackupOperator()
  if (denied) return denied

  const opened = await openUpload(req)
  if (opened instanceof Response) return opened

  const summary = await summarizeBackup(prisma, databaseSchema, opened.payload)
  return NextResponse.json({ data: { createdAt: opened.createdAt, appVersion: opened.appVersion, ...summary } })
}
