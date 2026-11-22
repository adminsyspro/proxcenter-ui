'use client'

import { useMemo, useState } from 'react'
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, IconButton, Menu, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegZone } from '@/lib/microseg/types'
import { clustersToRead, shownAnswers, useMergedClusters } from '@/lib/microseg/useMerged'
import { useClusterDrifts } from '@/lib/microseg/useMicrosegLists'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import AllowAddressDialog from './AllowAddressDialog'
import AssignGuestsDialog from './AssignGuestsDialog'
import { shownClusterName } from './ClusterRunRow'
import ClusterUnreadLines from './ClusterUnreadLines'
import { CLUSTER_DRIFT_KINDS, DRIFT_KINDS, canIgnoreDrift, clusterDriftSubject, driftKey, driftLabel, zoneOfDrift } from './driftLabels'
import { useIgnoredClusterDrifts } from './driftIgnore'
import DriftRow, { KindChip } from './DriftRow'
import { driftRowKey, groupDrifts, kindCounts, mergeDrifts, type ClusterDrift, type DriftGroup } from './driftsModel'
import { WriteTip, useMicrosegClusterWrite } from './microsegAccess'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import PolicyPager, { usePaged } from './PolicyPager'
import { useGroupGuests } from './useGroupGuests'
import { guestId } from './zoneModel'
import { formatWhen } from './summaryModel'

const KNOWN_KINDS: readonly string[] = [...CLUSTER_DRIFT_KINDS, ...DRIFT_KINDS]

/** The guest of a drift across the clusters of the policy. */
const driftGuestId = (d: ClusterDrift) => (d.guest ? guestId({ connectionId: d.connection_id, type: d.guest.type, vmid: d.guest.vmid }) : null)

/** The oldest of the ISO times that parse, or undefined. */
function oldestTime(times: (string | undefined)[]): string | undefined {
  const valid = times.filter((x): x is string => !!x && !Number.isNaN(Date.parse(x)))
  return valid.sort((a, b) => Date.parse(a) - Date.parse(b))[0]
}

/** `preselect` is built once per opening: the dialog compares it by identity. */
type Assigning = { zone: MicrosegZone; preselect: string[] }

/** Where the zone menu was opened: a row's Fix, or the bulk bar for the guests selected. */
type MenuFor = { anchor: HTMLElement; guests: string[] }

const COLUMNS = 6

type GroupProps = {
  group: DriftGroup<ClusterDrift>
  render: (drift: ClusterDrift) => React.ReactNode
  rowKey: (drift: ClusterDrift) => string
  selectedKeys: ReadonlySet<string>
  onSelectAll: (keys: string[], selected: boolean) => void
}

/** One kind of drift: a header row (chevron, kind chip, "Running guests in no zone (10)", group checkbox), its rows ten per page. */
function DriftGroupBody({ group, render, rowKey, selectedKeys, onSelectAll }: GroupProps) {
  const t = useTranslations('microsegPilot.drifts')
  const tk = useTranslations('microsegPilot.drifts.kind')
  const [open, setOpen] = useState(true)
  const paged = usePaged(group.drifts)
  const keys = group.drifts.map(rowKey)
  const chosen = keys.filter(k => selectedKeys.has(k)).length
  const known = KNOWN_KINDS.includes(group.kind)
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
 * dialog, a draft change) and ignore them. "Fix" only touches the draft (the assign dialog, an address allowed for
 * the IP filter of a guest) or opens the plan;
 * nothing is written to Proxmox from here. "Ignore" hides a drift in this browser.
 */
