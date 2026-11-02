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

/** Node glyph: the Proxmox logo with the status dot, as on every node row of the product. `testId` tags the glyph (`<id>`, `<id>-logo`, `<id>-dot`) when a test must find it. */
export const NodeGlyph = ({ status, dark, dotBorder, size = 14, testId }: { status?: string; dark: boolean; dotBorder: string; size?: number; testId?: string }) => (
  <Box component='span' data-testid={testId} sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: size, height: size, flexShrink: 0 }}>
    <img data-testid={testId && `${testId}-logo`} src={dark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={size} height={size} style={{ opacity: 0.8 }} />
    <Box component='span' data-testid={testId && `${testId}-dot`} data-status={status} sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: nodeStatusColor(status), border: `1px solid ${dotBorder}` }} />
  </Box>
)

const OSD_STATE_COLORS = { upIn: '#4caf50', upOut: '#ff9800', down: '#f44336', unknown: '#616161' }

/** State of an OSD for its glyph: up and in, up and out, down, anything else unknown. */
export type OsdGlyphState = 'upIn' | 'upOut' | 'down' | 'unknown'

export const osdGlyphState = (osd?: { up?: boolean; in?: boolean }): OsdGlyphState =>
  !osd || typeof osd.up !== 'boolean' ? 'unknown' : !osd.up ? 'down' : osd.in === false ? 'upOut' : 'upIn'

/** Colour of the OSD dot: up and in green, up and out orange, down red, anything else grey. */
export const osdStatusColor = (osd?: { up?: boolean; in?: boolean }) => OSD_STATE_COLORS[osdGlyphState(osd)]

/** OSD glyph: the disk icon with the state dot, same geometry as the guest glyph. */
export const OsdGlyph = ({ osd, dotBorder, label }: { osd?: { up?: boolean; in?: boolean }; dotBorder: string; label?: string }) => (
  <Box component='span' data-testid='osd-glyph' role={label ? 'img' : undefined} aria-label={label} sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
    <i className='ri-hard-drive-2-line' style={{ fontSize: '0.9286rem', opacity: 0.8 }} aria-hidden />
    <Box component='span' data-testid='osd-glyph-dot' aria-hidden sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: osdStatusColor(osd), border: `1px solid ${dotBorder}` }} />
  </Box>
)
