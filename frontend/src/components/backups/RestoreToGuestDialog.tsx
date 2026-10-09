'use client'

// Restore files from a backup straight INTO a running guest (Veeam-like),
// instead of downloading them to the browser. Shared by the inventory backup
// explorers and /operations/backups. The server streams the backup content
// and writes it through the QEMU guest agent or over SSH/SFTP; this dialog
// only collects the target, the method and the destination, then follows the
// job by polling GET /api/v1/guest-file-restore/jobs/{id}.
//
// Credentials typed here live in component state only: never persisted in
// the browser, cleared every time the dialog opens.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  createFilterOptions,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import NumericTextField from '@/components/ui/NumericTextField'
import { useToast } from '@/contexts/ToastContext'
import type { GuestRestoreSource } from '@/lib/guestFileRestore/types'
import { formatBytes } from '@/utils/format'

// Two-line radio labels: keep the button on the title line, not centred on both.
const RADIO_OPTION_SX = { alignItems: 'flex-start', mb: 0.75, '& .MuiRadio-root': { pt: 0.25 } } as const

export interface RestoreToGuestDialogProps {
  open: boolean
  onClose: () => void
  source: GuestRestoreSource
  items: Array<{ path: string; directory: boolean; size?: number; label?: string }>
  defaultTarget?: { connId: string; node: string; type: 'qemu' | 'lxc'; vmid: number; name?: string }
  /** e.g. "VM 100 · 20/09/2026 18:51" */
  backupLabel?: string
}

type Method = 'agent' | 'ssh'
type Conflict = 'keep' | 'overwrite' | 'skip'
type GuestOs = 'linux' | 'windows'

interface RestoreSettings {
  agentEnabled: boolean
  sshEnabled: boolean
  agentMaxBytes: number
  agentParallelWrites: number
  defaultConflict: Conflict
  restoredPrefix: string
  defaultCustomDirLinux: string
  defaultCustomDirWindows: string
}

// Same defaults as the server schema, used when the settings call fails.
const DEFAULT_SETTINGS: RestoreSettings = {
  agentEnabled: true,
  sshEnabled: true,
  agentMaxBytes: 1073741824,
  agentParallelWrites: 4,
  defaultConflict: 'keep',
  restoredPrefix: 'RESTORED-',
  defaultCustomDirLinux: '/var/tmp/proxcenter-restore',
  defaultCustomDirWindows: 'C:\\ProxCenter-Restore',
}

interface GuestOption {
  id: string
  connId: string
  connectionName?: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: number
  name: string
  status?: string
}

interface JobLogLine { at: string; level: 'info' | 'warn' | 'error'; msg: string }

interface RestoreJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'
  guestOs?: GuestOs | null
  bytesDone: number
  bytesRead?: number
  bytesTotal?: number | null
  filesDone: number
  filesSkipped: number
  filesFailed: number
  currentPath?: string | null
  error?: string | null
  log?: JobLogLine[]
}

interface ProbeResult { ok: boolean; os?: GuestOs; hostname?: string; hostKeyFingerprint?: string; details?: unknown; error?: string }

const POLL_MS = 1500
const ACTIVE_STATUSES = new Set(['queued', 'running'])
/** Above this the dialog recommends SSH over the guest agent. */
const AGENT_LARGE_SELECTION_BYTES = 200 * 1024 * 1024

// A small MUI Select renders 38 px against 35.9 px for a small TextField; this
// pins both to the same line height so a row of fields sits level.
const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

const filterGuests = createFilterOptions<GuestOption>({
  limit: 200,
  stringify: o => `${o.name} ${o.vmid} ${o.node} ${o.connectionName || ''}`,
})

async function readJson(res: Response): Promise<any> {
  const text = await res.text()

  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { error: text }
  }
}

function guestKey(connId: string, type: string, node: string, vmid: number | string) {
  return `${connId}:${type}:${node}:${vmid}`
}

// Same palette as the dashboard widgets, the DRS history and the bulk
// restore wizard: a guest must read identically wherever it appears.
const GUEST_STATUS_COLORS: Record<string, string> = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }

