'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Switch,
  Typography,
} from '@mui/material'
import { useLocale, useTranslations } from 'next-intl'

import ConfirmCloseDialog from '@/components/ConfirmCloseDialog'
import NumericTextField from '@/components/ui/NumericTextField'
import { PBS_REBOOT_TIMEOUT_DEFAULT, PBS_REBOOT_TIMEOUT_MAX, PBS_REBOOT_TIMEOUT_MIN } from '@/lib/pbs/updateOptions'
import {
  findingTone,
  findingValues,
  isKnownFinding,
  isRunActive,
  isSubscriptionRefusal,
  needsUpdate,
  rebootState,
  runDurationSeconds,
  runOutcome,
  runPercent,
  runSteps,
  updatesTone,
  type PbsFinding,
  type PbsPreflight,
  type PbsRun,
  type PbsRunNode,
  type PbsStepState,
  type PbsTone,
} from '@/lib/pbs/updateView'
import { packageProgressLabel } from '@/lib/rolling/updateProgress'
import { formatBytes } from '@/utils/format'

interface Props {
  open: boolean
  pbsId: string
  pbsName?: string
  onClose: () => void
  /** Called once a run ends, so the caller can read the pending updates again. */
  onFinished?: () => void
}

type View = 'loading' | 'checks' | 'run'
type Tone = PbsTone

const POLL_MS = 3000
const LOG_TAIL = 200

type Pane = 'log' | 'packages' | 'apt'

const OUTCOME_KEY = { failed: 'statusFailed', cancelled: 'statusCancelled', upToDate: 'statusUpToDate', completed: 'statusCompleted' } as const
const PANE_KEY = { log: 'paneLog', packages: 'panePackages', apt: 'paneApt' } as const
const REBOOT_KEY = { done: 'rebootDone', pending: 'rebootPending', notNeeded: 'rebootNotNeeded' } as const

const PANE_SX = { minHeight: 72, flex: '0 1 200px', overflow: 'auto', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1 } as const

const TONE_ICON: Record<Tone, { icon: string, color: string }> = {
  ok: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  warning: { icon: 'ri-error-warning-fill', color: 'warning.main' },
  error: { icon: 'ri-close-circle-fill', color: 'error.main' },
  info: { icon: 'ri-information-fill', color: 'text.secondary' },
}

const STEP_ICON: Record<PbsStepState, { icon: string, color: string }> = {
  pending: { icon: 'ri-checkbox-blank-circle-line', color: 'text.disabled' },
  active: { icon: 'ri-loader-4-line', color: 'primary.main' },
  done: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  failed: { icon: 'ri-close-circle-fill', color: 'error.main' },
  skipped: { icon: 'ri-skip-forward-line', color: 'text.disabled' },
}

/** One line: an icon, what it is, its value on the right. */
function Row({ icon, color, label, spin = false, children }: Readonly<{ icon: string, color: string, label: string, spin?: boolean, children?: ReactNode }>) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 36, px: 2 }}>
      <Box component='i' className={icon} sx={{ fontSize: 18, color, flexShrink: 0, ...(spin && { animation: 'spin 1s linear infinite' }) }} />
      <Typography variant='body2' sx={{ flex: 1, minWidth: 0 }} noWrap>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, maxWidth: '60%' }}>{children}</Box>
    </Box>
  )
}

function Value({ children }: Readonly<{ children: ReactNode }>) {
  return <Typography variant='body2' color='text.secondary' noWrap>{children}</Typography>
}

function Panel({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', '& > * + *': { borderTop: 1, borderColor: 'divider' } }}>
      {children}
    </Box>
  )
}

/**
 * Update of a Proxmox Backup Server from its Updates tab (ui#1428): the
 * checks, the options, the run as it goes, then what it changed. The run
 * lives in the orchestrator, so closing the dialog does not stop it and
 * opening it again shows where it is.
 */
