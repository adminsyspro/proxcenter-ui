'use client'

import { useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Menu, MenuItem, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'
import { useMicrosegDrifts } from '@/lib/microseg/useMicrosegLists'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import AssignGuestsDialog from './AssignGuestsDialog'
import { driftKey, driftLabel } from './driftLabels'
import { useIgnoredDrifts } from './driftIgnore'
import DriftRow from './DriftRow'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import PolicyPager, { usePaged } from './PolicyPager'
import { useZoneGuests } from './useZoneGuests'
import { guestKey } from './zoneModel'
import { formatWhen } from './summaryModel'

/** `preselect` is built once per opening: the dialog compares it by identity. */
type Assigning = { zone: MicrosegZone; preselect: string[] }

/**
 * The Drifts sub-tab: what the engine's last full run found different between
 * the policy and Proxmox. "Fix" only touches the draft (the assign dialog) or
 * opens the plan; nothing is written to Proxmox from here. "Ignore" hides a
 * drift in this browser.
 */
export default function DriftsPanel({ connectionId, policy, reloadPolicy, onOpenPlan }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.drifts')
  const tk = useTranslations('microsegPilot.drifts.kind')
  const format = useFormatter()
  const { data: drifts, loading, error, reload } = useMicrosegDrifts(connectionId)
  const { data: status } = useMicrosegStatus(connectionId)
  const { guests } = useZoneGuests(connectionId)
  const { ignored, ignore, restore } = useIgnoredDrifts(connectionId)
  const [showIgnored, setShowIgnored] = useState(false)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; drift: MicrosegDrift } | null>(null)
  const [assigning, setAssigning] = useState<Assigning | null>(null)

  const guestsByKey = useMemo(() => new Map(guests.map(g => [guestKey(g), g])), [guests])
  const ignoredCount = useMemo(() => (drifts ?? []).filter(d => ignored.has(driftKey(d))).length, [drifts, ignored])
  const visible = useMemo(
    () => (drifts ?? []).filter(d => showIgnored || !ignored.has(driftKey(d))),
    [drifts, ignored, showIgnored],
  )
  const paged = usePaged(visible)

  const lastFull = status?.engine.last_runs?.full?.started_at
  let asOf = status ? t('asOfNone') : ''
  if (lastFull && !Number.isNaN(Date.parse(lastFull))) asOf = t('asOf', { time: formatWhen(format, lastFull) })

  const subjectOf = (d: MicrosegDrift) => {
    if (d.guest) return guestsByKey.get(guestKey(d.guest))?.name ?? (typeof d.detail?.name === 'string' && d.detail.name ? d.detail.name : `${d.guest.type}/${d.guest.vmid}`)
    return d.object ?? '-'
  }

  const onFix = (drift: MicrosegDrift, label: ReturnType<typeof driftLabel>, anchor: HTMLElement) => {
    if (label.fix === 'assign') setMenu({ anchor, drift })
    else onOpenPlan()
  }

  const pickZone = (zone: MicrosegZone) => {
    const guest = menu?.drift.guest
    setMenu(null)
    if (guest) setAssigning({ zone, preselect: [guestKey(guest)] })
  }

  if (!drifts) {
    if (error) return <Box sx={{ px: 3 }}><MicrosegErrorAlert error={error} onRetry={reload} /></Box>
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3 }}>
        <CircularProgress size={20} />
        <Typography color='text.secondary'>{loading ? t('loading') : ''}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ px: 3, pb: 3 }}>
      {error && <MicrosegErrorAlert error={error} onRetry={reload} />}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 36, mb: 1 }}>
        <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: 1, minWidth: 0 }}>{asOf}</Typography>
        {ignoredCount > 0 && (
          <Button size='small' onClick={() => setShowIgnored(v => !v)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            {showIgnored ? t('hideIgnored') : t('showIgnored', { count: ignoredCount })}
          </Button>
        )}
      </Box>

      {visible.length === 0 ? (
        <Alert severity='success' sx={{ '& .MuiAlert-message': { minWidth: 0 } }}>{t('empty')}</Alert>
      ) : (
        <>
          <Box role='list'>
            {paged.rows.map(drift => {
              const label = driftLabel(drift, tk)
              const key = driftKey(drift)
              return (
                <DriftRow
                  key={key}
                  drift={drift}
                  label={label}
                  subject={subjectOf(drift)}
                  guest={drift.guest ? guestsByKey.get(guestKey(drift.guest)) ?? null : null}
                  ignored={ignored.has(key)}
                  hasZones={policy.zones.length > 0}
                  onFix={anchor => onFix(drift, label, anchor)}
                  onIgnore={() => ignore(key)}
                  onRestore={() => restore(key)}
                />
              )
            })}
          </Box>
          <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
        </>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)} slotProps={{ list: { 'aria-label': t('assignMenu') } }}>
        {policy.zones.map(zone => <MenuItem key={zone.id} onClick={() => pickZone(zone)}>{zone.name}</MenuItem>)}
      </Menu>
      {assigning && (
        <AssignGuestsDialog
          open
          connectionId={connectionId}
          zone={assigning.zone}
          policy={policy}
          reloadPolicy={reloadPolicy}
          preselect={assigning.preselect}
          onClose={() => setAssigning(null)}
        />
      )}
    </Box>
  )
}
