'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Collapse,
  FormControlLabel,
  LinearProgress,
  Link,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import type { HaConfig } from './useHaConfig'
import { resolveCompletionTarget } from './haRedirect'

interface DeployStepEvent {
  step: number
  totalSteps: number
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  detail?: string
  error?: string
  timestamp: string
}

interface ValidationResult {
  ip: string
  ssh: boolean
  docker: boolean
  dockerVersion?: string
  dockerCompose: boolean
  pgCompatible: boolean
  ping: Record<string, boolean>
}

interface ValidationResponse {
  results: ValidationResult[]
  global: {
    vipAvailable: boolean
    externalUrl?: string
  }
}

interface NodeInput {
  name: string
  ip: string
  password: string
  vrrpPriority: number
}

const WIZARD_STEPS = ['Prerequisites', 'Nodes', 'Network', 'Validation', 'Deployment']

const PREREQUISITES = [
  '3 VMs with Debian 12+ or Ubuntu 22.04+',
  'Docker Engine 24+ and Docker Compose v2 installed on all 3 VMs',
  '3 distinct Proxmox hosts (for anti-affinity)',
  'A free IP address for the VIP on the same subnet',
  'Root SSH access to all 3 VMs',
]

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

export default function HaDeployWizard({
  config,
  onDeployed,
}: {
  config: HaConfig | undefined
  onDeployed: () => void
}) {
  const resumeStep = config?.deploymentState === 'deploying' || config?.deploymentState === 'failed'
    ? 4
    : 0
  const [activeStep, setActiveStep] = useState(resumeStep)

  const [prereqChecked, setPrereqChecked] = useState(false)
  const [snapshotConfirmed, setSnapshotConfirmed] = useState(false)
  const [nodes, setNodes] = useState<NodeInput[]>(() => {
    if (config?.nodes?.length === 3) {
      return config.nodes.map(n => ({ name: n.name, ip: n.ip, password: '', vrrpPriority: n.vrrpPriority }))
    }
    return [
      { name: 'proxcenter-1', ip: '', password: '', vrrpPriority: 150 },
      { name: 'proxcenter-2', ip: '', password: '', vrrpPriority: 100 },
      { name: 'proxcenter-3', ip: '', password: '', vrrpPriority: 50 },
    ]
  })
  const [vip, setVip] = useState(config?.vip || '')
  const [vipInterface, setVipInterface] = useState(config?.vipInterface || 'eth0')

  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null)
  const [validationError, setValidationError] = useState('')

  const [deploying, setDeploying] = useState(config?.deploymentState === 'deploying')
  const [deploySteps, setDeploySteps] = useState<DeployStepEvent[]>([])
  const [deployError, setDeployError] = useState('')
  const [deployDone, setDeployDone] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const [sseReconnecting, setSseReconnecting] = useState(false)
  const [conversionPhase, setConversionPhase] = useState(false)
  const [vipPolling, setVipPolling] = useState(false)
  const [conversionElapsed, setConversionElapsed] = useState(0)

  const eventSourceRef = useRef<EventSource | null>(null)
  const deployingRef = useRef(false)
  const deployDoneRef = useRef(false)
  const vipPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    deployingRef.current = deploying
  }, [deploying])

  useEffect(() => {
    deployDoneRef.current = deployDone
  }, [deployDone])

  const updateNode = useCallback((index: number, field: keyof NodeInput, value: string) => {
    setNodes(prev => prev.map((n, i) => i === index ? { ...n, [field]: value } : n))
    setValidationResult(null)
  }, [])

  // Any change to network inputs invalidates a previous validation run
  useEffect(() => {
    setValidationResult(null)
  }, [vip, vipInterface])

  const canProceedNodes = nodes.every(n => IPV4_REGEX.test(n.ip) && n.password.length > 0)

  const canProceedNetwork = IPV4_REGEX.test(vip) && vipInterface.length > 0

  const handleValidate = useCallback(async () => {
    setValidating(true)
    setValidationError('')
    setValidationResult(null)
    try {
      const res = await fetch('/api/v1/ha/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: nodes.map(n => ({ ip: n.ip, password: n.password })),
          vip,
          vipInterface,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setValidationError(err.error || `Validation failed (${res.status})`)
        return
      }
      const data: ValidationResponse = await res.json()
      setValidationResult(data)
    } catch (e: any) {
      setValidationError(e.message || 'Validation request failed')
    } finally {
      setValidating(false)
    }
  }, [nodes, vip, vipInterface])

  const validationPassed = validationResult
    ? validationResult.results.every(r => r.ssh && r.docker && r.dockerCompose
        && Object.values(r.ping).every(Boolean))
      && validationResult.global.vipAvailable
    : false

  // Post-deploy destination (decision 3): the preserved external URL comes
  // from the validation summary on a fresh run, or from the saved config
  // when resuming after a reload.
  const completion = resolveCompletionTarget(
    validationResult?.global.externalUrl || config?.externalUrl,
    vip,
  )

  const stopConversionTimers = useCallback(() => {
    if (vipPollRef.current) {
      clearInterval(vipPollRef.current)
      vipPollRef.current = null
    }
    if (elapsedRef.current) {
      clearInterval(elapsedRef.current)
      elapsedRef.current = null
    }
    setVipPolling(false)
  }, [])

  const enterConversionPhase = useCallback(() => {
    setConversionPhase(true)
    setSseReconnecting(true)
    setConversionElapsed(0)
    if (!elapsedRef.current) {
      elapsedRef.current = setInterval(() => setConversionElapsed(e => e + 1), 1000)
    }
    if (!vipPollRef.current) {
      setVipPolling(true)
      vipPollRef.current = setInterval(async () => {
        try {
          const r = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
          if (r.ok) {
            stopConversionTimers()
            setConversionPhase(false)
            setSseReconnecting(false)
            setDeployDone(true)
            setDeploying(false)
            deployDoneRef.current = true
            deployingRef.current = false
            setDeploySteps(prev => {
              const maxStep = prev.reduce((m, s) => Math.max(m, s.step), 0)
              const totalSteps = prev[0]?.totalSteps || 18
              if (maxStep < totalSteps) {
                return [...prev, {
                  step: totalSteps,
                  totalSteps,
                  label: 'HA cluster online',
                  status: 'done' as const,
                  timestamp: new Date().toISOString(),
                }]
              }
              return prev
            })
            setTimeout(() => {
              window.location.href = completion.url
            }, 3000)
          }
        } catch {}
      }, 6000)
    }
  }, [completion.url, stopConversionTimers])

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    const es = new EventSource('/api/v1/ha/deploy/status')
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data: DeployStepEvent = JSON.parse(event.data)
        setDeploySteps(prev => {
          const idx = prev.findIndex(s => s.step === data.step)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = data
            return next
          }
          return [...prev, data]
        })
        if (data.status === 'failed') {
          setDeployError(data.error || `Step ${data.step} failed: ${data.label}`)
          setDeploying(false)
          deployingRef.current = false
          eventSourceRef.current?.close()
          stopConversionTimers()
        }
        if (data.status === 'done' && data.step === data.totalSteps) {
          setDeployDone(true)
          setDeploying(false)
          deployDoneRef.current = true
          deployingRef.current = false
          eventSourceRef.current?.close()
          stopConversionTimers()
        }
        if (data.step >= 13) {
          enterConversionPhase()
        }
      } catch {}
    }

    es.onerror = () => {
      es.close()
      if (!deployDoneRef.current && deployingRef.current) {
        enterConversionPhase()
        setTimeout(connectSSE, 8000)
      }
    }
  }, [stopConversionTimers, enterConversionPhase])

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
      if (vipPollRef.current) clearInterval(vipPollRef.current)
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }, [])

  // Resume an in-progress deployment after a page reload
  useEffect(() => {
    if (config?.deploymentState === 'deploying' && !deployDoneRef.current) {
      deployingRef.current = true
      setDeploying(true)
      connectSSE()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

  const handleDeploy = useCallback(async () => {
    setDeploying(true)
    deployingRef.current = true
    setDeployError('')
    setDeploySteps([])

    try {
      const configRes = await fetch('/api/v1/ha/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: nodes.map(n => ({ name: n.name, ip: n.ip, vrrpPriority: n.vrrpPriority })),
          vip,
          vipInterface,
          sshPasswords: Object.fromEntries(nodes.map(n => [n.ip, n.password])),
        }),
      })

      if (!configRes.ok) {
        const err = await configRes.json().catch(() => ({}))
        setDeployError(err.error || 'Failed to save configuration')
        setDeploying(false)
        return
      }

      const deployRes = await fetch('/api/v1/ha/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sshPasswords: Object.fromEntries(nodes.map(n => [n.ip, n.password])),
        }),
      })
      if (!deployRes.ok) {
        const err = await deployRes.json().catch(() => ({}))
        setDeployError(err.error || 'Failed to start deployment')
        setDeploying(false)
        return
      }

      connectSSE()
    } catch (e: any) {
      setDeployError(e.message || 'Deployment failed')
      setDeploying(false)
    }
  }, [nodes, vip, vipInterface, connectSSE])

  const handleRetryDeploy = useCallback(async () => {
    setDeploying(true)
    deployingRef.current = true
    setDeployError('')

    try {
      const deployRes = await fetch('/api/v1/ha/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sshPasswords: Object.fromEntries(nodes.map(n => [n.ip, n.password])),
        }),
      })
      if (!deployRes.ok) {
        const err = await deployRes.json().catch(() => ({}))
        setDeployError(err.error || 'Failed to resume deployment')
        setDeploying(false)
        return
      }
      connectSSE()
    } catch (e: any) {
      setDeployError(e.message || 'Deployment failed')
      setDeploying(false)
    }
  }, [nodes, connectSSE])

  const currentDeployStep = deploySteps.length > 0
    ? deploySteps[deploySteps.length - 1]
    : null
  const totalSteps = currentDeployStep?.totalSteps || 19
  const completedSteps = deploySteps.filter(s => s.status === 'done').length

  const renderPrerequisites = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Prerequisites</Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Verify the following prerequisites before proceeding:
      </Typography>
      {PREREQUISITES.map((prereq, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}>
          <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: 'action.selected', display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 1, mt: 0.25, flexShrink: 0 }}>
            <Typography variant="caption">{i + 1}</Typography>
          </Box>
          <Typography variant="body2">{prereq}</Typography>
        </Box>
      ))}
      <FormControlLabel
        sx={{ mt: 2 }}
        control={<Checkbox checked={prereqChecked} onChange={(e) => setPrereqChecked(e.target.checked)} />}
        label="I confirm all prerequisites are met"
      />
    </Box>
  )

  const renderNodes = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Cluster Nodes</Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Enter the IP address and root SSH password for each node. Node 1 is the current node.
      </Typography>
      {nodes.map((node, i) => (
        <Card key={i} variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {node.name} {i === 0 && <Chip label="Current node" size="small" color="primary" sx={{ ml: 1 }} />}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="IP Address"
                value={node.ip}
                onChange={(e) => updateNode(i, 'ip', e.target.value)}
                error={node.ip.length > 0 && !IPV4_REGEX.test(node.ip)}
                helperText={node.ip.length > 0 && !IPV4_REGEX.test(node.ip) ? 'Invalid IPv4 address' : ''}
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label="Root SSH Password"
                type="password"
                value={node.password}
                onChange={(e) => updateNode(i, 'password', e.target.value)}
                size="small"
                sx={{ flex: 1 }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              VRRP Priority: {node.vrrpPriority}
            </Typography>
          </CardContent>
        </Card>
      ))}
      <Alert severity="info" sx={{ mt: 1 }}>
        SSH passwords are used once for key injection and are never stored.
      </Alert>
    </Box>
  )

  const renderNetwork = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Network Configuration</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="Virtual IP (VIP)"
          value={vip}
          onChange={(e) => setVip(e.target.value)}
          error={vip.length > 0 && !IPV4_REGEX.test(vip)}
          helperText="A free IP on the same subnet as the nodes"
          size="small"
          fullWidth
        />
        <TextField
          label="Network Interface"
          value={vipInterface}
          onChange={(e) => setVipInterface(e.target.value)}
          helperText="Interface for VIP assignment (e.g., eth0, ens18)"
          size="small"
          fullWidth
        />
      </Box>
      <Alert severity="info" sx={{ mt: 2 }}>
        After deployment, the application is reachable at http://VIP:3000.
        An existing external URL (reverse proxy, OIDC) is preserved during
        conversion; you will only repoint your reverse proxy at the VIP.
      </Alert>
    </Box>
  )

  const renderValidation = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Validation</Typography>
      {!validationResult && !validating && !validationError && (
        <Box>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Run preflight checks on all nodes before deployment.
          </Typography>
          <Button variant="contained" onClick={handleValidate}>
            Run Validation
          </Button>
        </Box>
      )}
      {validating && (
        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>Validating nodes...</Typography>
          <LinearProgress />
        </Box>
      )}
      {validationError && (
        <Box>
          <Alert severity="error" sx={{ mb: 2 }}>{validationError}</Alert>
          <Button variant="outlined" onClick={handleValidate}>Retry</Button>
        </Box>
      )}
      {validationResult && (() => {
        const results = validationResult.results
        const checkIcon = (ok: boolean | undefined, warn?: boolean) => (
          <i
            className={ok ? 'ri-check-line' : 'ri-close-line'}
            style={{ color: ok ? 'var(--mui-palette-success-main)' : warn ? 'var(--mui-palette-warning-main)' : 'var(--mui-palette-error-main)', fontSize: 18 }}
          />
        )
        const nodeChecks: { label: string; values: (boolean | undefined)[] }[] = [
          { label: 'SSH', values: results.map(r => r.ssh) },
          { label: 'Docker', values: results.map(r => r.docker) },
          { label: 'Compose', values: results.map(r => r.dockerCompose) },
          { label: 'PG compatible', values: results.map(r => r.pgCompatible) },
        ]
        const allPingTargets = [...new Set(results.flatMap(r => Object.keys(r.ping)))]
        for (const target of allPingTargets) {
          nodeChecks.push({
            label: `Ping ${target}`,
            values: results.map(r => r.ping[target] ?? undefined),
          })
        }
        return (
          <Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, borderBottom: 2, borderColor: 'divider' }}>Check</TableCell>
                    {results.map((r, i) => (
                      <TableCell key={r.ip} align="center" sx={{ fontWeight: 600, borderBottom: 2, borderColor: 'divider' }}>
                        {nodes[i]?.name || r.ip}
                        <Typography variant="caption" display="block" color="text.secondary">{r.ip}</Typography>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {nodeChecks.map((check) => (
                    <TableRow key={check.label}>
                      <TableCell sx={{ py: 0.75 }}>
                        {check.label}
                        {check.label === 'Docker' && results.some(r => r.dockerVersion) && (
                          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                            ({results.find(r => r.dockerVersion)?.dockerVersion})
                          </Typography>
                        )}
                      </TableCell>
                      {check.values.map((ok, i) => (
                        <TableCell key={i} align="center" sx={{ py: 0.75 }}>
                          {ok === undefined ? <Typography variant="caption" color="text.secondary">n/a</Typography> : checkIcon(ok, check.label === 'PG compatible')}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell sx={{ py: 0.75, fontWeight: 600, borderTop: 2, borderColor: 'divider' }}>VIP available ({vip})</TableCell>
                    {results.map((_, i) => (
                      <TableCell key={i} align="center" sx={{ py: 0.75, borderTop: 2, borderColor: 'divider' }}>
                        {i === 0 ? checkIcon(validationResult.global.vipAvailable) : null}
                      </TableCell>
                    ))}
                  </TableRow>
                  {validationResult.global.externalUrl && (
                    <TableRow>
                      <TableCell colSpan={results.length + 1} sx={{ py: 0.75 }}>
                        <Typography variant="caption">
                          External URL kept: {validationResult.global.externalUrl}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            {validationPassed && (
              <Alert severity="success" sx={{ mt: 2 }}>All checks passed.</Alert>
            )}
            {!validationPassed && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="error" sx={{ mb: 1 }}>Some checks failed. Fix the issues and retry.</Alert>
                <Button variant="outlined" onClick={handleValidate}>Retry Validation</Button>
              </Box>
            )}
          </Box>
        )
      })()}
    </Box>
  )

  const renderDeployment = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Deployment</Typography>
      {!deploying && !deployDone && !deployError && config?.deploymentState === 'failed' && (
        <Box>
          <Alert severity="error" sx={{ mb: 2 }}>Previous deployment failed. You can retry from where it left off.</Alert>
          <Button variant="contained" color="warning" onClick={handleRetryDeploy}>Retry Deployment</Button>
        </Box>
      )}
      {!deploying && !deployDone && !deployError && config?.deploymentState !== 'failed' && (
        <Box>
          <Typography variant="body2" sx={{ mb: 2 }}>
            This will deploy the HA cluster across all 3 nodes. The process takes several minutes
            and includes a brief service interruption during database conversion.
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            The page may briefly disconnect during application cutover and will auto-reconnect.
          </Alert>
          <Alert severity="info" sx={{ mb: 2 }}>
            Before the old stack is stopped, a full database backup is written to
            {' '}/opt/proxcenter/backup-pre-patroni.sql on this server. If the conversion fails
            before the new cluster is viable, the previous stack is restarted automatically
            and the failed step is shown here.
          </Alert>
          <FormControlLabel
            sx={{ display: 'block', mb: 2 }}
            control={<Checkbox checked={snapshotConfirmed} onChange={(e) => setSnapshotConfirmed(e.target.checked)} />}
            label={(
              <span>
                I have taken a VM snapshot of this server
                {' '}(<Link href="https://github.com/adminsyspro/proxcenter-ui/blob/main/docs/ha/conversion-runbook.md" target="_blank" rel="noopener noreferrer">conversion runbook</Link>)
              </span>
            )}
          />
          <Button variant="contained" color="primary" onClick={handleDeploy} disabled={!snapshotConfirmed}>
            Deploy HA Cluster
          </Button>
        </Box>
      )}
      {(deploying || deployDone || deployError) && (
        <Box>
          <Box sx={{ mb: 2 }}>
            <LinearProgress
              variant="determinate"
              value={(completedSteps / totalSteps) * 100}
              sx={{ height: 8, borderRadius: 4 }}
            />
            <Typography variant="caption" sx={{ mt: 0.5, display: 'block' }}>
              Step {completedSteps} of {totalSteps}
            </Typography>
          </Box>
          {currentDeployStep && !conversionPhase && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2">
                {currentDeployStep.status === 'running' && '...'} {currentDeployStep.label}
              </Typography>
              {currentDeployStep.detail && (
                <Typography variant="caption" color="text.secondary">
                  {currentDeployStep.detail}
                </Typography>
              )}
            </Box>
          )}
          {conversionPhase && deploying && !deployDone && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                Autonomous conversion in progress ({Math.floor(conversionElapsed / 60)}:{String(conversionElapsed % 60).padStart(2, '0')})
              </Typography>
              <Typography variant="caption" component="div" sx={{ mb: 1 }}>
                {conversionElapsed < 15
                  ? 'Stopping the standalone stack and backing up database...'
                  : conversionElapsed < 45
                    ? 'Bootstrapping Patroni leader and replicating to nodes 2 and 3...'
                    : conversionElapsed < 90
                      ? 'Starting application services on all 3 nodes...'
                      : 'Still working, this can take a few minutes. Waiting for services to come back online...'
                }
              </Typography>
              <LinearProgress sx={{ mt: 0.5 }} />
            </Alert>
          )}
          <Button
            variant="text"
            size="small"
            onClick={() => setLogExpanded(!logExpanded)}
            sx={{ mb: 1 }}
          >
            {logExpanded ? 'Hide log' : 'Show log'}
          </Button>
          <Collapse in={logExpanded}>
            <Box sx={{ maxHeight: 300, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, p: 1 }}>
              {deploySteps.map((step) => (
                <Box key={step.step} sx={{ mb: 0.5 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>
                    [{step.status === 'done' ? 'OK' : step.status === 'failed' ? 'FAIL' : step.status === 'running' ? '...' : '--'}]
                    {' '}Step {step.step}: {step.label}
                    {step.detail ? ` - ${step.detail}` : ''}
                    {step.error ? ` - ERROR: ${step.error}` : ''}
                  </Typography>
                </Box>
              ))}
              {conversionPhase && deploying && (
                <Box sx={{ mb: 0.5 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'inherit', color: 'info.main' }}>
                    [...] Autonomous conversion running, waiting for local node to come back online...
                  </Typography>
                </Box>
              )}
            </Box>
          </Collapse>
          {deployError && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="error" sx={{ mb: 1 }}>{deployError}</Alert>
              <Button variant="outlined" onClick={handleRetryDeploy}>Retry (resume from failed step)</Button>
            </Box>
          )}
          {deployDone && (
            <Box sx={{ mt: 2 }}>
              {completion.external ? (
                <>
                  <Alert severity="success" sx={{ mb: 2 }}>
                    HA cluster deployed successfully. Redirecting to {completion.url}...
                  </Alert>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Your external URL was kept. Repoint your reverse proxy at the VIP ({vip});
                    no identity provider changes are needed.
                  </Alert>
                </>
              ) : (
                <>
                  <Alert severity="success" sx={{ mb: 2 }}>
                    HA cluster deployed successfully. Redirecting to VIP ({vip})...
                  </Alert>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    NEXTAUTH_URL has been set to http://{vip}:3000.
                    Update your OIDC/SSO callback URLs at your identity provider if applicable.
                  </Alert>
                </>
              )}
              <Button variant="contained" onClick={onDeployed}>View Dashboard</Button>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )

  const stepContent = [renderPrerequisites, renderNodes, renderNetwork, renderValidation, renderDeployment]

  const canNext = () => {
    switch (activeStep) {
      case 0: return prereqChecked
      case 1: return canProceedNodes
      case 2: return canProceedNetwork
      case 3: return validationPassed
      default: return false
    }
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 3 }}>HA Cluster Deployment</Typography>
      <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
        {WIZARD_STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <Card variant="outlined">
        <CardContent>
          {stepContent[activeStep]()}
          {activeStep < 4 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
              <Button
                disabled={activeStep === 0}
                onClick={() => setActiveStep(s => s - 1)}
              >
                Back
              </Button>
              <Button
                variant="contained"
                disabled={!canNext()}
                onClick={() => setActiveStep(s => s + 1)}
              >
                Next
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
