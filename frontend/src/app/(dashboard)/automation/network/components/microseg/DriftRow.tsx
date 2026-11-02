'use client'

import { useState } from 'react'
import { Box, Button, Chip, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegDrift } from '@/lib/microseg/types'

import type { DriftLabel } from './driftLabels'
import { OneLine } from './dialogParts'
import type { PolicyGuest } from './zoneModel'

/** Cluster objects have no guest: one glyph per kind, with the amber dot every drift carries. */
const OBJECT_GLYPH: Record<string, string> = {
  foreign_accept: 'ri-shield-line',
  ipset_out_of_sync: 'ri-list-settings-line',
  object_collision: 'ri-error-warning-line',
}

function DriftGlyph({ drift, guest }: { drift: MicrosegDrift; guest: PolicyGuest | null }) {
  if (drift.guest) {
    return guest
      ? <StatusIcon type='vm' vmType={guest.type} status={guest.status} />
      : <i className='ri-question-line' style={{ opacity: 0.6, fontSize: 16 }} />
  }
  return (
    <Box component='span' sx={{ position: 'relative', display: 'inline-flex', width: 16, height: 16, flexShrink: 0 }}>
      <i className={OBJECT_GLYPH[drift.kind] ?? 'ri-alert-line'} style={{ fontSize: 16 }} />
      <Box
        component='span'
        sx={{ position: 'absolute', bottom: -2, right: -3, width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main', border: '1.5px solid', borderColor: 'background.paper' }}
      />
    </Box>
  )
}

export type DriftRowProps = {
  drift: MicrosegDrift
  label: DriftLabel
  /** The guest or the object the drift is about. */
  subject: string
  guest: PolicyGuest | null
  ignored: boolean
  /** The assign fix needs a zone to assign to. */
  hasZones: boolean
  onFix: (anchor: HTMLElement) => void
  onIgnore: () => void
  onRestore: () => void
}

/** One drift on one line: chevron, glyph, title, subject, then Fix and Ignore; the detail sits under the chevron. */
export default function DriftRow({ drift, label, subject, guest, ignored, hasZones, onFix, onIgnore, onRestore }: DriftRowProps) {
  const t = useTranslations('microsegPilot.drifts')
  const tp = useTranslations('microsegPilot.policy')
  const [open, setOpen] = useState(false)
  const assign = label.fix === 'assign'
  const noZone = assign && !hasZones

  return (
    <Box role='listitem' aria-label={`${label.title}: ${subject}`} sx={{ borderBottom: 1, borderColor: 'divider', opacity: ignored ? 0.6 : 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, px: 1, minWidth: 0 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <DriftGlyph drift={drift} guest={guest} />
        <Tooltip title={label.title}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', maxWidth: 260 }}>{label.title}</Typography></Tooltip>
        <Tooltip title={subject}>
          <Typography noWrap color={label.hint ? 'text.primary' : 'text.secondary'} sx={label.hint ? { flex: '0 1 auto', maxWidth: 200 } : { flex: '1 1 0', minWidth: 0 }}>{subject}</Typography>
        </Tooltip>
        {label.hint && (
          <Tooltip title={label.hint}>
            <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{label.hint}</Typography>
          </Tooltip>
        )}
        {ignored && <Chip size='small' variant='outlined' label={t('ignoredChip')} sx={{ flexShrink: 0 }} />}
        {!ignored && label.fix && (
          <Tooltip title={noZone ? t('noZone') : ''}>
            <span>
              <Button
                size='small'
                variant='outlined'
                disabled={noZone}
                aria-haspopup={assign ? 'menu' : undefined}
                onClick={e => onFix(e.currentTarget)}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {assign ? t('fixAssign') : t('fixPlan')}
              </Button>
            </span>
          </Tooltip>
        )}
        {ignored ? (
          <Button size='small' onClick={onRestore} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('restore')}</Button>
        ) : (
          <Tooltip title={t('ignore')}>
            <IconButton size='small' aria-label={t('ignore')} onClick={onIgnore} sx={{ flexShrink: 0 }}><i className='ri-eye-off-line' /></IconButton>
          </Tooltip>
        )}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 7, pr: 2, pb: 1.5, minWidth: 0 }}><OneLine text={label.detail} /></Box>
      </Collapse>
    </Box>
  )
}
