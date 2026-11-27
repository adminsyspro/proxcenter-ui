'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Stack,
  Typography
} from '@mui/material'

import { integrationState, pollClusterHealthUntilResolved } from '@/lib/k8s/clusterHealthStatus'
import { deriveProvisionSteps, type ProvisionStepState } from '@/lib/k8s/provisionSteps'

interface ProvisionProgressProps {
  runId: string
  clusterName: string
  connectionId: string
  onDone?: (clusterId: string) => void
  onClose?: () => void
}

interface RunStatus {
  id: string
  status: string
  phase: string
  progress: number
  error?: string
}

interface ProvisionRunNode {
  name: string
  role: string
  vmid: number
  ip: string
}

interface RunOutputs {
  kubeconfig: string
  talosconfig?: string
  nodes: ProvisionRunNode[]
}

interface ProvisionLogLine {
  level: string
  message: string
  createdAt: string
}

const TERMINAL_STATUSES = ['completed', 'failed']

/** Maps status+phase to a translation key; server-side phases are init, apply and (post-apply) bootstrap. */
function phaseKeyFor(status: string, phase: string): string {
  if (status === 'completed') return 'ready'
  if (status === 'failed') return 'failed'
  if (status === 'running' && phase === 'apply') return 'applying'
  // Post-apply: VMs exist, the cluster is booting and its kubeconfig is being
  // fetched (can take minutes); a dedicated label + the streamed heartbeat
  // lines keep the wizard from looking frozen at "applying".
  if (status === 'running' && phase === 'bootstrap') return 'bootstrapping'
  if (status === 'running') return 'initializing'
  return 'queued'
}

function logColor(level: string): string {
  switch ((level || '').toLowerCase()) {
    case 'error':
      return '#f85149'
    case 'warn':
    case 'warning':
      return '#d29922'
    default:
      return '#c9d1d9'
  }
}

/** One marker in the deployment checklist. Theme-aware so it reads on light and dark. */
function StepMarker({ state }: { state: ProvisionStepState }) {
  if (state === 'active') return <CircularProgress size={15} thickness={5} />
  const spec: Record<Exclude<ProvisionStepState, 'active'>, { cls: string; color: string }> = {
    done: { cls: 'ri-checkbox-circle-fill', color: 'success.main' },
    failed: { cls: 'ri-close-circle-fill', color: 'error.main' },
    pending: { cls: 'ri-circle-line', color: 'text.disabled' },
  }
  const { cls, color } = spec[state]
  return <Box component="i" className={cls} sx={{ fontSize: 16, color, lineHeight: 1 }} />
}

