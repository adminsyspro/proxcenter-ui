'use client'

import { Fragment, useMemo } from 'react'

import { useLocale, useTranslations } from 'next-intl'

import { Box, Chip, Typography } from '@mui/material'

import { describeChange, describeGrouped, describeSpec } from '@/lib/changes/describe'
import type { DescribeFormat, DiffFact, FactLabel } from '@/lib/changes/describe'
import type { ChangeFieldDiff } from '@/lib/changes/csv'

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/** Sizes in the reader's locale: `4 GB`, `768 Mo`, binary steps as Proxmox counts them. */
export function useDescribeFormat(): DescribeFormat {
  const locale = useLocale()

  return useMemo(() => ({
    bytes: (n: number) => {
      let i = 0
      let v = n

      while (v >= 1024 && i < BYTE_UNITS.length - 1) {
        v /= 1024
        i++
      }

      return new Intl.NumberFormat(locale, { style: 'unit', unit: BYTE_UNITS[i], unitDisplay: 'short', maximumFractionDigits: 1 }).format(v)
    }
  }), [locale])
}

/** A fact's label: `Memory`, `net0 Firewall`, `scsi1`. */
export function useFactLabel() {
  const t = useTranslations()

  return (l: FactLabel): string => {
    if (!('key' in l)) return l.text

    const text = t(`changes.diff.${l.key}`)

    return l.of ? `${l.of} ${text}` : text
  }
}

/** One fact as plain text, for the tooltip and the screen reader. */
export function useFactText() {
  const t = useTranslations()
  const name = useFactLabel()

  return (f: DiffFact): string => {
    switch (f.kind) {
      case 'recreated': return t('changes.diff.recreated')
      case 'changed': return `${name(f.label)} ${f.from} → ${f.to}`
      case 'added': return `+ ${name(f.label)}${f.value ? ` ${f.value}` : ''}`
      case 'removed': return `− ${name(f.label)}${f.value ? ` ${f.value}` : ''}`
      case 'modified': return t('changes.diff.modified', { label: name(f.label) })
      case 'toggled': return `${name(f.label)} ${t(f.on ? 'changes.diff.on' : 'changes.diff.off')}`
    }
  }
}

interface FactLineProps {
  fields?: ChangeFieldDiff[]
  /** Shown when the diff amounts to nothing the reader cares about */
  empty?: string
}

/** A change's diff as one line: `Memory 2 GB → 4 GB · + scsi1 32 GB · net0 e1000 → virtio`. */
export default function FactLine({ fields, empty }: FactLineProps) {
  const t = useTranslations()
  const fmt = useDescribeFormat()
  const text = useFactText()
  const name = useFactLabel()
  const facts = useMemo(() => describeChange(fields, fmt), [fields, fmt])

  if (facts.length === 0) {
    return (
      <Typography variant='caption' sx={{ opacity: 0.5, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {empty}
      </Typography>
    )
  }

  const piece = (f: DiffFact) => {
    switch (f.kind) {
      case 'recreated':
        return <Box component='span' sx={{ color: 'warning.main', fontWeight: 600 }}>{text(f)}</Box>
      case 'changed':
        return (
          <>
            <Box component='span' sx={{ opacity: 0.6 }}>{name(f.label)} </Box>
            <Box component='span' sx={{ opacity: 0.6 }}>{f.from}</Box>
            <Box component='span' sx={{ opacity: 0.6 }}> → </Box>
            <Box component='span' sx={{ fontWeight: 600 }}>{f.to}</Box>
          </>
        )
      case 'added':
      case 'removed':
        return (
          <>
            <Box component='span' sx={{ color: f.kind === 'added' ? 'success.main' : 'error.main', fontWeight: 700 }}>
              {f.kind === 'added' ? '+' : '−'}{' '}
            </Box>
            <Box component='span' sx={{ opacity: 0.6 }}>{name(f.label)}</Box>
            {f.value && <Box component='span' sx={{ fontWeight: 600 }}> {f.value}</Box>}
          </>
        )
      case 'modified':
        return <Box component='span' sx={{ opacity: 0.6 }}>{text(f)}</Box>
      case 'toggled':
        return (
          <>
            <Box component='span' sx={{ opacity: 0.6 }}>{name(f.label)} </Box>
            <Box component='span' sx={{ fontWeight: 600 }}>{t(f.on ? 'changes.diff.on' : 'changes.diff.off')}</Box>
          </>
        )
    }
  }

  return (
    <Typography
      variant='caption'
      title={facts.map(text).join('\n')}
      sx={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', minWidth: 0 }}
    >
      {facts.map((f, i) => (
        <Fragment key={i}>
          {i > 0 && <Box component='span' sx={{ opacity: 0.35, mx: 0.75 }}>·</Box>}
          {piece(f)}
        </Fragment>
      ))}
    </Typography>
  )
}

/**
 * A change in the row: its one or two facts as they read, or past that the
 * count and the sections they touch (`7 changes · General · Disks · Network`),
 * the full table being in the row details.
 */
export function FactSummary({ fields, empty, side = 'diff' }: FactLineProps & { side?: 'diff' | 'before' | 'after' }) {
  const t = useTranslations()
  const fmt = useDescribeFormat()
  const { recreated, groups } = useMemo(() => describeGrouped(fields, fmt), [fields, fmt])
  const count = groups.reduce((n, g) => n + g.facts.length, 0)

  // A created or deleted guest reads as its size
  if (side !== 'diff') {
    const spec = describeSpec(fields, side, fmt)
    const parts = [
      spec.vcpus !== undefined ? t('changes.spec.vcpus', { count: spec.vcpus }) : '',
      spec.memory ?? '',
      spec.disks ? t('changes.spec.disks', { count: spec.disks }) : '',
      spec.nics ? t('changes.spec.nics', { count: spec.nics }) : ''
    ].filter(Boolean)

    return (
      <Typography variant='caption' sx={{ opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {parts.join(' · ') || empty}
      </Typography>
    )
  }

  if (!recreated && count <= 2) return <FactLine fields={fields} empty={empty} />

  const sections = groups.map(g => t(`changes.group.${g.group}`)).join(' · ')

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      {recreated && (
        <Chip
          size='small'
          variant='outlined'
          color='warning'
          icon={<i className='ri-refresh-line' style={{ fontSize: 13 }} />}
          label={t('changes.diff.recreated')}
          sx={{ height: 20, fontSize: '0.7rem', flexShrink: 0 }}
        />
      )}
      {count > 0 && (
        <Typography variant='caption' sx={{ fontWeight: 600, flexShrink: 0 }}>
          {t('changes.factCount', { count })}
        </Typography>
      )}
      {count > 0 && (
        <Typography variant='caption' title={sections} sx={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sections}
        </Typography>
      )}
    </Box>
  )
}
