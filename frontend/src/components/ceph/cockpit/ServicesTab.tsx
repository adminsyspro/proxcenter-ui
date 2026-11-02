'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import {
  Box, Button, Card, Dialog, DialogActions, DialogContent, IconButton, MenuItem, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import CephCreateDaemonDialog from '@/components/ceph/CephCreateDaemonDialog'
import { CephServiceActionsCell } from '@/components/ceph/CephServiceActions'
import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useRBAC } from '@/contexts/RBACContext'
import { nodesWithout, runningVersions, serviceRows, SERVICE_KINDS, type ServiceKind, type ServiceRow } from '@/lib/ceph/services'

import type { CephInventory } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import { fillColumnLg, fillGrowLg, HostGlyph, StateDot, Tag, TABULAR } from './ui'

/*
   Services tab of the Ceph cockpit: monitors, managers and metadata servers in one table
   grouped by kind (host, state, role, address, version, start, stop and restart through
   CephServiceActions), the versions that run and the "Create a daemon" button. The OSDs
   have their own tab. `item=svc:mon.pve1` highlights a row. Actions target the PVE node
   the host resolves to, and stay off, with the reason, when it resolves to none.
*/

export const SERVICES_PAGE_SIZE = 20
const COLUMNS = 7
const KIND_ICON: Record<ServiceKind, string> = { mon: 'ri-eye-line', mgr: 'ri-dashboard-line', mds: 'ri-folders-line' }
const ACTION_ICONS = ['ri-play-line', 'ri-stop-line', 'ri-restart-line']
/**
 * The refreshes that follow a started task, counted from the action: the first when PVE has acted, the next ones when the cluster has
 * caught up (a stopped manager leaves the mgrmap only after several seconds). Three reads of the inventory per action, never per poll.
 */
export const RELOAD_DELAYS_MS = [5000, 20_000, 45_000]

function DisabledActions({ service, reason }: { service: string; reason: string }) {
  return (
    <TableCell align='right' sx={{ whiteSpace: 'nowrap', py: 0.5 }} data-testid={`ceph-actions-${service}`}>
      <Tooltip title={reason}>
        <Box component='span' sx={{ display: 'inline-flex', gap: 0.25 }}>
          {ACTION_ICONS.map(icon => (
            <IconButton key={icon} size='small' disabled aria-label={reason} sx={{ p: 0.5 }}><i className={icon} style={{ fontSize: 16 }} /></IconButton>
          ))}
        </Box>
      </Tooltip>
    </TableCell>
  )
}

