'use client'

import { Fragment } from 'react'
import { Box, ButtonBase, Checkbox, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import { destinationKey, groupByDestination, maxHits, type ObservationGroup } from './observationModel'
import ObservationRow, { destinationName, OBSERVATION_COLUMNS } from './ObservationRow'

const HEAD_SX = { py: 0.75, px: 1, whiteSpace: 'nowrap', fontWeight: 600 } as const
const VISUALLY_HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

type Props = {
  rows: MicrosegSuggestion[]
  zones: Map<string, MicrosegZone>
  guestName: (ip: string) => string | undefined
  selected: ReadonlySet<string>
  busy: boolean
  now: number
  /** The select-all box of the page: checked, partly checked, and whether there is anything to select. */
  allChecked: boolean
  someChecked: boolean
  canSelect: boolean
  onToggleAll: () => void
  onToggle: (id: string) => void
  onResolve: (s: MicrosegSuggestion, action: SuggestionAction, prefixLen?: number) => void
  onOpenDetails: (s: MicrosegSuggestion) => void
  /** The first flow of the next page, when there is one: its destination group may go on there. */
  nextFlow?: MicrosegSuggestion
  /** The folded destinations (a zone id, or an address; '' = unknown destination), and the fold or unfold of one. */
  collapsed: ReadonlySet<string>
  onToggleGroup: (key: string) => void
}

/**
 * The header row of a destination zone: its name, flows and hits. The whole row is the button that folds its flows
 * (a disclosure: named by its text, aria-expanded, Enter and Space).
 */
function GroupHeader({ group, color, collapsed, onToggle }: { group: ObservationGroup<MicrosegSuggestion>; color: string; collapsed: boolean; onToggle: () => void }) {
  const t = useTranslations('microsegPilot.observation')
  return (
    <TableRow data-group={group.key} sx={{ bgcolor: 'action.hover' }}>
      <TableCell colSpan={OBSERVATION_COLUMNS} sx={{ p: 0 }}>
        <ButtonBase
          aria-expanded={!collapsed}
          onClick={onToggle}
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1, width: '100%', minWidth: 0, minHeight: 34, px: 1.5, textAlign: 'left', '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
        >
          <i aria-hidden className={collapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 18 }} />
          <Box component='span' aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
          <Typography component='span' noWrap variant='body2' fontWeight={600} sx={{ minWidth: 0 }}>
            {t('group', { zone: group.name, count: group.rows.length, hits: group.hits })}
          </Typography>
        </ButtonBase>
      </TableCell>
    </TableRow>
  )
}

/**
 * The observed flows of the page as a dense table, one row per flow, under a header row per destination zone (the
 * busiest first) that folds its flows (the panel keeps the folded zones). The grouping covers the page only:
 * the caption says so when the next page goes on with a zone.
 */
export default function ObservationTable({ rows, zones, guestName, selected, busy, now, allChecked, someChecked, canSelect, onToggleAll, onToggle, onResolve, onOpenDetails, nextFlow, collapsed, onToggleGroup }: Props) {
  const t = useTranslations('microsegPilot.observation')
  const max = maxHits(rows)

  // An outbound destination outside any zone is its guest or its address; an inbound one outside any zone is unknown.
  const nameOf = (_key: string, first: MicrosegSuggestion) => (first.dst_zone_id || first.direction === 'out'
    ? destinationName(first, zones, guestName, t as (key: string) => string)
    : t('unknownDestination'))
  const colorOf = (g: ObservationGroup<MicrosegSuggestion>) => (g.outside ? 'error.main' : zones.get(g.key)?.color || 'text.disabled')
  const groups = groupByDestination(rows, nameOf)

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
                <GroupHeader group={group} color={colorOf(group)} collapsed={collapsed.has(group.key)} onToggle={() => onToggleGroup(group.key)} />
                {!collapsed.has(group.key) && group.rows.map(s => (
                  <ObservationRow
                    key={s.id}
                    suggestion={s}
                    zones={zones}
                    guestName={guestName}
                    checked={selected.has(s.id)}
                    busy={busy}
                    maxHits={max}
                    now={now}
                    onToggle={() => onToggle(s.id)}
                    onResolve={(action, prefixLen) => onResolve(s, action, prefixLen)}
                    onOpenDetails={() => onOpenDetails(s)}
                  />
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {nextFlow !== undefined && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>
          {t('groupsContinue', { zone: nameOf(destinationKey(nextFlow), nextFlow) })}
        </Typography>
      )}
    </>
  )
}
