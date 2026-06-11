import { randomUUID } from 'crypto'

import { prisma } from '@/lib/db/prisma'
import { decryptSecret } from '@/lib/crypto/secret'
import {
  ensureNamespacePath, ensureSubToken, setNamespaceAcl, setDatastoreAuditAcl, deleteSubToken,
  waitForPbsTokenReady,
} from '@/lib/proxmox/pbsNamespace'
import {
  createPbsStorage, deletePbsStorage, sanitizeStorageName,
} from '@/lib/proxmox/pvePbsStorage'
import { getConnectionById } from '@/lib/connections/getConnection'
import {
  insertBinding, insertPveStorage, deleteBinding, deletePveStorage,
  listPveStoragesForBinding, findBindingByTuple, updateBindingToken,
  deleteBindingIfExists, type PbsBindingRow,
} from '@/lib/db/vdcPbsBindings'
import { clearVdcScopeCache } from './scope'

interface BindAutoArgs {
  vdcId: string
  pbsConnectionId: string
  datastore: string
  namespace?: string
}

interface BindManualArgs {
  vdcId: string
  pbsConnectionId: string
  datastore: string
  namespace: string
  pveStorageName?: string
  pveConnectionId?: string
}

interface StepStatus {
  namespace: 'ok' | 'skipped' | 'failed'
  token: 'ok' | 'skipped' | 'failed'
  acl: 'ok' | 'skipped' | 'failed'
  pveStorages: Array<{ pveConnectionId: string; name: string; status: 'ok' | 'skipped' | 'failed'; error?: string }>
}

interface ManualStepStatus {
  mode: 'manual'
  pveStorage: 'ok' | 'skipped'
}

const locks = new Map<string, Promise<any>>()
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  let resolve: () => void = () => {}
  const next = new Promise<void>(r => { resolve = r })
  locks.set(key, prev.then(() => next))
  try { return await prev.then(fn) }
  finally { resolve(); if (locks.get(key) === next) locks.delete(key) }
}

function parsePbsUser(apiToken: string): string {
  const m = apiToken.match(/^([^!]+)!/)
  if (!m) throw new Error('Unexpected PBS root token format; expected user@realm!tokenid:secret')
  return m[1]
}

async function resolvePbsMeta(pbsConnectionId: string): Promise<{
  conn: { baseUrl: string; apiToken: string; insecureDev: boolean }
  host: string
  fingerprint: string
  rootUser: string
}> {
  const row = await prisma.connection.findUnique({
    where: { id: pbsConnectionId },
    select: { baseUrl: true, fingerprint: true, apiTokenEnc: true, insecureTLS: true, type: true },
  })
  if (!row || row.type !== 'pbs') throw new Error(`PBS connection not found: ${pbsConnectionId}`)
  if (!row.fingerprint) throw new Error('PBS fingerprint missing — capture it on the connection first')

  const apiToken = decryptSecret(row.apiTokenEnc)
  const host = row.baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')

  return {
    conn: { baseUrl: row.baseUrl, apiToken, insecureDev: !!row.insecureTLS },
    host,
    fingerprint: row.fingerprint,
    rootUser: parsePbsUser(apiToken),
  }
}

async function readVdcAndTenant(vdcId: string) {
  const vdc = await prisma.vdc.findUnique({ where: { id: vdcId } })
  if (!vdc) throw new Error(`vDC not found: ${vdcId}`)
  const tenant = await prisma.tenant.findUnique({ where: { id: vdc.tenantId } })
  if (!tenant) throw new Error(`tenant not found: ${vdc.tenantId}`)
  return { vdc, tenant }
}

async function readVdcNodeNames(vdcId: string): Promise<string[]> {
  const rows = await prisma.vdcNode.findMany({ where: { vdcId }, select: { nodeName: true } })
  return rows.map(r => r.nodeName)
}

async function appendVdcStorage(vdcId: string, storageId: string): Promise<void> {
  // Mirror the SQLite `INSERT OR IGNORE` semantic: skip if the (vdcId,
  // storageId) row already exists thanks to the @@unique constraint.
  await prisma.vdcStorage.upsert({
    where: { vdcId_storageId: { vdcId, storageId } },
    update: {},
    create: { id: randomUUID(), vdcId, storageId },
  })
}

async function removeVdcStorage(vdcId: string, storageId: string): Promise<void> {
  await prisma.vdcStorage.deleteMany({ where: { vdcId, storageId } })
}

