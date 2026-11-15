'use client'

import { paletteAlpha } from '../paletteAlpha'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Button, Menu, MenuItem, Select, TextField, useTheme } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import { WriteTip } from '../microseg/microsegAccess'
import { SCOPE_FILTERS, type ScopeFilter } from './dfwModel'

type ViewToolbarProps = {
  count: number
  busy: boolean
  canWrite: boolean
  refreshing: boolean
  onPublish: () => void
  onDiscard: () => void
  onRefresh: () => void
  menu: { label: string; onClick: () => void; disabled?: boolean; write?: boolean }[]
  /** The sections shown: all, the cluster, the hosts or the guests. */
  scope: ScopeFilter
  onScope: (scope: ScopeFilter) => void
  filter: string
  onFilter: (value: string) => void
}

/** The scope shown and the filter of the rules, on the title line. */
function ViewFilters({ scope, onScope, filter, onFilter }: Pick<ViewToolbarProps, 'scope' | 'onScope' | 'filter' | 'onFilter'>) {
  const t = useTranslations('microsegPilot.dfw')
  const theme = useTheme()
  return (
    <>
      {/* No visible word: the values (All, Cluster, Hosts, Guests) say it; the name stays for screen readers. */}
      <Select size='small' value={scope} onChange={e => onScope(e.target.value as ScopeFilter)} SelectDisplayProps={{ 'aria-label': t('status.scope') }}
        sx={{ ...SMALL_SELECT_SX, fontSize: 13, minWidth: 110 }}>
        {SCOPE_FILTERS.map(s => <MenuItem key={s} value={s} sx={{ fontSize: 13 }}>{t(`scope.${s}`)}</MenuItem>)}
      </Select>
      <TextField size='small' value={filter} onChange={e => onFilter(e.target.value)} placeholder={t('filter')}
        inputProps={{ 'aria-label': t('filter') }}
        InputProps={{ startAdornment: <i className='ri-search-line' style={{ marginRight: 6, fontSize: 16, color: theme.palette.text.disabled }} />, sx: { fontSize: 13 } }}
        sx={{ width: 240, '& fieldset': { borderColor: paletteAlpha(theme, 'divider', 0.6) } }} />
    </>
  )
}

/**
 * The line above the table: the scope and the filter of the rules on the left; Publish (N), Discard changes, Refresh,
 * More on the right.
 */
export function ViewToolbar({ count, busy, canWrite, refreshing, onPublish, onDiscard, onRefresh, menu, scope, onScope, filter, onFilter }: ViewToolbarProps) {
  const t = useTranslations('microsegPilot.dfw')
  const tg = useTranslations()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 24px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <ViewFilters scope={scope} onScope={onScope} filter={filter} onFilter={onFilter} />
      </Box>
      <Box sx={{ ml: 'auto', display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <WriteTip>
          <Button variant='contained' size='small' onClick={onPublish} disabled={!canWrite || busy || count === 0}
            startIcon={<i className={busy ? 'ri-loader-4-line animate-spin' : 'ri-upload-cloud-2-line'} />}>
            {t('publish', { count })}
          </Button>
        </WriteTip>
        <Button variant='outlined' size='small' onClick={onDiscard} disabled={busy || count === 0}>{t('discard')}</Button>
        <Button variant='outlined' size='small' onClick={onRefresh} disabled={busy || refreshing} startIcon={<i className={`ri-refresh-line ${refreshing ? 'animate-spin' : ''}`} />}>
          {tg('networkPage.refresh')}
        </Button>
        <Button variant='outlined' size='small' onClick={e => setAnchor(e.currentTarget)} endIcon={<i className='ri-arrow-down-s-line' />} aria-haspopup='menu'>
          {tg('common.more')}
        </Button>
        <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
          {menu.map(item => (
            <MenuItem key={item.label} disabled={item.disabled || (item.write && !canWrite)} onClick={() => { setAnchor(null); item.onClick() }} sx={{ fontSize: 13 }}>
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      </Box>
    </Box>
  )
}
