'use client'

import type { KeyboardEvent } from 'react'

import { Box, Typography, alpha, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import PagedRows from '@/components/ui/PagedRows'
import { GuestGlyph, NodeGlyph } from '@/components/ui/glyphs'
import { bridgeLabel } from '@/lib/proxmox/hostVlanMap'

import type { AttachedGuest } from '../networkSummary'

// Guest (takes what is left), node, interfaces, and the bridge when asked.
const COLUMNS = 'minmax(0, 1fr) 180px 140px'
const COLUMNS_WITH_BRIDGE = 'minmax(0, 1fr) 180px 140px 160px'

const CELL_SX = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

/** Enter or Space on a focused row acts like a click, as on a button. */
export const onActivateKey = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    action()
  }
}

/**
 * The guests attached to one network (a VNet, a host bridge, a VLAN), one line
 * each, paged past 20. A line opens its guest in the inventory.
 */
export default function AttachedGuestsList({
  guests, nodeStatus, onOpen, showBridge = false, aliases, testId,
}: Readonly<{
  guests: AttachedGuest[]
  /** Status of a node, by `connId:node`, for the dot on its logo. */
  nodeStatus: (connId: string, node: string) => string | undefined
  onOpen?: (guest: AttachedGuest) => void
  /** Adds the bridge column, for a VLAN whose guests sit on several bridges. */
  showBridge?: boolean
  aliases?: Record<string, string>
  testId?: string
}>) {
  const t = useTranslations('inventory.networkGuests')
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const columns = showBridge ? COLUMNS_WITH_BRIDGE : COLUMNS
  const headSx = { fontSize: 11, fontWeight: 700, opacity: 0.55 }

  return (
    <Box data-testid={testId} sx={{ pl: 4.5, pr: 1.5, pb: 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 2, px: 1, py: 0.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>
        <Typography sx={headSx}>{t('guest')}</Typography>
        <Typography sx={headSx}>{t('node')}</Typography>
        <Typography sx={headSx}>{t('interfaces')}</Typography>
        {showBridge && <Typography sx={headSx}>{t('bridge')}</Typography>}
      </Box>
      <PagedRows items={guests}>
        {guest => (
          <Box
            component='button'
            type='button'
            key={guest.key}
            data-testid='attached-guest-row'
            onClick={() => onOpen?.(guest)}
            sx={{
              display: 'grid', gridTemplateColumns: columns, columnGap: 2, alignItems: 'center', width: '100%',
              px: 1, py: 0.5, border: 0, borderRadius: 1, bgcolor: 'transparent', color: 'inherit',
              font: 'inherit', textAlign: 'left', cursor: 'pointer',
              '&:hover, &:focus-visible': { bgcolor: alpha(theme.palette.action.hover, 0.5), outline: 'none' },
            }}
          >
            <Box component='span' sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <GuestGlyph type={guest.type} status={guest.status} dotBorder={dotBorder} />
              <Typography component='span' variant='body2' sx={{ ...CELL_SX, fontSize: 12, fontWeight: 600 }}>{guest.name || guest.vmid}</Typography>
              <Typography component='span' variant='caption' sx={{ opacity: 0.45, flexShrink: 0 }}>#{guest.vmid}</Typography>
            </Box>
            <Box component='span' sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <NodeGlyph status={nodeStatus(guest.connId, guest.node)} dark={dark} dotBorder={dotBorder} />
              <Typography component='span' variant='body2' sx={{ ...CELL_SX, fontSize: 12 }}>{guest.node}</Typography>
            </Box>
            <Typography component='span' variant='body2' sx={{ ...CELL_SX, fontSize: 12, opacity: 0.7 }}>{guest.ifaces.join(', ') || '—'}</Typography>
            {showBridge && (
              <Typography component='span' variant='body2' sx={{ ...CELL_SX, fontSize: 12, opacity: 0.7 }}>
                {guest.bridges.map(b => bridgeLabel(aliases, b)).join(', ') || '—'}
              </Typography>
            )}
          </Box>
        )}
      </PagedRows>
    </Box>
  )
}
