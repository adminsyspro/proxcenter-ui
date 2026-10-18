'use client'

import { Box } from '@mui/material'

/** Pastille colour of a migration job: done, failed, cancelled or in flight. */
export function migrationPastilleColor(status: string): string {
  if (status === 'completed') return '#4caf50'
  if (status === 'failed') return '#f44336'
  if (status === 'cancelled') return '#ff9800'
  return '#2196f3'
}

/** The source VM's icon, as the inventory tree draws it for this hypervisor. */
export function sourceVmIcon(hostType?: string | null): string | null {
  return hostType === 'vmware' || hostType === 'vcenter' ? '/images/esxi-vm.svg' : null
}

/**
 * Source VM of a migration: the hypervisor's VM icon with the job's state as
 * the pastille, the same glyph as a guest anywhere else in the product.
 */
export default function MigrationVmGlyph({ hostType, status, size = 16 }: { hostType?: string | null; status: string; size?: number }) {
  const icon = sourceVmIcon(hostType)
  const color = migrationPastilleColor(status)
  return (
    <Box component="span" data-testid="migration-vm-glyph" data-status={status} sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, flexShrink: 0 }}>
      {icon
        ? <img src={icon} alt="" width={size - 2} height={size - 2} style={{ opacity: 0.8 }} />
        : <i className="ri-computer-line" style={{ fontSize: size - 2, opacity: 0.8 }} />}
      <Box component="span" sx={{ position: 'absolute', bottom: -2, right: -3, width: 7, height: 7, borderRadius: '50%', bgcolor: color, border: '1.5px solid', borderColor: 'background.paper' }} />
    </Box>
  )
}
