'use client'

import Box from '@mui/material/Box'

// Same palette as the dashboard's Guests per Node widget, so a guest or a node
// reads the same everywhere in the DRS page.
const GUEST_STATUS_COLORS: Record<string, string> = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }
const NODE_STATUS_COLORS: Record<string, string> = { online: '#4caf50', unknown: '#9e9e9e', maintenance: '#ff9800' }

export const guestStatusColor = (status?: string) => GUEST_STATUS_COLORS[status || ''] || '#616161'
export const nodeStatusColor = (status?: string) => (status ? NODE_STATUS_COLORS[status] || '#f44336' : '#9e9e9e')

/** Guest glyph: type icon with the status dot, as in every guest list of the product. */
export const GuestGlyph = ({ type, status, dotBorder }: { type?: string; status?: string; dotBorder: string }) => (
  <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <i className={type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
    <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: guestStatusColor(status), border: `1px solid ${dotBorder}` }} />
  </Box>
)

/** Node glyph: the Proxmox logo with the status dot, as on every node row of the product. */
export const NodeGlyph = ({ status, dark, dotBorder }: { status?: string; dark: boolean; dotBorder: string }) => (
  <Box component='span' sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
    <img src={dark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={14} height={14} style={{ opacity: 0.8 }} />
    <Box component='span' sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: nodeStatusColor(status), border: `1px solid ${dotBorder}` }} />
  </Box>
)
