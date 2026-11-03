'use client'

import { useState } from 'react'
import { Box, Button, Chip, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'

import type { DriftLabel } from './driftLabels'
import { OneLine } from './dialogParts'
import type { PolicyGuest } from './zoneModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import { ZoneShield } from './ZoneNode'
import ZoneStateChip from './ZoneStateChip'

/** Cluster objects have no guest: one glyph per kind, with the amber dot every drift carries. */
const OBJECT_GLYPH: Record<string, string> = {
  foreign_accept: 'ri-shield-line',
  ipset_out_of_sync: 'ri-list-settings-line',
  object_collision: 'ri-error-warning-line',
}

type KindChipColor = 'warning' | 'error' | 'info'

/** One coloured chip per drift kind: amber for what is missing, red for a guest setting or a rule that is not ours, blue for a cluster object. */
export const KIND_CHIP: Record<string, { color: KindChipColor; icon: string }> = {
  unzoned_running: { color: 'warning', icon: 'ri-question-line' },
  member_without_ip: { color: 'warning', icon: 'ri-map-pin-line' },
  ambiguous_zone: { color: 'warning', icon: 'ri-git-merge-line' },
  nic_firewall_off: { color: 'error', icon: 'ri-shield-flash-line' },
  ipset_out_of_sync: { color: 'info', icon: 'ri-database-2-line' },
  foreign_accept: { color: 'error', icon: 'ri-alert-line' },
  object_collision: { color: 'error', icon: 'ri-alert-line' },
}
const UNKNOWN_KIND_CHIP = { color: 'error', icon: 'ri-alert-line' } as const

function KindChip({ kind }: { kind: string }) {
  const t = useTranslations('microsegPilot.drifts.chip')
  const { color, icon } = KIND_CHIP[kind] ?? UNKNOWN_KIND_CHIP
  const label = t(kind in KIND_CHIP ? kind : 'generic')
  return (
    <Chip
      size='small'
      variant='outlined'
      color={color}
      icon={<i className={icon} style={{ fontSize: 14 }} />}
      label={label}
      data-testid='drift-kind-chip'
      sx={{ flexShrink: 0, maxWidth: 140 }}
    />
  )
}

/** The zone a drift is about: its shield in its colour with the state dot, its name, then its state. */
function DriftZone({ zone }: { zone: MicrosegZone }) {
  return (
    <Box data-testid='drift-zone' sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, minWidth: 0, maxWidth: 260 }}>
      <ZoneShield color={zone.color || 'currentColor'} state={zone.state} />
      <Tooltip title={zone.name}><Typography noWrap variant='body2' fontWeight={600} sx={{ minWidth: 0 }}>{zone.name}</Typography></Tooltip>
      <ZoneStateChip state={zone.state} />
    </Box>
  )
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
  /** The zone the drift is about, when it names one that exists. */
  zone?: MicrosegZone | null
  ignored: boolean
  /** The assign fix needs a zone to assign to. */
  hasZones: boolean
  onFix: (anchor: HTMLElement) => void
  onIgnore: () => void
  onRestore: () => void
}

/** One drift on one line: chevron, glyph, title, subject, then Fix and Ignore; the detail sits under the chevron. */
export default function DriftRow({ drift, label, subject, guest, zone = null, ignored, hasZones, onFix, onIgnore, onRestore }: DriftRowProps) {
  const t = useTranslations('microsegPilot.drifts')
  const tp = useTranslations('microsegPilot.policy')
  const { canWrite } = useMicrosegWrite()
  const [open, setOpen] = useState(false)
  const assign = label.fix === 'assign'
  const noZone = assign && !hasZones

  return (
    <Box role='listitem' aria-label={`${label.title}: ${subject}`} sx={{ borderBottom: 1, borderColor: 'divider', opacity: ignored ? 0.6 : 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, px: 1, minWidth: 0 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <KindChip kind={drift.kind} />
        <DriftGlyph drift={drift} guest={guest} />
        <Tooltip title={label.title}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', maxWidth: 260 }}>{label.title}</Typography></Tooltip>
        <Tooltip title={subject}>
          <Typography noWrap color={label.hint ? 'text.primary' : 'text.secondary'} sx={label.hint ? { flex: '0 1 auto', maxWidth: 200 } : { flex: '1 1 0', minWidth: 0 }}>{subject}</Typography>
        </Tooltip>
        {zone && <DriftZone zone={zone} />}
        {label.hint && (
          <Tooltip title={label.hint}>
            <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{label.hint}</Typography>
          </Tooltip>
        )}
        {ignored && <Chip size='small' variant='outlined' label={t('ignoredChip')} sx={{ flexShrink: 0 }} />}
        {!ignored && label.fix && (
          <WriteTip title={noZone ? t('noZone') : ''}>
            <Button
                size='small'
                variant='outlined'
                disabled={!canWrite || noZone}
                aria-haspopup={assign ? 'menu' : undefined}
                onClick={e => onFix(e.currentTarget)}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {assign ? t('fixAssign') : t('fixPlan')}
            </Button>
          </WriteTip>
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
