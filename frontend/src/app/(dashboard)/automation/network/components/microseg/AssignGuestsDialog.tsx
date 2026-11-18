'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, TextField, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegPolicy, MicrosegZone } from '@/lib/microseg/types'

import { assignRows, chosenByCluster, filterRows, GUESTS_PAGE_SIZE, isRemovable, isSelectable, MAX_ASSIGN, membersBody, removalBodies, type AssignRow } from './assignModel'
import ClusterChip from './ClusterChip'
import { DialogErrorLine, isVersionConflict, ONE_LINE_SX, OneLine, useDialogAction, writeErrorMessage } from './dialogParts'
import { GroupGuestsUnread } from './GroupGuestsUnread'
import PolicyPager, { usePaged } from './PolicyPager'
import { useGroupGuests, visibleClusterNames } from './useGroupGuests'
import { guestId } from './zoneModel'
import TruncatedText from './TruncatedText'
import { useMicrosegClusterWrite } from './microsegAccess'

type Props = {
  open: boolean
  /** The connection the policy is read through. */
  connectionId: string
  /** The clusters sharing the policy, whose guests are listed; the connection alone when absent. */
  clusterIds?: string[]
  /** Names a cluster (the cluster chip of each guest of a shared policy, and a partial save). */
  clusterName?: (id: string) => string
  zone: MicrosegZone
  policy: MicrosegPolicy
  /** Re-reads the draft: after a save, and on a VERSION_CONFLICT. */
  reloadPolicy: () => Promise<unknown>
  /**
   * Guests ticked when the dialog opens, by `guestId`, or by `type/vmid` for a guest of `connectionId`. A preselected
   * guest that already carries the tag of the zone stays selectable: sending it makes the zone its only one (a guest
   * tagged with several zones).
   */
  preselect?: string[]
  onClose: () => void
  /** The assignment was saved (called before onClose): a caller holding a selection clears it then, not on Cancel. */
  onAssigned?: () => void
}

/** A preselected `type/vmid` names a guest of the dialog's connection (one cluster's key). */
const ONE_CLUSTER_KEY = /^(qemu|lxc)\/(\d+)$/

function preselectIds(preselect: readonly string[] | undefined, connectionId: string): string[] {
  return (preselect ?? []).map(key => {
    const one = ONE_CLUSTER_KEY.exec(key)
    return one ? guestId({ connectionId, type: one[1], vmid: Number(one[2]) }) : key
  })
}

function GuestLine({ row, zoneName, checked, selectable, removing, onToggle, cluster }: { row: AssignRow; zoneName: string; checked: boolean; selectable: boolean; removing: boolean; onToggle: () => void; cluster?: string }) {
  const t = useTranslations('microsegPilot.policy.assign')
  const { guest } = row
  const others = row.otherZones.join(', ')
  return (
    <Box role='listitem' aria-label={guest.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 36 }}>
      <Checkbox
        size='small'
        checked={checked}
        disabled={!selectable}
        onChange={onToggle}
        slotProps={{ input: { 'aria-label': guest.name } }}
        sx={{ p: 0.5 }}
      />
      <StatusIcon type='vm' vmType={guest.type} status={guest.status} />
      {cluster !== undefined && <ClusterChip connectionId={guest.connectionId} name={cluster} compact />}
      <TruncatedText text={guest.name} sx={{ flex: '0 1 auto' }} />
      <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{`${guest.vmid} · ${guest.node}`}</Typography>
      {row.member === 'tag' && !row.change && !removing && <Chip size='small' variant='outlined' label={t('member')} sx={{ flexShrink: 0 }} />}
      {removing && (
        <Tooltip title={t('willRemoveHint')}>
          <Chip size='small' color='warning' variant='outlined' label={t('willRemove')} sx={{ flexShrink: 0 }} />
        </Tooltip>
      )}
      {row.change?.kind === 'removal' && (
        <Tooltip title={t('removalHint')}>
          <Chip size='small' color='warning' variant='outlined' label={t('pendingRemoval')} sx={{ flexShrink: 0 }} />
        </Tooltip>
      )}
      {row.change?.kind === 'move' && (
        <Tooltip title={t('moveHint', { zone: row.change.zoneName })}>
          <Chip size='small' color='warning' variant='outlined' label={t('pendingMove', { zone: row.change.zoneName })} sx={{ flexShrink: 1, minWidth: 0, maxWidth: 200 }} />
        </Tooltip>
      )}
      {row.member === 'pending' && !removing && (
        <Tooltip title={t('pendingHint')}>
          <Chip size='small' color='warning' variant='outlined' label={t('pending')} sx={{ flexShrink: 0 }} />
        </Tooltip>
      )}
      {others && row.member === null && (
        <Tooltip title={t('movedHint', { zones: others, zone: zoneName })}>
          <Chip
            size='small'
            color='warning'
            variant='outlined'
            icon={<i className='ri-alert-line' />}
            label={others}
            sx={{ flexShrink: 1, minWidth: 0, maxWidth: 180 }}
          />
        </Tooltip>
      )}
    </Box>
  )
}

