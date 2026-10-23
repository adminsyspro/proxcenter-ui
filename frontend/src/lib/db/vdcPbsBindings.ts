import { randomUUID } from 'crypto'

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret'

import { prisma } from './prisma'

export type PbsBindingMode = 'auto' | 'manual'

// vdc_pbs_namespaces.pbs_token_secret is the PBS sub-token secret minted for
// the vDC. It used to be stored in clear; it is now written through
// encryptSecret (AES-256-GCM under APP_SECRET, like every other credential in
// this database) with no schema change. Rows written before this carry the
// plaintext, so reads detect the encrypted shape and pass anything else
// through unchanged; a legacy row is re-encrypted the next time its token is
// written (updateBindingToken).

const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16

function isBase64(part: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(part) && part.length % 4 === 0
}

/**
 * True when `stored` has the exact shape encryptSecret produces: three base64
 * parts, a 12-byte IV and a 16-byte GCM tag. A PBS token secret is a UUID, so
 * a plaintext row can never match this by accident.
 */
export function isEncryptedPbsTokenSecret(stored: string): boolean {
  const parts = stored.split('.')
  if (parts.length !== 3 || !parts.every(p => p.length > 0 && isBase64(p))) return false
  return Buffer.from(parts[0], 'base64').length === GCM_IV_BYTES
    && Buffer.from(parts[1], 'base64').length === GCM_TAG_BYTES
}

/** What goes into the column: the secret encrypted, null kept as null. */
export function protectPbsTokenSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null
  return encryptSecret(plain)
}

/** What comes out of the column, in clear: decrypted, or a legacy plaintext as is. */
export function revealPbsTokenSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null
  return isEncryptedPbsTokenSecret(stored) ? decryptSecret(stored) : stored
}

export interface PbsBindingRow {
  id: string
  vdcId: string
  pbsConnectionId: string
  datastore: string
  namespace: string
  mode: PbsBindingMode
  pbsTokenId: string | null
  pbsTokenSecret: string | null
  createdAt: string
}

export interface PvePbsStorageRow {
  id: string
  bindingId: string
  pveConnectionId: string
  pveStorageName: string
  managed: boolean
  createdAt: string
}

function rowToBinding(r: any): PbsBindingRow {
  return {
    id: r.id,
    vdcId: r.vdcId,
    pbsConnectionId: r.pbsConnectionId,
    datastore: r.datastore,
    namespace: r.namespace,
    mode: (r.mode ?? 'auto') as PbsBindingMode,
    pbsTokenId: r.pbsTokenId ?? null,
    pbsTokenSecret: revealPbsTokenSecret(r.pbsTokenSecret),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }
}

function rowToStorage(r: any): PvePbsStorageRow {
  return {
    id: r.id,
    bindingId: r.vdcPbsNamespaceId,
    pveConnectionId: r.pveConnectionId,
    pveStorageName: r.pveStorageName,
    managed: !!r.managed,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }
}

export async function insertBinding(args: {
  vdcId: string; pbsConnectionId: string; datastore: string; namespace: string;
  mode: PbsBindingMode;
  pbsTokenId?: string | null; pbsTokenSecret?: string | null;
}): Promise<PbsBindingRow> {
  // A vDC PBS binding may only target a provider-pool PBS. An MSP tenant owns
  // its PBS connections wholly; letting a vDC bind to an MSP-owned PBS would
  // grant IaaS tenants namespace access to another tenant's dedicated server.
  const owner = await prisma.connection.findUnique({
    where: { id: args.pbsConnectionId },
    select: { tenantId: true, type: true },
  })
  if (!owner) throw new Error(`PBS connection ${args.pbsConnectionId} not found`)
  if (owner.tenantId !== 'default') {
    throw new Error(`PBS connection ${args.pbsConnectionId} is owned by tenant ${owner.tenantId}; vDC bindings can only target provider-pool PBS`)
  }

  const row = await prisma.vdcPbsNamespace.create({
    data: {
      id: randomUUID(),
      vdcId: args.vdcId,
      pbsConnectionId: args.pbsConnectionId,
      datastore: args.datastore,
      namespace: args.namespace,
      mode: args.mode,
      pbsTokenId: args.pbsTokenId ?? null,
      pbsTokenSecret: protectPbsTokenSecret(args.pbsTokenSecret),
    },
  })
  return rowToBinding(row)
}

export async function findBindingByTuple(pbsConnectionId: string, datastore: string, namespace: string): Promise<PbsBindingRow | null> {
  const row = await prisma.vdcPbsNamespace.findUnique({
    where: { pbsConnectionId_datastore_namespace: { pbsConnectionId, datastore, namespace } },
  })
  return row ? rowToBinding(row) : null
}

export async function listBindingsForVdc(vdcId: string): Promise<PbsBindingRow[]> {
  const rows = await prisma.vdcPbsNamespace.findMany({
    where: { vdcId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(rowToBinding)
}

export async function listBindingsForTenant(tenantId: string): Promise<PbsBindingRow[]> {
  const rows = await prisma.vdcPbsNamespace.findMany({
    where: { vdc: { tenantId, enabled: true } },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(rowToBinding)
}

export async function deleteBinding(id: string): Promise<void> {
  await prisma.vdcPbsNamespace.delete({ where: { id } })
}

/**
 * Complete a placeholder binding with the freshly minted PBS sub-token.
 * Throws (P2025) when the row no longer exists, e.g. the PBS connection was
 * deleted while provisioning: callers use that signal to roll back the
 * PBS-side artifacts they just created.
 */
export async function updateBindingToken(id: string, pbsTokenId: string, pbsTokenSecret: string): Promise<void> {
  await prisma.vdcPbsNamespace.update({
    where: { id },
    data: { pbsTokenId, pbsTokenSecret: protectPbsTokenSecret(pbsTokenSecret) },
  })
}

/** Rollback-safe delete: no error when the row is already gone. */
export async function deleteBindingIfExists(id: string): Promise<void> {
  await prisma.vdcPbsNamespace.deleteMany({ where: { id } })
}

export async function insertPveStorage(args: {
  bindingId: string; pveConnectionId: string; pveStorageName: string;
  managed?: boolean;
}): Promise<PvePbsStorageRow> {
  const row = await prisma.vdcPbsPveStorage.create({
    data: {
      id: randomUUID(),
      vdcPbsNamespaceId: args.bindingId,
      pveConnectionId: args.pveConnectionId,
      pveStorageName: args.pveStorageName,
      managed: args.managed ?? true,
    },
  })
  return rowToStorage(row)
}

export async function listPveStoragesForBinding(bindingId: string): Promise<PvePbsStorageRow[]> {
  const rows = await prisma.vdcPbsPveStorage.findMany({
    where: { vdcPbsNamespaceId: bindingId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(rowToStorage)
}

export async function deletePveStorage(id: string): Promise<void> {
  await prisma.vdcPbsPveStorage.delete({ where: { id } })
}
