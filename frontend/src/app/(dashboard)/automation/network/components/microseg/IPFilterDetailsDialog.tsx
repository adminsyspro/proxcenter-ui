'use client'

import { useMemo, useState } from 'react'
import { Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { clusterGuestId } from '@/lib/microseg/pendingChanges'
import { useMergedClusters } from '@/lib/microseg/useMerged'
import { useClusterIPFilter } from '@/lib/microseg/useMicrosegLists'
import type { IPFilterGuest } from '@/lib/microseg/types'

import ClusterChip from './ClusterChip'
import { shownClusterName } from './ClusterRunRow'
import { ONE_LINE_SX } from './dialogParts'
import IPFilterLines, { FilterStateChip } from './IPFilterLines'
import { allowedCount, needsAttention, rowState } from './ipFilterModel'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PolicyPager, { usePaged } from './PolicyPager'
import TruncatedText from './TruncatedText'
import { useGroupGuests } from './useGroupGuests'

/** The members listed on one page of the dialog. */
export const IP_FILTER_PAGE_SIZE = 25

type Props = {
  /** The connection of the tab: the cluster read when no other is given, and the one always named. */
  connectionId: string
  /** The clusters to list (the clusters of a shared policy, or the one cluster of a pre-flight line); the connection alone when absent. */
  clusterIds?: readonly string[]
  clusterName?: (id: string) => string
  onClose: () => void
}

type Row = IPFilterGuest & { connectionId: string; key: string }

function MemberRow({ row, status, cluster, open, onToggle }: Readonly<{ row: Row; status: string | undefined; cluster: string | null; open: boolean; onToggle: () => void }>) {
  const t = useTranslations('microsegPilot.ipFilter.details')
  return (
    <Box role='listitem' aria-label={row.name} data-guest={row.key} sx={{ borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 40, minWidth: 0 }}>
        <IconButton size='small' aria-expanded={open} aria-label={t(open ? 'collapse' : 'expand', { name: row.name })} onClick={onToggle}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <StatusIcon type='vm' vmType={row.type} status={status} />
        {cluster !== null && <ClusterChip connectionId={row.connectionId} name={cluster} compact />}
        <TruncatedText text={row.name} fontWeight={600} sx={{ flex: '0 1 auto', minWidth: 0 }} />
        <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{`${row.vmid} · ${row.node}`}</Typography>
        <Chip size='small' variant='outlined' icon={<i className='ri-shield-fill' style={{ fontSize: 14 }} />} label={row.zone} sx={{ flexShrink: 1, minWidth: 0, maxWidth: 140 }} />
        <FilterStateChip state={rowState(row)} />
        <Typography noWrap variant='body2' color='text.secondary' sx={{ flexShrink: 0, width: 96, textAlign: 'right' }}>{t('addresses', { count: allowedCount(row) })}</Typography>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 5, pb: 1, minWidth: 0 }}>
          <IPFilterLines guest={row} />
        </Box>
      </Collapse>
    </Box>
  )
}

/**
 * "IP filter: addresses per member": the members of the zones as GET /ipfilter lists them (the engine's memory, no
 * Proxmox call), 25 per page, one line each (glyph and status, name, VMID and node, zone, state, how many addresses),
 * the lists per NIC behind a chevron. A box keeps only the members that need attention. Read only.
 */
export default function IPFilterDetailsDialog({ connectionId, clusterIds, clusterName, onClose }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.ipFilter.details')
  const tm = useTranslations('microsegPilot')
  const tc = useTranslations('common')
  const ids = useMemo(() => (clusterIds && clusterIds.length > 0 ? [...clusterIds] : [connectionId]), [clusterIds, connectionId])
  const shared = ids.length > 1
  const reads = useMergedClusters(ids, useClusterIPFilter)
  const { guests } = useGroupGuests(ids)
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())

  const statusOf = useMemo(() => new Map(guests.map(g => [clusterGuestId(g.connectionId, g.type, g.vmid), g.status])), [guests])
  const answers = ids.map(id => reads.byCluster[id]).filter(a => a !== undefined)
  const waiting = answers.length > 0 && answers.every(a => !a.computed)
  const rows = useMemo(() => ids.flatMap(id => {
    const data = reads.byCluster[id]
    if (!data?.computed || id in reads.errors) return []
    return data.guests.map((g): Row => ({ ...g, connectionId: id, key: clusterGuestId(id, g.type, g.vmid) }))
  }), [ids, reads])
  const shown = useMemo(() => (onlyAttention ? rows.filter(needsAttention) : rows), [rows, onlyAttention])
  const paged = usePaged(shown, IP_FILTER_PAGE_SIZE)
  const error = Object.values(reads.errors)[0]
  const other = tm('plan.cluster.other')

  const toggle = (key: string) => setOpened(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return (
    <Dialog open onClose={onClose} maxWidth='md' fullWidth scroll='paper' aria-labelledby='microseg-ipfilter-details-title'>
      <DialogTitle id='microseg-ipfilter-details-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 36, minWidth: 0 }}>
          <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{t('count', { count: shown.length })}</Typography>
          <FormControlLabel
            control={<Checkbox size='small' checked={onlyAttention} onChange={e => setOnlyAttention(e.target.checked)} />}
            label={<Typography variant='body2' noWrap>{t('onlyAttention')}</Typography>}
            sx={{ mr: 0, flexShrink: 0 }}
          />
        </Box>
        {error != null && <MicrosegErrorAlert error={error} onRetry={reads.reload} />}
        {reads.loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
            <CircularProgress size={18} />
            <Typography color='text.secondary' noWrap>{t('loading')}</Typography>
          </Box>
        )}
        {waiting && <Typography variant='body2' color='text.secondary' noWrap>{tm('waitingFirstCheck')}</Typography>}
        {!reads.loading && !waiting && error == null && shown.length === 0 && (
          <Typography variant='body2' color='text.disabled' noWrap>{t(onlyAttention ? 'emptyAttention' : 'empty')}</Typography>
        )}
        <Box role='list' aria-label={t('title')}>
          {paged.rows.map(row => (
            <MemberRow
              key={row.key}
              row={row}
              status={statusOf.get(row.key)}
              cluster={shared ? shownClusterName(row.connectionId, connectionId, clusterName, other) : null}
              open={opened.has(row.key)}
              onToggle={() => toggle(row.key)}
            />
          ))}
        </Box>
        <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'flex-end' }}>
        <Button onClick={onClose} variant='contained'>{tc('close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
