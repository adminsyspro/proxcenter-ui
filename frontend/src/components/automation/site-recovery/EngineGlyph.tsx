import { Box } from '@mui/material'

import { storageTypeColor, storageTypeIcon } from '@/components/storage/StorageTypeIcon'
import type { StorageEngine } from '@/lib/orchestrator/site-recovery.types'

// Same vocabulary as the inventory and the deploy wizard: Ceph carries its
// product logo, every other storage type its glyph and colour from
// StorageTypeIcon, so ZFS looks the same here as in the storage views.
export default function EngineGlyph({ engine = 'rbd', size = 18 }: { engine?: StorageEngine; size?: number }) {
  return engine === 'zfs'
    ? <Box component='i' role='img' aria-label='ZFS' className={storageTypeIcon('zfspool')} sx={{ fontSize: size, width: size, height: size, color: storageTypeColor('zfspool'), flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} />
    : <Box component='img' src='/images/ceph-logo.svg' alt='Ceph RBD' sx={{ width: size, height: size, flexShrink: 0 }} />
}
