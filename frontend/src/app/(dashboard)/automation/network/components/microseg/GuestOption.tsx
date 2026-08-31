'use client'

import { Box } from '@mui/material'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { EastWestGuest } from '@/lib/firewall/eastWest'

/**
 * The inventory tree's VM status icon (glyph + overlaid status dot), sized for
 * the pickers' rows and chips, so the whole product shows guest state the same
 * way.
 */
export function GuestStatusIcon({ guest, size = 14 }: { guest: EastWestGuest; size?: number }) {
  return <StatusIcon type='vm' status={guest.status} vmType={guest.type} size={size} />
}

/**
 * Option row of the VM pickers: the guest's status icon then the label. Falls
 * back to the bare label for a value that is not a known guest (the dialog's
 * pickers accept free IP/CIDR text).
 */
export function GuestOptionRow({ guest, label }: { guest?: EastWestGuest; label: string }) {
  if (!guest) return <>{label}</>

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <GuestStatusIcon guest={guest} />
      <Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
        {label}
      </Box>
    </Box>
  )
}
