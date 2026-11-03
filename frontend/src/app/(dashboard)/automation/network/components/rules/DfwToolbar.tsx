'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Button, Divider, Menu, MenuItem, Select, TextField, Tooltip, Typography, alpha, useTheme } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import { WriteTip } from '../microseg/microsegAccess'
import { SCOPE_FILTERS, type ScopeFilter } from './dfwModel'

const BAR_SX = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px', px: 1.75, py: 1, borderRadius: 2.5, border: 1, borderColor: 'divider', bgcolor: 'background.paper' } as const

type ViewToolbarProps = {
  subtitle: string
  publishedAt: string | null
  count: number
  busy: boolean
  canWrite: boolean
  refreshing: boolean
  onPublish: () => void
  onDiscard: () => void
  onRefresh: () => void
  menu: { label: string; onClick: () => void; disabled?: boolean; write?: boolean }[]
}

/** Title line: the connection, the last publish, and Publish (N), Discard changes, Refresh, More. */
export function ViewToolbar({ subtitle, publishedAt, count, busy, canWrite, refreshing, onPublish, onDiscard, onRefresh, menu }: ViewToolbarProps) {
  const t = useTranslations('microsegPilot.dfw')
  const tg = useTranslations()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const when = publishedAt ? new Date(publishedAt) : null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 24px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{tg('networkPage.tabFirewalling')}</Typography>
        <Typography noWrap sx={{ fontSize: 13, color: 'text.secondary' }}>{subtitle}</Typography>
      </Box>
      <Box sx={{ ml: 'auto', display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {when && !Number.isNaN(when.getTime()) && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('lastPublished', { date: when.toLocaleDateString(), time: when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</Typography>
        )}
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

type StatusBarProps = {
  /** What the last publish did, until the draft changes again. */
  summary?: string | null
  total: number
  totalPartial: boolean
  unpublished: number
  disabled: number
  sections: number
  managed: number
  covered: { covered: number; running: number } | null
  scope: ScopeFilter
  onScope: (scope: ScopeFilter) => void
}

const Sep = () => <Box component='span' aria-hidden sx={{ color: 'divider' }}>|</Box>

/** Rules total / unpublished / disabled · sections / managed · VMs covered · scope. */
export function StatusBar({ summary, total, totalPartial, unpublished, disabled, sections, managed, covered, scope, onScope }: StatusBarProps) {
  const t = useTranslations('microsegPilot.dfw')
  const theme = useTheme()
  return (
    <Box sx={{ ...BAR_SX, fontSize: 13 }} data-testid='dfw-status'>
      <Tooltip title={totalPartial ? t('status.rulesHint') : ''}>
        <span>{t(totalPartial ? 'status.rulesAtLeast' : 'status.rules', { count: total })}</span>
      </Tooltip>
      <span>{t('status.unpublished')} <Box component='strong' sx={{ color: unpublished > 0 ? theme.palette.warning.main : 'inherit' }}>{unpublished}</Box></span>
      <span>{t('status.disabled', { count: disabled })}</span>
      {summary && <Box component='span' data-testid='dfw-publish-summary' sx={{ color: 'text.secondary' }}>{summary}</Box>}
      <Sep />
      <span>{t('status.sections', { count: sections })}</span>
      <span>{t('status.managed', { count: managed })}</span>
      <Sep />
      <span>{covered ? t('status.covered', covered) : t('status.coveredUnknown')}</span>
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
        <span id='dfw-scope-label'>{t('status.scope')}</span>
        <Select size='small' value={scope} onChange={e => onScope(e.target.value as ScopeFilter)} sx={{ ...SMALL_SELECT_SX, fontSize: 13, minWidth: 110 }}
          inputProps={{ 'aria-labelledby': 'dfw-scope-label' }}>
          {SCOPE_FILTERS.map(s => <MenuItem key={s} value={s} sx={{ fontSize: 13 }}>{t(`scope.${s}`)}</MenuItem>)}
        </Select>
      </Box>
    </Box>
  )
}

type ActionBarProps = {
  selected: number
  canWrite: boolean
  canAddRule: boolean
  /** The selection sits in one section: Up and Down apply. */
  oneSection: boolean
  filter: string
  onFilter: (value: string) => void
  onAddRule: () => void
  onEnable: () => void
  onDisable: () => void
  onClone: () => void
  onUp: () => void
  onDown: () => void
  onMoveTo: () => void
  onDelete: () => void
  onClearSelection: () => void
}

/** Add rule (with a scope to pick), then what the checked rules can do, and the filter. */
export function ActionBar(p: ActionBarProps) {
  const t = useTranslations('microsegPilot.dfw')
  const tg = useTranslations()
  const theme = useTheme()
  const none = p.selected === 0
  const bulk = (label: string, onClick: () => void, icon: string, extra?: { disabled?: boolean; color?: 'error' }) => (
    <WriteTip key={label}>
      <Button size='small' color={extra?.color ?? 'inherit'} onClick={onClick} disabled={!p.canWrite || none || extra?.disabled}
        startIcon={<i className={icon} />} sx={{ textTransform: 'none', fontSize: 13 }}>
        {label}
      </Button>
    </WriteTip>
  )
  return (
    <Box sx={{ ...BAR_SX, gap: 0.5, py: 0.75 }} data-testid='dfw-actions'>
      <WriteTip>
        <Button size='small' onClick={p.onAddRule} disabled={!p.canWrite || !p.canAddRule} startIcon={<i className='ri-add-line' />} sx={{ textTransform: 'none', fontWeight: 600 }}>
          {tg('networkPage.addRule')}
        </Button>
      </WriteTip>
      <Divider orientation='vertical' flexItem sx={{ mx: 0.5 }} />
      {bulk(t('bulk.enable'), p.onEnable, 'ri-toggle-line')}
      {bulk(t('bulk.disable'), p.onDisable, 'ri-toggle-fill')}
      {bulk(t('bulk.clone'), p.onClone, 'ri-file-copy-line')}
      {bulk(t('bulk.up'), p.onUp, 'ri-arrow-up-line', { disabled: !p.oneSection })}
      {bulk(t('bulk.down'), p.onDown, 'ri-arrow-down-line', { disabled: !p.oneSection })}
      {bulk(t('bulk.moveTo'), p.onMoveTo, 'ri-folder-transfer-line')}
      {bulk(tg('common.delete'), p.onDelete, 'ri-delete-bin-line', { color: 'error' })}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {t('selection', { count: p.selected })} · {t('dragHint')}
        </Typography>
        {!none && <Button size='small' onClick={p.onClearSelection} sx={{ textTransform: 'none', fontSize: 12 }}>{t('clearSelection')}</Button>}
        <TextField size='small' value={p.filter} onChange={e => p.onFilter(e.target.value)} placeholder={t('filter')}
          inputProps={{ 'aria-label': t('filter') }}
          InputProps={{ startAdornment: <i className='ri-search-line' style={{ marginRight: 6, fontSize: 16, color: theme.palette.text.disabled }} />, sx: { fontSize: 13 } }}
          sx={{ width: 240, '& fieldset': { borderColor: alpha(theme.palette.divider, 0.6) } }} />
      </Box>
    </Box>
  )
}
