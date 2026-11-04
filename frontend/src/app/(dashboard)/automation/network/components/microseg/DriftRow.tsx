'use client'

import { Box, Button, Checkbox, Chip, IconButton, TableCell, TableRow, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'

import type { DriftLabel } from './driftLabels'
import type { PolicyGuest } from './zoneModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import { ZoneShield } from './ZoneNode'

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

/**
 * The chip of a drift kind in its colour with its icon; with a count, a filter of the summary strip (filled when it is
 * the kind shown).
 */
export function KindChip({ kind, count, selected = false, onClick }: { kind: string; count?: number; selected?: boolean; onClick?: () => void }) {
  const t = useTranslations('microsegPilot.drifts.chip')
  const { color, icon } = KIND_CHIP[kind] ?? UNKNOWN_KIND_CHIP
  const label = t(kind in KIND_CHIP ? kind : 'generic')
  return (
    <Chip
      size='small'
      variant={selected ? 'filled' : 'outlined'}
      color={color}
      icon={<i className={icon} style={{ fontSize: 14 }} />}
      label={count === undefined ? label : `${label} · ${count}`}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      data-testid={count === undefined ? 'drift-kind-chip' : `drift-kind-filter-${kind}`}
      sx={{ flexShrink: 0, maxWidth: 200 }}
    />
  )
}

/** The zone a drift is about: its shield in its colour with the state dot and its name; "none" when it names none. */
function DriftZone({ zone }: { zone: MicrosegZone | null }) {
  const t = useTranslations('microsegPilot.drifts')
  if (!zone) return <Typography variant='body2' color='text.disabled'>{t('noneZone')}</Typography>
  return (
    <Box data-testid='drift-zone' sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <ZoneShield color={zone.color || 'currentColor'} state={zone.state} />
      <Tooltip title={zone.name}><Typography noWrap variant='body2' fontWeight={600} sx={{ minWidth: 0 }}>{zone.name}</Typography></Tooltip>
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
  /** When the drift was found: the last full run. */
  since: string
  ignored: boolean
  /** The assign fix needs a zone to assign to. */
  hasZones: boolean
  selected: boolean
  onSelect: (selected: boolean) => void
  onFix: (anchor: HTMLElement) => void
  onIgnore: () => void
  onRestore: () => void
}

/**
 * One drift on one row of the Drifts table: a checkbox, the object (glyph, name, vmid and node, or the cluster
 * object), its zone, what differs, since when, and Fix (assign to a zone or open the plan) and Ignore.
 */
export default function DriftRow({ drift, label, subject, guest, zone = null, since, ignored, hasZones, selected, onSelect, onFix, onIgnore, onRestore }: DriftRowProps) {
  const t = useTranslations('microsegPilot.drifts')
  const { canWrite } = useMicrosegWrite()
  const assign = label.fix === 'assign'
  const noZone = assign && !hasZones
  const where = drift.guest ? `${drift.guest.vmid} · ${guest?.node ?? drift.guest.node}` : null
  const differs = label.hint ? `${label.detail} ${label.hint}` : label.detail

  return (
    <TableRow aria-label={`${label.title}: ${subject}`} selected={selected} sx={{ opacity: ignored ? 0.6 : 1 }}>
      <TableCell padding='checkbox'>
        <Checkbox size='small' checked={selected} onChange={e => onSelect(e.target.checked)} slotProps={{ input: { 'aria-label': t('select', { name: subject }) } }} />
      </TableCell>
      <TableCell sx={{ maxWidth: 260 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <DriftGlyph drift={drift} guest={guest} />
          <Tooltip title={subject}><Typography noWrap fontWeight={600} sx={{ minWidth: 0 }}>{subject}</Typography></Tooltip>
          {where && <Typography noWrap variant='body2' color='text.secondary' sx={{ flexShrink: 0 }}>{where}</Typography>}
        </Box>
      </TableCell>
      <TableCell sx={{ maxWidth: 180 }}><DriftZone zone={zone} /></TableCell>
      <TableCell sx={{ maxWidth: 380 }}>
        <Tooltip title={differs}><Typography noWrap variant='body2' data-testid='drift-differs'>{label.detail}</Typography></Tooltip>
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant='body2' color='text.secondary'>{since}</Typography></TableCell>
      <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
        {ignored && <Chip size='small' variant='outlined' label={t('ignoredChip')} sx={{ mr: 1 }} />}
        {!ignored && label.fix && (
          <WriteTip title={noZone ? t('noZone') : ''}>
            <Button
              size='small'
              variant='outlined'
              disabled={!canWrite || noZone}
              aria-haspopup={assign ? 'menu' : undefined}
              onClick={e => onFix(e.currentTarget)}
              sx={{ whiteSpace: 'nowrap', mr: 0.5 }}
            >
              {assign ? t('fixAssign') : t('fixPlan')}
            </Button>
          </WriteTip>
        )}
        {ignored ? (
          <Button size='small' onClick={onRestore} sx={{ whiteSpace: 'nowrap' }}>{t('restore')}</Button>
        ) : (
          <Tooltip title={t('ignore')}>
            <IconButton size='small' aria-label={t('ignore')} onClick={onIgnore}><i className='ri-eye-off-line' /></IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  )
}
