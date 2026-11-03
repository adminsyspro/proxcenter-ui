'use client'

import { Fragment, useMemo } from 'react'
import { Box, Checkbox, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import { decodeCollapsed, encodeCollapsed, groupByDestination, maxHits, type ObservationGroup } from './observationModel'
import ObservationRow, { OBSERVATION_COLUMNS } from './ObservationRow'
import { useStored } from './useStoredChoice'

/** Where the collapsed destination zones of the table are kept in this browser. */
export const COLLAPSED_STORAGE_KEY = 'microseg.observation.collapsed'

const HEAD_SX = { py: 0.75, px: 1, whiteSpace: 'nowrap', fontWeight: 600 } as const
const VISUALLY_HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

type Props = {
  rows: MicrosegSuggestion[]
  zones: Map<string, MicrosegZone>
  selected: ReadonlySet<string>
  busy: boolean
  now: number
  /** The select-all box of the page: checked, partly checked, and whether there is anything to select. */
  allChecked: boolean
  someChecked: boolean
  canSelect: boolean
  onToggleAll: () => void
  onToggle: (id: string) => void
  onResolve: (s: MicrosegSuggestion, action: SuggestionAction) => void
  /** The destination zone of the first flow of the next page, when there is one: its group may go on there. */
  nextZoneId?: string
}

/** The header row of a destination zone: its name, flows and hits, and the chevron that folds its flows. */
function GroupHeader({ group, color, collapsed, onToggle }: { group: ObservationGroup<MicrosegSuggestion>; color: string; collapsed: boolean; onToggle: () => void }) {
  const t = useTranslations('microsegPilot.observation')
  return (
    <TableRow data-group={group.key} sx={{ bgcolor: 'action.hover' }}>
      <TableCell colSpan={OBSERVATION_COLUMNS} sx={{ py: 0.25, px: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <IconButton
            size='small'
            aria-expanded={!collapsed}
            aria-label={t(collapsed ? 'groupExpand' : 'groupCollapse', { zone: group.name })}
            onClick={onToggle}
          >
            <i className={collapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} />
          </IconButton>
          <Box component='span' sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
          <Typography noWrap variant='body2' fontWeight={600} sx={{ minWidth: 0 }}>
            {t('group', { zone: group.name, count: group.rows.length, hits: group.hits })}
          </Typography>
        </Box>
      </TableCell>
    </TableRow>
  )
}

/**
 * The observed flows of the page as a dense table, one row per flow, under a header row per destination zone (the
 * busiest first) that folds its flows; the folded zones are kept in this browser. The grouping covers the page only:
 * the caption says so when the next page goes on with a zone.
 */
export default function ObservationTable({ rows, zones, selected, busy, now, allChecked, someChecked, canSelect, onToggleAll, onToggle, onResolve, nextZoneId }: Props) {
  const t = useTranslations('microsegPilot.observation')
  const max = maxHits(rows)
  const [collapsedKeys, setCollapsedKeys] = useStored(COLLAPSED_STORAGE_KEY, decodeCollapsed, encodeCollapsed)
  const collapsed = useMemo(() => new Set(collapsedKeys), [collapsedKeys])

  const nameOf = (id: string) => (id ? zones.get(id)?.name ?? t('deletedZone') : t('unknownDestination'))
  const colorOf = (id: string) => (id ? zones.get(id)?.color || 'text.disabled' : 'error.main')
  const groups = groupByDestination(rows, nameOf)
  const toggleGroup = (key: string) => setCollapsedKeys(collapsed.has(key) ? collapsedKeys.filter(k => k !== key) : [...collapsedKeys, key])

  return (
    <>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size='small' aria-label={t('tableLabel')}>
          <TableHead>
            <TableRow>
              <TableCell padding='checkbox' sx={{ py: 0.5 }}>
                <Checkbox
                  size='small'
                  checked={allChecked}
                  indeterminate={someChecked && !allChecked}
                  disabled={!canSelect || busy}
                  onChange={onToggleAll}
                  slotProps={{ input: { 'aria-label': t('selectPage') } }}
                  sx={{ p: 0.5 }}
                />
              </TableCell>
              <TableCell sx={{ ...HEAD_SX, px: 0 }}><Box component='span' sx={VISUALLY_HIDDEN}>{t('columns.details')}</Box></TableCell>
              <TableCell sx={HEAD_SX}>{t('columns.source')}</TableCell>
              <TableCell sx={{ ...HEAD_SX, px: 0 }} aria-hidden />
              <TableCell sx={HEAD_SX}>{t('columns.destination')}</TableCell>
              <TableCell sx={HEAD_SX}>{t('columns.service')}</TableCell>
              <TableCell sx={HEAD_SX}>{t('columns.hits')}</TableCell>
              <TableCell sx={HEAD_SX}>{t('columns.lastSeen')}</TableCell>
              <TableCell sx={HEAD_SX}>{t('columns.status')}</TableCell>
              <TableCell sx={{ ...HEAD_SX, textAlign: 'right' }}>{t('columns.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map(group => (
              <Fragment key={group.key}>
                <GroupHeader group={group} color={colorOf(group.key)} collapsed={collapsed.has(group.key)} onToggle={() => toggleGroup(group.key)} />
                {!collapsed.has(group.key) && group.rows.map(s => (
                  <ObservationRow
                    key={s.id}
                    suggestion={s}
                    zones={zones}
                    checked={selected.has(s.id)}
                    busy={busy}
                    maxHits={max}
                    now={now}
                    onToggle={() => onToggle(s.id)}
                    onResolve={action => onResolve(s, action)}
                  />
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {nextZoneId !== undefined && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>
          {t('groupsContinue', { zone: nameOf(nextZoneId) })}
        </Typography>
      )}
    </>
  )
}
