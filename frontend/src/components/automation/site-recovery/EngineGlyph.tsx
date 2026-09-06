import { Box } from '@mui/material'

import type { StorageEngine } from '@/lib/orchestrator/site-recovery.types'

export default function EngineGlyph({ engine = 'rbd', size = 18 }: { engine?: StorageEngine; size?: number }) {
  return engine === 'zfs'
    ? <Box component='span' role='img' aria-label='ZFS' sx={{ width: size, height: size, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontWeight: 700, fontSize: size / 2 }}>ZFS</Box>
    : <Box component='img' src='/images/ceph-logo.svg' alt='Ceph RBD' sx={{ width: size, height: size, flexShrink: 0 }} />
}
