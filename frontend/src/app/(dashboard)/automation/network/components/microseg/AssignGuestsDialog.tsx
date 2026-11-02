'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, TextField, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegPolicy, MicrosegZone } from '@/lib/microseg/types'

import { assignRows, filterRows, GUESTS_PAGE_SIZE, isSelectable, MAX_ASSIGN, type AssignRow } from './assignModel'
import { DialogErrorLine, isVersionConflict, ONE_LINE_SX, OneLine, useDialogAction } from './dialogParts'
import PolicyPager, { usePaged } from './PolicyPager'
import { useZoneGuests } from './useZoneGuests'

type Props = {
  open: boolean
  connectionId: string
  zone: MicrosegZone
  policy: MicrosegPolicy
  /** Re-reads the draft: after a save, and on a VERSION_CONFLICT. */
  reloadPolicy: () => Promise<unknown>
  /**
   * Guests (`type/vmid`) ticked when the dialog opens. A preselected guest that already carries the tag of
   * the zone stays selectable: sending it makes the zone its only one (a guest tagged with several zones).
   */
  preselect?: string[]
  onClose: () => void
}

function GuestLine({ row, zoneName, checked, selectable, onToggle }: { row: AssignRow; zoneName: string; checked: boolean; selectable: boolean; onToggle: () => void }) {
  const t = useTranslations('microsegPilot.policy.assign')
  const { guest } = row
  const others = row.otherZones.join(', ')
  return (
    <Box role='listitem' aria-label={guest.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 36 }}>
      <Checkbox
        size='small'
        checked={checked || !selectable}
        disabled={!selectable}
        onChange={onToggle}
        slotProps={{ input: { 'aria-label': guest.name } }}
        sx={{ p: 0.5 }}
      />
      <StatusIcon type='vm' vmType={guest.type} status={guest.status} />
      <Tooltip title={guest.name}><Typography noWrap sx={{ flex: '0 1 auto' }}>{guest.name}</Typography></Tooltip>
      <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{`${guest.vmid} · ${guest.node}`}</Typography>
      {row.member === 'tag' && !row.change && <Chip size='small' variant='outlined' label={t('member')} sx={{ flexShrink: 0 }} />}
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
      {row.member === 'pending' && (
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
 * Assign guests to a zone. The selection is sent as pending members of the zone
 * (a draft): nothing is written to Proxmox until the plan is applied. A guest
 * of another zone is flagged and will be moved. Select-all covers every
 * filtered guest, across pages.
 */
export default function AssignGuestsDialog({ open, connectionId, zone, policy, reloadPolicy, preselect, onClose }: Props) {
  const t = useTranslations('microsegPilot.policy.assign')
  const tc = useTranslations('common')
  const { guests, status } = useZoneGuests(connectionId)
  const { busy, error, run } = useDialogAction()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselect))

  const rows = useMemo(
    () => assignRows(zone, policy.zones, policy.policy.tag_prefix, guests, policy.pending_members),
    [zone, policy.zones, policy.policy.tag_prefix, guests, policy.pending_members],
  )
  const filtered = useMemo(() => filterRows(rows, search), [rows, search])
  const paged = usePaged(filtered, GUESTS_PAGE_SIZE)

  // A guest that became a member (after a reload) drops out of the selection.
  const canTick = useCallback((r: AssignRow) => isSelectable(r) || (r.member === 'tag' && !!preselect?.includes(r.key)), [preselect])
  const chosen = useMemo(() => rows.filter(r => canTick(r) && selected.has(r.key)), [rows, selected, canTick])
  const selectable = filtered.filter(canTick)
  const selectedInFilter = selectable.filter(r => selected.has(r.key)).length
  const allChecked = selectable.length > 0 && selectedInFilter === selectable.length
  const tooMany = chosen.length > MAX_ASSIGN

  const toggle = (key: string) => setSelected(prev => {
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

  const submit = async () => {
    if (chosen.length === 0 || tooMany) return
    const api = microsegApi(connectionId)
    const ok = await run(async () => {
      try {
        await api.setMembers({ version: policy.version, zone_id: zone.id, guests: chosen.map(r => r.ref) })
      } catch (e) {
        if (isVersionConflict(e)) await reloadPolicy().catch(() => undefined)
        throw e
      }
      await reloadPolicy().catch(() => undefined)
    })
    if (ok) onClose()
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
              <Typography noWrap sx={{ flex: 1, minWidth: 0 }}>{t('selectAllCount', { count: selectable.length })}</Typography>
              <Typography noWrap variant='body2' color='text.secondary' sx={{ flexShrink: 0 }}>{t('selected', { count: chosen.length })}</Typography>
            </Box>
            {filtered.length === 0 ? (
              <OneLine text={t('noMatch')} />
            ) : (
              <>
                <Box role='list'>
                  {paged.rows.map(row => (
                    <GuestLine key={row.key} row={row} zoneName={zone.name} checked={selected.has(row.key)} selectable={canTick(row)} onToggle={() => toggle(row.key)} />
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
        {error && <Box sx={{ mt: 1 }}><DialogErrorLine message={error} /></Box>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
        <Button onClick={submit} variant='contained' disabled={busy || chosen.length === 0 || tooMany}>
          {t('confirm', { count: chosen.length })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