const guestStatusColor = (status?: string) => GUEST_STATUS_COLORS[status || ''] || '#616161'

/** Guest glyph: type icon with the status dot on it, as in every guest list. */
function GuestGlyph({ type, status }: Readonly<{ type?: string; status?: string }>) {
  return (
    <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Box component='i' className={type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} sx={{ fontSize: '0.9286rem', opacity: 0.8 }} />
      <Box sx={{
        position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%',
        bgcolor: guestStatusColor(status), border: theme => `1px solid ${theme.palette.background.paper}`,
      }} />
    </Box>
  )
}

export default function RestoreToGuestDialog({
  open,
  onClose,
  source,
  items,
  defaultTarget,
  backupLabel,
}: Readonly<RestoreToGuestDialogProps>) {
  const t = useTranslations('guestFileRestore')
  const toast = useToast()

  const [settings, setSettings] = useState<RestoreSettings>(DEFAULT_SETTINGS)
  const [guests, setGuests] = useState<GuestOption[]>([])
  const [guestsLoading, setGuestsLoading] = useState(false)
  const [target, setTarget] = useState<GuestOption | null>(null)

  // What the /guest route reported for a target, keyed by its id so a stale
  // answer never applies to another guest.
  const [guestInfo, setGuestInfo] = useState<{ id: string; status?: string; os?: GuestOs } | null>(null)

  const [pickedMethod, setMethod] = useState<Method>('agent')
  const [host, setHost] = useState('')
  const [hostTouched, setHostTouched] = useState(false)
  const [port, setPort] = useState(22)
  const [username, setUsername] = useState('')
  const [authMode, setAuthMode] = useState<'password' | 'key'>('password')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')

  const [destMode, setDestMode] = useState<'original' | 'custom'>('original')
  const [customPathEdit, setCustomPath] = useState<string | null>(null)
  const [windowsDrive, setWindowsDrive] = useState('C')
  const [conflict, setConflict] = useState<Conflict>('keep')

  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  // SSH only: the operator confirms the host key the probe saw; the job pins it.
  const [confirmedHostKey, setConfirmedHostKey] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<RestoreJob | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const notifiedRef = useRef<string | null>(null)
  const hostTouchedRef = useRef(false)

  useEffect(() => { hostTouchedRef.current = hostTouched }, [hostTouched])

  const defaultTargetKey = defaultTarget
    ? guestKey(defaultTarget.connId, defaultTarget.type, defaultTarget.node, defaultTarget.vmid)
    : ''

  // Reset everything on (re)open: a reopened dialog never shows the previous
  // run's credentials or job.
  useEffect(() => {
    if (!open) return

    setTarget(defaultTarget
      ? {
          id: defaultTargetKey,
          connId: defaultTarget.connId,
          node: defaultTarget.node,
          type: defaultTarget.type,
          vmid: defaultTarget.vmid,
          name: defaultTarget.name || `${defaultTarget.type}/${defaultTarget.vmid}`,
        }
      : null)
    setGuestInfo(null)
    setMethod('agent')
    setHost('')
    setHostTouched(false)
    setPort(22)
    setUsername('')
    setAuthMode('password')
    setPassword('')
    setPrivateKey('')
    setPassphrase('')
    setDestMode('original')
    setCustomPath(null)
    setWindowsDrive('C')
    setProbe(null)
    setError(null)
    setSubmitting(false)
    setJobId(null)
    setJob(null)
    setLogOpen(false)
    setCancelling(false)
    notifiedRef.current = null
    // defaultTargetKey captures every field of defaultTarget that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTargetKey])

  // Settings: method availability and form defaults.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    fetch('/api/v1/settings/guest-file-restore', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (cancelled) return
        const s: RestoreSettings = { ...DEFAULT_SETTINGS, ...(json?.data || {}) }

        setSettings(s)
        setConflict(s.defaultConflict)
      })
      .catch(() => {
        if (cancelled) return
        setSettings(DEFAULT_SETTINGS)
        setConflict(DEFAULT_SETTINGS.defaultConflict)
      })

    return () => { cancelled = true }
  }, [open])

  // Guest inventory for the target picker.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    setGuestsLoading(true)
    fetch('/api/v1/vms', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (cancelled) return
        const list: GuestOption[] = (json?.data?.vms || [])
          .filter((v: any) => !v.template && (v.type === 'qemu' || v.type === 'lxc'))
          .map((v: any) => ({
            id: guestKey(v.connId, v.type, v.node, v.vmid),
            connId: v.connId,
            connectionName: v.connectionName,
            node: v.node,
            type: v.type,
            vmid: Number(v.vmid),
            name: v.name,
            status: v.status,
          }))

        setGuests(list)
      })
      .catch(() => { if (!cancelled) setGuests([]) })
      .finally(() => { if (!cancelled) setGuestsLoading(false) })

    return () => { cancelled = true }
  }, [open])

  // The connection of the backup's own guest comes first, then the others.
  const sortedGuests = useMemo(() => {
    const firstConn = defaultTarget?.connId

    return [...guests].sort((a, b) => {
      const ra = a.connId === firstConn ? 0 : 1
      const rb = b.connId === firstConn ? 0 : 1

      if (ra !== rb) return ra - rb
      const byConn = (a.connectionName || a.connId).localeCompare(b.connectionName || b.connId)

      if (byConn !== 0) return byConn

      return a.vmid - b.vmid
    })
  }, [guests, defaultTarget?.connId])

  // The placeholder default target gets its inventory row (status,
  // connection name) once the list lands.
  const targetRow = target ? (guests.find(g => g.id === target.id) ?? target) : null

  // Guest status, OS and first IPv4 of the selected target.
  useEffect(() => {
    if (!open || !target) return
    let cancelled = false
    const url = `/api/v1/connections/${encodeURIComponent(target.connId)}/guests/${target.type}/${encodeURIComponent(target.node)}/${target.vmid}/guest`

    fetch(url, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (cancelled || !json?.data) return
        const d = json.data

        setGuestInfo({
          id: target.id,
          status: d.status || undefined,
          os: d.osInfo?.type === 'linux' || d.osInfo?.type === 'windows' ? d.osInfo.type : undefined,
        })
        if (d.ip) setHost(prev => (hostTouchedRef.current ? prev : d.ip))
      })
      .catch(() => { /* prefill only */ })

    return () => { cancelled = true }
  }, [open, target?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const info = guestInfo && guestInfo.id === target?.id ? guestInfo : null
  const guestStatus = info?.status ?? targetRow?.status

  const agentAllowed = settings.agentEnabled && target?.type !== 'lxc'
  const sshAllowed = settings.sshEnabled
  const noMethod = !settings.agentEnabled && !settings.sshEnabled

  // The picked method falls back to the other one when it is not allowed
  // (container target, method disabled in the settings).
  const method: Method = pickedMethod === 'agent'
    ? (agentAllowed || !sshAllowed ? 'agent' : 'ssh')
    : (sshAllowed || !agentAllowed ? 'ssh' : 'agent')

  const guestOs: GuestOs | undefined = (probe?.ok ? probe.os : undefined) || info?.os

  const customPath = customPathEdit ?? (guestOs === 'windows' ? settings.defaultCustomDirWindows : settings.defaultCustomDirLinux)

  // A new target prefers the agent again and drops the previous probe.
  const selectTarget = (v: GuestOption | null) => {
    setTarget(v)
    setMethod('agent')
    setProbe(null)
  }

  const knownBytes = useMemo(() => items.reduce((sum, i) => sum + (i.size || 0), 0), [items])
  // Directories carry no size until the job walks them: the total is only
  // shown when every item is a file.
  const sizeKnown = items.length > 0 && items.every(i => !i.directory && i.size != null)
  const overAgentLimit = method === 'agent' && knownBytes > settings.agentMaxBytes
  // The guest agent moves a few dozen KB per round trip: past this, SSH is
  // the sensible choice even when the selection is under the hard limit.
  const largeForAgent = method === 'agent' && !overAgentLimit && knownBytes > AGENT_LARGE_SELECTION_BYTES

  const sshCredentialsOk = !!host.trim() && !!username.trim() && (authMode === 'password' ? !!password : !!privateKey.trim())
  const driveOk = /^[A-Za-z]$/.test(windowsDrive)
  const showDrive = destMode === 'original' && guestOs === 'windows'
  const destinationOk = destMode === 'custom' ? !!customPath.trim() : (!showDrive || driveOk)
  const methodOk = method === 'agent' ? agentAllowed : sshAllowed

  const canProbe = !!target && methodOk && (method === 'agent' || sshCredentialsOk) && !probing
  const sshHostKey = method === 'ssh' && probe?.ok ? probe.hostKeyFingerprint : undefined
  const hostKeyConfirmed = !!sshHostKey && confirmedHostKey === sshHostKey
  const sshTrustOk = method === 'agent' || hostKeyConfirmed
  const canStart = !!target && methodOk && (method === 'agent' || sshCredentialsOk) && sshTrustOk && destinationOk && items.length > 0 && !submitting && !overAgentLimit

  const sshPayload = () => (method === 'ssh'
    ? {
        host: host.trim(),
        port,
        username: username.trim(),
        hostKeyFingerprint: sshHostKey,
        ...(authMode === 'password'
          ? { password }
          : { privateKey, ...(passphrase ? { passphrase } : {}) }),
      }
    : undefined)

  const targetPayload = () => (target
    ? { connId: target.connId, node: target.node, type: target.type, vmid: target.vmid }
    : null)

  const handleProbe = async () => {
    if (!target) return
    setProbing(true)
    setProbe(null)

    try {
      const res = await fetch('/api/v1/guest-file-restore/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: targetPayload(), method, ssh: sshPayload() }),
      })
      const json = await readJson(res)

      if (!res.ok) setProbe({ ok: false, error: json?.error || `HTTP ${res.status}` })
      else setProbe(json as ProbeResult)
    } catch (e: any) {
      setProbe({ ok: false, error: e?.message || String(e) })
    } finally {
      setProbing(false)
    }
  }

  const handleStart = async () => {
    if (!target) return
    setSubmitting(true)
    setError(null)

    try {
      const destination = destMode === 'custom'
        ? { mode: 'custom' as const, path: customPath.trim() }
        : { mode: 'original' as const, ...(showDrive ? { windowsDrive: windowsDrive.toUpperCase() } : {}) }

      const res = await fetch('/api/v1/guest-file-restore/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          items: items.map(i => ({ path: i.path, directory: i.directory, ...(i.size == null ? {} : { size: i.size }) })),
          target: targetPayload(),
          method,
          destination,
          conflict,
          ssh: sshPayload(),
        }),
      })
      const json = await readJson(res)

      if (!res.ok || !json?.data?.id) throw new Error(json?.error || `HTTP ${res.status}`)

      // The server holds the credentials for the run; drop ours.
      setPassword('')
      setPrivateKey('')
      setPassphrase('')
      setJobId(json.data.id)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const notifyEnd = useCallback((j: RestoreJob) => {
    if (notifiedRef.current === j.id) return
    notifiedRef.current = j.id

    if (j.status === 'completed') toast.success(t('toastCompleted', { count: j.filesDone }))
    else if (j.status === 'completed_with_errors') toast.warning(t('toastCompletedWithErrors', { done: j.filesDone, failed: j.filesFailed }))
    else if (j.status === 'cancelled') toast.info(t('toastCancelled'))
    else if (j.status === 'failed') toast.error(t('toastFailed', { error: j.error || '' }))
  }, [toast, t])

  // Poll the job while it runs; the timer stops itself on a final status.
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/guest-file-restore/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
        const json = await readJson(res)

        if (cancelled) return
        if (res.ok && json?.data) {
          setJob(json.data)
          if (!ACTIVE_STATUSES.has(json.data.status)) {
            notifyEnd(json.data)

            return
          }
        }
      } catch {
        // transient: retry on the next tick
      }

      if (!cancelled) timer = setTimeout(tick, POLL_MS)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [jobId, notifyEnd])

  const handleCancelJob = async () => {
    if (!jobId) return
    setCancelling(true)

    try {
      const res = await fetch(`/api/v1/guest-file-restore/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
      const json = await readJson(res)

      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      if (json?.data) setJob(json.data)
    } catch (e: any) {
      toast.error(t('cancelFailed', { error: e?.message || String(e) }))
    } finally {
      setCancelling(false)
    }
  }


  const running = !!jobId && (!job || ACTIVE_STATUSES.has(job.status))
  const shownItems = items.slice(0, 5)

  const renderForm = () => (
    <Stack spacing={2.5}>
      {/* What is restored */}
      <Box>
        <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('itemsHeading', { count: items.length })}</Typography>
        {backupLabel && (
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 0.5 }}>
            {t('fromBackup', { backup: backupLabel })}
          </Typography>
        )}
        <Stack spacing={0.25}>
          {shownItems.map(i => (
            <Box key={i.path} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <i className={i.directory ? 'ri-folder-3-line' : 'ri-file-line'} style={{ fontSize: 16, opacity: 0.7, flexShrink: 0 }} />
              <Typography variant='body2' noWrap sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, flex: 1, minWidth: 0 }} title={i.path}>
                {i.label || i.path}
              </Typography>
              {i.size != null && !i.directory && (
                <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{formatBytes(i.size)}</Typography>
              )}
            </Box>
          ))}
          {items.length > shownItems.length && (
            <Typography variant='caption' color='text.secondary'>
              {t('moreItems', { count: items.length - shownItems.length })}
            </Typography>
          )}
          {sizeKnown && (
            <Typography variant='caption' color='text.secondary'>
              {t('selectionSize', { size: formatBytes(knownBytes) })}
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Target guest */}
      <Autocomplete
        size='small'
        options={sortedGuests}
        loading={guestsLoading}
        value={targetRow}
        onChange={(_e, v) => selectTarget(v)}
        filterOptions={filterGuests}
        groupBy={o => o.connectionName || o.connId}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        getOptionLabel={o => `${o.name} (${o.vmid})`}
        renderOption={(props, o) => {
          const { key, ...rest } = props as any

          return (
            <Box component='li' key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <GuestGlyph type={o.type} status={o.status} />
              <Typography variant='body2' noWrap sx={{ flex: 1, minWidth: 0 }}>{o.name}</Typography>
              <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>
                {o.vmid} · {o.node}
              </Typography>
            </Box>
          )
        }}
        renderInput={params => (
          <TextField
            {...params}
            label={t('targetGuest')}
            helperText={target ? t('targetGuestHelper', { node: target.node }) : undefined}
            InputProps={{
                ...params.InputProps,
                startAdornment: target
                  ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', pl: 0.5, pr: 0.5 }}>
                      <GuestGlyph type={target.type} status={guestStatus} />
                    </Box>
                  )
                  : params.InputProps.startAdornment,
                endAdornment: (
                  <>
                    {guestsLoading ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
            }}
          />
        )}
        noOptionsText={t('noGuests')}
      />

      {target && guestStatus && guestStatus !== 'running' && (
        <Alert severity='warning'>{t('guestNotRunning')}</Alert>
      )}

      {/* Method */}
      {noMethod ? (
        <Alert severity='error'>{t('noMethodEnabled')}</Alert>
      ) : (
        <Box>
          <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('method')}</Typography>
          <RadioGroup
            value={method}
            onChange={e => { setMethod(e.target.value as Method); setProbe(null) }}
          >
            <FormControlLabel
              value='agent'
              disabled={!agentAllowed}
              control={<Radio size='small' />}
              sx={RADIO_OPTION_SX}
              label={(
                <Box>
                  <Typography variant='body2'>{t('methodAgent')}</Typography>
                  <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                    {!settings.agentEnabled
                      ? t('methodDisabledBySettings')
                      : target?.type === 'lxc'
                        ? t('methodAgentNoLxc')
                        : t('methodAgentHint', { max: formatBytes(settings.agentMaxBytes) })}
                  </Typography>
                </Box>
              )}
            />
            <FormControlLabel
              value='ssh'
              disabled={!sshAllowed}
              control={<Radio size='small' />}
              sx={RADIO_OPTION_SX}
              label={(
                <Box>
                  <Typography variant='body2'>{t('methodSsh')}</Typography>
                  <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                    {sshAllowed ? t('methodSshHint') : t('methodDisabledBySettings')}
                  </Typography>
                </Box>
              )}
            />
          </RadioGroup>
          {overAgentLimit && (
            <Alert severity='warning' sx={{ mt: 1 }}>
              {t('agentLimitExceeded', { size: formatBytes(knownBytes), max: formatBytes(settings.agentMaxBytes) })}
            </Alert>
          )}
          {largeForAgent && (
            <Alert severity='info' sx={{ mt: 1 }}>
              {t('agentLargeSelection', { size: formatBytes(knownBytes), threshold: formatBytes(AGENT_LARGE_SELECTION_BYTES) })}
            </Alert>
          )}
        </Box>
      )}

      {/* SSH credentials */}
      {method === 'ssh' && sshAllowed && (
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField
              size='small'
              label={t('sshHost')}
              value={host}
              onChange={e => { setHost(e.target.value); setHostTouched(true); setProbe(null) }}
              helperText={t('sshHostHelper')}
              sx={{ flex: 1 }}
            />
            <NumericTextField
              size='small'
              type='number'
              label={t('sshPort')}
              value={port}
              onChange={v => { setPort(v); setProbe(null) }}
              fallback={22}
              min={1}
              max={65535}
              sx={{ width: 110 }}
            />
          </Box>
          <TextField
            size='small'
            label={t('sshUsername')}
            value={username}
            onChange={e => { setUsername(e.target.value); setProbe(null) }}
            autoComplete='off'
          />
          <ToggleButtonGroup
            size='small'
            exclusive
            value={authMode}
            onChange={(_e, v) => { if (v) { setAuthMode(v); setProbe(null) } }}
          >
            <ToggleButton value='password' sx={{ textTransform: 'none', gap: 0.75 }}>
              <i className='ri-lock-password-line' /> {t('sshAuthPassword')}
            </ToggleButton>
            <ToggleButton value='key' sx={{ textTransform: 'none', gap: 0.75 }}>
              <i className='ri-key-2-line' /> {t('sshAuthKey')}
            </ToggleButton>
          </ToggleButtonGroup>
          {authMode === 'password' ? (
            <TextField
              size='small'
              type='password'
              label={t('sshPassword')}
              value={password}
              onChange={e => { setPassword(e.target.value); setProbe(null) }}
              autoComplete='new-password'
            />
          ) : (
            <>
              <TextField
                size='small'
                multiline
                minRows={4}
                maxRows={10}
                label={t('sshPrivateKey')}
                placeholder='-----BEGIN OPENSSH PRIVATE KEY-----'
                value={privateKey}
                onChange={e => { setPrivateKey(e.target.value); setProbe(null) }}
                slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12 } } }}
              />
              <TextField
                size='small'
                type='password'
                label={t('sshPassphrase')}
                value={passphrase}
                onChange={e => { setPassphrase(e.target.value); setProbe(null) }}
                autoComplete='new-password'
                helperText={t('sshPassphraseHelper')}
              />
            </>
          )}
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
            {t('sshCredentialsNotStored')}
          </Typography>
        </Stack>
      )}

      {/* Test connection */}
      {!noMethod && (
        <Box>
          <Button
            size='small'
            variant='outlined'
            onClick={handleProbe}
            disabled={!canProbe}
            startIcon={probing ? <CircularProgress size={14} /> : <i className='ri-plug-line' />}
          >
            {t('testConnection')}
          </Button>
          {probe && (
            <Alert severity={probe.ok ? 'success' : 'error'} sx={{ mt: 1 }}>
              {probe.ok
                ? t('probeOk', {
                    os: probe.os === 'windows' ? 'Windows' : probe.os === 'linux' ? 'Linux' : t('osUnknown'),
                    hostname: probe.hostname || '-',
                  })
                : t('probeFailed', { error: probe.error || '' })}
              {probe.ok && typeof probe.details === 'string' && probe.details && (
                <Typography variant='caption' sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}>{probe.details}</Typography>
              )}
            </Alert>
          )}
          {method === 'ssh' && sshHostKey && (
            <Box sx={{ mt: 1 }}>
              <Typography variant='caption' sx={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                {t('sshHostKeyFingerprint', { fingerprint: sshHostKey })}
              </Typography>
              <FormControlLabel
                control={<Checkbox size='small' checked={hostKeyConfirmed} onChange={e => setConfirmedHostKey(e.target.checked ? sshHostKey : null)} />}
                label={<Typography variant='body2'>{t('sshConfirmHostKey')}</Typography>}
              />
            </Box>
          )}
          {method === 'ssh' && !sshHostKey && sshCredentialsOk && (
            <Typography variant='caption' sx={{ display: 'block', mt: 0.5, opacity: 0.7 }}>{t('sshProbeRequired')}</Typography>
          )}
        </Box>
      )}

      {/* Destination */}
      <Box>
        <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('destination')}</Typography>
        <RadioGroup value={destMode} onChange={e => setDestMode(e.target.value as 'original' | 'custom')}>
          <FormControlLabel
            value='original'
            control={<Radio size='small' />}
            sx={RADIO_OPTION_SX}
            label={(
              <Box>
                <Typography variant='body2'>{t('destinationOriginal')}</Typography>
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                  {t('destinationOriginalHint')}
                </Typography>
              </Box>
            )}
          />
          <FormControlLabel
            value='custom'
            control={<Radio size='small' />}
            sx={RADIO_OPTION_SX}
            label={(
              <Box>
                <Typography variant='body2'>{t('destinationCustom')}</Typography>
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                  {t('destinationCustomHint')}
                </Typography>
              </Box>
            )}
          />
        </RadioGroup>
        {destMode === 'custom' && (
          <TextField
            size='small'
            fullWidth
            label={t('customFolder')}
            value={customPath}
            onChange={e => setCustomPath(e.target.value)}
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13 } } }}
            sx={{ mt: 1 }}
          />
        )}
        {showDrive && (
          <TextField
            size='small'
            label={t('windowsDrive')}
            value={windowsDrive}
            onChange={e => setWindowsDrive(e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase())}
            error={!driveOk}
            helperText={t('windowsDriveHelper')}
            sx={{ mt: 1, width: 260 }}
          />
        )}
      </Box>

      {/* Conflicts */}
      <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
        <InputLabel>{t('conflict')}</InputLabel>
        <Select label={t('conflict')} value={conflict} onChange={e => setConflict(e.target.value as Conflict)}>
          <MenuItem value='keep'>{t('conflictKeep', { prefix: settings.restoredPrefix })}</MenuItem>
          <MenuItem value='overwrite'>{t('conflictOverwrite')}</MenuItem>
          <MenuItem value='skip'>{t('conflictSkip')}</MenuItem>
        </Select>
      </FormControl>

      {error && <Alert severity='error'>{error}</Alert>}
    </Stack>
  )

  const renderProgress = () => {
    const total = job?.bytesTotal || 0
    const pct = total > 0 ? Math.min(100, ((job?.bytesDone || 0) / total) * 100) : undefined
    const status = job?.status || 'queued'
    const statusColor: 'default' | 'info' | 'success' | 'warning' | 'error' =
      status === 'completed' ? 'success'
        : status === 'completed_with_errors' ? 'warning'
          : status === 'failed' ? 'error'
            : status === 'cancelled' ? 'default'
              : 'info'

    return (
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {target && <GuestGlyph type={target.type} status={guestStatus} />}
          <Typography variant='body2' sx={{ flex: 1, minWidth: 0 }} noWrap>
            {targetRow ? `${targetRow.name} (${targetRow.vmid})` : ''}
          </Typography>
          <Chip size='small' color={statusColor} label={t(`status.${status}`)} />
        </Box>

        <Box>
          <LinearProgress
            variant={running && pct == null ? 'indeterminate' : 'determinate'}
            value={pct ?? (running ? 0 : 100)}
            sx={{ height: 8, borderRadius: 4 }}
          />
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.5 }}>
            {total > 0
              ? t('bytesProgress', { done: formatBytes(job?.bytesDone || 0), total: formatBytes(total) })
              : t('bytesDone', { done: formatBytes(job?.bytesDone || 0) })}
          </Typography>
          {running && (job?.bytesRead || 0) > (job?.bytesDone || 0) && (
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
              {t('bytesRead', { read: formatBytes(job?.bytesRead || 0) })}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip size='small' variant='outlined' icon={<i className='ri-check-line' />} label={t('filesDone', { count: job?.filesDone || 0 })} />
          <Chip size='small' variant='outlined' icon={<i className='ri-skip-forward-line' />} label={t('filesSkipped', { count: job?.filesSkipped || 0 })} />
          <Chip
            size='small'
            variant='outlined'
            color={(job?.filesFailed || 0) > 0 ? 'error' : 'default'}
            icon={<i className='ri-close-line' />}
            label={t('filesFailed', { count: job?.filesFailed || 0 })}
          />
          {job?.guestOs && <Chip size='small' variant='outlined' label={job.guestOs === 'windows' ? 'Windows' : 'Linux'} />}
        </Box>

        {running && job?.currentPath && (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('currentPath')}</Typography>
            <Typography variant='body2' noWrap title={job.currentPath} sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
              {job.currentPath}
            </Typography>
          </Box>
        )}

        {job?.error && <Alert severity='error'>{job.error}</Alert>}

        {running && (
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('keepsRunning')}</Typography>
        )}

        <Box>
          <Button
            size='small'
            onClick={() => setLogOpen(v => !v)}
            startIcon={<i className={logOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />}
            sx={{ textTransform: 'none' }}
          >
            {t('log', { count: job?.log?.length || 0 })}
          </Button>
          <Collapse in={logOpen}>
            <Box
              sx={{
                mt: 1, p: 1, maxHeight: 240, overflow: 'auto', borderRadius: 1,
                border: '1px solid', borderColor: 'divider', bgcolor: 'action.hover',
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
              }}
            >
              {(job?.log || []).length === 0 ? (
                <Typography variant='caption' color='text.secondary'>{t('logEmpty')}</Typography>
              ) : (
                (job?.log || []).map((l, idx) => (
                  <Box
                    key={`${l.at}-${idx}`}
                    sx={{ color: l.level === 'error' ? 'error.main' : l.level === 'warn' ? 'warning.main' : 'text.primary', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                  >
                    {new Date(l.at).toLocaleTimeString()} {l.msg}
                  </Box>
                ))
              )}
            </Box>
          </Collapse>
        </Box>
      </Stack>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <AppDialogTitle onClose={onClose} icon={<i className='ri-folder-transfer-line' style={{ fontSize: 22 }} />}>
        {t('title')}
      </AppDialogTitle>
      <DialogContent dividers>
        {jobId ? renderProgress() : renderForm()}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {jobId ? (
          <>
            {running && (
              <Button
                color='error'
                onClick={handleCancelJob}
                disabled={cancelling}
                startIcon={cancelling ? <CircularProgress size={14} /> : <i className='ri-stop-circle-line' />}
              >
                {t('cancelJob')}
              </Button>
            )}
            <Button variant='contained' onClick={onClose}>{t('close')}</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button
              variant='contained'
              onClick={handleStart}
              disabled={!canStart || noMethod}
              startIcon={submitting ? <CircularProgress size={16} /> : <i className='ri-folder-transfer-line' />}
            >
              {t('restore')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
