'use client'

import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { useTranslations } from 'next-intl'

import { Box, Collapse, Typography } from '@mui/material'

import { useDescribeFormat, useFactLabel } from '@/components/changes/FactLine'
import { describeGrouped } from '@/lib/changes/describe'
import type { DiffFact, FactGroup } from '@/lib/changes/describe'
import type { ChangeFieldDiff } from '@/lib/changes/csv'

const GROUP_ICONS: Record<FactGroup, string> = {
  general: 'ri-information-line',
  compute: 'ri-cpu-line',
  disks: 'ri-hard-drive-2-line',
  network: 'ri-router-line',
  cloudinit: 'ri-cloud-line',
  snapshots: 'ri-camera-line',
  other: 'ri-settings-3-line'
}

/** One raw Proxmox config line, old struck through above new. */
export function FieldDiff({ field }: { field: { field?: string; oldValue?: string | null; newValue?: string | null } }) {
  return (
    <Box sx={{ py: 0.5 }}>
      <Typography
        variant='caption'
        sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, opacity: 0.8, display: 'block', mb: 0.25 }}
      >
        {field.field}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
        {field.oldValue && (
          <Box sx={{
            px: 1, py: 0.25, borderRadius: 0.5,
            bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(244,67,54,0.15)' : 'rgba(244,67,54,0.1)',
            color: theme => theme.palette.mode === 'dark' ? '#ef9a9a' : '#c62828',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
            textDecoration: 'line-through', wordBreak: 'break-all', whiteSpace: 'pre-wrap'
          }}>
            {field.oldValue}
          </Box>
        )}
        {field.newValue && (
          <Box sx={{
            px: 1, py: 0.25, borderRadius: 0.5,
            bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(76,175,80,0.15)' : 'rgba(76,175,80,0.1)',
            color: theme => theme.palette.mode === 'dark' ? '#a5d6a7' : '#2e7d32',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem',
            wordBreak: 'break-all', whiteSpace: 'pre-wrap'
          }}>
            {field.newValue}
          </Box>
        )}
      </Box>
    </Box>
  )
}

const VALUE_SX = { fontSize: '0.8125rem', wordBreak: 'break-word' } as const

interface ChangeDetailsProps {
  fields?: ChangeFieldDiff[]
  /** The raw config lines a click away under the table */
  showRaw?: boolean
  /**
   * `diff` reads before → after; a created guest reads its config as it came
   * (`after`), a deleted one as it was (`before`), one value per line
   */
  side?: 'diff' | 'before' | 'after'
}

/**
 * A change's details as a before / after table, one section per part of the
 * guest (general, CPU and memory, disks, network...), the raw config lines
 * folded underneath.
 */
