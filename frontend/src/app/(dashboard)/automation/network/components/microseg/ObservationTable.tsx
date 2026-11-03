'use client'

import { Box, Checkbox, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import { maxHits } from './observationModel'
import ObservationRow from './ObservationRow'

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
}

/** The observed flows of the page as a dense table, one row per flow. */
export default function ObservationTable({ rows, zones, selected, busy, now, allChecked, someChecked, canSelect, onToggleAll, onToggle, onResolve }: Props) {
  const t = useTranslations('microsegPilot.observation')
  const max = maxHits(rows)

  return (
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
          {rows.map(s => (
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
        </TableBody>
      </Table>
    </TableContainer>
  )
}
