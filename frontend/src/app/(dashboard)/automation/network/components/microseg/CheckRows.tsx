'use client'

import { useState } from 'react'
import { Box, Button, Chip, CircularProgress, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { OneLine } from './dialogParts'
import PolicyPager, { usePaged } from './PolicyPager'
import { guestName } from './planGroups'
import type { CheckRow, CheckStatus, LoggedStep } from './checkModel'
import type { PolicyGuest } from './zoneModel'
import TruncatedText from './TruncatedText'

const STATUS_ICON: Record<Exclude<CheckStatus, 'pending'>, { icon: string; color: string }> = {
  pass: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  warn: { icon: 'ri-alert-fill', color: 'warning.main' },
  fail: { icon: 'ri-close-circle-fill', color: 'error.main' },
  info: { icon: 'ri-information-fill', color: 'info.main' },
}

/** The rows that say what happened without a figure. */
const NO_FIGURE = new Set(['truncated'])

function StatusGlyph({ status }: { status: CheckStatus }) {
  if (status === 'pending') return <CircularProgress size={18} sx={{ flexShrink: 0, mx: '1px' }} />
  const icon = STATUS_ICON[status]
  return <Box component='i' className={icon.icon} sx={{ color: icon.color, fontSize: 20, flexShrink: 0 }} />
}

type RowProps = { row: CheckRow; guests: PolicyGuest[]; onOpenDrifts: () => void }

/** One check on one line (glyph, name, figure); what it means and the items it is about under the chevron. */
function CheckLine({ row, guests, onOpenDrifts }: RowProps) {
  const t = useTranslations('microsegPilot.check')
  const tp = useTranslations('microsegPilot.policy')
  const [open, setOpen] = useState(false)
  const label = t(`rows.${row.id}.label`)
  const measured = row.status !== 'pending' && row.status !== 'info'
  const statusText = t(`status.${row.status}`)
  const figure = measured && !NO_FIGURE.has(row.id) ? t(`rows.${row.id}.figure`, row.values) : statusText
  const detail = t(`rows.${row.id}.${row.variant}`, row.values)
  const items = [...(row.guests ?? []).map(ref => `${guestName(guests, ref)} · ${ref.vmid} · ${ref.node}`), ...(row.lines ?? [])]

  return (
    <Box role='listitem' aria-label={`${label}: ${statusText}`} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 44, minWidth: 0 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <StatusGlyph status={row.status} />
        <TruncatedText text={label} fontWeight={600} sx={{ flex: '0 0 auto', width: 200 }} />
        <TruncatedText text={figure} color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
        {row.id === 'drifts' && row.status === 'warn' && (
          <Button size='small' variant='outlined' onClick={onOpenDrifts} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('rows.drifts.open')}</Button>
        )}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 7, pr: 1, pb: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <OneLine text={detail} />
          {items.map(item => <OneLine key={item} text={item} />)}
        </Box>
      </Collapse>
    </Box>
  )
}

/** The outcome of the check, one row per thing it looked at. */
export function CheckRowList({ rows, guests, onOpenDrifts }: { rows: CheckRow[] } & Omit<RowProps, 'row'>) {
  return (
    <Box role='list'>
      {rows.map(row => <CheckLine key={row.id} row={row} guests={guests} onOpenDrifts={onOpenDrifts} />)}
    </Box>
  )
}

const OUTCOME_COLOR: Record<LoggedStep['outcome'], 'success' | 'error' | 'default'> = { done: 'success', failed: 'error', notRun: 'default' }

export const LOG_PAGE_SIZE = 10

/** The steps of the run, one line each: what became of it, its kind, its target and its error. Paginated. */
export function CheckLog({ steps, guests }: { steps: LoggedStep[]; guests: PolicyGuest[] }) {
  const t = useTranslations('microsegPilot.check')
  const paged = usePaged(steps, LOG_PAGE_SIZE)

  if (steps.length === 0) return <OneLine text={t('logEmpty')} />

  return (
    <Box>
      <Box role='list' aria-label={t('log')}>
        {paged.rows.map(step => {
          const target = step.guest ? `${guestName(guests, step.guest)} · ${step.object}` : step.object
          const full = [step.kind, target, step.summary, step.error].filter(Boolean).join(' · ')
          return (
            <Tooltip key={step.index} title={full}>
              <Box role='listitem' sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
                <Chip size='small' variant='outlined' color={OUTCOME_COLOR[step.outcome]} label={t(`outcome.${step.outcome}`)} sx={{ flexShrink: 0 }} />
                <Typography noWrap variant='body2' fontWeight={600} sx={{ flex: '0 0 auto', width: 150 }}>{step.kind}</Typography>
                <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{target}</Typography>
                {step.error && <Typography noWrap variant='body2' color='error' sx={{ flex: '1 1 0', minWidth: 0 }}>{step.error}</Typography>}
              </Box>
            </Tooltip>
          )
        })}
      </Box>
      <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
    </Box>
  )
}
