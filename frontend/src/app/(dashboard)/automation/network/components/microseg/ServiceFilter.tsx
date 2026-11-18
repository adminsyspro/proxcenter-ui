'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button, Checkbox, Menu, MenuItem, Typography } from '@mui/material'

import type { EdgeService } from './zoneGraph'

type Props = {
  /** The services the map carries. */
  services: readonly EdgeService[]
  /** The services not drawn (a service that appears later is drawn). */
  hidden: ReadonlySet<string>
  onHidden: (next: ReadonlySet<string>) => void
}

/**
 * The services the map draws: a button of the toolbar that opens the list of the services its edges carry, each with
 * its checkbox, under "All" (ticked, unticked, or in between). Nothing is kept between two visits: the list is what
 * the map carries now.
 */
export default function ServiceFilter({ services, hidden, onHidden }: Props) {
  const t = useTranslations('microsegPilot.overview.services')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const off = services.filter(s => hidden.has(s.token)).length
  const shown = services.length - off
  const toggle = (token: string) => {
    const next = new Set(hidden)
    if (!next.delete(token)) next.add(token)
    onHidden(next)
  }
  const toggleAll = () => onHidden(off === 0 ? new Set(services.map(s => s.token)) : new Set())

  return (
    <>
      <Button
        size='small'
        variant='outlined'
        color={off > 0 ? 'primary' : 'inherit'}
        startIcon={<i className='ri-filter-3-line' aria-hidden />}
        disabled={services.length === 0}
        aria-haspopup='menu'
        aria-expanded={anchor ? 'true' : undefined}
        onClick={e => setAnchor(e.currentTarget)}
        sx={{ flexShrink: 0, whiteSpace: 'nowrap', textTransform: 'none' }}
      >
        {off > 0 ? t('some', { shown, total: services.length }) : t('button')}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true, 'aria-label': t('button') }, paper: { sx: { maxHeight: 360 } } }}>
        <MenuItem onClick={toggleAll} sx={{ minHeight: 32, gap: 0.5 }}>
          <Checkbox size='small' edge='start' tabIndex={-1} disableRipple checked={off === 0} indeterminate={off > 0 && shown > 0} sx={{ p: 0.5 }} slotProps={{ input: { 'aria-label': t('all') } }} />
          <Typography variant='body2' fontWeight={600} noWrap>{t('all')}</Typography>
        </MenuItem>
        {services.map(s => (
          <MenuItem key={s.token} onClick={() => toggle(s.token)} sx={{ minHeight: 32, gap: 0.5 }}>
            <Checkbox size='small' edge='start' tabIndex={-1} disableRipple checked={!hidden.has(s.token)} sx={{ p: 0.5 }} slotProps={{ input: { 'aria-label': s.label } }} />
            <Typography variant='body2' noWrap>{s.label}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