function ServiceRowView({ row, inventory, selected, conn, canManage, onSelect, onDone }: {
  row: ServiceRow
  inventory: CephInventory
  selected: boolean
  conn: string
  canManage: boolean
  onSelect: (service: string) => void
  onDone: () => void
}) {
  const t = useTranslations('cephCockpit')
  const missing = t('overview.missing')
  const stateLabel = row.rawState ?? t(`services.state.${row.state}`)
  let role: React.ReactNode = <Typography component='span' variant='body2' color='text.disabled'>{missing}</Typography>

  if (row.leader) role = <Tag tone='ok'>{t('services.role.leader')}</Tag>
  // A stopped monitor holds no role (no quorum to be a peon of).
  else if (row.kind === 'mon' && row.state !== 'stopped') role = <Typography component='span' variant='body2' color='text.secondary'>{t('services.role.peon')}</Typography>
  else if (row.kind === 'mgr' && row.state !== 'stopped') role = row.state === 'active' ? <Tag tone='ok'>{t('services.role.active')}</Tag> : <Typography component='span' variant='body2' color='text.secondary'>{t('services.role.standby')}</Typography>
  else if (row.rank !== null) role = <Typography component='span' variant='body2' color='text.secondary' sx={TABULAR}>{t('services.role.rank', { rank: row.rank })}</Typography>

  return (
    <TableRow
      hover
      selected={selected}
      data-testid='service-row'
      data-service={row.service}
      data-state={row.dot}
      aria-current={selected ? 'true' : undefined}
      sx={{ '& td': { py: 0.875, whiteSpace: 'nowrap' } }}
    >
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className={KIND_ICON[row.kind]} style={{ fontSize: 16, opacity: 0.6 }} aria-hidden />
          <StateDot state={row.dot === 'info' ? 'muted' : row.dot} size={8} label={stateLabel} />
          <Box
            component='button'
            type='button'
            onClick={() => onSelect(row.service)}
            aria-label={t('services.select', { service: row.service })}
            sx={{ all: 'unset', cursor: 'pointer', fontSize: 13, fontWeight: 700, borderRadius: 0.5, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}
          >
            {row.service}
          </Box>
        </Box>
      </TableCell>
      <TableCell sx={{ fontSize: 12.5 }}>
        <Box data-testid='service-host' sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <HostGlyph host={row.host} inventory={inventory} />
          {row.host}
        </Box>
      </TableCell>
      <TableCell sx={{ fontSize: 12.5 }}>
        <Box component='span' data-testid='service-state' sx={{ color: row.dot === 'warn' ? 'warning.main' : 'text.primary' }}>{stateLabel}</Box>
      </TableCell>
      <TableCell>{role}</TableCell>
      <TableCell sx={{ ...TABULAR, fontSize: 12.5, color: row.addr ? 'text.secondary' : 'text.disabled' }}>{row.addr ?? missing}</TableCell>
      <TableCell sx={{ ...TABULAR, fontSize: 12.5, color: row.version ? 'text.primary' : 'text.disabled' }} data-testid='service-version'>{row.version ?? missing}</TableCell>
      {row.node ? (
        <CephServiceActionsCell
          connId={conn}
          canManage={canManage}
          target={{ kind: row.kind, service: row.service, host: row.node, running: row.running }}
          onDone={onDone}
        />
      ) : (
        <DisabledActions service={row.service} reason={t('services.noNode', { host: row.host })} />
      )}
    </TableRow>
  )
}

/** Which daemon, then on which node: the two choices before the creation dialog. */
function CreatePicker({ open, mons, mgrs, onClose, onPick }: {
  open: boolean
  mons: string[]
  mgrs: string[]
  onClose: () => void
  onPick: (kind: 'mon' | 'mgr', node: string) => void
}) {
  const t = useTranslations('cephCockpit')
  const [kind, setKind] = useState<'mon' | 'mgr'>('mon')
  const [nodePick, setNodePick] = useState('')
  const nodes = kind === 'mon' ? mons : mgrs
  const node = nodes.includes(nodePick) ? nodePick : (nodes[0] ?? '')

  return (
    <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
      <AppDialogTitle icon={<img src='/images/ceph-logo.svg' alt='' width={20} height={20} />} onClose={onClose}>{t('services.create.title')}</AppDialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '20px !important' }}>
        <Box>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 0.5 }}>{t('services.create.kind')}</Typography>
          <Select size='small' fullWidth sx={SMALL_SELECT_SX} value={kind} onChange={e => setKind(e.target.value as 'mon' | 'mgr')} inputProps={{ 'aria-label': t('services.create.kind') }}>
            <MenuItem value='mon'>{t('services.create.mon')}</MenuItem>
            <MenuItem value='mgr'>{t('services.create.mgr')}</MenuItem>
          </Select>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 0.5 }}>{t('services.create.node')}</Typography>
          <Select size='small' fullWidth sx={SMALL_SELECT_SX} value={node} disabled={nodes.length === 0} onChange={e => setNodePick(String(e.target.value))} inputProps={{ 'aria-label': t('services.create.node') }}>
            {nodes.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </Select>
          {nodes.length === 0 && <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.5 }}>{t('services.create.noNode')}</Typography>}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color='inherit'>{t('services.create.cancel')}</Button>
        <Button variant='contained' disabled={!node} onClick={() => onPick(kind, node)}>{t('services.create.next')}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function ServicesTab({ conn, inventory, url }: CockpitTabProps) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const { hasPermission } = useRBAC()
  const canManage = hasPermission('storage.admin')
  const inv = inventory.inventory
  const [page, setPage] = useState(0)
  const [followed, setFollowed] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState<{ kind: 'mon' | 'mgr'; node: string } | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const reloadRef = useRef(inventory.reload)

  useEffect(() => { reloadRef.current = inventory.reload }, [inventory.reload])
  // The follow-up reads end with the tab and with the connection they were scheduled for.
  useEffect(() => () => {
    for (const id of timers.current) clearTimeout(id)
    timers.current = []
  }, [conn])

  const rows = useMemo(() => (inv ? serviceRows(inv) : []), [inv])
  const versions = useMemo(() => (inv ? runningVersions(inv, rows) : []), [inv, rows])
  const monNodes = useMemo(() => (inv ? nodesWithout('mon', inv, rows) : []), [inv, rows])
  const mgrNodes = useMemo(() => (inv ? nodesWithout('mgr', inv, rows) : []), [inv, rows])

  if (!inv) return <Skeleton variant='rounded' height={320} data-testid='services-loading' />

  const selected = url.item?.kind === 'service' ? url.item.name : null
  const mixed = versions.length > 1
  const reload = () => {
    for (const id of timers.current) clearTimeout(id)
    timers.current = RELOAD_DELAYS_MS.map(delay => setTimeout(() => reloadRef.current(), delay))
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / SERVICES_PAGE_SIZE))
  // The page follows the row the URL selects (deep link), not the other way round.
  if (selected !== followed) {
    setFollowed(selected)
    const at = selected ? rows.findIndex(r => r.service === selected) : -1

    if (at >= 0) setPage(Math.floor(at / SERVICES_PAGE_SIZE))
  }

  const shownPage = Math.min(page, pageCount - 1)
  const slice = rows.slice(shownPage * SERVICES_PAGE_SIZE, (shownPage + 1) * SERVICES_PAGE_SIZE)
  const from = shownPage * SERVICES_PAGE_SIZE + 1
  const to = Math.min(rows.length, (shownPage + 1) * SERVICES_PAGE_SIZE)

  const groupMeta = (kind: ServiceKind): string => {
    const list = rows.filter(r => r.kind === kind)

    if (kind === 'mon') return t('services.group.monMeta', { inQuorum: list.filter(r => r.state === 'quorum').length, total: list.length })
    if (kind === 'mgr') {
      const active = list.filter(r => r.state === 'active').length
      const stopped = list.filter(r => r.state === 'stopped').length
      const standby = list.length - active - stopped

      return stopped > 0 ? t('services.group.mgrMetaStopped', { active, standby, stopped }) : t('services.group.mgrMeta', { active, standby })
    }

    return list.length === 0 ? t('services.group.none') : t('services.group.mdsMeta', { active: list.filter(r => r.state === 'active').length, total: list.length })
  }

  const header = (kind: ServiceKind) => (
    <TableRow key={`group-${kind}`} data-testid={`service-group-${kind}`} sx={{ bgcolor: 'action.hover' }}>
      <TableCell colSpan={COLUMNS} sx={{ py: 0.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className={KIND_ICON[kind]} style={{ fontSize: 15, opacity: 0.7 }} aria-hidden />
          <Typography component='span' sx={{ fontSize: 12.5, fontWeight: 700 }}>{t(`services.group.${kind}`)}</Typography>
          <Typography component='span' variant='caption' color='text.secondary' sx={TABULAR}>{t('ui.separator').trim()} {groupMeta(kind)}</Typography>
        </Box>
      </TableCell>
    </TableRow>
  )

  const body: React.ReactNode[] = []
  let last: ServiceKind | null = null

  for (const row of slice) {
    if (row.kind !== last) {
      body.push(header(row.kind))
      last = row.kind
    }
    body.push(
      <ServiceRowView
        key={row.service}
        row={row}
        inventory={inv}
        selected={row.service === selected}
        conn={conn}
        canManage={canManage}
        onSelect={service => url.set({ item: selected === service ? null : { kind: 'service', name: service } })}
        onDone={reload}
      />,
    )
  }

  // A kind with no daemon still shows its group, so "no CephFS" is read at a glance (on the last page only).
  if (shownPage === pageCount - 1) {
    for (const kind of SERVICE_KINDS) {
      if (!rows.some(r => r.kind === kind)) {
        body.push(
          <Fragment key={`empty-${kind}`}>
            {header(kind)}
            <TableRow><TableCell colSpan={COLUMNS} sx={{ color: 'text.secondary', fontSize: 12.5 }}>{t(`services.empty.${kind}`)}</TableCell></TableRow>
          </Fragment>,
        )
      }
    }
  }

  const createDisabled = !canManage || (monNodes.length === 0 && mgrNodes.length === 0)
  const createReason = !canManage ? t('services.create.noPermission') : (createDisabled ? t('services.create.noNode') : t('services.create.button'))

  return (
    <Box data-testid='services-tab' sx={fillColumnLg}>
      <Card variant='outlined' sx={{ mb: 1.5 }} data-testid='services-versions'>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', px: 2, py: 1.5 }}>
          <i className={mixed ? 'ri-error-warning-line' : 'ri-git-branch-line'} style={{ fontSize: 18, opacity: mixed ? 1 : 0.6 }} aria-hidden />
          <Box sx={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography component='span' sx={{ fontSize: 13, fontWeight: 700 }}>{mixed ? t('services.versions.mixed') : t('services.versions.title')}</Typography>
            {versions.length === 0 && <Typography component='span' variant='body2' color='text.secondary'>{t('services.versions.unknown')}</Typography>}
            {versions.map((v, i) => (
              <Tag key={v.version} tone={mixed && i > 0 ? 'warning' : 'neutral'}>
                <Box component='span' data-testid='services-version' sx={TABULAR}>{t('services.versions.item', { version: v.version, count: format.number(v.count) })}</Box>
              </Tag>
            ))}
            {mixed && <Typography component='span' variant='caption' color='text.secondary' data-testid='services-mixed'>{t('services.versions.mixedHint')}</Typography>}
          </Box>
          <Tooltip title={createReason}>
            <span>
              <Button size='small' variant='outlined' disabled={createDisabled} startIcon={<i className='ri-add-line' />} onClick={() => setPicking(true)}>
                {t('services.create.button')}
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Card>

      <Card variant='outlined' data-testid='services-card' sx={fillColumnLg}>
        <Box data-testid='services-table' sx={[{ overflowX: 'auto' }, fillGrowLg]}>
          <Table size='small' aria-label={t('services.title')}>
            <TableHead>
              <TableRow sx={{ '& th': { fontSize: 11.5, fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' } }}>
                <TableCell>{t('services.col.daemon')}</TableCell>
                <TableCell>{t('services.col.host')}</TableCell>
                <TableCell>{t('services.col.state')}</TableCell>
                <TableCell>{t('services.col.role')}</TableCell>
                <TableCell>{t('services.col.address')}</TableCell>
                <TableCell>{t('services.col.version')}</TableCell>
                <TableCell align='right'>{t('services.col.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{body}</TableBody>
          </Table>
        </Box>

        {rows.length > SERVICES_PAGE_SIZE && (
          <Box data-testid='services-pager' sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant='caption' color='text.secondary' sx={TABULAR}>{t('osd.pager.range', { from, to, total: rows.length })}</Typography>
            <IconButton size='small' aria-label={t('osd.pager.prev')} disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}><i className='ri-arrow-left-s-line' /></IconButton>
            <IconButton size='small' aria-label={t('osd.pager.next')} disabled={shownPage >= pageCount - 1} onClick={() => setPage(shownPage + 1)}><i className='ri-arrow-right-s-line' /></IconButton>
          </Box>
        )}
      </Card>

      <CreatePicker
        open={picking}
        mons={monNodes}
        mgrs={mgrNodes}
        onClose={() => setPicking(false)}
        onPick={(kind, node) => { setPicking(false); setCreating({ kind, node }) }}
      />
      {creating && (
        <CephCreateDaemonDialog
          open
          kind={creating.kind}
          connId={conn}
          node={creating.node}
          onClose={() => setCreating(null)}
          onCreated={reload}
        />
      )}
    </Box>
  )
}
