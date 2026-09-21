'use client'

// Bulk restore wizard (issue #983): restore many guests from one PBS server
// in one pass, each from its own restore point.
//
// Why a wizard and not "the per-VM dialog in a loop": the per-VM dialog asks
// for a target VMID, and a batch needs a VMID *policy* (a free range, or the
// source VMIDs with an explicit overwrite), plus a dispatch queue: PVE has no
// batch restore endpoint and a restore saturates both the PBS read and the
// target storage write, so they are fired a few at a time and tracked
// individually.
//
// ⚠️ The queue lives in this component, like the bulk migration queue in
// InventoryDetails.tsx: closing the tab stops NEW restores from being
// dispatched (the ones already handed to PVE finish server-side). The wizard
// says so on the run step.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import StorageTypeIcon from '@/components/storage/StorageTypeIcon'
import { resolveSelectedRowIds } from '@/utils/gridSelection'
import {
  buildRestoreRequest,
  filterGuestsByVmidRange,
  groupBackupsByGuest,
  isTerminal,
  planTargets,
  selectNextJobs,
  statusFromTask,
  summarizeJobs,
  type GuestBackupGroup,
  type RestoreJob,
  type TargetMode,
} from '@/lib/backups/bulkRestore'

const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

const STEP_KEYS = ['guests', 'target', 'review'] as const

const POLL_INTERVAL_MS = 2_500

interface Props {
  open: boolean
  onClose: () => void
  /** PBS server the backups are read from. */
  pbsId: string
  /** Optional preselection carried over from the page filters. */
  initialDatastore?: string
  initialNamespace?: string
  /** Dispatch + poll cadence. Only the component tests pass it, to drive the
   *  queue without waiting 2.5 s per tick. */
  pollIntervalMs?: number
}

interface ConnectionOption { id: string; name: string }
interface NodeOption { node: string; status?: string }
interface StorageOption { storage: string; type?: string; content?: string }

// Same palette as the dashboard widgets and the DRS history: a guest or a
// node must read identically wherever it appears.
const GUEST_STATUS_COLORS: Record<string, string> = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }
const NODE_STATUS_COLORS: Record<string, string> = { online: '#4caf50', unknown: '#9e9e9e', maintenance: '#ff9800' }

const guestStatusColor = (status?: string) => GUEST_STATUS_COLORS[status || ''] || '#616161'
const nodeStatusColor = (status?: string) => (status ? NODE_STATUS_COLORS[status] || '#f44336' : '#9e9e9e')

/** Guest glyph: type icon with the status dot, as in every guest list. */
const GuestGlyph = ({ type, status }: { type?: string; status?: string }) => (
  <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Box component='i' className={type === 'ct' ? 'ri-instance-line' : 'ri-computer-line'} sx={{ fontSize: '0.9286rem', opacity: 0.8 }} />
    <Box sx={{
      position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%',
      bgcolor: guestStatusColor(status), border: theme => `1px solid ${theme.palette.background.paper}`,
    }} />
  </Box>
)

