'use client'

import { Box } from '@mui/material'
import { useTheme } from '@mui/material/styles'

import type { AvailabilityState, ObjectRef } from '@/lib/availability/types'

import { stateColor } from './stateColors'

/** The Proxmox logo, the glyph of a node everywhere in the product. */
export function ProxmoxLogo({ size = 14 }: Readonly<{ size?: number }>) {
  const theme = useTheme()

  return (
    <img
      src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
      alt=''
      width={size}
      height={size}
      style={{ opacity: 0.8, verticalAlign: 'text-bottom' }}
    />
  )
}

/** Icon value meaning the Proxmox logo, next to the Remix icon classes. */
export const PROXMOX = 'proxmox'

/** A Remix icon class, or the Proxmox logo for PROXMOX. */
export function GlyphIcon({ icon }: Readonly<{ icon: string }>) {
  return icon === PROXMOX ? <ProxmoxLogo /> : <i className={icon} aria-hidden='true' />
}

interface Props {
  kind: ObjectRef['kind']
  /** `lxc` for a container; a VM otherwise. */
  guestType?: string
  state: AvailabilityState
}

/**
 * The glyph at the head of a timeline row, as in every node or guest list of
 * the product (drs/glyphs): the Proxmox logo for a node, the server icon for
 * the cluster, the type icon for a guest, with the state dot of the legend.
 */
export default function RowGlyph({ kind, guestType, state }: Readonly<Props>) {
  const theme = useTheme()
  let iconClass = 'ri-computer-line'
  if (kind === 'cluster') iconClass = 'ri-server-line'
  else if (guestType === 'lxc') iconClass = 'ri-instance-line'

  return (
    <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {kind === 'node'
        ? <ProxmoxLogo />
        : <i className={iconClass} aria-hidden='true' style={{ fontSize: '0.9286rem', opacity: 0.8 }} />}
      <Box
        sx={{
          position: 'absolute',
          bottom: -1,
          right: -2,
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: state === 'absent' ? theme.palette.background.paper : stateColor(theme, state),
          border: `1px solid ${state === 'absent' ? theme.palette.divider : theme.palette.background.paper}`,
        }}
      />
    </Box>
  )
}
