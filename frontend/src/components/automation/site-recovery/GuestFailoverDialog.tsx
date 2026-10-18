'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, LinearProgress, MenuItem, Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material'

import { useTheme } from '@mui/material/styles'

import type { RecoveryExecution, RecoveryPlanGuestState, VMRestorePoints } from '@/lib/orchestrator/site-recovery.types'
import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'

import ExecutionTrace, { CUTOVER_STEPS, FAILOVER_STEPS } from './ExecutionTrace'

/**
 * The guest a per-VM dialog acts on: one row of the Emergency DR tab, with
 * the plan it belongs to. siblingCount is how many OTHER guests of the plan
 * keep replicating while this one is on the DR site.
 */
export interface GuestDialogTarget {
  planId: string
  planName: string
  vmId: number
  vmName: string
  targetVmId: number
  jobId: string
  siblingCount: number
  /** Connection ids of the two sites, to find where each side runs. */
  sourceCluster?: string
  targetCluster?: string
  /** Names of the two sites, for the reverse-sync picture; ids when unknown. */
  sourceSite?: string
  targetSite?: string
}

/** Where one side of the guest runs right now, from the inventory. */
export interface GuestPlacement {
  node?: string
  status?: string
}

export interface GuestPlacements {
  source: GuestPlacement | null
  dr: GuestPlacement | null
}

export interface GuestRestorePointsState {
  loading: boolean
  data: VMRestorePoints | null
  failed: boolean
}

