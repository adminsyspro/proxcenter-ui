'use client'

import { createContext, useContext, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Radio,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

import { GuestGlyph, deviceLabel } from '@/components/gpu/GpuInventoryPanel'
import { rawReleaseCommand } from '@/lib/gpu/actions'
import { moveTargets } from '@/lib/gpu/move'
import { isComputeProfile, parseProfile } from '@/lib/gpu/vgpu'
import type { GpuReport, GpuReportDevice } from '@/lib/gpu/report'

/** What the GPU page lends its tabs to act: whether the caller may, and how to reload after. */
export type MoveVm = { connId: string; node: string; vmid: string; vmName: string | null }

export type GpuActionsApi = {
  canAct: boolean
  canMove: boolean
  refresh: () => void
  attach: (d: GpuReportDevice) => void
  release: (t: ReleaseTarget) => void
  move: (vm: MoveVm) => void
}

export const GpuActionsContext = createContext<GpuActionsApi>({ canAct: false, canMove: false, refresh: () => {}, attach: () => {}, release: () => {}, move: () => {} })

export const useGpuActions = () => useContext(GpuActionsContext)

export type ReleaseTarget = {
  connId: string
  node: string
  vmid: string
  vmName: string | null
  hostpci: string
  deviceName: string | null
  vmStatus: string | null
  /** Given by its raw PCI address: no API call can remove it, the root command is shown at once. */
  raw?: boolean
}

type Candidate = { connId: string; node: string; vmid: string; name: string; status: string; pool: string | null }

async function post(body: unknown): Promise<{ ok: boolean; json: any }> {
  const res = await fetch('/api/v1/gpu/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: res.ok, json: await res.json().catch(() => ({})) }
}

type Profile = { type: string; name: string; available: number }

const ERRORS = ['profile_required', 'profile_unavailable', 'not_vgpu_capable', 'quota_exceeded', 'already_attached', 'vm_not_on_node', 'vm_is_template', 'no_free_slot', 'device_ids_unknown', 'mapping_failed', 'pve_refused', 'device_not_found', 'allocation_not_found', 'raw_passthrough', 'gpu_check_unavailable']

function useErrorText() {
  const t = useTranslations('gpu.actions')
  return (code: string | undefined) => t(`errors.${code && ERRORS.includes(code) ? code : 'generic'}`)
}

export function AttachDialog({ device, onClose, onDone }: { device: GpuReportDevice | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('gpu.actions')
  const unit = useTranslations('gpu.tiles')('gib')
  const theme = useTheme()
  const errorText = useErrorText()
  // A refusal of the vDC contingent names the use and the size of its line, and the line when the server says which.
  const quotaMessage = (json: any) => {
    const values = { used: Number(json.used ?? 0), max: Number(json.count ?? 0) }
    const line = json.line
    const label = line?.kind === 'vgpu' ? [line.modelName, line.profileName].filter(Boolean).join(' ') : line?.modelName
    return label ? t('quotaExceededLine', { ...values, line: label }) : t('quotaExceeded', values)
  }
  const [vms, setVms] = useState<Candidate[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ pending: boolean; mapping: string; created: boolean } | null>(null)
  // A card in vGPU mode is handed out by profile.
  const vgpu = device?.vgpu?.mode === 'sriov'
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [profile, setProfile] = useState<string | null>(null)

  useEffect(() => {
    setProfiles(null)
    setProfile(null)
    if (!device || device.vgpu?.mode !== 'sriov') return
    let cancelled = false
    fetch(`/api/v1/gpu/actions/profiles?deviceKey=${encodeURIComponent(device.key)}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return
        if (!ok) return setLoadError(true)
        setProfiles((j.data as Profile[]).filter(p => isComputeProfile(p.name)).sort((a, b) => (parseProfile(a.name)?.gib ?? 0) - (parseProfile(b.name)?.gib ?? 0)))
      })
      .catch(() => !cancelled && setLoadError(true))
    return () => {
      cancelled = true
    }
  }, [device])

  useEffect(() => {
    setVms(null)
    setPicked(null)
    setError(null)
    setDone(null)
    setLoadError(false)
    if (!device) return
    let cancelled = false
    fetch(`/api/v1/gpu/actions/candidates?deviceKey=${encodeURIComponent(device.key)}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return
        if (!ok) return setLoadError(true)
        // One vGPU per VM (NVIDIA: Max Instances Per VM 1), one whole card per VM.
        const holders = new Set(device.vms.map(v => v.vmid))
        setVms((j.data as Candidate[]).filter(v => !holders.has(v.vmid)))
      })
      .catch(() => !cancelled && setLoadError(true))
    return () => {
      cancelled = true
    }
  }, [device])

  const submit = async () => {
    if (!device || !picked || (vgpu && !profile)) return
    setBusy(true)
    setError(null)
    const { ok, json } = await post({ action: 'attach', deviceKey: device.key, vmid: picked, ...(vgpu ? { profile } : {}) })
    setBusy(false)
    if (!ok) return setError(json?.error === 'quota_exceeded' ? quotaMessage(json) : errorText(json?.error))
    setDone({ pending: !!json.data?.pending, mapping: json.data?.mapping, created: !!json.data?.mappingCreated })
    onDone()
  }

  return (
    <Dialog open={!!device} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{vgpu ? t('attachVgpuTitle') : t('attachTitle')}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {device && (
          <Typography variant='body2'>
            {vgpu ? t('attachVgpuIntro', { device: deviceLabel(device), node: device.node }) : t('attachIntro', { device: deviceLabel(device), node: device.node })}
          </Typography>
        )}
        {done ? (
          <Alert severity='success' data-testid='gpu-attach-done'>
            {done.created ? t('attachedCreated', { mapping: done.mapping }) : t('attached', { mapping: done.mapping })}
            {done.pending && ` ${t('pendingRestart')}`}
          </Alert>
        ) : (
          <>
            {device && (vgpu ? !device.vgpuMappings?.length : device.mappings.length === 0) && <Alert severity='info'>{t('mappingWillBeCreated')}</Alert>}
            {vgpu && profiles === null && !loadError && <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} /></Box>}
            {vgpu && profiles !== null && profiles.length === 0 && <Alert severity='warning' data-testid='gpu-attach-no-profile'>{t('noProfile')}</Alert>}
            {vgpu && profiles && profiles.length > 0 && (
              <>
                <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>{t('pickProfile')}</Typography>
                <Box role='radiogroup' aria-label={t('pickProfile')} sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1 }}>
                  {profiles.map(p => {
                    const size = parseProfile(p.name)
                    const off = p.available < 1
                    return (
                      <Box
                        key={p.type}
                        data-testid='gpu-attach-profile'
                        onClick={() => !off && setProfile(p.type)}
                        sx={{
                          border: 1,
                          borderColor: profile === p.type ? 'primary.main' : 'divider',
                          bgcolor: profile === p.type ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                          borderRadius: 2,
                          px: 1,
                          py: 0.5,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          cursor: off ? 'not-allowed' : 'pointer',
                          opacity: off ? 0.5 : 1,
                        }}
                      >
                        <Radio size='small' disabled={off} checked={profile === p.type} onChange={() => setProfile(p.type)} slotProps={{ input: { 'aria-label': p.name } }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant='body2' sx={{ fontWeight: 600 }}>{p.name.replace(/^.*-/, '')}{size ? ` · ${size.gib} ${unit}` : ''}</Typography>
                          <Typography variant='caption' color='text.secondary'>{off ? t('profileFull') : t('profileAvailable')}</Typography>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
                <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>{t('pickVm')}</Typography>
              </>
            )}
            {loadError && <Alert severity='error'>{t('candidatesError')}</Alert>}
            {!vms && !loadError && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} /></Box>}
            {vms && vms.length === 0 && <Typography variant='body2' color='text.secondary'>{t('noCandidate')}</Typography>}
            {vms && vms.length > 0 && (
              <Box role='radiogroup' aria-label={t('pickVm')} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, maxHeight: 320, overflow: 'auto' }}>
                {vms.map(v => (
                  <Box
                    key={v.vmid}
                    data-testid='gpu-attach-candidate'
                    onClick={() => setPicked(v.vmid)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, cursor: 'pointer', borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
                  >
                    <Radio size='small' checked={picked === v.vmid} onChange={() => setPicked(v.vmid)} slotProps={{ input: { 'aria-label': v.name } }} />
                    <GuestGlyph status={v.status} dotBorder={theme.palette.background.paper} />
                    <Typography variant='body2' sx={{ fontWeight: 600 }}>{v.name}</Typography>
                    <Typography variant='caption' color='text.secondary'>#{v.vmid}</Typography>
                    {v.status === 'running' && <Typography variant='caption' color='warning.main' sx={{ ml: 'auto' }}>{t('runningHint')}</Typography>}
                  </Box>
                ))}
              </Box>
            )}
            {error && <Alert severity='error'>{error}</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{done ? t('close') : t('cancel')}</Button>
        {!done && (
          <Button variant='contained' onClick={submit} disabled={!picked || busy || (vgpu && !profile)} startIcon={busy ? <CircularProgress size={14} /> : undefined}>
            {t('attach')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

export function ReleaseDialog({ target, onClose, onDone }: { target: ReleaseTarget | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('gpu.actions')
  const errorText = useErrorText()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [command, setCommand] = useState<string | null>(null)
  const [done, setDone] = useState<{ pending: boolean } | null>(null)

  useEffect(() => {
    setDone(null)
    if (target?.raw) {
      setError(errorText('raw_passthrough'))
      setCommand(rawReleaseCommand(target.vmid, target.hostpci))
    } else {
      setError(null)
      setCommand(null)
    }
    // errorText is a fresh closure each render; the target alone decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const submit = async () => {
    if (!target) return
    setBusy(true)
    setError(null)
    const { ok, json } = await post({ action: 'release', connId: target.connId, node: target.node, vmid: target.vmid, hostpci: target.hostpci })
    setBusy(false)
    if (!ok) {
      if (json?.error === 'raw_passthrough' && json.command) setCommand(json.command)
      return setError(errorText(json?.error))
    }
    setDone({ pending: !!json.data?.pending })
    onDone()
  }

  return (
    <Dialog open={!!target} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{t('releaseTitle')}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {target && (
          <Typography variant='body2'>
            {t('releaseIntro', { device: target.deviceName ?? 'GPU', vm: target.vmName ?? `#${target.vmid}`, hostpci: target.hostpci })}
          </Typography>
        )}
        {target?.vmStatus === 'running' && !done && <Alert severity='warning'>{t('releaseRunning')}</Alert>}
        {done && <Alert severity='success' data-testid='gpu-release-done'>{t('released')}{done.pending && ` ${t('pendingRestart')}`}</Alert>}
        {error && <Alert severity={command ? 'info' : 'error'}>{error}</Alert>}
        {command && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.75 }}>
            <Typography variant='body2' sx={{ flex: 1, fontWeight: 600 }} data-testid='gpu-release-command'>{command}</Typography>
            <Tooltip title={t('copy')}>
              <IconButton size='small' aria-label={t('copy')} onClick={() => navigator.clipboard?.writeText(command)}>
                <i className='ri-file-copy-line' />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{done || command ? t('close') : t('cancel')}</Button>
        {!done && !command && (
          <Button variant='contained' color='warning' onClick={submit} disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : undefined}>
            {t('release')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

/**
 * Move a stopped GPU VM to a node where its mapping has a free GPU (#672). The
 * migration goes through the guest migrate route (vm.migrate, audit, snapshot
 * guard), offline: a passthrough GPU cannot live-migrate.
 */
export function MoveDialog({ vm, report, onClose, onDone }: { vm: MoveVm | null; report: GpuReport | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('gpu.actions')
  const plan = vm && report ? moveTargets(report, vm.connId, vm.node, vm.vmid) : null
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setTarget(null)
    setError(null)
    setDone(false)
  }, [vm])

  const submit = async () => {
    if (!vm || !target) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/qemu/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/migrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, online: false }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(json?.error ? String(json.error) : t('errors.generic'))
    setDone(true)
    onDone()
  }

  return (
    <Dialog open={!!vm} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{t('moveTitle')}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {vm && <Typography variant='body2'>{t('moveIntro', { vm: vm.vmName ?? `#${vm.vmid}`, node: vm.node })}</Typography>}
        {done ? (
          <Alert severity='success' data-testid='gpu-move-done'>{t('moveStarted', { node: target ?? '' })}</Alert>
        ) : plan && 'reason' in plan ? (
          <Alert severity='info' data-testid='gpu-move-impossible'>{t(`moveReason.${plan.reason}`, { mappings: plan.mappings.join(', ') })}</Alert>
        ) : (
          plan && 'targets' in plan && (
            <Box role='radiogroup' aria-label={t('moveTarget')} sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
              {plan.targets.map(tg => (
                <Box key={tg.node} data-testid='gpu-move-target' onClick={() => setTarget(tg.node)} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, cursor: 'pointer', borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                  <Radio size='small' checked={target === tg.node} onChange={() => setTarget(tg.node)} slotProps={{ input: { 'aria-label': tg.node } }} />
                  <i className='ri-server-line' style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
                  <Typography variant='body2' sx={{ fontWeight: 600 }}>{tg.node}</Typography>
                  <Typography variant='caption' color='text.secondary'>{t('moveFree', { count: tg.freeGpus, models: tg.models.join(', ') })}</Typography>
                </Box>
              ))}
            </Box>
          )
        )}
        {error && <Alert severity='error'>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{done || (plan && !plan.ok) ? t('close') : t('cancel')}</Button>
        {!done && plan?.ok && (
          <Button variant='contained' onClick={submit} disabled={!target || busy} startIcon={busy ? <CircularProgress size={14} /> : undefined}>
            {t('move')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