export default function PbsUpdateDialog({ open, pbsId, pbsName, onClose, onFinished }: Readonly<Props>) {
  const t = useTranslations('inventory.pbsUpdate')
  const tu = useTranslations()
  const locale = useLocale()

  const [view, setView] = useState<View>('loading')
  const [preflight, setPreflight] = useState<PbsPreflight | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<PbsRun | null>(null)
  const [lastRun, setLastRun] = useState<PbsRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  // What the pane under the report shows; null until chosen: the apt output of a failed run, the log otherwise.
  const [pane, setPane] = useState<Pane | null>(null)

  const [autoReboot, setAutoReboot] = useState(true)
  const [rebootMinutes, setRebootMinutes] = useState(PBS_REBOOT_TIMEOUT_DEFAULT / 60)
  const [readOnly, setReadOnly] = useState(true)

  const finishedFor = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  const options = useCallback(() => ({
    autoReboot,
    rebootTimeout: rebootMinutes * 60,
    datastoreReadOnly: readOnly,
  }), [autoReboot, rebootMinutes, readOnly])

  const runChecks = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/update/preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setPreflight(body.data as PbsPreflight)
    } catch (e: any) {
      setPreflight(null)
      setError(e?.message || String(e))
    } finally {
      setChecking(false)
    }
  }, [pbsId])

  // On open: a run still going is shown as it is, otherwise the checks start.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    setView('loading')
    setPreflight(null)
    setError(null)
    setRun(null)
    setPane(null)
    finishedFor.current = null

    void (async () => {
      let latest: PbsRun | null = null

      try {
        const res = await fetch(`/api/v1/pbs/${pbsId}/update`, { cache: 'no-store' })
        const body = await res.json().catch(() => ({}))

        latest = (body?.data?.run as PbsRun | null) ?? null
      } catch {
        latest = null
      }
      if (cancelled) return
      if (isRunActive(latest)) {
        setRun(latest)
        setView('run')

        return
      }
      setLastRun(latest)
      setView('checks')
      void runChecks()
    })()

    return () => { cancelled = true }
  }, [open, pbsId, runChecks])

  // Follow the run until it ends.
  const runId = run?.id
  const active = isRunActive(run)

  useEffect(() => {
    if (!open || view !== 'run' || !runId || !active) return
    let stop = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/pbs/${pbsId}/update?run=${encodeURIComponent(runId)}`, { cache: 'no-store' })
        const body = await res.json().catch(() => ({}))

        if (!stop && res.ok && body?.data?.run) setRun(body.data.run as PbsRun)
      } catch {
        // The server reboots, the orchestrator does not: a failed poll is retried.
      }
    }
    const timer = setInterval(() => { void tick() }, POLL_MS)

    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [open, view, runId, active, pbsId])

  useEffect(() => {
    if (run && !isRunActive(run) && finishedFor.current !== run.id) {
      finishedFor.current = run.id
      onFinished?.()
    }
  }, [run, onFinished])

  const logCount = run?.logs?.length ?? 0

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logCount])

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options()),
      })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setRun(body.data as PbsRun)
      setView('run')
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setStarting(false)
    }
  }

  const cancelRun = async () => {
    setConfirmCancel(false)
    if (!run) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/update?run=${encodeURIComponent(run.id)}`, { method: 'DELETE' })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))

        setError(body?.error || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setCancelling(false)
    }
  }

  const findingText = (f: PbsFinding) => {
    if (isSubscriptionRefusal(f)) return t('findings.pbs_apt_update_subscription', findingValues(f))

    return isKnownFinding(f.code) ? t(`findings.${f.code}` as any, findingValues(f)) : f.message
  }

  const node = run?.node_statuses?.[0]
  const pkg = node?.status === 'updating' ? packageProgressLabel(node.package_progress as any) : null

  const optionsPanel = () => (
    <>
      <Panel>
        <Row icon='ri-restart-line' color='text.secondary' label={t('optAutoReboot')}>
          <Switch size='small' checked={autoReboot} onChange={e => setAutoReboot(e.target.checked)} slotProps={{ input: { 'aria-label': t('optAutoReboot') } }} />
        </Row>
        <Row icon='ri-timer-line' color='text.secondary' label={t('optRebootTimeout')}>
          <NumericTextField
            size='small'
            value={rebootMinutes}
            onChange={v => setRebootMinutes(v)}
            fallback={PBS_REBOOT_TIMEOUT_DEFAULT / 60}
            min={PBS_REBOOT_TIMEOUT_MIN / 60}
            max={PBS_REBOOT_TIMEOUT_MAX / 60}
            disabled={!autoReboot}
            sx={{ width: 84 }}
            slotProps={{ htmlInput: { 'aria-label': t('optRebootTimeout') } }}
          />
          <Value>{t('minutes')}</Value>
        </Row>
        <Row icon='ri-lock-line' color='text.secondary' label={t('optReadOnly')}>
          <Switch size='small' checked={readOnly} onChange={e => setReadOnly(e.target.checked)} slotProps={{ input: { 'aria-label': t('optReadOnly') } }} />
        </Row>
      </Panel>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
        {readOnly ? t('readOnlyHint') : t('readOnlyOffHint')}
      </Typography>
    </>
  )

  const checksView = () => {
    if (checking && !preflight) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}>
          <CircularProgress size={18} />
          <Typography variant='body2' color='text.secondary'>{t('checking')}</Typography>
        </Box>
      )
    }
    if (!preflight) return null

    const errors = preflight.findings.filter(f => f.severity === 'error')
    const warnings = preflight.findings.filter(f => f.severity === 'warning' && f.code !== 'pbs_no_updates')
    const tone = (...codes: string[]) => findingTone(preflight.findings, ...codes)
    const aptFailed = preflight.findings.some(f => f.code === 'pbs_apt_update_failed')
    const maintained = preflight.datastores.filter(d => d.maintenance_mode).length
    const upcoming = preflight.upcoming_backup_jobs ?? []
    const jobs = preflight.backup_jobs ?? []
    const icon = (x: Tone) => TONE_ICON[x]

    return (
      <Stack spacing={2}>
        {errors.map(f => <Alert key={`${f.code}:${f.message}`} severity='error'>{findingText(f)}</Alert>)}
        {warnings.map(f => <Alert key={`${f.code}:${f.message}`} severity='warning'>{findingText(f)}</Alert>)}
        {upcoming.length > 0 && (
          <Alert severity='warning'>
            {t('upcomingJobs', {
              count: upcoming.length,
              time: new Date((upcoming[0].nextRun ?? 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              cluster: upcoming[0].connectionName,
            })}
          </Alert>
        )}

        <Panel>
          <Row {...icon(tone('pbs_state_unreadable'))} label={t('rowVersion')}>
            <Value>{preflight.version || '-'}</Value>
          </Row>
          <Row {...icon('ok')} label={t('rowKernel')}>
            <Value>{preflight.kernel || '-'}</Value>
          </Row>
          <Row {...icon(updatesTone(preflight))} label={t('rowUpdates')}>
            {preflight.updates.kernel_update && <Chip size='small' variant='outlined' label={t('kernelUpdate')} />}
            <Value>{aptFailed ? '-' : t('packageCount', { count: preflight.updates.package_count })}</Value>
          </Row>
          <Row {...icon(tone('pbs_tasks_running'))} label={t('rowTasks')}>
            <Value>{preflight.running_tasks.length === 0 ? t('noTask') : t('taskCount', { count: preflight.running_tasks.length })}</Value>
          </Row>
          <Row {...icon(tone('pbs_datastore_offline'))} label={t('rowDatastores')}>
            <Value>
              {maintained > 0
                ? t('datastoreCountMaintenance', { count: preflight.datastores.length, maintained })
                : t('datastoreCount', { count: preflight.datastores.length })}
            </Value>
          </Row>
          <Row {...icon(tone('pbs_disk_space', 'pbs_disk_space_low'))} label={t('rowDisk')}>
            <Value>{t('diskFree', { free: formatBytes(preflight.disk_space_free_bytes), total: formatBytes(preflight.disk_space_total_bytes) })}</Value>
          </Row>
          <Row {...icon(tone('pbs_service_inactive'))} label={t('rowServices')}>
            <Value>{preflight.inactive_services.length === 0 ? t('servicesRunning') : preflight.inactive_services.join(', ')}</Value>
          </Row>
          <Row {...icon(upcoming.length > 0 ? 'warning' : 'ok')} label={t('rowBackupJobs')}>
            <Value>{jobs.length === 0 ? t('noBackupJob') : t('backupJobCount', { count: jobs.length })}</Value>
          </Row>
        </Panel>

        {optionsPanel()}
      </Stack>
    )
  }

  const reportPanel = (run: PbsRun, node: PbsRunNode) => {
    const { outcome, tone } = runOutcome(run)
    const duration = runDurationSeconds(run)
    const upgraded = node.upgraded_packages ?? []
    const maintained = node.maintenance_datastores?.length ?? 0

    return (
      <Panel>
        <Row icon='ri-flag-line' color='text.secondary' label={t('reportStatus')}>
          <Box component='i' className={TONE_ICON[tone].icon} sx={{ fontSize: 18, color: TONE_ICON[tone].color }} />
          <Value>{t(OUTCOME_KEY[outcome])}</Value>
        </Row>
        {node.status !== 'skipped' && (
          <>
        <Row icon='ri-server-line' color='text.secondary' label={t('reportVersion')}>
          <Value>{node.version_before || '-'} → {node.version_after || '-'}</Value>
        </Row>
        <Row icon='ri-cpu-line' color='text.secondary' label={t('reportKernel')}>
          <Value>{node.kernel_before || '-'} → {node.kernel_after || '-'}</Value>
        </Row>
        <Row icon='ri-restart-line' color='text.secondary' label={t('reportReboot')}>
          <Value>{t(REBOOT_KEY[rebootState(node)])}</Value>
        </Row>
        <Row icon='ri-archive-line' color='text.secondary' label={t('reportPackages')}>
          <Value>{t('packageCount', { count: upgraded.length })}</Value>
        </Row>
        {maintained > 0 && (
          <Row icon='ri-lock-line' color='text.secondary' label={t('reportReadOnly')}>
            <Value>{t('datastoreCount', { count: maintained })}</Value>
          </Row>
        )}
        {run.completed_at && (
          <Row icon='ri-calendar-check-line' color='text.secondary' label={t('reportFinished')}>
            <Value>{new Date(run.completed_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</Value>
          </Row>
        )}
        {duration !== null && (
          <Row icon='ri-timer-line' color='text.secondary' label={t('reportDuration')}>
            <Value>{t('duration', { minutes: Math.floor(duration / 60), seconds: duration % 60 })}</Value>
          </Row>
        )}
          </>
        )}
      </Panel>
    )
  }

  const detailPane = (panes: Pane[], shown: Pane, upgraded: NonNullable<PbsRunNode['upgraded_packages']>, output: string, logs: NonNullable<PbsRun['logs']>) => (
    <>
      {panes.length > 1 && (
        <ToggleButtonGroup size='small' exclusive value={shown} onChange={(_, v: Pane | null) => { if (v) setPane(v) }} aria-label={t('paneLabel')} sx={{ alignSelf: 'flex-start', flexShrink: 0 }}>
          {panes.map(p => (
            <ToggleButton key={p} value={p} sx={{ py: 0.25, px: 1.5, textTransform: 'none' }}>{t(PANE_KEY[p])}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
      {shown === 'packages' ? (
        <Box sx={PANE_SX}>
          {upgraded.map(p => (
            <Box key={p.name} sx={{ display: 'flex', gap: 2, px: 2, py: 0.5, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
              <Typography variant='body2' sx={{ flex: 1, minWidth: 0 }} noWrap>{p.name}</Typography>
              <Typography variant='body2' color='text.secondary' noWrap>{p.current_version} → {p.new_version}</Typography>
            </Box>
          ))}
        </Box>
      ) : (
        <Box
          ref={logRef}
          component='pre'
          data-testid={shown === 'apt' ? 'pbs-update-output' : 'pbs-update-log'}
          sx={{ ...PANE_SX, m: 0, p: 1.5, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {shown === 'apt' ? output : logs.map(l => `${new Date(l.timestamp).toLocaleTimeString(locale)}  ${l.message}`).join('\n')}
        </Box>
      )}
    </>
  )

  const runView = () => {
    if (!run) return null
    const steps = runSteps(run)
    const ended = !isRunActive(run)
    const upgraded = node?.upgraded_packages ?? []
    const logs = (run.logs ?? []).slice(-LOG_TAIL)
    const output = node?.update_output ?? ''
    const panes: Pane[] = [...(logs.length > 0 ? ['log' as const] : []), ...(ended && upgraded.length > 0 ? ['packages' as const] : []), ...(output ? ['apt' as const] : [])]
    const preferred = pane ?? (node?.status === 'failed' && output ? 'apt' : 'log')
    const shown = panes.includes(preferred) ? preferred : panes[0]

    return (
      <Stack spacing={2} sx={{ minHeight: 0 }}>
        {run.status === 'failed' && <Alert severity='error'>{t('resultFailed', { error: run.error || node?.error || '' })}</Alert>}
        {ended && node?.reboot_required && !node.did_reboot && run.status === 'completed' && (
          <Alert severity='warning'>{t('rebootStillRequired')}</Alert>
        )}

        {!ended && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant='body2'>{t('runInProgress')}</Typography>
              <Typography variant='body2' color='text.secondary'>{pkg ? tu(pkg.key as any, pkg.values) : ''}</Typography>
            </Box>
            <LinearProgress variant='determinate' value={runPercent(run)} aria-label={t('runInProgress')} sx={{ height: 6, borderRadius: 1 }} />
          </Box>
        )}

        {/* Once the run succeeded every step reads "done": the report below says it better. */}
        {(!ended || run.status !== 'completed') && (
          <Panel>
            {steps.map(({ step, state }) => (
              <Row
                key={step}
                icon={STEP_ICON[state].icon}
                spin={state === 'active'}
                color={STEP_ICON[state].color}
                label={t(`steps.${step}` as any)}
              >
                <Value>{t(`stepStates.${state}` as any)}</Value>
              </Row>
            ))}
          </Panel>
        )}

        {ended && node && reportPanel(run, node)}

        {panes.length > 0 && detailPane(panes, shown, upgraded, output, logs)}
      </Stack>
    )
  }

  const canStart = !!preflight?.can_proceed && needsUpdate(preflight) && !checking && !starting

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-install-line' style={{ fontSize: 20 }} />
          {pbsName ? t('titleNamed', { name: pbsName }) : t('title')}
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ display: 'flex', flexDirection: 'column' }}>
          <Stack spacing={2} sx={{ minHeight: 0 }}>
            {error && <Alert severity='error' onClose={() => setError(null)}>{error}</Alert>}
            {view === 'loading' && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={22} /></Box>
            )}
            {view === 'checks' && checksView()}
            {view === 'run' && runView()}
          </Stack>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ '& .MuiButton-root': { whiteSpace: 'nowrap', flexShrink: 0, minHeight: 34 } }}>
          {view === 'checks' && lastRun && (
            <Button onClick={() => { setRun(lastRun); setView('run') }} sx={{ mr: 'auto' }} startIcon={<i className='ri-file-list-3-line' style={{ fontSize: 16 }} />}>
              {t('lastReport')}
            </Button>
          )}
          {view === 'run' && run && !isRunActive(run) && (
            <Button onClick={() => { setLastRun(run); setRun(null); setView('checks'); void runChecks() }} sx={{ mr: 'auto' }} startIcon={<i className='ri-arrow-left-line' style={{ fontSize: 16 }} />}>
              {t('backToChecks')}
            </Button>
          )}
          <Button onClick={onClose}>{tu('common.close')}</Button>
          {view === 'checks' && (
            <>
              <Button variant='outlined' onClick={() => void runChecks()} disabled={checking || starting} startIcon={checking ? <CircularProgress size={14} /> : <i className='ri-refresh-line' style={{ fontSize: 16 }} />}>
                {t('recheck')}
              </Button>
              <Button variant='contained' color='warning' onClick={() => void start()} disabled={!canStart} startIcon={starting ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <i className='ri-play-line' style={{ fontSize: 16 }} />}>
                {t('start')}
              </Button>
            </>
          )}
          {view === 'run' && run && isRunActive(run) && (
            <Button variant='outlined' color='error' onClick={() => setConfirmCancel(true)} disabled={cancelling} startIcon={<i className='ri-stop-circle-line' style={{ fontSize: 16 }} />}>
              {t('cancelRun')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <ConfirmCloseDialog
        open={confirmCancel}
        title={t('cancelTitle')}
        message={t('cancelMessage')}
        confirmLabel={t('cancelRun')}
        onConfirm={() => void cancelRun()}
        onCancel={() => setConfirmCancel(false)}
      />
    </>
  )
}
