import path from 'path'
import { prisma } from '@/lib/db/prisma'

export type AssetKind = 'branding' | 'login-bg'

export interface StoredAsset {
  ext: string
  contentType: string
  data: Buffer
}

export async function putAsset(
  tenantId: string,
  kind: AssetKind,
  slot: string,
  ext: string,
  contentType: string,
  data: Buffer,
): Promise<void> {
  await prisma.uploadedAsset.upsert({
    where: { tenantId_kind_slot: { tenantId, kind, slot } },
    update: { ext, contentType, data, updatedAt: new Date() },
    create: { tenantId, kind, slot, ext, contentType, data },
  })
}

export async function getAsset(
  tenantId: string,
  kind: AssetKind,
  slot: string,
): Promise<StoredAsset | null> {
  const row = await prisma.uploadedAsset.findUnique({
    where: { tenantId_kind_slot: { tenantId, kind, slot } },
  })
  if (!row) return null
  return { ext: row.ext, contentType: row.contentType, data: Buffer.from(row.data) }
}

export async function deleteAsset(
  tenantId: string,
  kind: AssetKind,
  slot: string,
): Promise<void> {
  // deleteMany is a no-op (count 0) when the row is absent, so callers can
  // delete idempotently without catching a P2025.
  await prisma.uploadedAsset.deleteMany({ where: { tenantId, kind, slot } })
}

/** Derive the storage slot from a served filename ("logo.png" -> "logo"). */
export function slotFromFilename(filename: string): string {
  const base = path.basename(filename)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}