export default function DriftsPanel({ connectionId, policy, reloadPolicy, onOpenPlan, goToSubTab, driftsZone = null, anchor, clusterIds, clusterName }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.drifts')
  const tk = useTranslations('microsegPilot.drifts.kind')
  const format = useFormatter()
  // Every cluster of the group, once it is known; the connection alone for a policy of one cluster.
  const ids = useMemo(() => clustersToRead(connectionId, { anchor, clusterIds }), [connectionId, anchor, clusterIds])
  const shared = ids.length > 1
  const reads = useMergedClusters(ids, useClusterDrifts)
  const merged = useMemo(() => mergeDrifts(shownAnswers(reads, shared), ids), [reads, shared, ids])
  const drifts = merged.answered ? merged.drifts : undefined
  // On a shared policy each failed cluster says so on its own line; on one cluster the error is the list's, as before.
  const failed = shared ? reads.errors : {}
  const error = shared ? Object.values(reads.errors)[0] : reads.errors[connectionId]
  const { loading, reload } = reads
  // Until the first full run since the engine started, an empty list would read as "no drift": say it is waiting instead.
  const waiting = !!drifts && !merged.computed
  const tm = useTranslations('microsegPilot')
  const statuses = useMergedClusters(ids, useMicrosegStatus)
  const { guests } = useGroupGuests(ids)
  // Each row is ignored on its own cluster (stored under it, plain key): the same set whichever cluster the page was opened from.
  const { isIgnored, ignore, restore } = useIgnoredClusterDrifts(ids)
  // The bulk assignment writes the members of each guest's cluster: the right on one cluster of the policy opens it.
  const { canWriteSome: canWrite } = useMicrosegClusterWrite()
  const [showIgnored, setShowIgnored] = useState(false)
  const [kindFilter, setKindFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<MenuFor | null>(null)
  const [assigning, setAssigning] = useState<Assigning | null>(null)
  // The drift whose held address is being allowed (the IP filter), until its confirmation closes.
  const [allowing, setAllowing] = useState<ClusterDrift | null>(null)

  const rowKey = useMemo(() => (d: ClusterDrift) => driftRowKey(d, shared), [shared])
  // A cluster outside the user's scope is never named by the backend's text: the page's lookup or "Another cluster".
  const nameOf = useMemo(() => (id: string) => shownClusterName(id, connectionId, clusterName, id), [connectionId, clusterName])
  const labelOf = (d: ClusterDrift) => driftLabel(d, tk, nameOf)
  const guestsById = useMemo(() => new Map(guests.map(g => [guestId(g), g])), [guests])
  const ignoredOf = useMemo(() => (d: ClusterDrift) => isIgnored(d.connection_id, driftKey(d)), [isIgnored])
  const ignoredCount = useMemo(() => (drifts ?? []).filter(ignoredOf).length, [drifts, ignoredOf])
  // Opened from a zone panel: the drifts of that zone (its own, or of one of its members), until the filter is cleared.
  const filterZone = driftsZone ? policy.zones.find(z => z.id === driftsZone) ?? null : null
  const memberIds = useMemo(() => {
    if (!filterZone) return null
    const tag = `${policy.policy.tag_prefix}${filterZone.name}`.toLowerCase()
    return new Set(guests.filter(g => g.tags.some(x => x.toLowerCase() === tag)).map(g => guestId(g)))
  }, [filterZone, guests, policy.policy.tag_prefix])
  const visible = useMemo(
    () => (drifts ?? []).filter(d => (showIgnored || !ignoredOf(d))
      && (!filterZone || zoneOfDrift(d, policy.zones)?.id === filterZone.id || (!!d.guest && !!memberIds?.has(driftGuestId(d)!)))),
    [drifts, ignoredOf, showIgnored, filterZone, memberIds, policy.zones],
  )
  const counts = useMemo(() => kindCounts(visible), [visible])
  // A kind filter left on a kind that is gone shows everything again.
  const shownKind = kindFilter && counts.some(c => c.kind === kindFilter) ? kindFilter : null
  const groups = useMemo(() => groupDrifts(visible, shownKind), [visible, shownKind])
  const byKey = useMemo(() => new Map(visible.map(d => [rowKey(d), d])), [visible, rowKey])
  // The selection keeps only what is still shown.
  const chosen = [...selected].map(k => byKey.get(k)).filter((d): d is ClusterDrift => !!d && (!shownKind || d.kind === shownKind))
  const chosenIgnorable = chosen.filter(canIgnoreDrift)
  // Only the drifts an assignment fixes (a running guest in no zone, a guest in several zones) go to the assign dialog.
  const chosenGuests = [...new Set(chosen.filter(d => d.guest && labelOf(d).fix === 'assign').map(d => driftGuestId(d)!))]

  // When the drifts were found: the last full run of their cluster (the oldest of the clusters for the whole list).
  const lastFullOf = (id: string) => statuses.byCluster[id]?.engine.last_runs?.full?.started_at
  const anyStatus = ids.some(id => statuses.byCluster[id])
  const lastFull = shared ? oldestTime(ids.map(lastFullOf)) : lastFullOf(connectionId)
  let asOf = anyStatus ? t('asOfNone') : ''
  if (lastFull && !Number.isNaN(Date.parse(lastFull))) asOf = t('asOf', { time: formatWhen(format, lastFull) })
  const sinceOf = (id: string) => {
    const at = lastFullOf(id)
    return at && !Number.isNaN(Date.parse(at)) ? formatWhen(format, at) : '-'
  }

  const subjectOf = (d: ClusterDrift) => {
    if ((CLUSTER_DRIFT_KINDS as readonly string[]).includes(d.kind)) return clusterDriftSubject(d, tk('clusterOther'), nameOf)
    if (d.guest) return guestsById.get(driftGuestId(d)!)?.name ?? (typeof d.detail?.name === 'string' && d.detail.name ? d.detail.name : `${d.guest.type}/${d.guest.vmid}`)
    return d.object ?? '-'
  }

  const onFix = (drift: ClusterDrift, label: ReturnType<typeof driftLabel>, anchorEl: HTMLElement) => {
    if (label.fix === 'assign' && drift.guest) setMenu({ anchor: anchorEl, guests: [driftGuestId(drift)!] })
    else if (label.fix === 'allow') setAllowing(drift)
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
    ignore(chosenIgnorable.map(d => ({ connectionId: d.connection_id, key: driftKey(d) })))
    setSelected(new Set())
  }

  if (!drifts) {
    if (error) {
      return (
        <Box sx={{ px: 3 }}>
          <ClusterUnreadLines errors={failed} tabConnection={connectionId} clusterName={clusterName} />
          <MicrosegErrorAlert error={error} onRetry={reload} />
        </Box>
      )
    }
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3 }}>
        <CircularProgress size={20} />
        <Typography color='text.secondary'>{loading ? t('loading') : ''}</Typography>
      </Box>
    )
  }

  const renderRow = (drift: ClusterDrift) => {
    const label = labelOf(drift)
    const key = rowKey(drift)
    const chipName = shared ? shownClusterName(drift.connection_id, connectionId, clusterName, tk('clusterOther')) : null
    return (
      <DriftRow
        key={key}
        drift={drift}
        label={label}
        subject={subjectOf(drift)}
        zone={zoneOfDrift(drift, policy.zones)}
        guest={drift.guest ? guestsById.get(driftGuestId(drift)!) ?? null : null}
        since={sinceOf(drift.connection_id)}
        cluster={chipName === null ? undefined : { id: drift.connection_id, name: chipName }}
        ignorable={canIgnoreDrift(drift)}
        ignored={ignoredOf(drift)}
        hasZones={policy.zones.length > 0}
        selected={selected.has(key)}
        onSelect={on => select([key], on)}
        onFix={anchor => onFix(drift, label, anchor)}
        onIgnore={() => ignore([{ connectionId: drift.connection_id, key: driftKey(drift) }])}
        onRestore={() => restore({ connectionId: drift.connection_id, key: driftKey(drift) })}
        onChanged={() => {
          // The status too: the banner and the tiles read the same answers and must not keep saying it is off.
          void reload()
          void statuses.reload()
        }}
      />
    )
  }

  return (
    <Box sx={{ px: 3, pb: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {!shared && !!error && <MicrosegErrorAlert error={error} onRetry={reload} />}
      <ClusterUnreadLines errors={failed} tabConnection={connectionId} clusterName={clusterName} />
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

          {/* The groups scroll inside the sub-tab; the bulk bar stays pinned under them. */}
          <Box data-testid='drift-scroll' sx={{ flex: '1 1 0', minHeight: 240, overflow: 'auto' }}>
            <Table size='small' stickyHeader aria-label={t('tableLabel')} sx={{ '& td, & th': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell padding='checkbox' />
                  <TableCell>{t('colObject')}</TableCell>
                  <TableCell>{t('colZone')}</TableCell>
                  <TableCell>{t('colDiffers')}</TableCell>
                  <TableCell>
                    <Tooltip title={t('colSinceHint')}><span>{t('colSince')}</span></Tooltip>
                  </TableCell>
                  <TableCell align='right'>{t('colActions')}</TableCell>
                </TableRow>
              </TableHead>
              {groups.map(group => (
                <DriftGroupBody key={group.kind} group={group} render={renderRow} rowKey={rowKey} selectedKeys={selected} onSelectAll={select} />
              ))}
            </Table>
          </Box>
          {chosen.length > 0 && (
            <Box data-testid='drift-bulk' sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 40, px: 1.5, mt: 1, flexShrink: 0, borderRadius: 1, bgcolor: 'action.selected' }}>
              <Typography variant='body2' fontWeight={600} sx={{ flex: 1, minWidth: 0 }} noWrap>{t('bulkSelected', { count: chosen.length })}</Typography>
              {chosenGuests.length > 0 && (
                <WriteTip allowed={canWrite} title={policy.zones.length ? '' : t('noZone')}>
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
              {chosenIgnorable.length > 0 && <Button size='small' variant='outlined' onClick={ignoreChosen}>{t('bulkIgnore', { count: chosenIgnorable.length })}</Button>}
              <Button size='small' onClick={() => setSelected(new Set())}>{t('bulkClear')}</Button>
            </Box>
          )}

        </>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)} slotProps={{ list: { 'aria-label': t('assignMenu') } }}>
        {policy.zones.map(zone => <MenuItem key={zone.id} onClick={() => pickZone(zone)}>{zone.name}</MenuItem>)}
      </Menu>
      {allowing?.guest && typeof allowing.detail?.addr === 'string' && (
        <AllowAddressDialog
          connectionId={connectionId}
          policy={policy}
          reloadPolicy={reloadPolicy}
          guest={{ connectionId: allowing.connection_id, type: allowing.guest.type, vmid: allowing.guest.vmid, name: subjectOf(allowing) }}
          addr={allowing.detail.addr}
          onDone={() => { setAllowing(null); void reload() }}
          onCancel={() => setAllowing(null)}
        />
      )}
      {assigning && (
        <AssignGuestsDialog
          open
          connectionId={connectionId}
          clusterIds={shared ? ids : undefined}
          clusterName={shared ? clusterName : undefined}
          zone={assigning.zone}
          policy={policy}
          reloadPolicy={reloadPolicy}
          preselect={assigning.preselect}
          onClose={() => setAssigning(null)}
          onAssigned={() => setSelected(new Set())}
        />
      )}
    </Box>
  )
}