/** Node glyph: the Proxmox logo with the status dot. A CLUSTER is ri-server-line. */
const NodeGlyph = ({ status, dark }: { status?: string; dark: boolean }) => (
  <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img
      src={dark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
      alt=''
      width={14}
      height={14}
      style={{ opacity: status === 'online' ? 0.8 : 0.4 }}
    />
    <Box sx={{
      position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%',
      bgcolor: nodeStatusColor(status), border: theme => `1px solid ${theme.palette.background.paper}`,
    }} />
  </Box>
)

/** Icon + label inside a MenuItem; MUI renders the selected item as the
 *  closed value, so the icon shows in both states. */
const OptionLabel = ({ icon, label, muted = false }: { icon: string; label: string; muted?: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <Box component='i' className={icon} sx={{ fontSize: 16, opacity: muted ? 0.45 : 0.8, display: 'inline-flex' }} />
    <Typography variant='body2'>{label}</Typography>
  </Box>
)

type StatusColor = 'default' | 'info' | 'success' | 'error' | 'warning'

const STATUS_COLORS: Record<RestoreJob['status'], StatusColor> = {
  pending: 'default',
  starting: 'info',
  running: 'info',
  done: 'success',
  failed: 'error',
  cancelled: 'warning',
}

export default function BulkRestoreWizard({
  open, onClose, pbsId, initialDatastore, initialNamespace, pollIntervalMs = POLL_INTERVAL_MS,
}: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'

  const [step, setStep] = useState(0)

  // ── Step 1: pick the guests ──
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [guests, setGuests] = useState<GuestBackupGroup[]>([])
  const [search, setSearch] = useState('')
  const [datastoreFilter, setDatastoreFilter] = useState('all')
  const [namespaceFilter, setNamespaceFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [vmidFrom, setVmidFrom] = useState('')
  const [vmidTo, setVmidTo] = useState('')
  const [selection, setSelection] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() })
  const [pointByKey, setPointByKey] = useState<Record<string, string>>({})
  // Live state of the guest each backup came from, so a row carries the same
  // status dot as everywhere else. A backup whose guest no longer exists
  // anywhere keeps the neutral dot, which is precisely the common case here.
  const [liveGuests, setLiveGuests] = useState<Record<number, { status: string; cluster: string }>>({})

  // ── Step 2: target ──
  const [connectionId, setConnectionId] = useState('')
  const [node, setNode] = useState('')
  const [storage, setStorage] = useState('')
  const [connections, setConnections] = useState<ConnectionOption[]>([])
  const [nodes, setNodes] = useState<NodeOption[]>([])
  const [storages, setStorages] = useState<StorageOption[]>([])
  const [usedVmIds, setUsedVmIds] = useState<Set<number>>(new Set())
  const [mode, setMode] = useState<TargetMode>('range')
  const [rangeStart, setRangeStart] = useState('9000')
  const [rangeEnd, setRangeEnd] = useState('9099')
  const [overwrite, setOverwrite] = useState(false)
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false)
  const [startAfter, setStartAfter] = useState(false)
  const [uniqueMac, setUniqueMac] = useState(true)
  const [bwlimit, setBwlimit] = useState('')
  const [nameSuffix, setNameSuffix] = useState('')

  // ── Step 3: run ──
  const [concurrency, setConcurrency] = useState(1)
  const [jobs, setJobs] = useState<RestoreJob[]>([])
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [closeArmed, setCloseArmed] = useState(false)

  // ⛔ The queue's state lives in the REF, not in React state, and every
  // mutation goes through setJob below. Mirroring `jobs` into the ref from an
  // effect instead leaves a window between "the POST went out" and "React
  // committed the new status": a tick landing in that window reads a stale
  // `pending` and dispatches the SAME guest a second time. Measured here on
  // 2026-09-21 with a 20 ms tick, and it is the same double-dispatch class
  // that bit the bulk migration (#984).
  const jobsRef = useRef<RestoreJob[]>([])

  const setJob = useCallback((key: string, patch: Partial<RestoreJob>) => {
    jobsRef.current = jobsRef.current.map(j => (j.key === key ? { ...j, ...patch } : j))
    setJobs(jobsRef.current)
  }, [])

  const resetAll = useCallback(() => {
    setStep(0)
    setSearch('')
    setDatastoreFilter(initialDatastore && initialDatastore !== 'all' ? initialDatastore : 'all')
    setNamespaceFilter(initialNamespace && initialNamespace !== 'all' ? initialNamespace : 'all')
    setTypeFilter('all')
    setVmidFrom('')
    setVmidTo('')
    setSelection({ type: 'include', ids: new Set() })
    setPointByKey({})
    setMode('range')
    setOverwrite(false)
    setOverwriteConfirmed(false)
    setStartAfter(false)
    setUniqueMac(true)
    setBwlimit('')
    setNameSuffix('')
    setStorage('')
    setJobs([])
    setRunning(false)
    setStarted(false)
    setCloseArmed(false)
    jobsRef.current = []
  }, [initialDatastore, initialNamespace])

  // Load every snapshot of this PBS once, then fold them into guests. `slim=1`
  // strips the per-snapshot file list and verification record, which are most
  // of the payload and useless here.
  useEffect(() => {
    if (!open || !pbsId) return
    resetAll()
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const r = await fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/backups?pageSize=100000&slim=1`, { cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) {
          setLoadError(j?.error || `HTTP ${r.status}`)
          return
        }
        setGuests(groupBackupsByGuest(j?.data?.backups || []))
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || 'Failed to load backups')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, pbsId, resetAll])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/v1/connections?type=pve', { cache: 'no-store' })
        if (cancelled || !r.ok) return
        const j = await r.json()
        const list: ConnectionOption[] = Array.isArray(j?.data) ? j.data : []
        setConnections(list)
        if (list.length === 1) setConnectionId(list[0].id)
      } catch { /* the picker stays empty, the step blocks on it */ }
    })()
    return () => { cancelled = true }
  }, [open])

  // Status dots on the guest list: one /resources call per PVE connection,
  // keyed by VMID. A VMID is unique per cluster, not across clusters, so the
  // first cluster that answers for it wins and the tooltip names it.
  useEffect(() => {
    if (!open || connections.length === 0) return
    let cancelled = false
    ;(async () => {
      const found: Record<number, { status: string; cluster: string }> = {}
      await Promise.all(connections.map(async (c) => {
        try {
          const r = await fetch(`/api/v1/connections/${encodeURIComponent(c.id)}/resources`, { cache: 'no-store' })
          if (!r.ok) return
          const j = await r.json()
          for (const g of Array.isArray(j?.data) ? j.data : []) {
            const vmid = Number(g?.vmid)
            if (!Number.isFinite(vmid) || found[vmid]) continue
            found[vmid] = { status: String(g?.status || 'unknown'), cluster: c.name }
          }
        } catch { /* a cluster we cannot read just leaves its guests neutral */ }
      }))
      if (!cancelled) setLiveGuests(found)
    })()
    return () => { cancelled = true }
  }, [open, connections])

  useEffect(() => {
    if (!open || !connectionId) return
    setNode('')
    setNodes([])
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes`, { cache: 'no-store' })
        if (cancelled || !r.ok) return
        const j = await r.json()
        const list = Array.isArray(j) ? j : (j?.data || [])
        const online = list.filter((n: NodeOption) => n.status === 'online')
        setNodes(online)
        if (online.length === 1) setNode(online[0].node)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [open, connectionId])

  // Target storages + the VMIDs already live on that cluster. The used set is
  // what makes the range allocation land on free IDs.
  useEffect(() => {
    if (!open || !connectionId || !node) return
    let cancelled = false
    ;(async () => {
      try {
        const [images, rootdir] = await Promise.all([
          fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/storages?content=images`, { cache: 'no-store' }),
          fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/storages?content=rootdir`, { cache: 'no-store' }),
        ])
        if (cancelled) return
        const imagesList: StorageOption[] = images.ok ? ((await images.json())?.data || []) : []
        const rootdirList: StorageOption[] = rootdir.ok ? ((await rootdir.json())?.data || []) : []
        setStorages(
          imagesList.map(s => ({ ...s, content: 'images' })).concat(
            rootdirList
              .filter(s => !imagesList.some(i => i.storage === s.storage))
              .map(s => ({ ...s, content: 'rootdir' })),
          ),
        )
      } catch { /* ignore */ }
      try {
        const r = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/resources`, { cache: 'no-store' })
        if (cancelled || !r.ok) return
        const j = await r.json()
        const ids = new Set<number>(
          (Array.isArray(j?.data) ? j.data : [])
            .map((x: any) => Number(x?.vmid))
            .filter((n: number) => Number.isFinite(n)),
        )
        setUsedVmIds(ids)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [open, connectionId, node])

  const datastores = useMemo(() => [...new Set(guests.map(g => g.datastore))].sort((a, b) => a.localeCompare(b)), [guests])
  const namespaces = useMemo(() => [...new Set(guests.map(g => g.namespace))].sort((a, b) => a.localeCompare(b)), [guests])

  const visibleGuests = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const from = vmidFrom.trim() === '' ? null : Number(vmidFrom)
    const to = vmidTo.trim() === '' ? null : Number(vmidTo)

    return filterGuestsByVmidRange(
      guests.filter(g => {
        if (datastoreFilter !== 'all' && g.datastore !== datastoreFilter) return false
        if (namespaceFilter !== 'all' && g.namespace !== namespaceFilter) return false
        if (typeFilter !== 'all' && g.backupType !== typeFilter) return false
        if (needle && !`${g.vmid} ${g.vmName}`.toLowerCase().includes(needle)) return false
        return true
      }),
      Number.isFinite(from as number) ? (from as number) : null,
      Number.isFinite(to as number) ? (to as number) : null,
    )
  }, [guests, search, datastoreFilter, namespaceFilter, typeFilter, vmidFrom, vmidTo])

  const selectedKeys = useMemo(
    () => resolveSelectedRowIds(selection, visibleGuests.map(g => ({ id: g.key }))),
    [selection, visibleGuests],
  )

  const selectedGuests = useMemo(() => {
    const keys = new Set(selectedKeys)
    return visibleGuests.filter(g => keys.has(g.key))
  }, [selectedKeys, visibleGuests])

  const plan = useMemo(
    () =>
      planTargets({
        guests: selectedGuests,
        pointByKey,
        mode,
        rangeStart: rangeStart.trim() === '' ? null : Number(rangeStart),
        rangeEnd: rangeEnd.trim() === '' ? null : Number(rangeEnd),
        usedVmIds,
        overwrite,
      }),
    [selectedGuests, pointByKey, mode, rangeStart, rangeEnd, usedVmIds, overwrite],
  )

  const restoreOptions = useMemo(
    () => ({
      storage: storage || undefined,
      bwlimit: bwlimit.trim() === '' ? null : Number(bwlimit),
      start: startAfter,
      unique: uniqueMac,
      nameSuffix,
      force: mode === 'source' && overwrite,
    }),
    [storage, bwlimit, startAfter, uniqueMac, nameSuffix, mode, overwrite],
  )

  // ── Dispatch loop ──
  const pollJob = useCallback(async (job: RestoreJob) => {
    if (!job.upid) return
    try {
      const r = await fetch(
        `/api/v1/tasks/${encodeURIComponent(connectionId)}/${encodeURIComponent(node)}/${encodeURIComponent(job.upid)}`,
        { cache: 'no-store' },
      )
      if (!r.ok) return
      const task = await r.json()
      const mapped = statusFromTask(task)
      setJob(job.key, {
        status: mapped.status,
        error: mapped.error || job.error,
        progress: typeof task?.progress === 'number' ? task.progress : job.progress,
        message: task?.message || job.message,
        ...(isTerminal(mapped.status) ? { endedAt: Date.now() } : {}),
      })
    } catch { /* transient, the next tick retries */ }
  }, [connectionId, node, setJob])

  const dispatchJob = useCallback(async (key: string) => {
    // Claim the slot synchronously: this is what makes a second tick see the
    // guest as `starting` instead of re-dispatching it.
    const job = jobsRef.current.find(j => j.key === key)
    if (!job || job.status !== 'pending') return
    setJob(key, { status: 'starting', startedAt: Date.now() })

    const entry = plan.entries.find(e => e.key === key)
    const body = entry ? buildRestoreRequest(entry, pbsId, restoreOptions) : null
    if (!body) {
      setJob(key, { status: 'failed', error: 'incomplete restore request', endedAt: Date.now() })
      return
    }

    try {
      const r = await fetch(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/restore`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      )
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setJob(key, { status: 'failed', error: j?.error || `HTTP ${r.status}`, endedAt: Date.now() })
        return
      }
      const upid = typeof j?.data === 'string' ? j.data : undefined
      // No UPID means PVE accepted the call but we cannot follow the task;
      // treat it as started-and-done rather than polling forever.
      setJob(key, upid ? { status: 'running', upid } : { status: 'done', endedAt: Date.now() })
    } catch (e: any) {
      setJob(key, { status: 'failed', error: e?.message || 'restore failed', endedAt: Date.now() })
    }
  }, [plan.entries, pbsId, restoreOptions, connectionId, node, setJob])

  useEffect(() => {
    if (!running) return

    const tick = async () => {
      await Promise.all(jobsRef.current.filter(j => j.status === 'running' && j.upid).map(pollJob))

      for (const key of selectNextJobs(jobsRef.current, concurrency)) {
        void dispatchJob(key)
      }

      if (summarizeJobs(jobsRef.current).finished) setRunning(false)
    }

    void tick()
    const handle = setInterval(() => { void tick() }, pollIntervalMs)
    return () => clearInterval(handle)
  }, [running, concurrency, pollJob, dispatchJob, pollIntervalMs])

  const summary = useMemo(() => summarizeJobs(jobs), [jobs])

  const handleStart = () => {
    jobsRef.current = plan.entries
      .filter(e => !e.blocking)
      .map(e => ({
        key: e.key,
        vmid: e.guest.vmid,
        targetVmid: e.targetVmid,
        label: e.guest.vmName ? `${e.guest.vmName} (${e.guest.vmid})` : String(e.guest.vmid),
        status: 'pending' as const,
      }))
    setJobs(jobsRef.current)
    setStarted(true)
    setRunning(true)
  }

  // Only the guests that have not been handed to PVE yet: a restore already
  // running server-side is not interrupted from here.
  const handleStopRemaining = () => {
    jobsRef.current = jobsRef.current.map(j => (j.status === 'pending' ? { ...j, status: 'cancelled', endedAt: Date.now() } : j))
    setJobs(jobsRef.current)
  }

  const handleClose = () => {
    if (running && !closeArmed) {
      setCloseArmed(true)
      return
    }
    onClose()
  }

  const columns: GridColDef[] = useMemo(() => [
    {
      field: 'vmid',
      headerName: t('common.vmId'),
      width: 100,
      renderCell: params => {
        const live = liveGuests[params.row.vmid]
        return (
          <Stack direction='row' spacing={0.75} alignItems='center' sx={{ height: '100%' }}>
            <Tooltip title={live ? `${live.status} · ${live.cluster}` : t('backups.bulkRestore.guestGone')}>
              <span style={{ display: 'inline-flex' }}>
                <GuestGlyph type={params.row.backupType} status={live?.status} />
              </span>
            </Tooltip>
            <span>{params.row.vmid}</span>
          </Stack>
        )
      },
    },
    {
      field: 'backupType',
      headerName: t('common.type'),
      width: 90,
      valueGetter: (_v, row) => (row.backupType === 'ct' ? 'LXC' : 'VM'),
    },
    { field: 'vmName', headerName: t('common.name'), flex: 1, minWidth: 140 },
    { field: 'datastore', headerName: t('backups.datastoreHeader'), width: 130 },
    {
      field: 'namespace',
      headerName: 'Namespace',
      width: 120,
      valueGetter: (_v, row) => row.namespace || t('backups.rootNamespace'),
    },
    {
      field: 'points',
      headerName: t('backups.bulkRestore.restorePoint'),
      width: 260,
      sortable: false,
      renderCell: params => {
        const guest: GuestBackupGroup = params.row
        const value = pointByKey[guest.key] || guest.points[0]?.id || ''
        return (
          <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
            <Select
              value={value}
              onChange={e => setPointByKey(prev => ({ ...prev, [guest.key]: String(e.target.value) }))}
              onClick={e => e.stopPropagation()}
            >
              {guest.points.map((p, i) => (
                <MenuItem key={p.id} value={p.id}>
                  <OptionLabel
                    icon={i === 0 ? 'ri-history-line' : 'ri-time-line'}
                    label={`${p.backupTimeFormatted}${i === 0 ? ` · ${t('backups.bulkRestore.latest')}` : ''}`}
                  />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )
      },
    },
    {
      field: 'count',
      headerName: t('backups.bulkRestore.pointsCount'),
      width: 110,
      valueGetter: (_v, row) => row.points.length,
    },
  ], [t, pointByKey, liveGuests])

  const rows = useMemo(() => visibleGuests.map(g => ({ ...g, id: g.key })), [visibleGuests])

  const canLeaveGuests = selectedGuests.length > 0
  const canLeaveTarget =
    !!connectionId && !!node && plan.blockingCount === 0 && (mode !== 'source' || !overwrite || overwriteConfirmed)

  const renderGuestsStep = () => (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, width: '100%' }}>
        <TextField
          size='small'
          fullWidth
          placeholder={t('common.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-search-line' /></InputAdornment> }}
          sx={{ flex: '2 1 200px' }}
        />
        {datastores.length > 1 && (
          <FormControl size='small' fullWidth sx={{ flex: '1.4 1 150px', ...SMALL_SELECT_SX }}>
            <InputLabel>{t('backups.datastoreHeader')}</InputLabel>
            <Select value={datastoreFilter} label={t('backups.datastoreHeader')} onChange={e => setDatastoreFilter(String(e.target.value))}>
              <MenuItem value='all'>
                <OptionLabel icon='ri-database-2-line' label={t('backups.allDatastores')} muted />
              </MenuItem>
              {datastores.map(d => (
                <MenuItem key={d} value={d}>
                  <OptionLabel icon='ri-database-2-line' label={d} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {namespaces.length > 1 && (
          <FormControl size='small' fullWidth sx={{ flex: '1.4 1 150px', ...SMALL_SELECT_SX }}>
            <InputLabel>Namespace</InputLabel>
            <Select value={namespaceFilter} label='Namespace' onChange={e => setNamespaceFilter(String(e.target.value))}>
              <MenuItem value='all'>
                <OptionLabel icon='ri-folder-line' label={t('backups.allNamespaces')} muted />
              </MenuItem>
              {namespaces.map(ns => (
                <MenuItem key={ns} value={ns}>
                  <OptionLabel icon={ns ? 'ri-folder-line' : 'ri-folder-open-line'} label={ns || t('backups.rootNamespace')} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControl size='small' fullWidth sx={{ flex: '1 1 120px', ...SMALL_SELECT_SX }}>
          <InputLabel>{t('common.type')}</InputLabel>
          <Select value={typeFilter} label={t('common.type')} onChange={e => setTypeFilter(String(e.target.value))}>
            <MenuItem value='all'>
              <OptionLabel icon='ri-stack-line' label={t('backups.allTypesFilter')} muted />
            </MenuItem>
            <MenuItem value='vm'>
              <OptionLabel icon='ri-computer-line' label='VM' />
            </MenuItem>
            <MenuItem value='ct'>
              <OptionLabel icon='ri-instance-line' label='LXC' />
            </MenuItem>
          </Select>
        </FormControl>
        <TextField
          size='small'
          fullWidth
          label={t('backups.bulkRestore.vmidFrom')}
          value={vmidFrom}
          onChange={e => setVmidFrom(e.target.value.replace(/[^0-9]/g, ''))}
          sx={{ flex: '1 1 110px' }}
        />
        <TextField
          size='small'
          fullWidth
          label={t('backups.bulkRestore.vmidTo')}
          value={vmidTo}
          onChange={e => setVmidTo(e.target.value.replace(/[^0-9]/g, ''))}
          sx={{ flex: '1 1 110px' }}
        />
        <Chip
          size='small'
          color={selectedGuests.length > 0 ? 'primary' : 'default'}
          variant='tonal'
          label={t('backups.bulkRestore.selectedCount', { count: selectedGuests.length })}
          sx={{ flexShrink: 0, ml: 'auto' }}
        />
      </Box>

      {loadError && <Alert severity='error'>{loadError}</Alert>}

      <Box sx={{ height: 420 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          density='compact'
          rowHeight={46}
          checkboxSelection
          disableRowSelectionOnClick
          keepNonExistentRowsSelected
          rowSelectionModel={selection}
          onRowSelectionModelChange={model => setSelection(model)}
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        />
      </Box>
    </Stack>
  )

  /** Section heading, same treatment as the deploy wizard's steps. */
  const SectionTitle = ({ label }: { label: string }) => (
    <Typography variant='overline' sx={{ opacity: 0.6, display: 'block', mb: 1.75, lineHeight: 1.4 }}>{label}</Typography>
  )

  const THREE_COLS = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, alignItems: 'start' } as const

  const renderTargetStep = () => (
    <Stack spacing={3}>
      {/* 1. Where the guests land. */}
      <Box>
        <SectionTitle label={t('backups.bulkRestore.sectionDestination')} />
        <Box sx={THREE_COLS}>
          <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
            <InputLabel>{t('inventory.pbsRestoreTargetCluster')}</InputLabel>
            <Select value={connectionId} label={t('inventory.pbsRestoreTargetCluster')} onChange={e => setConnectionId(String(e.target.value))}>
              {connections.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  <OptionLabel icon='ri-server-line' label={c.name} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size='small' fullWidth sx={SMALL_SELECT_SX} disabled={!connectionId}>
            <InputLabel>{t('inventory.pbsRestoreTargetNode')}</InputLabel>
            <Select value={node} label={t('inventory.pbsRestoreTargetNode')} onChange={e => setNode(String(e.target.value))}>
              {nodes.map(n => (
                <MenuItem key={n.node} value={n.node}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <NodeGlyph status={n.status} dark={dark} />
                    <Typography variant='body2'>{n.node}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size='small' fullWidth sx={SMALL_SELECT_SX} disabled={!node}>
            <InputLabel>{t('inventory.pbsRestoreStorage')}</InputLabel>
            <Select value={storage} label={t('inventory.pbsRestoreStorage')} onChange={e => setStorage(String(e.target.value))}>
              <MenuItem value=''>
                <OptionLabel icon='ri-archive-line' label={t('backups.bulkRestore.storageFromBackup')} muted />
              </MenuItem>
              {storages.map(s => (
                <MenuItem key={s.storage} value={s.storage}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StorageTypeIcon type={s.type || ''} />
                    <Typography variant='body2'>{s.storage}</Typography>
                    {s.type && <Typography variant='caption' sx={{ opacity: 0.5, ml: 'auto' }}>{s.type}</Typography>}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* 2. Which VMID each restored guest takes. The explanation is the
          field's own helper text: a full-width banner over three inputs read
          as noise. */}
      <Box>
        <SectionTitle label={t('backups.bulkRestore.sectionVmid')} />
        <Box sx={THREE_COLS}>
          <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
            <InputLabel>{t('backups.bulkRestore.vmidPolicy')}</InputLabel>
            <Select
              value={mode}
              label={t('backups.bulkRestore.vmidPolicy')}
              onChange={e => { setMode(e.target.value as TargetMode); setOverwriteConfirmed(false) }}
            >
              <MenuItem value='range'>
                <OptionLabel icon='ri-add-circle-line' label={t('backups.bulkRestore.modeRange')} />
              </MenuItem>
              <MenuItem value='source'>
                <OptionLabel icon='ri-arrow-go-back-line' label={t('backups.bulkRestore.modeSource')} />
              </MenuItem>
            </Select>
            <FormHelperText>
              {mode === 'range' ? t('backups.bulkRestore.rangeHelp') : t('backups.bulkRestore.sourceHelp')}
            </FormHelperText>
          </FormControl>

          {mode === 'range' ? (
            <>
              <TextField
                size='small'
                fullWidth
                label={t('backups.bulkRestore.rangeStart')}
                value={rangeStart}
                onChange={e => setRangeStart(e.target.value.replace(/[^0-9]/g, ''))}
              />
              <TextField
                size='small'
                fullWidth
                label={t('backups.bulkRestore.rangeEnd')}
                value={rangeEnd}
                onChange={e => setRangeEnd(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </>
          ) : (
            <FormControlLabel
              sx={{ gridColumn: { sm: 'span 2' }, mt: 0.5 }}
              control={<Switch checked={overwrite} onChange={(_, v) => { setOverwrite(v); setOverwriteConfirmed(false) }} />}
              label={t('backups.bulkRestore.overwrite')}
            />
          )}
        </Box>
      </Box>

      {/* 3. What the restored guests look like once they are there. */}
      <Box>
        <SectionTitle label={t('backups.bulkRestore.sectionOptions')} />
        <Box sx={THREE_COLS}>
          <TextField
            size='small'
            fullWidth
            label={t('backups.bulkRestore.nameSuffix')}
            value={nameSuffix}
            onChange={e => setNameSuffix(e.target.value)}
            helperText={t('backups.bulkRestore.nameSuffixHelp')}
          />
          <TextField
            size='small'
            fullWidth
            label={t('inventory.pbsRestoreBandwidth')}
            value={bwlimit}
            onChange={e => setBwlimit(e.target.value.replace(/[^0-9]/g, ''))}
            helperText={t('backups.bulkRestore.bandwidthHelp')}
          />
          <Stack sx={{ mt: 0.5 }}>
            <FormControlLabel
              control={<Switch checked={uniqueMac} onChange={(_, v) => setUniqueMac(v)} />}
              label={t('backups.bulkRestore.uniqueMac')}
            />
            <FormControlLabel
              control={<Switch checked={startAfter} onChange={(_, v) => setStartAfter(v)} />}
              label={t('backups.bulkRestore.startAfter')}
            />
          </Stack>
        </Box>
      </Box>

      {mode === 'source' && overwrite && (
        <Alert
          severity='error'
          variant='outlined'
          action={
            <Button size='small' color='error' onClick={() => setOverwriteConfirmed(true)} disabled={overwriteConfirmed}>
              {overwriteConfirmed ? t('backups.bulkRestore.overwriteConfirmed') : t('common.confirm')}
            </Button>
          }
        >
          {t('backups.bulkRestore.overwriteWarning', { count: plan.entries.filter(e => e.issue === 'targetExists').length })}
        </Alert>
      )}

      {plan.issues.includes('rangeInvalid') && <Alert severity='error'>{t('backups.bulkRestore.rangeInvalid')}</Alert>}
      {plan.issues.includes('rangeExhausted') && (
        <Alert severity='error'>
          {t('backups.bulkRestore.rangeExhausted', { count: plan.entries.filter(e => e.issue === 'rangeExhausted').length })}
        </Alert>
      )}
      {mode === 'source' && !overwrite && plan.issues.includes('targetExists') && (
        <Alert severity='error'>
          {t('backups.bulkRestore.targetExists', { count: plan.entries.filter(e => e.issue === 'targetExists').length })}
        </Alert>
      )}
    </Stack>
  )

  const renderReviewStep = () => (
    <Stack spacing={2}>
      <Stack direction='row' spacing={2} alignItems='center' flexWrap='wrap' useFlexGap>
        <FormControl size='small' sx={{ minWidth: 200, ...SMALL_SELECT_SX }} disabled={started}>
          <InputLabel>{t('backups.bulkRestore.concurrency')}</InputLabel>
          <Select value={concurrency} label={t('backups.bulkRestore.concurrency')} onChange={e => setConcurrency(Number(e.target.value))}>
            {[1, 2, 3, 4].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }} />
        {started && (
          <Stack direction='row' spacing={1} alignItems='center'>
            <Chip size='small' color='info' variant='tonal' label={t('backups.bulkRestore.jobsActive', { count: summary.active })} />
            <Chip size='small' color='success' variant='tonal' label={t('backups.bulkRestore.jobsDone', { count: summary.done })} />
            {summary.failed > 0 && <Chip size='small' color='error' variant='tonal' label={t('backups.bulkRestore.jobsFailed', { count: summary.failed })} />}
            {summary.pending > 0 && <Chip size='small' variant='tonal' label={t('backups.bulkRestore.jobsPending', { count: summary.pending })} />}
          </Stack>
        )}
      </Stack>

      {!started && (
        <Alert severity='info' variant='outlined'>{t('backups.bulkRestore.queueWarning')}</Alert>
      )}
      {started && summary.finished && (
        <Alert severity={summary.failed > 0 ? 'warning' : 'success'}>
          {t('backups.bulkRestore.runFinished', { done: summary.done, failed: summary.failed })}
        </Alert>
      )}

      <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
        <Table size='small' stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t('common.vmId')}</TableCell>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>{t('backups.bulkRestore.restorePoint')}</TableCell>
              <TableCell>{t('backups.bulkRestore.targetVmid')}</TableCell>
              <TableCell>{t('common.status')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plan.entries.map(entry => {
              const job = jobs.find(j => j.key === entry.key)
              return (
                <TableRow key={entry.key}>
                  <TableCell>
                    <Stack direction='row' spacing={0.75} alignItems='center'>
                      <GuestGlyph type={entry.guest.backupType} status={liveGuests[entry.guest.vmid]?.status} />
                      <span>{entry.guest.vmid}</span>
                    </Stack>
                  </TableCell>
                  <TableCell>{entry.guest.vmName || '-'}</TableCell>
                  <TableCell>{entry.point?.backupTimeFormatted || '-'}</TableCell>
                  <TableCell>{entry.targetVmid ?? '-'}</TableCell>
                  <TableCell sx={{ minWidth: 220 }}>
                    {entry.blocking ? (
                      <Chip size='small' color='error' variant='tonal' label={t(`backups.bulkRestore.issue.${entry.issue}`)} />
                    ) : job ? (
                      <Stack spacing={0.5}>
                        <Stack direction='row' spacing={0.75} alignItems='center'>
                          <Chip size='small' color={STATUS_COLORS[job.status]} variant='tonal' label={t(`backups.bulkRestore.status.${job.status}`)} />
                          {job.error && (
                            <Tooltip title={job.error}>
                              <i className='ri-error-warning-line' style={{ fontSize: 16 }} />
                            </Tooltip>
                          )}
                        </Stack>
                        {job.status === 'running' && (
                          <LinearProgress variant={job.progress ? 'determinate' : 'indeterminate'} value={job.progress || 0} sx={{ height: 4, borderRadius: 2 }} />
                        )}
                      </Stack>
                    ) : (
                      <Chip size='small' variant='tonal' label={t('backups.bulkRestore.status.pending')} />
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  )

  return (
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth='lg' fullWidth>
      <AppDialogTitle onClose={handleClose}>{t('backups.bulkRestore.title')}</AppDialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ my: 2 }}>
          {STEP_KEYS.map(key => (
            <Step key={key}>
              <StepLabel>{t(`backups.bulkRestore.steps.${key}`)}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {closeArmed && running && (
          <Alert severity='warning' sx={{ mb: 2 }}>{t('backups.bulkRestore.closeWhileRunning')}</Alert>
        )}

        {loading && step === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
        )}

        {step === 0 && renderGuestsStep()}
        {step === 1 && renderTargetStep()}
        {step === 2 && renderReviewStep()}
      </DialogContent>
      <DialogActions>
        {step > 0 && !started && (
          <Button onClick={() => setStep(s => s - 1)} color='secondary'>{t('common.back')}</Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={handleClose} color='secondary'>
          {running && closeArmed ? t('backups.bulkRestore.closeAnyway') : t('common.close')}
        </Button>
        {step === 0 && (
          <Button variant='contained' disabled={!canLeaveGuests} onClick={() => setStep(1)}>
            {t('common.next')} ({selectedGuests.length})
          </Button>
        )}
        {step === 1 && (
          <Button variant='contained' disabled={!canLeaveTarget} onClick={() => setStep(2)}>{t('common.next')}</Button>
        )}
        {step === 2 && !started && (
          <Button variant='contained' color='primary' onClick={handleStart} disabled={plan.entries.length === plan.blockingCount}>
            {t('backups.bulkRestore.startRestores', { count: plan.entries.length - plan.blockingCount })}
          </Button>
        )}
        {step === 2 && started && summary.pending > 0 && (
          <Button variant='outlined' color='warning' onClick={handleStopRemaining}>
            {t('backups.bulkRestore.stopRemaining', { count: summary.pending })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