/**
 * Assign guests to a zone, or take members out of it. The selection is sent as
 * pending members of the zone (a draft): nothing is written to Proxmox until
 * the plan is applied. A guest of another zone is flagged and will be moved; a
 * member is ticked, and unticking it queues its removal (or forgets it when it
 * was only queued for the zone). Select-all covers every
 * filtered guest, across pages. On a shared policy the guests of every cluster
 * are listed (each with its cluster chip) and the selection is sent once per
 * cluster, through that cluster, each request with the draft version the
 * previous one answered.
 */
export default function AssignGuestsDialog({ open, connectionId, clusterIds, clusterName, zone, policy, reloadPolicy, preselect, onClose, onAssigned }: Props) {
  const t = useTranslations('microsegPilot.policy.assign')
  const tc = useTranslations('common')
  const tAll = useTranslations()
  const groupIds = clusterIds ?? [connectionId]
  const shared = groupIds.length > 1
  // Members are written on each guest's cluster: the guests of a cluster the user may not write are not offered.
  const { canWriteOn } = useMicrosegClusterWrite()
  const { guests, status, errors } = useGroupGuests(groupIds.filter(id => canWriteOn(id)))
  const { busy, error, run } = useDialogAction()
  // A save that went through on some clusters and not on the next one: said instead of the plain error.
  const [partial, setPartial] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const preselected = useMemo(() => preselectIds(preselect, connectionId), [preselect, connectionId])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected))
  // The members unticked: taken out of the zone on Save.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())

  const rows = useMemo(
    () => assignRows(zone, policy.zones, policy.policy.tag_prefix, guests, policy.pending_members),
    [zone, policy.zones, policy.policy.tag_prefix, guests, policy.pending_members],
  )
  const filtered = useMemo(() => filterRows(rows, search), [rows, search])
  const paged = usePaged(filtered, GUESTS_PAGE_SIZE)

  // A guest that became a member (after a reload) drops out of the selection.
  const canTick = useCallback((r: AssignRow) => isSelectable(r) || (r.member === 'tag' && preselected.includes(r.key)), [preselected])
  const chosen = useMemo(() => rows.filter(r => canTick(r) && selected.has(r.key)), [rows, selected, canTick])
  // A member is unticked to take it out; one that is ticked to be assigned again (canTick) keeps that meaning.
  const canUntick = useCallback((r: AssignRow) => isRemovable(r) && !canTick(r), [canTick])
  const removals = useMemo(() => rows.filter(r => canUntick(r) && removed.has(r.key)), [rows, removed, canUntick])
  const selectable = filtered.filter(canTick)
  const selectedInFilter = selectable.filter(r => selected.has(r.key)).length
  const allChecked = selectable.length > 0 && selectedInFilter === selectable.length
  const tooMany = chosen.length > MAX_ASSIGN
  const failure = partial ?? error

  const toggle = (key: string) => setSelected(prev => {
    const next = new Set(prev)
    if (!next.delete(key)) next.add(key)
    return next
  })
  const toggleRemoved = (key: string) => setRemoved(prev => {
    const next = new Set(prev)
    if (!next.delete(key)) next.add(key)
    return next
  })
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    for (const r of selectable) {
      if (allChecked) next.delete(r.key)
      else next.add(r.key)
    }
    return next
  })
  const onSearch = (value: string) => {
    setSearch(value)
    paged.setPage(0)
  }

  const partialText = (saved: string[], e: unknown) => {
    const names = visibleClusterNames(saved, clusterName)
    const reason = writeErrorMessage(tAll as (key: string) => string, e)
    return names ? t('partial', { clusters: names.join(', '), error: reason }) : t('partialSome', { error: reason })
  }

  const submit = async () => {
    if (chosen.length + removals.length === 0 || tooMany) return
    setPartial(null)
    const ok = await run(async () => {
      // POST /members writes the rows of its URL's cluster only: the requests of a cluster go through it, one after
      // the other (the guests to assign, then the members to take out), never retried on their own.
      const saved: string[] = []
      let version = policy.version
      const assigned = new Map(chosenByCluster(chosen))
      const takenOut = new Map(chosenByCluster(removals))
      const clusters = [...new Set([...assigned.keys(), ...takenOut.keys()])].sort((a, b) => a.localeCompare(b))
      try {
        for (const cluster of clusters) {
          const bodies = [
            ...(assigned.has(cluster) ? [(v: number) => membersBody(v, zone.id, assigned.get(cluster)!)] : []),
            ...removalBodies(takenOut.get(cluster) ?? []),
          ]
          for (const body of bodies) {
            const answer = await microsegApi(cluster).setMembers(body(version))
            version = answer?.version ?? version
          }
          saved.push(cluster)
        }
      } catch (e) {
        if (saved.length > 0 || isVersionConflict(e)) await reloadPolicy().catch(() => undefined)
        if (saved.length > 0) setPartial(partialText(saved, e))
        throw e
      }
      await reloadPolicy().catch(() => undefined)
    })
    if (ok) {
      onAssigned?.()
      onClose()
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth='md' fullWidth aria-labelledby='microseg-assign-title'>
      <DialogTitle id='microseg-assign-title' sx={ONE_LINE_SX}>{t('title', { zone: zone.name })}</DialogTitle>
      <DialogContent>
        <OneLine text={t('draftNote')} />
        <TextField
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={t('search')}
          size='small'
          fullWidth
          sx={{ my: 1.5 }}
          slotProps={{
            htmlInput: { 'aria-label': t('search') },
            input: { startAdornment: <InputAdornment position='start'><i className='ri-search-line' /></InputAdornment> },
          }}
        />
        {status === 'loading' && <OneLine text={t('loading')} />}
        {status === 'error' && <OneLine text={t('loadFailed')} color='error.main' />}
        {status === 'ready' && <GroupGuestsUnread errors={errors} clusterName={clusterName} />}
        {status === 'ready' && rows.length === 0 && <OneLine text={t('noGuests')} />}
        {status === 'ready' && rows.length > 0 && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 36, borderBottom: 1, borderColor: 'divider' }}>
              <Checkbox
                size='small'
                checked={allChecked}
                indeterminate={selectedInFilter > 0 && !allChecked}
                disabled={selectable.length === 0}
                onChange={toggleAll}
                slotProps={{ input: { 'aria-label': t('selectAll') } }}
                sx={{ p: 0.5 }}
              />
              <Typography noWrap sx={{ flex: 1, minWidth: 0 }}>{selectable.length === filtered.length ? t('selectAllCount', { count: selectable.length }) : t('selectAllCountOf', { count: selectable.length, total: filtered.length })}</Typography>
              <Typography noWrap variant='body2' color='text.secondary' sx={{ flexShrink: 0 }}>{t('selected', { count: chosen.length })}</Typography>
            </Box>
            {filtered.length === 0 ? (
              <OneLine text={t('noMatch')} />
            ) : (
              <>
                <Box role='list'>
                  {paged.rows.map(row => (
                    <GuestLine
                      key={row.key}
                      row={row}
                      zoneName={zone.name}
                      checked={canUntick(row) ? !removed.has(row.key) : selected.has(row.key)}
                      selectable={canTick(row) || canUntick(row)}
                      removing={canUntick(row) && removed.has(row.key)}
                      onToggle={() => (canUntick(row) ? toggleRemoved(row.key) : toggle(row.key))}
                      cluster={shared ? clusterName?.(row.guest.connectionId) ?? row.guest.connectionId : undefined}
                    />
                  ))}
                </Box>
                <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
              </>
            )}
          </>
        )}
        {tooMany && (
          <Alert severity='warning' sx={{ mt: 1, '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden' } }}>
            <Tooltip title={t('tooMany', { max: MAX_ASSIGN, count: chosen.length })}>
              <Typography variant='body2' noWrap>{t('tooMany', { max: MAX_ASSIGN, count: chosen.length })}</Typography>
            </Tooltip>
          </Alert>
        )}
        {failure && <Box sx={{ mt: 1 }}><DialogErrorLine message={failure} /></Box>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
        <Button onClick={submit} variant='contained' disabled={busy || chosen.length + removals.length === 0 || tooMany}>
          {removals.length > 0 ? t('confirmChanges', { add: chosen.length, remove: removals.length }) : t('confirm', { count: chosen.length })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
