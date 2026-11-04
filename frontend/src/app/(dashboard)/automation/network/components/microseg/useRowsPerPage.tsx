'use client'

import { FormControl, MenuItem, Select } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import { useBoxSize } from './useBoxSize'
import { useStoredChoice } from './useStoredChoice'

export const ROWS_CHOICES = ['auto', '10', '25', '50'] as const
export type RowsChoice = (typeof ROWS_CHOICES)[number]

/** A small table row with a chip (px), and the head row above the rows. */
export const ROW_PX = 44
export const HEAD_PX = 40
/** Never fewer rows per page than this, whatever the height. */
export const MIN_ROWS = 10

/** The rows that fit in a box of `height` px under the head row, at least MIN_ROWS. */
export function rowsThatFit(height: number | null | undefined): number {
  if (!height || height <= HEAD_PX) return MIN_ROWS
  return Math.max(MIN_ROWS, Math.floor((height - HEAD_PX) / ROW_PX))
}

/**
 * The rows per page of a table that fills its sub-tab: "Auto" (the default) fits the height of the scroll box the
 * returned `ref` is put on, measured as it resizes; 10, 25 or 50 as chosen. The choice is remembered per browser.
 */
export function useRowsPerPage(storageKey: string) {
  const [choice, setChoice] = useStoredChoice<RowsChoice>(storageKey, ROWS_CHOICES, 'auto')
  const [ref, box] = useBoxSize<HTMLDivElement>()
  const size = choice === 'auto' ? rowsThatFit(box?.height) : Number(choice)
  return { ref, size, choice, setChoice }
}

/** The rows-per-page select next to a pager. */
export function RowsPerPageSelect({ choice, onChoice }: { choice: RowsChoice; onChoice: (next: RowsChoice) => void }) {
  const t = useTranslations('microsegPilot.policy.pager')
  return (
    <FormControl size='small' sx={{ minWidth: 92, flexShrink: 0 }}>
      <Select
        value={choice}
        onChange={e => onChoice(e.target.value as RowsChoice)}
        inputProps={{ 'aria-label': t('rowsPerPage') }}
        sx={{ ...SMALL_SELECT_SX, fontSize: 13 }}
      >
        {ROWS_CHOICES.map(c => <MenuItem key={c} value={c}>{c === 'auto' ? t('rowsAuto') : c}</MenuItem>)}
      </Select>
    </FormControl>
  )
}
