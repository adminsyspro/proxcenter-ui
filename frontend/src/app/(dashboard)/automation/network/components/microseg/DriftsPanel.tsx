'use client'

import { useMemo, useState } from 'react'
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, IconButton, Menu, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'
import { useMicrosegDrifts } from '@/lib/microseg/useMicrosegLists'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import AssignGuestsDialog from './AssignGuestsDialog'
import { DRIFT_KINDS, driftKey, driftLabel, zoneOfDrift } from './driftLabels'
import { useIgnoredDrifts } from './driftIgnore'
import DriftRow, { KindChip } from './DriftRow'
import { groupDrifts, kindCounts, type DriftGroup } from './driftsModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import PolicyPager, { usePaged } from './PolicyPager'
import { useZoneGuests } from './useZoneGuests'
import { guestKey } from './zoneModel'
import { formatWhen } from './summaryModel'

/** `preselect` is built once per opening: the dialog compares it by identity. */
type Assigning = { zone: MicrosegZone; preselect: string[] }

/** Where the zone menu was opened: a row's Fix, or the bulk bar for the guests selected. */
type MenuFor = { anchor: HTMLElement; guests: string[] }

const COLUMNS = 6

type GroupProps = {
  group: DriftGroup
  render: (drift: MicrosegDrift) => React.ReactNode
  selectedKeys: ReadonlySet<string>
  onSelectAll: (keys: string[], selected: boolean) => void
}