interface GuestFailoverDialogProps {
  open: boolean
  mode: 'failover' | 'failback'
  target: GuestDialogTarget | null
  /** Live DR state of the guest, from the plan list; null while it replicates. */
  guestState: RecoveryPlanGuestState | null
  /** The execution acting on the guest, polled by the page while it runs. */
  execution: RecoveryExecution | null
  errorMessage?: string | null
  /** Live node and power state of the source VM and of its DR copy. */
  placements?: GuestPlacements | null
  restorePoints: GuestRestorePointsState
  onClose: () => void
  onFailover: (restorePoint?: string) => void
  onStartFailback: () => void
  onCutover: () => void
  onCancelFailback: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

const PROGRESS_COLORS: Record<string, 'error' | 'success'> = { failed: 'error', completed: 'success' }

// Packets travelling from the DR copy back to the source, while the reverse
// sync loops; still under prefers-reduced-motion.
const FLOW_DOTS = [0, 1, 2]

function FlowTrack() {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'relative',
        flex: 1,
        minWidth: 48,
        height: 14,
        '@keyframes reverseSyncFlow': {
          from: { left: '0%', opacity: 0 },
          '15%': { opacity: 1 },
          '85%': { opacity: 1 },
          to: { left: 'calc(100% - 8px)', opacity: 0 },
        },
      }}
    >
      <Box sx={{ position: 'absolute', top: 6, left: 0, right: 6, borderTop: '2px dashed', borderColor: 'divider' }} />
      <Box
        component='i'
        className='ri-arrow-right-s-fill'
        sx={{ position: 'absolute', right: -4, top: -3, fontSize: 18, color: 'primary.main' }}
      />
      {FLOW_DOTS.map(i => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            top: 3,
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            animation: `reverseSyncFlow 1.8s linear ${i * 0.6}s infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none', left: `${30 + i * 20}%` },
          }}
        />
      ))}
    </Box>
  )
}

interface FlowEndProps {
  testId: string
  caption: string
  title: string
  site?: string
  placement: GuestPlacement | null
  busy?: boolean
}

// One side of the reverse sync: the guest glyph with its power dot (ringed by
// a spinner on the side receiving), then the cluster and the node it runs on.
function FlowEnd({ testId, caption, title, site, placement, busy }: FlowEndProps) {
  const theme = useTheme()
  const dotBorder = theme.palette.background.paper

  return (
    <Box
      data-testid={testId}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider', minWidth: 0, flex: '0 1 230px' }}
    >
      <Box sx={{ position: 'relative', width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <GuestGlyph status={placement?.status} dotBorder={dotBorder} />
        {busy && <CircularProgress size={30} thickness={2.5} sx={{ position: 'absolute', inset: 0 }} aria-label={caption} />}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant='caption' sx={{ display: 'block', color: 'text.secondary', fontSize: '0.62rem', textTransform: 'uppercase' }}>{caption}</Typography>
        <Typography variant='body2' noWrap sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{title}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, color: 'text.secondary' }}>
          {site && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }} data-testid={`${testId}-cluster`}>
              <i className='ri-server-line' style={{ fontSize: 12, opacity: 0.8 }} />
              <Typography variant='caption' noWrap sx={{ fontSize: '0.68rem' }}>{site}</Typography>
            </Box>
          )}
          {placement?.node && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }} data-testid={`${testId}-node`}>
              <NodeGlyph status='online' dark={theme.palette.mode === 'dark'} dotBorder={dotBorder} />
              <Typography variant='caption' noWrap sx={{ fontSize: '0.68rem' }}>{placement.node}</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

interface ReverseSyncFlowProps {
  name: string
  drVmId: number
  drSite?: string
  drPlacement: GuestPlacement | null
  sourceVmId: number
  sourceSite?: string
  sourcePlacement: GuestPlacement | null
  lastSyncAt?: string
  lastSyncBytes?: number
  error?: string
}

/**
 * The reverse sync of a failback, drawn as what it is: the DR copy, which
 * runs as production, streams its changes back to the source VM, which
 * receives them (spinner) until the operator triggers the cutover.
 */
function ReverseSyncFlow({ name, drVmId, drSite, drPlacement, sourceVmId, sourceSite, sourcePlacement, lastSyncAt, lastSyncBytes, error }: ReverseSyncFlowProps) {
  const t = useTranslations()

  return (
    <Box data-testid='guest-reverse-sync' sx={{ px: 1.25, py: 1.25, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <FlowEnd
          testId='reverse-sync-from'
          caption={t('siteRecovery.guestDR.flowFrom')}
          title={`${name} · ${drVmId}`}
          site={drSite}
          placement={drPlacement}
        />
        <FlowTrack />
        <FlowEnd
          testId='reverse-sync-to'
          caption={t('siteRecovery.guestDR.flowTo')}
          title={`${name} · ${sourceVmId}`}
          site={sourceSite}
          placement={sourcePlacement}
          busy
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 1.25, flexWrap: 'wrap' }}>
        <Typography variant='caption' sx={{ color: 'text.secondary' }}>
          {t('siteRecovery.guestDR.lastReverseSync')}{' '}
          <Box component='span' sx={{ fontWeight: 600, color: 'text.primary' }}>
            {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : t('siteRecovery.failback.neverSynced')}
          </Box>
        </Typography>
        <Typography variant='caption' sx={{ color: 'text.secondary' }}>
          {t('siteRecovery.guestDR.transferred')}{' '}
          <Box component='span' sx={{ fontWeight: 600, color: 'text.primary' }}>
            {/* The orchestrator omits a zero byte count: a pass that found nothing to send reads 0 B. */}
            {lastSyncAt ? formatBytes(lastSyncBytes ?? 0) : '-'}
          </Box>
        </Typography>
      </Box>
      {error && (
        <Typography variant='caption' sx={{ display: 'block', mt: 0.5, color: 'error.main', fontSize: '0.65rem' }}>{error}</Typography>
      )}
    </Box>
  )
}

/**
 * Failover and failback of ONE guest of a recovery plan (ui#943). The plan
 * dialog walks every guest of the plan; this one walks a single row, with
 * the same two-phase failback (reverse sync, then cutover) and the same
 * step codes, so the operator reads the same words in both places.
 */
export default function GuestFailoverDialog({
  open, mode, target, guestState, execution, errorMessage, placements, restorePoints,
  onClose, onFailover, onStartFailback, onCutover, onCancelFailback,
}: GuestFailoverDialogProps) {
  const t = useTranslations()
  const [confirmText, setConfirmText] = useState('')
  const [restorePoint, setRestorePoint] = useState('')
  const [confirmCutover, setConfirmCutover] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => {
    if (!open) {
      setConfirmText('')
      setRestorePoint('')
      setConfirmCutover(false)
      setConfirmCancel(false)
    }
  }, [open])

  if (!target) return null

  const name = target.vmName
  const result = execution?.vm_results?.find(vm => vm.vm_id === target.vmId) || execution?.vm_results?.[0] || null
  const isRunning = !!execution && execution.status === 'running'
  const isReverseSync = mode === 'failback' && isRunning && execution?.phase === 'reverse_sync'
  const isCutover = mode === 'failback' && isRunning && execution?.phase === 'cutover'
  const cutoverNotReady = isReverseSync && !result?.last_reverse_sync_at
  const failoverTerminal = mode === 'failover' && !!execution && !isRunning
  const failbackTerminal = mode === 'failback' && !!execution && !isRunning
  const canConfirmFailover = confirmText === name
  // The reverse sync only logs its passes; the failover and the cutover list their steps.
  let traceSteps = CUTOVER_STEPS
  if (mode === 'failover') traceSteps = FAILOVER_STEPS
  else if (isReverseSync) traceSteps = []

  const title = mode === 'failover'
    ? t('siteRecovery.guestDR.failoverTitle', { name })
    : t('siteRecovery.guestDR.failbackTitle', { name })
  const icon = mode === 'failover' ? 'ri-shield-star-line' : 'ri-arrow-go-back-line'

  const progressBlock = (label: string) => (
    <Box>
      <Typography variant='subtitle2' sx={{ mb: 1.5 }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 20, textAlign: 'center' }}>
          {result?.status === 'completed' && <i className='ri-check-line' style={{ color: 'var(--mui-palette-success-main)' }} />}
          {result?.status === 'failed' && <i className='ri-close-line' style={{ color: 'var(--mui-palette-error-main)' }} />}
          {(result?.status === 'running' || result?.status === 'pending') && <i className='ri-loader-4-line' style={{ color: 'var(--mui-palette-primary-main)' }} />}
        </Box>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant='body2' sx={{ fontWeight: 500, fontSize: '0.8rem' }}>
              {name}{result?.target_node && ` · ${result.target_node}`}
            </Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary' }}>{result?.progress_percent ?? 0}%</Typography>
          </Box>
          <LinearProgress
            variant={result?.status === 'running' || result?.status === 'pending' ? 'indeterminate' : 'determinate'}
            value={result?.progress_percent ?? 0}
            color={PROGRESS_COLORS[result?.status ?? ''] ?? 'primary'}
            sx={{ height: 3, borderRadius: 1 }}
          />
          {result?.error && (
            <Typography variant='caption' sx={{ color: 'error.main', fontSize: '0.65rem' }}>{result.error}</Typography>
          )}
        </Box>
      </Box>
    </Box>
  )

  return (
    <Dialog open={open} onClose={isRunning && !isReverseSync ? undefined : onClose} maxWidth='sm' fullWidth data-testid='guest-dr-dialog'>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={icon} />
        {title}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {/* Failover: confirm screen */}
          {mode === 'failover' && !execution && (
            <>
              <Alert severity='warning'>{t('siteRecovery.guestDR.failoverDescription', { vmid: target.targetVmId })}</Alert>
              <Typography variant='body2' color='text.secondary'>
                {t('siteRecovery.guestDR.failoverSiblings', { count: target.siblingCount })}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant='body2' fontWeight={500}>{t('siteRecovery.failover.restorePoint')}</Typography>
                {restorePoints.loading ? <CircularProgress size={18} /> : (
                  (restorePoints.data?.restore_points?.length || 0) === 0 ? (
                    <Typography variant='body2' color='text.secondary'>
                      {restorePoints.failed || restorePoints.data?.error
                        ? t('siteRecovery.failover.restorePointsLoadFailed')
                        : t('siteRecovery.failover.restorePointsNone')}
                    </Typography>
                  ) : (
                    <Select
                      size='small'
                      displayEmpty
                      value={restorePoint}
                      onChange={e => setRestorePoint(e.target.value)}
                      sx={{ minWidth: 240, fontSize: '0.8rem' }}
                    >
                      <MenuItem value=''>{t('siteRecovery.failover.restorePointLatest')}</MenuItem>
                      {(restorePoints.data?.restore_points || []).map(rp => (
                        <MenuItem key={rp.snapshot} value={rp.snapshot}>
                          <i className='ri-camera-line' style={{ fontSize: 13, marginRight: 6, opacity: 0.7 }} />
                          {rp.created_iso ? new Date(rp.created_iso).toLocaleString() : rp.snapshot}
                        </MenuItem>
                      ))}
                    </Select>
                  )
                )}
              </Box>
              {!!restorePoint && <Alert severity='info'>{t('siteRecovery.failover.restorePointRebaseWarning')}</Alert>}
              <TextField
                size='small'
                fullWidth
                label={t('siteRecovery.guestDR.typeToConfirm', { name })}
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                autoComplete='off'
              />
            </>
          )}

          {/* Failover: progress and outcome */}
          {mode === 'failover' && isRunning && progressBlock(t('siteRecovery.guestDR.inProgress'))}
          {failoverTerminal && execution?.status === 'completed' && (
            <Alert severity='success'>{t('siteRecovery.guestDR.failoverDone', { name, vmid: result?.target_vmid || target.targetVmId })}</Alert>
          )}
          {failoverTerminal && execution?.status !== 'completed' && (
            <>
              <Alert severity={guestState ? 'error' : 'warning'}>
                {guestState
                  ? t('siteRecovery.guestDR.failoverFailed', { name })
                  : t('siteRecovery.guestDR.failoverUntouched', { name })}
              </Alert>
              {result?.error && <Typography variant='caption' color='error.main'>{result.error}</Typography>}
            </>
          )}

          {/* Failback: start screen */}
          {mode === 'failback' && !execution && (
            <Alert severity='warning'>{t('siteRecovery.guestDR.failbackDescription', { name })}</Alert>
          )}

          {/* Failback: reverse-sync monitor */}
          {isReverseSync && (
            <Box>
              <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('siteRecovery.failback.phase1Title')}</Typography>
              <ReverseSyncFlow
                name={name}
                drVmId={result?.target_vmid || target.targetVmId}
                drSite={target.targetSite}
                drPlacement={placements?.dr ?? (result?.target_node ? { node: result.target_node } : null)}
                sourceVmId={target.vmId}
                sourceSite={target.sourceSite}
                sourcePlacement={placements?.source ?? null}
                lastSyncAt={result?.last_reverse_sync_at}
                lastSyncBytes={result?.last_reverse_sync_bytes}
                error={result?.error}
              />
              {result?.error && result.step === '' && (
                <Alert severity='warning' sx={{ mt: 1.5 }}>{t('siteRecovery.guestDR.cutoverFailed', { name })}</Alert>
              )}
              <Alert severity='info' sx={{ mt: 1.5 }}>{t('siteRecovery.failback.phase1Help')}</Alert>
            </Box>
          )}

          {/* Failback: cutover progress and outcome */}
          {isCutover && progressBlock(t('siteRecovery.guestDR.cutoverInProgress'))}
          {failbackTerminal && execution?.status === 'completed' && (
            <Alert severity='success'>{t('siteRecovery.guestDR.failbackDone', { name })}</Alert>
          )}
          {failbackTerminal && execution?.status === 'cancelled' && (
            <Alert severity='info'>{t('siteRecovery.emergencyDR.guestFailedOver')}</Alert>
          )}
          {failbackTerminal && execution?.status === 'failed' && (
            <Alert severity='error'>{result?.error || t('siteRecovery.guestDR.cutoverFailed', { name })}</Alert>
          )}

          {/* Checks and log of the run, kept once it is over (ui#943). */}
          {execution && (
            <ExecutionTrace
              key={execution.id}
              executionId={execution.id}
              steps={traceSteps}
              currentStep={result?.step}
              status={execution.status}
            />
          )}
        </Stack>
      </DialogContent>
      {errorMessage && <Alert severity='error' sx={{ mx: 3 }}>{errorMessage}</Alert>}
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'failover' && !execution && (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              variant='contained'
              color='error'
              disabled={!canConfirmFailover}
              startIcon={<i className='ri-shield-star-line' />}
              onClick={() => onFailover(restorePoint || undefined)}
            >
              {t('siteRecovery.guestDR.confirmFailover')}
            </Button>
          </>
        )}
        {mode === 'failback' && !execution && (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              variant='contained'
              color='warning'
              disabled={guestState !== 'failed_over'}
              startIcon={<i className='ri-arrow-go-back-line' />}
              onClick={onStartFailback}
            >
              {t('siteRecovery.guestDR.startFailback')}
            </Button>
          </>
        )}
        {isReverseSync && (
          <>
            <Button onClick={onClose}>{t('common.close')}</Button>
            <Button variant='outlined' onClick={() => setConfirmCancel(true)}>{t('siteRecovery.failback.cancelFailback')}</Button>
            <Tooltip title={t('siteRecovery.failback.cutoverNotReady')} disableHoverListener={!cutoverNotReady} arrow>
              <span>
                <Button variant='contained' color='warning' disabled={cutoverNotReady} onClick={() => setConfirmCutover(true)}>
                  {t('siteRecovery.failback.cutover')}
                </Button>
              </span>
            </Tooltip>
          </>
        )}
        {execution && !isRunning && <Button onClick={onClose}>{t('common.close')}</Button>}
      </DialogActions>

      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('siteRecovery.failback.cancelFailback')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('siteRecovery.guestDR.cancelConfirm', { name })}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmCancel(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' color='error' onClick={() => { setConfirmCancel(false); onCancelFailback() }}>
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmCutover} onClose={() => setConfirmCutover(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('siteRecovery.failback.cutover')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('siteRecovery.guestDR.cutoverConfirm', { name })}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmCutover(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' color='warning' onClick={() => { setConfirmCutover(false); onCutover() }}>
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