export async function bindPbsToVdc(args: BindAutoArgs): Promise<{ binding: PbsBindingRow; steps: StepStatus }> {
  const lockKey = `${args.vdcId}|${args.pbsConnectionId}|${args.datastore}|${args.namespace ?? ''}`
  return withLock(lockKey, async () => {
    const { vdc, tenant } = await readVdcAndTenant(args.vdcId)
    const namespace = args.namespace ?? `tenant-${tenant.slug}/vdc-${vdc.slug}`
    const pbs = await resolvePbsMeta(args.pbsConnectionId)

    const steps: StepStatus = { namespace: 'skipped', token: 'skipped', acl: 'skipped', pveStorages: [] }

    // Pre-check: if a binding on this tuple already exists, fail BEFORE touching
    // PBS. Otherwise ensureSubToken would rotate the PBS secret and leave the DB
    // with the stale one, breaking future auth.
    const existing = await findBindingByTuple(args.pbsConnectionId, args.datastore, namespace)
    if (existing) {
      throw new Error(`Binding already exists (${existing.datastore}/${existing.namespace}). Delete it first if you want to recreate.`)
    }

    // Record the binding BEFORE provisioning anything on the PBS. insertBinding
    // validates pool ownership and the DB insert-trigger re-checks it under the
    // per-connection advisory lock, so from this point a concurrent
    // owner-reassign is rejected and a concurrent connection-delete sees the
    // row and routes it through unbindFromVdc: no orphan PBS artifacts either
    // way. Token fields start null (like a manual binding, which every consumer
    // already tolerates) and are completed after provisioning; any failure
    // rolls back the placeholder row and the PBS artifacts below.
    const binding = await insertBinding({
      vdcId: args.vdcId,
      pbsConnectionId: args.pbsConnectionId,
      datastore: args.datastore,
      namespace,
      mode: 'auto',
      pbsTokenId: null,
      pbsTokenSecret: null,
    })

    const tokenShortId = `vdc-${args.vdcId.slice(0, 8)}`
    // Only roll the sub-token back when WE obtained a fresh secret: the token
    // id is per-vDC and may pre-exist for a sibling binding of the same vDC.
    let freshSecretMinted = false
    let effectiveTokenId: string
    let effectiveSecret: string

    try {
      await ensureNamespacePath(pbs.conn, args.datastore, namespace)
      steps.namespace = 'ok'

      let tokenResult = await ensureSubToken(pbs.conn, pbs.rootUser, tokenShortId)
      if (!tokenResult.secret) {
        await deleteSubToken(pbs.conn, pbs.rootUser, tokenShortId)
        tokenResult = await ensureSubToken(pbs.conn, pbs.rootUser, tokenShortId)
        if (!tokenResult.secret) throw new Error('Failed to mint sub-token (no secret)')
      }
      freshSecretMinted = true
      steps.token = 'ok'
      effectiveTokenId = tokenResult.tokenId
      effectiveSecret = tokenResult.secret

      await setNamespaceAcl(pbs.conn, args.datastore, namespace, effectiveTokenId)
      await setDatastoreAuditAcl(pbs.conn, args.datastore, effectiveTokenId)
      steps.acl = 'ok'

      // Wait for PBS to propagate the just-set ACLs to the point where the
      // sub-token's own /admin/datastore/{store}/status returns 200. That's the
      // same call PVE's pbs: storage probe ends up making, so once it's green
      // here the POST /storage probe will be too. Empirically takes 3-5s.
      await waitForPbsTokenReady(pbs.conn, args.datastore, effectiveTokenId, effectiveSecret)

      // Complete the placeholder row. Throws (P2025) when the row vanished,
      // i.e. the PBS connection was deleted while we were provisioning: the
      // rollback below then removes the freshly minted PBS artifacts.
      await updateBindingToken(binding.id, effectiveTokenId, effectiveSecret)
    } catch (e) {
      try { await deleteBindingIfExists(binding.id) } catch { /* best-effort */ }
      if (freshSecretMinted) {
        try {
          // The token id is per-vDC: when a SIBLING binding of the same vDC
          // still references it, leave the token alone. (Its secret was
          // already rotated by ensureSubToken, a pre-existing quirk of the
          // shared-token design, but revoking it entirely would be worse.)
          const sibling = await prisma.vdcPbsNamespace.findFirst({
            // Same token on the SAME PBS server only: the same vDC bound to
            // another PBS yields the same token id string there, which must
            // not suppress cleanup on the server that just failed. A
            // concurrent auto bind of the same vDC still provisioning counts
            // too: its placeholder row has null token fields but shares the
            // per-vDC token (our own placeholder is already deleted above).
            // Accepted residual: if that concurrent bind ALSO fails before
            // minting, the token stays unreferenced on the PBS until the next
            // bind of this vDC reclaims the same tokenShortId.
            where: {
              pbsConnectionId: args.pbsConnectionId,
              OR: [
                { pbsTokenId: effectiveTokenId },
                { vdcId: args.vdcId, pbsTokenId: null, mode: 'auto' },
              ],
            },
            select: { id: true },
          })
          if (!sibling) await deleteSubToken(pbs.conn, pbs.rootUser, tokenShortId)
        } catch { /* best-effort */ }
      }
      // The namespace is intentionally left in place: it may have pre-existed
      // with data, and unbindFromVdc keeps namespaces too.
      throw e
    }

    const pveConnId = vdc.connectionId
    const pveConn = await getConnectionById(pveConnId, tenant.id)
    const storageName = sanitizeStorageName(tenant.slug, vdc.slug)
    const nodes = await readVdcNodeNames(args.vdcId)
    try {
      await createPbsStorage(pveConn, {
        storage: storageName,
        server: pbs.host,
        datastore: args.datastore,
        namespace,
        username: effectiveTokenId,
        password: effectiveSecret,
        fingerprint: pbs.fingerprint,
        nodes,
      })
      await insertPveStorage({ bindingId: binding.id, pveConnectionId: pveConnId, pveStorageName: storageName, managed: true })
      await appendVdcStorage(args.vdcId, storageName)
      steps.pveStorages.push({ pveConnectionId: pveConnId, name: storageName, status: 'ok' })
    } catch (e: any) {
      steps.pveStorages.push({ pveConnectionId: pveConnId, name: storageName, status: 'failed', error: String(e?.message ?? e) })
    }

    clearVdcScopeCache(tenant.id)
    // Reflect the completed token in the returned row (the placeholder was
    // inserted with null token fields).
    return {
      binding: { ...binding, pbsTokenId: effectiveTokenId, pbsTokenSecret: effectiveSecret },
      steps,
    }
  })
}

