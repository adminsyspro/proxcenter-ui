'use client'

import { useState } from 'react'
import { Box, Button, Checkbox, Chip, IconButton, TableCell, TableRow, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'

import ClusterChip from './ClusterChip'
import type { DriftFix, DriftLabel } from './driftLabels'
import EnableClusterFirewallDialog from './EnableClusterFirewallDialog'
import type { PolicyGuest } from './zoneModel'
import { WriteTip, useMicrosegClusterWrite, useMicrosegWrite } from './microsegAccess'
import { ZoneShield } from './ZoneNode'
import TruncatedText from './TruncatedText'

/** Cluster objects have no guest: one glyph per kind, with the amber dot every drift carries. */
const OBJECT_GLYPH: Record<string, string> = {
  foreign_accept: 'ri-shield-line',
  ipset_out_of_sync: 'ri-list-settings-line',
  object_collision: 'ri-error-warning-line',
  local_set_desync: 'ri-list-settings-line',
  peer_unreadable: 'ri-link-unlink',
  stop_lift_held: 'ri-shield-cross-line',
  cluster_firewall_off: 'ri-shield-cross-line',
  firewall_service_stopped: 'ri-server-line',
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
  foreign_group: { color: 'error', icon: 'ri-shield-check-line' },
  object_collision: { color: 'error', icon: 'ri-alert-line' },
  egress_rule_missing: { color: 'warning', icon: 'ri-logout-box-r-line' },
  egress_rule_misplaced: { color: 'warning', icon: 'ri-arrow-up-down-line' },
  egress_rule_verdict: { color: 'error', icon: 'ri-shield-flash-line' },
  known_rule_missing: { color: 'warning', icon: 'ri-bookmark-line' },
  known_rule_extra: { color: 'info', icon: 'ri-bookmark-3-line' },
  local_set_desync: { color: 'info', icon: 'ri-database-2-line' },
  egress_no_subnet: { color: 'warning', icon: 'ri-map-pin-line' },
  ipfilter_off: { color: 'error', icon: 'ri-filter-off-line' },
  ipfilter_list_changed: { color: 'info', icon: 'ri-list-settings-line' },
  ipfilter_no_address: { color: 'warning', icon: 'ri-map-pin-line' },
  ipfilter_address_held: { color: 'warning', icon: 'ri-forbid-line' },
  ipfilter_manual: { color: 'info', icon: 'ri-edit-line' },
  unzoned_same_network: { color: 'warning', icon: 'ri-share-line' },
  peer_unreadable: { color: 'warning', icon: 'ri-link-unlink' },
  stop_lift_held: { color: 'error', icon: 'ri-shield-cross-line' },
  cluster_firewall_off: { color: 'error', icon: 'ri-shield-cross-line' },
  firewall_service_stopped: { color: 'error', icon: 'ri-server-line' },
}
/** The drifts of a cluster firewall that reads off: `object` is the connection ID, and the row offers to turn it back on. */
const FIREWALL_OFF_KINDS: ReadonlySet<string> = new Set(['cluster_firewall_off', 'stop_lift_held'])

/** The label of the Fix button of each fix (under microsegPilot.drifts). */
const FIX_LABEL: Record<DriftFix, string> = { assign: 'fixAssign', plan: 'fixPlan', allow: 'fixAllow' }

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
      <TruncatedText text={zone.name} variant='body2' fontWeight={600} sx={{ minWidth: 0 }} />
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
  /** On a shared policy: the cluster the drift was read from, its chip after the glyph. */
  cluster?: { id: string; name: string }
  /** False for a drift that cannot be ignored (one about a cluster of the policy): no Ignore button. */
  ignorable?: boolean
  /** The cluster firewall was turned back on from the row: the drifts are read again. */
  onChanged?: () => void
}

/**
 * One drift on one row of the Drifts table: a checkbox, the object (glyph, name, vmid and node, or the cluster
 * object), its zone, what differs, since when, and Fix (assign to a zone, open the plan, or allow the address the IP
 * filter held back) and Ignore.
 */
