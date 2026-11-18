'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button, Menu, MenuItem, Radio, Typography } from '@mui/material'

import { SEEN_PERIODS, type SeenPeriod } from './zoneGraph'

type Props = { period: SeenPeriod; onPeriod: (next: SeenPeriod) => void }

/**
 * How far back the observed flows of the map go: a button of the toolbar that says the period ("Seen: any time" by
 * default, which is what the map holds: every pending flow since it was first seen) and opens the four choices.
 */
export default function SeenPeriodPicker({ period, onPeriod }: Props) {
  const t = useTranslations('microsegPilot.overview.seen')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const pick = (next: SeenPeriod) => {
    onPeriod(next)
    setAnchor(null)
  }

  return (
    <>
      <Button
        size='small'
        variant='outlined'
        color={period === 'all' ? 'inherit' : 'primary'}
        startIcon={<i className='ri-time-line' aria-hidden />}
        aria-haspopup='menu'
        aria-expanded={anchor ? 'true' : undefined}
        onClick={e => setAnchor(e.currentTarget)}
        sx={{ flexShrink: 0, whiteSpace: 'nowrap', textTransform: 'none' }}
      >
        {t('button', { period: t(`period.${period}`) })}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true, 'aria-label': t('title') } }}>
        {SEEN_PERIODS.map(p => (
          <MenuItem key={p} selected={p === period} onClick={() => pick(p)} sx={{ minHeight: 32, gap: 0.5 }}>
            <Radio size='small' edge='start' tabIndex={-1} disableRipple checked={p === period} sx={{ p: 0.5 }} slotProps={{ input: { 'aria-label': t(`period.${p}`) } }} />
            <Typography variant='body2' noWrap>{t(`period.${p}`)}</Typography>
          </MenuItem>
        ))}
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', px: 2, py: 0.5, maxWidth: 320 }}>{t('note')}</Typography>
      </Menu>
    </>
  )
}