/** One kind of drift: a header row (chevron, kind chip, "Running guests in no zone (10)", group checkbox), its rows ten per page. */
function DriftGroupBody({ group, render, selectedKeys, onSelectAll }: GroupProps) {
  const t = useTranslations('microsegPilot.drifts')
  const tk = useTranslations('microsegPilot.drifts.kind')
  const [open, setOpen] = useState(true)
  const paged = usePaged(group.drifts)
  const keys = group.drifts.map(driftKey)
  const chosen = keys.filter(k => selectedKeys.has(k)).length
  const known = (DRIFT_KINDS as readonly string[]).includes(group.kind)
  const title = known ? t(`groups.${group.kind}`, { count: group.drifts.length }) : t('groups.generic', { kind: tk('generic.title', { kind: group.kind }), count: group.drifts.length })
  return (
    <TableBody aria-label={title} data-group={group.kind}>
      <TableRow sx={{ bgcolor: 'action.hover' }}>
        <TableCell padding='checkbox'>
          <Checkbox
            size='small'
            checked={chosen > 0 && chosen === keys.length}
            indeterminate={chosen > 0 && chosen < keys.length}
            onChange={e => onSelectAll(keys, e.target.checked)}
            slotProps={{ input: { 'aria-label': t('selectGroup', { group: title }) } }}
          />
        </TableCell>
        <TableCell component='th' scope='rowgroup' colSpan={COLUMNS - 1} sx={{ py: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <IconButton size='small' aria-expanded={open} aria-label={open ? t('foldGroup') : t('unfoldGroup')} onClick={() => setOpen(v => !v)}>
              <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
            </IconButton>
            <KindChip kind={group.kind} />
            <Typography noWrap fontWeight={600} data-testid={`drift-group-${group.kind}`}>{title}</Typography>
          </Box>
        </TableCell>
      </TableRow>
      {open && paged.rows.map(render)}
      {open && paged.count > paged.size && (
        <TableRow>
          <TableCell colSpan={COLUMNS} sx={{ p: 0, borderBottom: 0 }}>
            <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  )
}

/**
 * The Drifts sub-tab: what the engine's last full run found different between the policy and Proxmox. A strip of
 * chips per kind with their counts (a click shows that kind only), then a table grouped by kind (Object, Zone, What
 * differs, Since, Actions), with a selection for bulk actions: assign the selected guests to a zone (the assign
 * dialog, a draft change) and ignore them. "Fix" only touches the draft (the assign dialog) or opens the plan;
 * nothing is written to Proxmox from here. "Ignore" hides a drift in this browser.
 */
export default function DriftsPanel({ connectionId, policy, reloadPolicy, onOpenPlan, goToSubTab, driftsZone = null }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.drifts')
  const tk = useTranslations('microsegPilot.drifts.kind')
  const format = useFormatter()
  const { data, loading, error, reload } = useMicrosegDrifts(connectionId)
  const drifts = data?.drifts
  // Until the first full run since the engine started, an empty list would read as "no drift": say it is waiting instead.
  const waiting = !!data && !data.computed
  const tm = useTranslations('microsegPilot')
  const { data: status } = useMicrosegStatus(connectionId)
  const { guests } = useZoneGuests(connectionId)
  const { ignored, ignore, ignoreAll, restore } = useIgnoredDrifts(connectionId)
  const { canWrite } = useMicrosegWrite()
  const [showIgnored, setShowIgnored] = useState(false)
  const [kindFilter, setKindFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<MenuFor | null>(null)
  const [assigning, setAssigning] = useState<Assigning | null>(null)

  const guestsByKey = useMemo(() => new Map(guests.map(g => [guestKey(g), g])), [guests])
  const ignoredCount = useMemo(() => (drifts ?? []).filter(d => ignored.has(driftKey(d))).length, [drifts, ignored])
  // Opened from a zone panel: the drifts of that zone (its own, or of one of its members), until the filter is cleared.
  const filterZone = driftsZone ? policy.zones.find(z => z.id === driftsZone) ?? null : null
  const memberKeys = useMemo(() => {
    if (!filterZone) return null
    const tag = `${policy.policy.tag_prefix}${filterZone.name}`.toLowerCase()
    return new Set(guests.filter(g => g.tags.some(x => x.toLowerCase() === tag)).map(g => guestKey(g)))
  }, [filterZone, guests, policy.policy.tag_prefix])
  const visible = useMemo(
    () => (drifts ?? []).filter(d => (showIgnored || !ignored.has(driftKey(d)))
      && (!filterZone || zoneOfDrift(d, policy.zones)?.id === filterZone.id || (!!d.guest && !!memberKeys?.has(guestKey(d.guest))))),
    [drifts, ignored, showIgnored, filterZone, memberKeys, policy.zones],
  )
  const counts = useMemo(() => kindCounts(visible), [visible])
  // A kind filter left on a kind that is gone shows everything again.
  const shownKind = kindFilter && counts.some(c => c.kind === kindFilter) ? kindFilter : null
  const groups = useMemo(() => groupDrifts(visible, shownKind), [visible, shownKind])
  const byKey = useMemo(() => new Map(visible.map(d => [driftKey(d), d])), [visible])
  // The selection keeps only what is still shown.
  const chosen = [...selected].map(k => byKey.get(k)).filter((d): d is MicrosegDrift => !!d && (!shownKind || d.kind === shownKind))
  const chosenGuests = [...new Set(chosen.filter(d => d.guest).map(d => guestKey(d.guest!)))]

  const lastFull = status?.engine.last_runs?.full?.started_at
  let asOf = status ? t('asOfNone') : ''
  let since = '-'
  if (lastFull && !Number.isNaN(Date.parse(lastFull))) {
    since = formatWhen(format, lastFull)
    asOf = t('asOf', { time: since })
  }

  const subjectOf = (d: MicrosegDrift) => {
    if (d.guest) return guestsByKey.get(guestKey(d.guest))?.name ?? (typeof d.detail?.name === 'string' && d.detail.name ? d.detail.name : `${d.guest.type}/${d.guest.vmid}`)
    return d.object ?? '-'
  }

  const onFix = (drift: MicrosegDrift, label: ReturnType<typeof driftLabel>, anchor: HTMLElement) => {
    if (label.fix === 'assign' && drift.guest) setMenu({ anchor, guests: [guestKey(drift.guest)] })
    else onOpenPlan()
  }

  const pickZone = (zone: MicrosegZone) => {
    const preselect = menu?.guests ?? []
    setMenu(null)
    if (preselect.length) setAssigning({ zone, preselect })
  }

  const select = (keys: string[], on: boolean) => setSelected(prev => {
    const next = new Set(prev)
    for (const k of keys) {
      if (on) next.add(k)
      else next.delete(k)
    }
    return next
  })
  const ignoreChosen = () => {
    ignoreAll(chosen.map(driftKey))
    setSelected(new Set())
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

  const renderRow = (drift: MicrosegDrift) => {
    const label = driftLabel(drift, tk)
    const key = driftKey(drift)
    return (
      <DriftRow
        key={key}
        drift={drift}
        label={label}
        subject={subjectOf(drift)}
        zone={zoneOfDrift(drift, policy.zones)}
        guest={drift.guest ? guestsByKey.get(guestKey(drift.guest)) ?? null : null}
        since={since}
        ignored={ignored.has(key)}
        hasZones={policy.zones.length > 0}
        selected={selected.has(key)}
        onSelect={on => select([key], on)}
        onFix={anchor => onFix(drift, label, anchor)}
        onIgnore={() => ignore(key)}
        onRestore={() => restore(key)}
      />
    )
  }

  return (
    <Box sx={{ px: 3, pb: 3 }}>
      {error && <MicrosegErrorAlert error={error} onRetry={reload} />}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 36, mb: 1 }}>
        <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: 1, minWidth: 0 }}>{asOf}</Typography>
        {filterZone && (
          <Chip
            size='small'
            data-testid='drifts-zone-filter'
            icon={<i className='ri-shield-fill' style={{ color: filterZone.color || undefined }} />}
            label={t('zoneFilter', { name: filterZone.name })}
            onDelete={() => goToSubTab('drifts')}
            deleteIcon={<i className='ri-close-line' aria-label={t('zoneFilterClear')} role='button' />}
            sx={{ flexShrink: 0, maxWidth: 220 }}
          />
        )}
        {ignoredCount > 0 && (
          <Button size='small' onClick={() => setShowIgnored(v => !v)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            {showIgnored ? t('hideIgnored') : t('showIgnored', { count: ignoredCount })}
          </Button>
        )}
      </Box>

      {waiting && <Alert severity='info' sx={{ '& .MuiAlert-message': { minWidth: 0 } }}>{tm('waitingFirstCheck')}</Alert>}
      {!waiting && visible.length === 0 && <Alert severity='success' sx={{ '& .MuiAlert-message': { minWidth: 0 } }}>{t('empty')}</Alert>}
      {!waiting && visible.length > 0 && (
        <>
          <Box data-testid='drift-kinds' role='toolbar' aria-label={t('kindsLabel')} sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
            <Chip size='small' label={t('allKinds', { count: visible.length })} variant={shownKind ? 'outlined' : 'filled'} color={shownKind ? 'default' : 'primary'} onClick={() => setKindFilter(null)} aria-pressed={!shownKind} data-testid='drift-kind-filter-all' />
            {counts.map(c => (
              <KindChip key={c.kind} kind={c.kind} count={c.count} selected={shownKind === c.kind} onClick={() => setKindFilter(shownKind === c.kind ? null : c.kind)} />
            ))}
          </Box>

          {chosen.length > 0 && (
            <Box data-testid='drift-bulk' sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 40, px: 1.5, mb: 1, borderRadius: 1, bgcolor: 'action.selected' }}>
              <Typography variant='body2' fontWeight={600} sx={{ flex: 1, minWidth: 0 }} noWrap>{t('bulkSelected', { count: chosen.length })}</Typography>
              {chosenGuests.length > 0 && (
                <WriteTip title={policy.zones.length ? '' : t('noZone')}>
                  <Button
                    size='small'
                    variant='contained'
                    disabled={!canWrite || policy.zones.length === 0}
                    aria-haspopup='menu'
                    onClick={e => setMenu({ anchor: e.currentTarget, guests: chosenGuests })}
                  >
                    {t('bulkAssign', { count: chosenGuests.length })}
                  </Button>
                </WriteTip>
              )}
              <Button size='small' variant='outlined' onClick={ignoreChosen}>{t('bulkIgnore', { count: chosen.length })}</Button>
              <Button size='small' onClick={() => setSelected(new Set())}>{t('bulkClear')}</Button>
            </Box>
          )}

          <Box sx={{ overflowX: 'auto' }}>
            <Table size='small' aria-label={t('tableLabel')} sx={{ '& td, & th': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell padding='checkbox' />
                  <TableCell>{t('colObject')}</TableCell>
                  <TableCell>{t('colZone')}</TableCell>
                  <TableCell>{t('colDiffers')}</TableCell>
                  <TableCell>{t('colSince')}</TableCell>
                  <TableCell align='right'>{t('colActions')}</TableCell>
                </TableRow>
              </TableHead>
              {groups.map(group => (
                <DriftGroupBody key={group.kind} group={group} render={renderRow} selectedKeys={selected} onSelectAll={select} />
              ))}
            </Table>
          </Box>
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
          onClose={() => { setAssigning(null); setSelected(new Set()) }}
        />
      )}
    </Box>
  )
}
