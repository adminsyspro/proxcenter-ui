'use client'

// Move a VM to another vDC of its tenant (#1335). One line per setting: the
// source storage or network on the left, its target in the right column,
// aligned on every row. The server re-checks everything at launch; the
// dialog only shows what it answered.

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/VdcQuotaRow'
import { useProxCenterTasks } from '@/contexts/ProxCenterTasksContext'
import { trackVdcMove } from './trackVdcMove'

type Blocker = { code: string; context?: Record<string, string | number>; details?: string[] }

type TargetStorage = {
  storage: string
  primary: boolean
  policy: { name: string; iopsRd: number | null; iopsWr: number | null; mbpsRd: number | null; mbpsWr: number | null } | null
  quotaMb: number | null
  usedMb: number | null
}

type Options = {
  guest: {
    vmid: number
    name: string
    running: boolean
    vcpus: number
    memoryMb: number
    totalDiskMb: number
    storages: Array<{ storage: string; disks: string[]; sizeMb: number }>
    bridges: Array<{ bridge: string; nics: string[]; tags: number[] }>
  }
  sourceVdc: { id: string; name: string }
  targets: Array<{ vdcId: string; name: string }>
  target: {
    vdcId: string
    name: string
    storages: TargetStorage[]
    networks: Array<{ bridge: string; label: string; kind: 'vnet' | 'shared'; stretched: boolean }>
    defaults: { storageMap: Record<string, string>; bridgeMap: Record<string, string> }
  } | null
  blockers: Blocker[]
}

const LABEL_WIDTH = 220
const ROW_SX = { display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 40 } as const
const LEAD_SX = { width: LABEL_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 } as const

