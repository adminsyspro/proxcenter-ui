import type { SnapshotIdentity } from './site-recovery.types'

export function snapshotIdentity(snapshot: SnapshotIdentity): Required<SnapshotIdentity> {
  return {
    cluster_id: snapshot.cluster_id,
    storage_engine: snapshot.storage_engine || 'rbd',
    node: snapshot.storage_engine === 'zfs' ? snapshot.node || '' : '',
    pool: snapshot.pool,
    image: snapshot.image,
    snapshot: snapshot.snapshot,
  }
}

export function snapshotKey(snapshot: SnapshotIdentity): string {
  // JSON preserves component boundaries even when names contain separators.
  return JSON.stringify(Object.values(snapshotIdentity(snapshot)))
}
