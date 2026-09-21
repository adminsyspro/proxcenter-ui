import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { isSharedStorage } from '@/lib/proxmox/storage'
import { buildVmResourceId, checkPermission, PERMISSIONS } from '@/lib/rbac'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { isLibraryOnlyStorage, loadTenantSlugs, resolveUploadOwner } from '@/lib/vdc/scope'

export class SourceVolumeError extends Error {
  constructor(message: string, public readonly status = 403) { super(message) }
}

export interface ImageVolumeSource {
  volumeId?: string | null
  sourceConnectionId?: string | null
  sourceNode?: string | null
  format?: string
  tenantId?: string
  isShared?: boolean
}

/** Validate the exact source, never the caller's declared destination storage.
 * A locator is required: identical PVE volume names can refer to different
 * disks on different clusters, or on two nodes' local storage. Old rows need
 * their owner to select the source again; we cannot infer that origin safely.
 * `publishedImage` is a server-resolved catalogue row, never request data.
 */
export async function authorizeImageVolume(args: {
  tenantId: string
  source: ImageVolumeSource
  target?: { connectionId: string; node: string }
  publishedImage?: ImageVolumeSource
}): Promise<void> {
  const { tenantId, source, target, publishedImage } = args
  const { volumeId, sourceConnectionId, sourceNode } = source
  if (!sourceConnectionId || !sourceNode) {
    throw new SourceVolumeError('Edit this image and select its source cluster and node before using it.', 409)
  }
  // Volume IDs are interpolated into PVE property strings (import-from and
  // ide2). Reject option injection, paths and ambiguous encoded separators.
  // Storage ids may carry dots (pve-storage-id, STORAGE_ID_RE in lib/vdc) and
  // ISO names spaces, parentheses and '+'. Only the property separators
  // (',', '=', ';', a second ':') and path tricks are refused.
  if (!volumeId || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}:[A-Za-z0-9_./+@ ()-]+$/.test(volumeId)
    || volumeId.split(':')[1].split('/').some(part => !part || part === '.' || part === '..')) {
    throw new SourceVolumeError('Invalid source volume ID.', 400)
  }
  if (target && target.connectionId !== sourceConnectionId) {
    throw new SourceVolumeError('This image belongs to another cluster. Select its source cluster for deployment.', 400)
  }
  const storage = volumeId.split(':')[0]
  // Publishing is an explicit provider grant to this exact, bound source. The
  // provider's golden image legitimately sits on storage and nodes outside the
  // tenant's vDC (#971), so the scope gates below do not apply to it. A tenant
  // cannot manufacture this exception with isShared in a request:
  // `publishedImage` is always a server-resolved catalogue row.
  const published = publishedImage?.tenantId === DEFAULT_TENANT_ID && !!publishedImage.isShared
    && publishedImage.volumeId === volumeId
    && publishedImage.sourceConnectionId === sourceConnectionId
    && publishedImage.sourceNode === sourceNode
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
  const scope = infra.kind === 'iaas' ? infra.vdcScope : null
  if (!published && infra.kind === 'msp' && !infra.connectionIds.has(sourceConnectionId)) {
    throw new SourceVolumeError('Source volume not accessible.')
  }
  if (!published && infra.kind === 'iaas' && (!scope
    || !scope.connectionIds.has(sourceConnectionId)
    || !scope.nodesByConnection.get(sourceConnectionId)?.has(sourceNode)
    || !scope.storagesByConnection.get(sourceConnectionId)?.has(storage))) {
    throw new SourceVolumeError('Source volume not accessible.')
  }

  const conn = await getConnectionById(sourceConnectionId).catch((error: unknown) => {
    if (error instanceof Error && /not found/i.test(error.message)) {
      throw new SourceVolumeError('Source cluster not found.', 404)
    }
    throw error
  })
  if (target && target.node !== sourceNode) {
    const config = await pveFetch<any>(conn, `/storage/${encodeURIComponent(storage)}`)
    // A shared storage can still be restricted to some nodes (`nodes=`).
    const nodes = typeof config?.nodes === 'string' && config.nodes ? config.nodes.split(',') : null
    if (!isSharedStorage(config) || (nodes && !nodes.includes(target.node))) {
      throw new SourceVolumeError('This image is not reachable from the target node. Deploy it on its source node.', 400)
    }
  }
  // Look up the actual content type and owning VMID from PVE. A guessed
  // vm-<id> name is neither proof of ownership nor proof a volume exists.
  const node = target?.node ?? sourceNode
  const content = await pveFetch<any[]>(conn,
    `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
    {}, { timeoutMs: 30_000 })
  const volume = Array.isArray(content) ? content.find(item => item.volid === volumeId) : null
  if (!volume) throw new SourceVolumeError('Source volume not accessible.')
  const kind = volume.content
  if (source.format === 'iso' ? kind !== 'iso' : !['images', 'import'].includes(kind)) {
    throw new SourceVolumeError('Source volume does not match the image format.', 400)
  }
  // A published golden image commonly sits on the provider's `local:import/`,
  // which a vDC may also hold as its ISO library: the provider's grant covers
  // the disk source, the library rule only restricts the tenant's own images.
  if (published) return
  if (scope && isLibraryOnlyStorage(scope, sourceConnectionId, storage) && kind !== 'iso') {
    throw new SourceVolumeError('An ISO library cannot be used as a source of VM disks.')
  }

  if (kind === 'images') {
    const vmid = Number(volume.vmid)
    if (!Number.isSafeInteger(vmid) || vmid <= 0) throw new SourceVolumeError('Source volume not accessible.')
    const guests = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')
    const guest = Array.isArray(guests) ? guests.find(item => Number(item.vmid) === vmid && item.type === 'qemu') : null
    if (!guest || (scope && (!scope.poolsByConnection.get(sourceConnectionId)?.has(guest.pool)
      || !scope.nodesByConnection.get(sourceConnectionId)?.has(guest.node)))) {
      throw new SourceVolumeError('Source volume not accessible.')
    }
    const denied = await checkPermission(PERMISSIONS.VM_CLONE, 'vm',
      buildVmResourceId(sourceConnectionId, guest.node, 'qemu', String(vmid)))
    if (denied) throw new SourceVolumeError('Cloning this source VM is not permitted.')
    return
  }

  if (!scope) return
  const slugs = await loadTenantSlugs(tenantId)
  const owner = resolveUploadOwner(volumeId.split('/').pop() ?? '', slugs.all)
  if (owner.kind === 'tenant' && owner.slug === slugs.mine) return
  if (owner.kind === 'provider') {
    // An unprefixed name is the provider catalogue on an ISO library, and the
    // tenant's own upload on a storage it writes to: tenantUploadFilename only
    // namespaces files on libraries, never on the vDC's own storage.
    if (kind === 'iso' && scope.isoLibrariesByConnection.get(sourceConnectionId)?.has(storage)) return
    if (scope.writableStoragesByConnection?.get(sourceConnectionId)?.has(storage)) return
  }
  throw new SourceVolumeError('Source volume not accessible.')
}