export default function DriftRow({ drift, label, subject, guest, zone = null, since, ignored, hasZones, selected, onSelect, onFix, onIgnore, onRestore, cluster, ignorable = true, onChanged }: DriftRowProps) {
  const t = useTranslations('microsegPilot.drifts')
  const { canWrite: canPlan } = useMicrosegWrite()
  const { canWriteOn } = useMicrosegClusterWrite()
  const assign = label.fix === 'assign'
  // Assigning writes the members of the guest's cluster (its own right); the plan and an allowed address are writes of the whole policy.
  const canWrite = assign ? canWriteOn(cluster?.id ?? '') : canPlan
  const noZone = assign && !hasZones
  const where = drift.guest ? `${drift.guest.vmid} · ${guest?.node ?? drift.guest.node}` : null
  // The cluster whose firewall reads off: the drift names it by its connection ID.
  const firewallOf = FIREWALL_OFF_KINDS.has(drift.kind) && drift.object ? drift.object : null
  const [enabling, setEnabling] = useState(false)
  const differs = [label.detail, label.hint, label.note].filter(Boolean).join(' ')

  return (
    <TableRow aria-label={`${label.title}: ${subject}`} selected={selected} sx={{ opacity: ignored ? 0.6 : 1 }}>
      <TableCell padding='checkbox'>
        <Checkbox size='small' checked={selected} onChange={e => onSelect(e.target.checked)} slotProps={{ input: { 'aria-label': t('select', { name: subject }) } }} />
      </TableCell>
      <TableCell sx={{ maxWidth: 260 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <DriftGlyph drift={drift} guest={guest} />
          {cluster && <ClusterChip connectionId={cluster.id} name={cluster.name} compact />}
          <TruncatedText text={subject} fontWeight={600} sx={{ minWidth: 0 }} />
          {where && <Typography noWrap variant='body2' color='text.secondary' sx={{ flexShrink: 0 }}>{where}</Typography>}
        </Box>
      </TableCell>
      <TableCell sx={{ maxWidth: 180 }}><DriftZone zone={zone} /></TableCell>
      <TableCell sx={{ maxWidth: 380 }}>
        {label.note ? (
          // A removal on hold is a remark, not an error: a muted clock with the note on hover, the detail on the same line.
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Tooltip title={label.note}>
              <Box component='i' className='ri-time-line' role='img' aria-label={label.note} data-testid='drift-held' sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
            </Tooltip>
            <TruncatedText text={label.detail} title={differs} variant='body2' data-testid='drift-differs' sx={{ minWidth: 0 }} />
          </Box>
        ) : (
          <TruncatedText text={label.detail} title={differs} variant='body2' data-testid='drift-differs' />
        )}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant='body2' color='text.secondary'>{since}</Typography></TableCell>
      <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
        {ignored && <Chip size='small' variant='outlined' label={t('ignoredChip')} sx={{ mr: 1 }} />}
        {!ignored && label.fix && (
          <WriteTip allowed={assign ? canWrite : undefined} title={noZone ? t('noZone') : ''}>
            <Button
              size='small'
              variant='outlined'
              disabled={!canWrite || noZone}
              aria-haspopup={assign ? 'menu' : undefined}
              onClick={e => onFix(e.currentTarget)}
              sx={{ whiteSpace: 'nowrap', mr: 0.5 }}
            >
              {t(FIX_LABEL[label.fix])}
            </Button>
          </WriteTip>
        )}
        {firewallOf && (
          <WriteTip allowed={canWriteOn(firewallOf)}>
            <Button
              size='small'
              variant='outlined'
              disabled={!canWriteOn(firewallOf)}
              startIcon={<i className='ri-shield-check-line' />}
              onClick={() => setEnabling(true)}
              data-testid='drift-enable-firewall'
              sx={{ whiteSpace: 'nowrap', mr: 0.5 }}
            >
              {t('enableFirewall.button')}
            </Button>
          </WriteTip>
        )}
        {firewallOf && (
          <EnableClusterFirewallDialog
            open={enabling}
            connectionId={firewallOf}
            name={cluster?.name ?? null}
            onClose={() => setEnabling(false)}
            onDone={() => onChanged?.()}
          />
        )}
        {ignored && <Button size='small' onClick={onRestore} sx={{ whiteSpace: 'nowrap' }}>{t('restore')}</Button>}
        {!ignored && ignorable && (
          <Tooltip title={t('ignore')}>
            <IconButton size='small' aria-label={t('ignore')} onClick={onIgnore}><i className='ri-eye-off-line' /></IconButton>
          </Tooltip>
        )}
        {/* No Ignore on this row: the same room is kept, so its button lines up with those of the other rows. */}
        {!ignored && !ignorable && (
          <IconButton size='small' disabled aria-hidden tabIndex={-1} data-testid='drift-ignore-spacer' sx={{ visibility: 'hidden' }}><i className='ri-eye-off-line' /></IconButton>
        )}
      </TableCell>
    </TableRow>
  )
}