export default function ProvisionProgress({ runId, clusterName, connectionId, onDone, onClose }: ProvisionProgressProps) {
  const t = useTranslations('kubernetes.provision.progress')
  const tHealth = useTranslations('kubernetes.health')
  const router = useRouter()

  const [run, setRun] = useState<RunStatus | null>(null)
  const [outputs, setOutputs] = useState<RunOutputs | undefined>(undefined)
  const [logs, setLogs] = useState<ProvisionLogLine[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const [registering, setRegistering] = useState(false)
  const [clusterId, setClusterId] = useState<string | null>(null)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [integrating, setIntegrating] = useState(false)

  const registerStartedRef = useRef(false)
  const integrationStartedRef = useRef(false)
  const mountedRef = useRef(true)
  const controllerRef = useRef<AbortController | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Reset state + the once-only guard whenever runId changes without a remount.
  // Defense in depth: the wizard also mounts us with key={runId}, but a stale
  // registerStartedRef would otherwise silently block registering a new cluster.
  useEffect(() => {
    setRun(null)
    setOutputs(undefined)
    setLogs([])
    setRegistering(false)
    setClusterId(null)
    setRegisterError(null)
    setIntegrating(false)
    registerStartedRef.current = false
    integrationStartedRef.current = false
  }, [runId])

  // Poll run status + logs together every 2s (5s after a fetch error). Stops once
  // the run reaches a terminal status (completed/failed), mirroring useTaskDetail's
  // backoff and DeploymentProgress's raw poll loop.
  useEffect(() => {
    if (!runId) return undefined

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const scheduleNext = (delayMs: number) => {
      if (disposed) return
      timer = setTimeout(tick, delayMs)
    }

    const tick = async () => {
      const controller = new AbortController()
      controllerRef.current = controller
      try {
        const [statusRes, logsRes] = await Promise.all([
          fetch(`/api/v1/k8s/clusters/provision/${runId}`, { signal: controller.signal }),
          fetch(`/api/v1/k8s/clusters/provision/${runId}/logs?limit=500`, { signal: controller.signal })
        ])
        if (disposed) return
        if (!statusRes.ok) throw new Error('status fetch failed')

        const statusBody = await statusRes.json()
        if (disposed) return
        setRun(statusBody.run)
        setOutputs(statusBody.outputs)

        if (logsRes.ok) {
          const logsBody = await logsRes.json().catch(() => null)
          if (!disposed && logsBody && Array.isArray(logsBody.logs)) {
            setLogs(logsBody.logs)
          }
        }

        if (TERMINAL_STATUSES.includes(statusBody.run?.status)) {
          return
        }
        scheduleNext(2000)
      } catch {
        if (!disposed) scheduleNext(5000)
      }
    }

    tick()

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [runId])

  // Register the cluster exactly once, the first time we observe `completed`.
  useEffect(() => {
    if (run?.status !== 'completed' || registerStartedRef.current) return
    registerStartedRef.current = true
    setRegistering(true)
    setRegisterError(null)

    const attemptRegister = async (attempt: number) => {
      try {
        const res = await fetch(`/api/v1/k8s/clusters/provision/${runId}/register`, {
          method: 'POST',
          // The route reads the name and the connection from the run itself.
        })
        const body = await res.json().catch(() => ({}))
        if (!mountedRef.current) return

        if (res.ok) {
          setRegistering(false)
          setClusterId(body.clusterId)
          onDone?.(body.clusterId)
          return
        }

        // Raced: our poll saw `completed` but the register route's own read of
        // the run is not there yet. Retry once after a short delay.
        if (res.status === 409 && body?.error === 'cluster_name_taken') {
          setRegistering(false)
          setRegisterError(t('nameTaken'))
          return
        }
        if (res.status === 409 && attempt === 0) {
          setTimeout(() => attemptRegister(1), 2000)
          return
        }

        setRegistering(false)
        setRegisterError(t('registerFailed'))
      } catch {
        if (mountedRef.current) {
          setRegistering(false)
          setRegisterError(t('registerFailed'))
        }
      }
    }

    attemptRegister(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, runId, clusterName, connectionId])

  // Once the cluster is registered, poll its health in the background until it
  // resolves (tolerating the RKE2 x509 cert-rotation window right after boot).
  // Each iteration hits ?refresh=1, which persists the health server-side, so
  // the dashboard/tree turn green on their own. Never blocks onDone/navigation.
  useEffect(() => {
    if (!clusterId || integrationStartedRef.current) return
    integrationStartedRef.current = true
    setIntegrating(true)
    // Every VM the run deployed: the cluster is only integrated once each of
    // them has joined and is ready, not when the first control plane answers.
    const expectedNodes = outputs?.nodes?.length ?? 0

    const fetchState = async (id: string): Promise<string | null> => {
      const res = await fetch(`/api/v1/k8s/clusters/${id}?refresh=1`, { cache: 'no-store' })
      if (!res.ok) return null
      const body = await res.json()
      return integrationState(body?.health ?? null, body?.cluster?.healthState ?? null, expectedNodes)
    }

    // pollClusterHealthUntilResolved never throws; finally covers both outcomes.
    // Workers join after the run ends: up to ten minutes for all of them.
    pollClusterHealthUntilResolved(clusterId, { fetchState, timeoutMs: 600_000 }).finally(() => {
      if (mountedRef.current) setIntegrating(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterId])

  // Surface the retained logs by default when a run fails (still toggleable).
  useEffect(() => {
    if (run?.status === 'failed') setShowLogs(true)
  }, [run?.status])

  // Auto-scroll logs to bottom, unless the user scrolled up to read history.
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs.length, autoScroll])

  const handleScroll = () => {
    if (!logsContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100)
  }

  const handleDownloadKubeconfig = () => {
    if (!outputs?.kubeconfig) return
    const blob = new Blob([outputs.kubeconfig], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${clusterName}.kubeconfig`
    a.click()
    URL.revokeObjectURL(url)
  }

  const status = run?.status ?? 'pending'
  const phase = run?.phase ?? 'init'
  const progressValue = Math.min(100, Math.max(0, status === 'completed' ? 100 : run?.progress ?? 0))
  const isTerminal = TERMINAL_STATUSES.includes(status)
  const steps = deriveProvisionSteps({
    status,
    phase,
    registering,
    registered: !!clusterId,
    registerError: !!registerError,
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, py: 1 }}>
      {/* The Kubernetes logo spins as the primary "working" indicator; it stops
          and tints green when the cluster is ready, dims on failure. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}>
        <Box
          component="img"
          src="/images/kubernetes-logo.svg"
          alt=""
          sx={{
            width: 52,
            height: 52,
            display: 'block',
            '@keyframes k8sSpin': { to: { transform: 'rotate(360deg)' } },
            animation: isTerminal ? 'none' : 'k8sSpin 2.4s linear infinite',
            opacity: status === 'failed' ? 0.4 : 1,
            filter: status === 'completed' ? 'drop-shadow(0 0 6px rgba(63,185,80,0.55))' : 'none',
            transition: 'opacity .3s, filter .3s',
          }}
        />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t(`phase.${phaseKeyFor(status, phase)}`)}
        </Typography>
        {!isTerminal && (
          <Typography variant="caption" color="text.secondary">
            {Math.round(progressValue)}%
          </Typography>
        )}
      </Box>

      {/* Discrete step checklist, alongside the raw logs below. */}
      <Stack spacing={0.75} sx={{ px: 0.5 }}>
        {steps.map(s => (
          <Stack key={s.key} direction="row" spacing={1} alignItems="center">
            <Box sx={{ width: 18, display: 'flex', justifyContent: 'center' }}>
              <StepMarker state={s.state} />
            </Box>
            <Typography
              variant="body2"
              sx={{ color: s.state === 'pending' ? 'text.disabled' : 'text.primary', fontWeight: s.state === 'active' ? 600 : 400 }}
            >
              {t(`steps.${s.key}`)}
            </Typography>
          </Stack>
        ))}
      </Stack>

      {status === 'failed' && (
        <Alert severity="error">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('failedTitle')}
          </Typography>
          {run?.error && <Typography variant="body2">{run.error}</Typography>}
        </Alert>
      )}

      {status === 'completed' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {registering && (
            <Alert severity="info" icon={<CircularProgress size={16} />}>
              {t('registering')}
            </Alert>
          )}
          {registerError && <Alert severity="warning">{registerError}</Alert>}
          {clusterId && <Alert severity="success">{t('registered')}</Alert>}
          {integrating && (
            <Alert severity="info" icon={<CircularProgress size={16} />}>
              {tHealth('integrating')}
            </Alert>
          )}

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              startIcon={<i className="ri-download-line" style={{ fontSize: 16 }} />}
              onClick={handleDownloadKubeconfig}
              disabled={!outputs?.kubeconfig}
            >
              {t('downloadKubeconfig')}
            </Button>
            {clusterId && (
              <Button
                variant="contained"
                startIcon={<i className="ri-external-link-line" style={{ fontSize: 16 }} />}
                onClick={() => {
                  onClose?.()
                  router.push(`/infrastructure/inventory?selectType=kubernetes-cluster&selectId=${clusterId}`)
                }}
              >
                {t('openCluster')}
              </Button>
            )}
          </Stack>
        </Box>
      )}

      <Box>
        <Box
          onClick={() => setShowLogs(v => !v)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            cursor: 'pointer',
            userSelect: 'none',
            '&:hover': { opacity: 0.8 }
          }}
        >
          <i
            className={showLogs ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
            style={{ fontSize: 16, opacity: 0.6 }}
          />
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {showLogs ? t('hideLogs') : t('showLogs')}
          </Typography>
        </Box>

        <Collapse in={showLogs}>
          <Box
            ref={logsContainerRef}
            onScroll={handleScroll}
            sx={{
              maxHeight: 260,
              overflow: 'auto',
              bgcolor: '#0d1117',
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 1.6,
              mt: 1
            }}
          >
            {logs.length > 0 ? (
              <Box sx={{ p: 1 }}>
                {logs.map((log, idx) => (
                  <Box
                    key={`${log.createdAt}-${idx}`}
                    sx={{ display: 'flex', py: 0.125, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}
                  >
                    <Typography
                      component="span"
                      sx={{
                        color: 'grey.600',
                        minWidth: 64,
                        textAlign: 'right',
                        pr: 1,
                        userSelect: 'none',
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        flexShrink: 0
                      }}
                    >
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </Typography>
                    <Typography
                      component="span"
                      sx={{
                        color: logColor(log.level),
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        wordBreak: 'break-all'
                      }}
                    >
                      {log.message}
                    </Typography>
                  </Box>
                ))}
                <div ref={logsEndRef} />
              </Box>
            ) : (
              <Box sx={{ p: 2, textAlign: 'center', color: 'grey.500', fontSize: 11 }}>{t('waitingForLogs')}</Box>
            )}
          </Box>
        </Collapse>
      </Box>
    </Box>
  )
}