export function formatMb(mb: number): string {
  if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(1)} TiB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GiB`

  return `${mb} MiB`
}

function capsText(policy: TargetStorage['policy']): string {
  if (!policy) return ''
  const parts: string[] = []
  if (policy.iopsRd || policy.iopsWr) parts.push(`${policy.iopsRd ?? '∞'}/${policy.iopsWr ?? '∞'} IOPS`)
  if (policy.mbpsRd || policy.mbpsWr) parts.push(`${policy.mbpsRd ?? '∞'}/${policy.mbpsWr ?? '∞'} MB/s`)

  return parts.join(' · ')
}

export default function MoveVdcDialog({
  open,
  onClose,
  connId,
  node,
  vmid,
  onMoved,
}: {
  open: boolean
  onClose: () => void
  connId: string
  node: string
  vmid: string | number
  onMoved?: () => void
}) {
  const t = useTranslations('moveVdc')
  const { addTask, updateTask } = useProxCenterTasks()
  const [options, setOptions] = useState<Options | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [targetVdcId, setTargetVdcId] = useState<string>('')
  const [storageMap, setStorageMap] = useState<Record<string, string>>({})
  const [bridgeMap, setBridgeMap] = useState<Record<string, string>>({})
  const [online, setOnline] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [launchBlockers, setLaunchBlockers] = useState<Blocker[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)

  const base = `/api/v1/connections/${encodeURIComponent(connId)}/guests/qemu/${encodeURIComponent(node)}/${encodeURIComponent(String(vmid))}/move-vdc`

  const load = useCallback(async (target?: string) => {
    setLoading(true)
    setLoadError(null)
    setLaunchBlockers([])
    try {
      const res = await fetch(target ? `${base}?targetVdcId=${encodeURIComponent(target)}` : base, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      const data: Options = json.data
      setOptions(data)
      if (data.target) {
        setTargetVdcId(data.target.vdcId)
        setStorageMap(data.target.defaults.storageMap)
        setBridgeMap(data.target.defaults.bridgeMap)
      }
    } catch (e: any) {
      setLoadError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    if (!open) return
    setOptions(null)
    setSubmitError(null)
    setOnline(true)
    void load()
  }, [open, load])

  const blockers = useMemo(() => [...(options?.blockers ?? []), ...launchBlockers], [options, launchBlockers])
  const unmapped = useMemo(() => {
    if (!options) return true
    return options.guest.storages.some((g) => !storageMap[g.storage]) || options.guest.bridges.some((g) => !bridgeMap[g.bridge])
  }, [options, storageMap, bridgeMap])

  const blockerText = (b: Blocker) => {
    const key = `blockers.${b.code}`
    const text = t.has(key) ? t(key, b.context ?? {}) : b.code
    return b.details?.length ? `${text} ${b.details.join(' · ')}` : text
  }

  const submit = async () => {
    if (!options?.target) return
    setSubmitting(true)
    setSubmitError(null)
    setLaunchBlockers([])
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetVdcId, storageMap, bridgeMap, online }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && Array.isArray(json?.blockers)) {
        setLaunchBlockers(json.blockers)
        return
      }
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

      const moveId: string = json.data.moveId
      const label = t('taskLabel', { name: options.guest.name || String(options.guest.vmid), target: options.target.name })
      addTask({ id: `vdc-move-${moveId}`, type: 'generic', label, progress: 10, status: 'running', createdAt: Date.now() })
      trackVdcMove(moveId, (update) => {
        updateTask(`vdc-move-${moveId}`, update)
        if (update.status === 'done') onMoved?.()
      }, {
        done: t('taskDone'),
        doneWithWarnings: t('taskDoneWithWarnings'),
        copying: t('taskCopying'),
        finalizing: t('taskFinalizing'),
      })
      onClose()
    } catch (e: any) {
      setSubmitError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const target = options?.target ?? null

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-arrow-left-right-line" style={{ fontSize: 20 }} />
        <Typography variant="h6" component="span" noWrap>
          {t('title', { name: options?.guest.name || String(vmid), vmid: String(vmid) })}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '20px !important' }}>
        {loading && !options && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>
        )}
        {loadError && <Alert severity="error">{loadError}</Alert>}

        {options && (
          <Stack spacing={0.5}>
            <Box sx={ROW_SX}>
              <Box sx={LEAD_SX}>
                <i className="ri-cloud-line" style={{ fontSize: 18 }} />
                <Typography variant="body2" noWrap>{t('currentVdc')}</Typography>
              </Box>
              <Typography variant="body2" fontWeight={600} noWrap>{options.sourceVdc.name}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 'auto' }}>
                {t('guestSummary', { vcpus: options.guest.vcpus, ram: formatMb(options.guest.memoryMb), disk: formatMb(options.guest.totalDiskMb) })}
              </Typography>
            </Box>

            <Box sx={ROW_SX}>
              <Box sx={LEAD_SX}>
                <i className="ri-cloud-fill" style={{ fontSize: 18 }} />
                <Typography variant="body2" noWrap>{t('targetVdc')}</Typography>
              </Box>
              <Select
                size="small"
                fullWidth
                sx={SMALL_SELECT_SX}
                value={options.targets.some((x) => x.vdcId === targetVdcId) ? targetVdcId : ''}
                displayEmpty
                disabled={options.targets.length === 0 || loading}
                onChange={(e) => void load(String(e.target.value))}
                inputProps={{ 'aria-label': t('targetVdc') }}
              >
                {options.targets.length === 0 && <MenuItem value="">{t('noOtherVdc')}</MenuItem>}
                {options.targets.map((x) => <MenuItem key={x.vdcId} value={x.vdcId}>{x.name}</MenuItem>)}
              </Select>
            </Box>

            {target && (
              <>
                <Typography variant="overline" color="text.secondary" sx={{ pt: 1 }}>{t('storageSection')}</Typography>
                {options.guest.storages.map((g) => {
                  const label = `${g.storage} · ${g.disks.join(', ')} · ${formatMb(g.sizeMb)}`
                  return (
                    <Box key={g.storage} sx={ROW_SX}>
                      <Box sx={LEAD_SX} title={label}>
                        <i className="ri-hard-drive-3-line" style={{ fontSize: 18 }} />
                        <Typography variant="body2" noWrap>{label}</Typography>
                      </Box>
                      <Select
                        size="small"
                        fullWidth
                        sx={SMALL_SELECT_SX}
                        value={storageMap[g.storage] ?? ''}
                        displayEmpty
                        onChange={(e) => setStorageMap((m) => ({ ...m, [g.storage]: String(e.target.value) }))}
                        inputProps={{ 'aria-label': t('storageFor', { storage: g.storage }) }}
                      >
                        <MenuItem value="" disabled>{t('chooseStorage')}</MenuItem>
                        {target.storages.map((s) => {
                          const caps = capsText(s.policy)
                          const used = s.usedMb === null ? '?' : formatMb(s.usedMb)
                          const quota = s.quotaMb === null ? '' : t('tierUsage', { used, quota: formatMb(s.quotaMb) })
                          let tier = t('noPolicy')
                          if (s.policy) tier = s.policy.name
                          else if (s.primary) tier = t('primaryStorage')
                          const text = [tier, s.storage, caps, quota].filter(Boolean).join(' · ')
                          return <MenuItem key={s.storage} value={s.storage}><Typography variant="body2" noWrap>{text}</Typography></MenuItem>
                        })}
                      </Select>
                    </Box>
                  )
                })}

                {options.guest.bridges.length > 0 && (
                  <Typography variant="overline" color="text.secondary" sx={{ pt: 1 }}>{t('networkSection')}</Typography>
                )}
                {options.guest.bridges.map((g) => {
                  const label = `${g.bridge} · ${g.nics.join(', ')}`
                  return (
                    <Box key={g.bridge} sx={ROW_SX}>
                      <Box sx={LEAD_SX} title={label}>
                        <i className="ri-git-merge-line" style={{ fontSize: 18 }} />
                        <Typography variant="body2" noWrap>{label}</Typography>
                      </Box>
                      <Select
                        size="small"
                        fullWidth
                        sx={SMALL_SELECT_SX}
                        value={bridgeMap[g.bridge] ?? ''}
                        displayEmpty
                        onChange={(e) => setBridgeMap((m) => ({ ...m, [g.bridge]: String(e.target.value) }))}
                        inputProps={{ 'aria-label': t('networkFor', { bridge: g.bridge }) }}
                      >
                        <MenuItem value="" disabled>{t('chooseNetwork')}</MenuItem>
                        {target.networks.map((n) => {
                          let kind = ''
                          if (n.stretched) kind = t('stretched')
                          else if (n.kind === 'shared') kind = t('sharedBridge')
                          const text = [n.label, n.bridge === n.label ? '' : n.bridge, kind].filter(Boolean).join(' · ')
                          return (
                            <MenuItem key={n.bridge} value={n.bridge}>
                              <Typography variant="body2" noWrap>{text}</Typography>
                            </MenuItem>
                          )
                        })}
                      </Select>
                    </Box>
                  )
                })}

                <Box sx={ROW_SX}>
                  <Box sx={LEAD_SX}>
                    <i className="ri-flashlight-line" style={{ fontSize: 18 }} />
                    <Typography variant="body2" noWrap>{t('mode')}</Typography>
                  </Box>
                  {options.guest.running ? (
                    <FormControlLabel
                      sx={{ m: 0 }}
                      control={<Switch size="small" checked={online} onChange={(e) => setOnline(e.target.checked)} />}
                      label={<Typography variant="body2" noWrap>{online ? t('modeLive') : t('modeOfflineRunning')}</Typography>}
                    />
                  ) : (
                    <Typography variant="body2" noWrap>{t('modeOffline')}</Typography>
                  )}
                </Box>
              </>
            )}

            {blockers.length > 0 && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                <Stack spacing={0.25}>
                  {blockers.map((b, i) => (
                    <Typography key={`${b.code}-${i}`} variant="body2" noWrap title={blockerText(b)}>{blockerText(b)}</Typography>
                  ))}
                </Stack>
              </Alert>
            )}
            {submitError && <Alert severity="error" sx={{ mt: 1 }}>{submitError}</Alert>}
            {target && blockers.length === 0 && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ pt: 1 }} title={t('afterMoveHint')}>
                {t('afterMoveHint')}
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>{t('cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={!target || submitting || loading || unmapped || (options?.blockers.length ?? 0) > 0}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <i className="ri-arrow-left-right-line" />}
        >
          {t('submit')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
