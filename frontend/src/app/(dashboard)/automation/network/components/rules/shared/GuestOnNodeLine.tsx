'use client'

import { Box, Typography } from '@mui/material'

import { NodeIcon, StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

type Props = {
  guest: { type: string; vmid: string | number; name: string; node: string }
  /** The guest's state for its dot (running, stopped...); grey when not known. */
  guestStatus?: string
  /** The node's state for its dot (online, offline...); grey when not known. */
  nodeStatus?: string
  /** Said after the node, such as the security group the line is about. */
  extra?: string
}

/**
 * A guest and the node it runs on, on one line, with the icons of the inventory tree that the other dialogs of this
 * page use: the guest's type icon with its state dot, its name and VMID, then the Proxmox logo with the node's dot.
 */
export default function GuestOnNodeLine({ guest, guestStatus, nodeStatus, extra }: Readonly<Props>) {
  // Same geometry as the other lines of a dialog: an 18 px icon column, then the text at the dialog's own size.
  const text = { fontSize: 'inherit', lineHeight: 'inherit' } as const

  return (
    <Box data-testid={`guest-line-${guest.type}-${guest.vmid}`} sx={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <Box sx={{ width: 18, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <StatusIcon type='vm' vmType={guest.type} status={guestStatus} />
        </Box>
        <Typography component='span' noWrap sx={{ ...text, minWidth: 0 }}>{guest.name}</Typography>
        <Typography component='span' sx={{ ...text, color: 'text.secondary', flexShrink: 0 }}>#{guest.vmid}</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
        <NodeIcon status={nodeStatus} size={16} />
        <Typography component='span' sx={{ ...text, color: 'text.secondary' }}>{guest.node}</Typography>
      </Box>
      {extra && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box component='i' className='ri-shield-check-line' aria-hidden sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
          <Typography component='span' noWrap sx={{ ...text, color: 'text.secondary', minWidth: 0 }}>{extra}</Typography>
        </Box>
      )}
    </Box>
  )
}