export async function bindPbsToVdcManual(args: BindManualArgs): Promise<{ binding: PbsBindingRow; steps: ManualStepStatus }> {
  if (!args.namespace) throw new Error('namespace is required in manual mode')
  const lockKey = `${args.vdcId}|${args.pbsConnectionId}|${args.datastore}|${args.namespace}`
  return withLock(lockKey, async () => {
    const { vdc, tenant } = await readVdcAndTenant(args.vdcId)

    const row = await prisma.connection.findUnique({
      where: { id: args.pbsConnectionId },
      select: { type: true },
    })
    if (!row || row.type !== 'pbs') throw new Error(`PBS connection not found: ${args.pbsConnectionId}`)

    const binding = await insertBinding({
      vdcId: args.vdcId,
      pbsConnectionId: args.pbsConnectionId,
      datastore: args.datastore,
      namespace: args.namespace,
      mode: 'manual',
      pbsTokenId: null,
      pbsTokenSecret: null,
    })

    const steps: ManualStepStatus = { mode: 'manual', pveStorage: 'skipped' }
    if (args.pveStorageName) {
      const pveConnId = args.pveConnectionId ?? vdc.connectionId
      await insertPveStorage({
        bindingId: binding.id,
        pveConnectionId: pveConnId,
        pveStorageName: args.pveStorageName,
        managed: false,
      })
      await appendVdcStorage(args.vdcId, args.pveStorageName)
      steps.pveStorage = 'ok'
    }

    clearVdcScopeCache(tenant.id)
    return { binding, steps }
  })
}

export async function unbindFromVdc(bindingId: string): Promise<void> {
  const row = await prisma.vdcPbsNamespace.findUnique({ where: { id: bindingId } })
  if (!row) return

  const { tenant } = await readVdcAndTenant(row.vdcId)
  const mode: 'auto' | 'manual' = (row.mode as 'auto' | 'manual') ?? 'auto'

  for (const s of await listPveStoragesForBinding(bindingId)) {
    if (s.managed) {
      try {
        const pveConn = await getConnectionById(s.pveConnectionId, tenant.id)
        await deletePbsStorage(pveConn, s.pveStorageName)
      } catch { /* already gone */ }
    }
    await removeVdcStorage(row.vdcId, s.pveStorageName)
    await deletePveStorage(s.id)
  }

  if (mode === 'auto' && row.pbsTokenId) {
    try {
      const pbs = await resolvePbsMeta(row.pbsConnectionId)
      const tokenShortId = String(row.pbsTokenId).split('!')[1] ?? `vdc-${row.vdcId.slice(0, 8)}`
      await deleteSubToken(pbs.conn, pbs.rootUser, tokenShortId)
    } catch (e) {
      console.error(`[pbs-unbind] token revoke failed for ${bindingId}:`, e)
    }
  }

  await deleteBinding(bindingId)
  clearVdcScopeCache(tenant.id)
}