export default function ChangeDetails({ fields, showRaw = true, side = 'diff' }: ChangeDetailsProps) {
  const t = useTranslations()
  const fmt = useDescribeFormat()
  const name = useFactLabel()
  const { recreated, groups } = useMemo(() => describeGrouped(fields, fmt), [fields, fmt])
  const [rawOpen, setRawOpen] = useState(false)
  const raw = fields || []

  const dash = <Typography sx={{ ...VALUE_SX, opacity: 0.35 }}>-</Typography>

  const cells = (f: DiffFact): [ReactNode, ReactNode] | ReactNode => {
    switch (f.kind) {
      case 'recreated':
        return null
      case 'changed':
        return [
          <Typography key='a' sx={{ ...VALUE_SX, opacity: 0.7 }}>{f.from}</Typography>,
          <Typography key='b' sx={{ ...VALUE_SX, fontWeight: 600 }}>{f.to}</Typography>
        ]
      case 'added':
        return [
          dash,
          <Typography key='b' sx={{ ...VALUE_SX, fontWeight: 600 }}>
            <Box component='span' sx={{ color: 'success.main', fontWeight: 700, mr: 0.5 }}>+</Box>
            {f.value ?? t('changes.diff.addedWord')}
          </Typography>
        ]
      case 'removed':
        return [
          f.value
            ? <Typography key='a' sx={{ ...VALUE_SX, opacity: 0.7, textDecoration: 'line-through' }}>{f.value}</Typography>
            : dash,
          <Typography key='b' sx={{ ...VALUE_SX, fontWeight: 600 }}>
            <Box component='span' sx={{ color: 'error.main', fontWeight: 700, mr: 0.5 }}>−</Box>
            {t('changes.diff.removedWord')}
          </Typography>
        ]
      case 'toggled':
        return [
          <Typography key='a' sx={{ ...VALUE_SX, opacity: 0.7 }}>{t(f.on ? 'changes.diff.off' : 'changes.diff.on')}</Typography>,
          <Typography key='b' sx={{ ...VALUE_SX, fontWeight: 600 }}>{t(f.on ? 'changes.diff.on' : 'changes.diff.off')}</Typography>
        ]
      case 'modified':
        return (
          <Typography sx={{ ...VALUE_SX, gridColumn: '2 / -1', opacity: 0.6, fontStyle: 'italic' }}>
            {t('changes.diff.modifiedWord')}
          </Typography>
        )
    }
  }

  // One side of a fact, for a creation or a deletion
  const state = (f: DiffFact): string => {
    switch (f.kind) {
      case 'changed': return side === 'after' ? f.to : f.from
      case 'added':
      case 'removed': return f.value ?? t('changes.diff.setWord')
      case 'toggled': return t((side === 'after') === f.on ? 'changes.diff.on' : 'changes.diff.off')
      default: return t('changes.diff.setWord')
    }
  }

  const row = (f: DiffFact) => {
    if (!('label' in f)) return null

    if (side !== 'diff') {
      return (
        <>
          <Typography variant='caption' sx={{ opacity: 0.75, pl: 2.75, minWidth: 140 }}>{name(f.label)}</Typography>
          <Typography sx={{ ...VALUE_SX, fontWeight: 600 }}>{state(f)}</Typography>
        </>
      )
    }

    const value = cells(f)

    if (value === null) return null

    return (
      <>
        <Typography variant='caption' sx={{ opacity: 0.75, pl: 2.75, minWidth: 140 }}>{name(f.label)}</Typography>
        {Array.isArray(value)
          ? (
            <>
              {value[0]}
              <Typography sx={{ ...VALUE_SX, opacity: 0.35, textAlign: 'center' }}>→</Typography>
              {value[1]}
            </>
          )
          : value}
      </>
    )
  }

  return (
    <Box sx={{ maxWidth: 820 }}>
      {recreated && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            mb: 1.5,
            px: 1.5,
            py: 1,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'warning.main',
            color: 'warning.main'
          }}
        >
          <i className='ri-refresh-line' style={{ fontSize: 16, marginTop: 1 }} />
          <Typography variant='caption' sx={{ color: 'text.primary' }}>
            <Box component='span' sx={{ fontWeight: 700, color: 'warning.main', mr: 0.75 }}>{t('changes.diff.recreated')}</Box>{' '}
            {t('changes.recreatedHint')}
          </Typography>
        </Box>
      )}

      {groups.length === 0 && !recreated && (
        <Typography variant='caption' sx={{ opacity: 0.6, fontStyle: 'italic' }}>{t('changes.noVisibleDiff')}</Typography>
      )}

      {groups.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: side === 'diff' ? 'fit-content(220px) fit-content(360px) 24px minmax(0, 1fr)' : 'fit-content(220px) minmax(0, 1fr)',
            columnGap: 2,
            rowGap: 0.5,
            alignItems: 'baseline'
          }}
        >
          {side === 'diff' && (
            <>
              <span />
              <Typography variant='caption' sx={{ fontWeight: 600, opacity: 0.5 }}>{t('changes.colBefore')}</Typography>
              <span />
              <Typography variant='caption' sx={{ fontWeight: 600, opacity: 0.5 }}>{t('changes.colAfter')}</Typography>
            </>
          )}
          {groups.map((g, gi) => (
            <Fragment key={g.group}>
              <Box
                sx={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  mt: gi === 0 ? 0.25 : 1,
                  pb: 0.25,
                  borderBottom: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <i className={GROUP_ICONS[g.group]} style={{ fontSize: 14, opacity: 0.7 }} />
                <Typography variant='caption' sx={{ fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.7 }}>
                  {t(`changes.group.${g.group}`)}
                </Typography>
              </Box>
              {g.facts.map((f, i) => <Fragment key={i}>{row(f)}</Fragment>)}
            </Fragment>
          ))}
        </Box>
      )}

      {showRaw && raw.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Box
            role='button'
            tabIndex={0}
            aria-expanded={rawOpen}
            onClick={() => setRawOpen(o => !o)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setRawOpen(o => !o) }}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', userSelect: 'none', opacity: 0.8 }}
          >
            <i className={rawOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16 }} />
            <Typography variant='caption' sx={{ fontWeight: 600 }}>{t('changes.rawConfig', { count: raw.length })}</Typography>
          </Box>
          <Collapse in={rawOpen} unmountOnExit>
            <Box sx={{ pl: 2.5, pt: 0.5 }}>
              {raw.map((f, i) => <FieldDiff key={i} field={f} />)}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  )
}
