'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'

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
  FormLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  Link,
  Radio,
  RadioGroup,
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
import { useTranslations } from 'next-intl'

import type { HaConfig, HaImageSource, HaImageSourceMode } from './useHaConfig'
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

type CheckStatus = 'pass' | 'fail' | 'warn' | 'unverifiable' | 'info'

// Structured pre-flight check from the orchestrator. Detail is an English
// remediation message rendered as-is, like other backend errors.
interface CheckResult {
  name: string
  status: CheckStatus | string
  detail?: string
}

interface ValidationResult {
  ip: string
  ssh: boolean
  docker: boolean
  dockerVersion?: string
  dockerCompose: boolean
  pgCompatible: boolean
  ping: Record<string, boolean>
  // Optional: older orchestrators do not send structured checks.
  checks?: CheckResult[]
}

interface ValidationResponse {
  results: ValidationResult[]
  global: {
    vipAvailable: boolean
    externalUrl?: string
    checks?: CheckResult[]
  }
}

interface NodeInput {
  name: string
  ip: string
  password: string
  vrrpPriority: number
}

const KNOWN_CHECK_NAMES = new Set(['registry', 'tcpMatrix', 'listeners', 'vipInterface', 'existingStack', 'postgresVolume'])

// vipAddress duplicates the legacy vipAvailable row, which is already shown.
const SKIPPED_GLOBAL_CHECKS = new Set(['vipAddress'])

const hasFailedCheck = (checks: CheckResult[] | undefined) => (checks ?? []).some(c => c.status === 'fail')

const WIZARD_STEP_KEYS = ['stepPrerequisites', 'stepNodes', 'stepNetwork', 'stepValidation', 'stepDeployment'] as const

const PREREQ_KEYS = ['prereq1', 'prereq2', 'prereq3', 'prereq4', 'prereq5'] as const

const RUNBOOK_URL = 'https://docs.proxcenter.io/operations/ha-conversion'

const BACKUP_PATH = '/opt/proxcenter/backup-pre-patroni.sql'

// Same pattern as the orchestrator: host[:port]/namespace, no scheme,
// lowercase namespace path.
const REGISTRY_REGEX = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/

const IMAGE_SOURCE_MODES: { mode: HaImageSourceMode; key: string }[] = [
  { mode: '', key: 'imageSourceAuto' },
  { mode: 'online', key: 'imageSourceOnline' },
  { mode: 'registry', key: 'imageSourceRegistry' },
  { mode: 'local', key: 'imageSourceLocal' },
]

const normalizeRegistry = (value: string) => value.trim().replace(/\/+$/, '')

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

export default function HaDeployWizard({
  config,
  onDeployed,
}: {
  config: HaConfig | undefined
  onDeployed: () => void
}) {
  const t = useTranslations('ha')

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
  const [externalUrl, setExternalUrl] = useState(config?.externalUrl || '')
  const [showPw, setShowPw] = useState<Record<number, boolean>>({})
  const [imageMode, setImageMode] = useState<HaImageSourceMode>(config?.imageSource?.mode || '')
  const [registry, setRegistry] = useState(config?.imageSource?.registry || '')
  const [registryCaCert, setRegistryCaCert] = useState(config?.imageSource?.caCert || '')
  const [registryUsername, setRegistryUsername] = useState('')
  const [registryPassword, setRegistryPassword] = useState('')
  const [showRegistryPw, setShowRegistryPw] = useState(false)

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
  }, [vip, vipInterface, imageMode, registry, registryCaCert, registryUsername, registryPassword])

  const registryValue = normalizeRegistry(registry)
  const registryValid = REGISTRY_REGEX.test(registryValue)

  // Only the fields of the selected mode are sent: { mode: '' } for auto.
  const imageSource = useMemo<HaImageSource>(() => (imageMode === 'registry'
    ? {
        mode: imageMode,
        registry: normalizeRegistry(registry),
        ...(registryCaCert.trim() ? { caCert: registryCaCert.trim() } : {}),
      }
    : { mode: imageMode }), [imageMode, registry, registryCaCert])

  // Typed once for validation and deployment, never stored.
  const registryCredentials = useMemo(() => (imageMode === 'registry' && registryUsername.trim()
    ? { registryUsername: registryUsername.trim(), registryPassword }
    : {}), [imageMode, registryUsername, registryPassword])

  const canProceedNodes = nodes.every(n => IPV4_REGEX.test(n.ip) && n.password.length > 0)

  const canProceedNetwork = IPV4_REGEX.test(vip) && vipInterface.length > 0
    && (imageMode !== 'registry' || registryValid)

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
          externalUrl: externalUrl.trim(),
          imageSource,
          ...registryCredentials,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setValidationError(err.error || t('wizard.validationFailedStatus', { status: res.status }))
        return
      }
      const data: ValidationResponse = await res.json()
      setValidationResult(data)
    } catch (e: any) {
      setValidationError(e.message || t('wizard.validationRequestFailed'))
    } finally {
      setValidating(false)
    }
  }, [nodes, vip, vipInterface, externalUrl, imageSource, registryCredentials, t])

  const validationPassed = validationResult
    ? validationResult.results.every(r => r.ssh && r.docker && r.dockerCompose
        && Object.values(r.ping).every(Boolean))
      && validationResult.global.vipAvailable
      && !validationResult.results.some(r => hasFailedCheck(r.checks))
      && !hasFailedCheck(validationResult.global.checks)
    : false

  // Post-deploy destination (decision 3): the preserved external URL comes
  // from the validation summary on a fresh run, or from the saved config
  // when resuming after a reload.
  // The post-deploy destination is the admin's external URL (or the VIP when
  // empty) — never node 1's detected NEXTAUTH_URL, which would send the browser
  // to a node IP that just bounces to the VIP.
  const completion = resolveCompletionTarget(
    externalUrl.trim() || config?.externalUrl,
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
          // Poll the backend's authoritative deploy state, not a bare frontend
          // health ping: a single frontend answering 200 does not mean the whole
          // conversion converged (the backend only reports 'deployed' once the
          // VIP + Patroni + conversion script have all succeeded).
          const r = await fetch('/api/v1/ha/config', { signal: AbortSignal.timeout(5000) })
          if (!r.ok) return
          const data = await r.json()
          if (data.deploymentState === 'deployed') {
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
                  label: t('wizard.clusterOnline'),
                  status: 'done' as const,
                  timestamp: new Date().toISOString(),
                }]
              }
              return prev
            })
            setTimeout(() => {
              // resolveCompletionTarget already rejects anything that is not
              // http(s), but the scheme is re-checked against a literal here so
              // the guard sits at the assignment itself.
              const target = completion.url
              if (target.startsWith('http://') || target.startsWith('https://')) {
                window.location.href = target
              }
            }, 3000)
          } else if (data.deploymentState === 'failed') {
            stopConversionTimers()
            setConversionPhase(false)
            setSseReconnecting(false)
            setDeploying(false)
            deployingRef.current = false
            setDeployError(data.deployError || t('wizard.deployFailed'))
            eventSourceRef.current?.close()
          }
        } catch {}
      }, 6000)
    }
  }, [completion.url, stopConversionTimers, t])

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
          setDeployError(data.error || t('wizard.stepFailed', { step: data.step, label: data.label }))
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
  }, [stopConversionTimers, enterConversionPhase, t])

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
          externalUrl: externalUrl.trim(),
          imageSource,
          sshPasswords: Object.fromEntries(nodes.map(n => [n.ip, n.password])),
        }),
      })

      if (!configRes.ok) {
        const err = await configRes.json().catch(() => ({}))
        setDeployError(err.error || t('wizard.saveConfigFailed'))
        setDeploying(false)
        return
      }

      const deployRes = await fetch('/api/v1/ha/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sshPasswords: Object.fromEntries(nodes.map(n => [n.ip, n.password])),
          ...registryCredentials,
        }),
      })
      if (!deployRes.ok) {
        const err = await deployRes.json().catch(() => ({}))
        setDeployError(err.error || t('wizard.startDeployFailed'))
        setDeploying(false)
        return
      }

      connectSSE()
    } catch (e: any) {
      setDeployError(e.message || t('wizard.deployFailed'))
      setDeploying(false)
    }
  }, [nodes, vip, vipInterface, externalUrl, imageSource, registryCredentials, connectSSE, t])

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
        setDeployError(err.error || t('wizard.resumeDeployFailed'))
        setDeploying(false)
        return
      }
      connectSSE()
    } catch (e: any) {
      setDeployError(e.message || t('wizard.deployFailed'))
      setDeploying(false)
    }
  }, [nodes, connectSSE, t])

  const currentDeployStep = deploySteps.length > 0
    ? deploySteps[deploySteps.length - 1]
    : null
  const totalSteps = currentDeployStep?.totalSteps || 19
  const completedSteps = deploySteps.filter(s => s.status === 'done').length

  const renderPrerequisites = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>{t('wizard.stepPrerequisites')}</Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        {t('wizard.prereqIntro')}
      </Typography>
      {PREREQ_KEYS.map((key, i) => (
        <Box key={key} sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}>
          <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: 'action.selected', display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 1, mt: 0.25, flexShrink: 0 }}>
            <Typography variant="caption">{i + 1}</Typography>
          </Box>
          <Typography variant="body2">{t(`wizard.${key}`)}</Typography>
        </Box>
      ))}
      <FormControlLabel
        sx={{ mt: 2 }}
        control={<Checkbox checked={prereqChecked} onChange={(e) => setPrereqChecked(e.target.checked)} />}
        label={t('wizard.prereqConfirm')}
      />
    </Box>
  )

  const renderNodes = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>{t('wizard.nodesTitle')}</Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        {t('wizard.nodesIntro')}
      </Typography>
      {nodes.map((node, i) => (
        <Card key={i} variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {node.name} {i === 0 && <Chip label={t('wizard.currentNode')} size="small" color="primary" sx={{ ml: 1 }} />}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label={t('wizard.ipAddress')}
                value={node.ip}
                onChange={(e) => updateNode(i, 'ip', e.target.value)}
                error={node.ip.length > 0 && !IPV4_REGEX.test(node.ip)}
                helperText={node.ip.length > 0 && !IPV4_REGEX.test(node.ip) ? t('wizard.invalidIpv4') : ''}
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label={t('wizard.rootPassword')}
                type={showPw[i] ? 'text' : 'password'}
                value={node.password}
                onChange={(e) => updateNode(i, 'password', e.target.value)}
                size="small"
                sx={{ flex: 1 }}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPw((s) => ({ ...s, [i]: !s[i] }))}
                          edge="end"
                          size="small"
                          aria-label={showPw[i] ? t('wizard.hidePassword') : t('wizard.showPassword')}
                        >
                          <i className={showPw[i] ? 'ri-eye-off-line' : 'ri-eye-line'} />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {t('wizard.vrrpPriority', { priority: node.vrrpPriority })}
            </Typography>
          </CardContent>
        </Card>
      ))}
      <Alert severity="info" sx={{ mt: 1 }}>
        {t('wizard.passwordsNotice')}
      </Alert>
    </Box>
  )

  const renderImageSource = () => (
    <Box sx={{ mt: 3 }}>
      <FormLabel id="ha-image-source-label" sx={{ display: 'block', mb: 0.5, fontWeight: 600, color: 'text.primary' }}>
        {t('wizard.imageSourceTitle')}
      </FormLabel>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {t('wizard.imageSourceIntro')}
      </Typography>
      <RadioGroup
        aria-labelledby="ha-image-source-label"
        value={imageMode}
        onChange={(e) => setImageMode(e.target.value as HaImageSourceMode)}
      >
        {IMAGE_SOURCE_MODES.map(({ mode, key }) => (
          <FormControlLabel
            key={key}
            value={mode}
            control={<Radio size="small" />}
            label={<Typography variant="body2">{t(`wizard.${key}`)}</Typography>}
          />
        ))}
      </RadioGroup>
      {imageMode === 'registry' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1.5 }}>
          <TextField
            label={t('wizard.registryLabel')}
            placeholder="harbor.example.com/proxcenter"
            value={registry}
            onChange={(e) => setRegistry(e.target.value)}
            error={registry.trim().length > 0 && !registryValid}
            helperText={registry.trim().length > 0 && !registryValid ? t('wizard.registryInvalid') : t('wizard.registryHelper')}
            size="small"
            fullWidth
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label={t('wizard.registryUsernameLabel')}
              value={registryUsername}
              onChange={(e) => setRegistryUsername(e.target.value)}
              autoComplete="off"
              size="small"
              sx={{ flex: 1 }}
            />
            <TextField
              label={t('wizard.registryPasswordLabel')}
              type={showRegistryPw ? 'text' : 'password'}
              value={registryPassword}
              onChange={(e) => setRegistryPassword(e.target.value)}
              autoComplete="new-password"
              size="small"
              sx={{ flex: 1 }}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowRegistryPw(v => !v)}
                        edge="end"
                        size="small"
                        aria-label={showRegistryPw ? t('wizard.hidePassword') : t('wizard.showPassword')}
                      >
                        <i className={showRegistryPw ? 'ri-eye-off-line' : 'ri-eye-line'} />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1 }}>
            {t('wizard.registryCredentialsHelper')}
          </Typography>
          <TextField
            label={t('wizard.registryCaLabel')}
            placeholder="-----BEGIN CERTIFICATE-----"
            value={registryCaCert}
            onChange={(e) => setRegistryCaCert(e.target.value)}
            helperText={t('wizard.registryCaHelper')}
            multiline
            minRows={3}
            maxRows={10}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 12 } } }}
          />
        </Box>
      )}
      {imageMode === 'local' && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {t.rich('wizard.imageSourceLocalHint', {
            code: (chunks) => <Box component="code" sx={{ fontFamily: 'monospace', px: 0.5, bgcolor: 'action.hover', borderRadius: 0.5 }}>{chunks}</Box>,
          })}
        </Alert>
      )}
    </Box>
  )

  const renderNetwork = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>{t('wizard.networkTitle')}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label={t('wizard.vipLabel')}
          value={vip}
          onChange={(e) => setVip(e.target.value)}
          error={vip.length > 0 && !IPV4_REGEX.test(vip)}
          helperText={t('wizard.vipHelper')}
          size="small"
          fullWidth
        />
        <TextField
          label={t('wizard.interfaceLabel')}
          value={vipInterface}
          onChange={(e) => setVipInterface(e.target.value)}
          helperText={t('wizard.interfaceHelper')}
          size="small"
          fullWidth
        />
        <TextField
          label={t('wizard.externalUrlLabel')}
          value={externalUrl}
          onChange={(e) => setExternalUrl(e.target.value)}
          helperText={t('wizard.externalUrlHelper')}
          size="small"
          fullWidth
        />
      </Box>
      <Alert severity="info" sx={{ mt: 2 }}>
        {t('wizard.networkNotice')}
      </Alert>
      {renderImageSource()}
    </Box>
  )

  const renderValidation = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>{t('wizard.stepValidation')}</Typography>
      {!validationResult && !validating && !validationError && (
        <Box>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('wizard.validationIntro')}
          </Typography>
          <Button variant="contained" onClick={handleValidate}>
            {t('wizard.runValidation')}
          </Button>
        </Box>
      )}
      {validating && (
        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>{t('wizard.validating')}</Typography>
          <LinearProgress />
        </Box>
      )}
      {validationError && (
        <Box>
          <Alert severity="error" sx={{ mb: 2 }}>{validationError}</Alert>
          <Button variant="outlined" onClick={handleValidate}>{t('wizard.retry')}</Button>
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
        const pgCompatibleLabel = t('wizard.checkPgCompatible')
        const nodeChecks: { label: string; values: (boolean | undefined)[] }[] = [
          { label: t('wizard.checkSsh'), values: results.map(r => r.ssh) },
          { label: t('wizard.checkDocker'), values: results.map(r => r.docker) },
          { label: t('wizard.checkCompose'), values: results.map(r => r.dockerCompose) },
          { label: pgCompatibleLabel, values: results.map(r => r.pgCompatible) },
        ]
        const allPingTargets = [...new Set(results.flatMap(r => Object.keys(r.ping)))]
        for (const target of allPingTargets) {
          nodeChecks.push({
            label: t('wizard.checkPing', { target }),
            values: results.map(r => r.ping[target] ?? undefined),
          })
        }

        // Structured pre-flight checks: one row per distinct name, in
        // first-seen order across nodes.
        const checkLabel = (name: string) => (KNOWN_CHECK_NAMES.has(name) ? t(`wizard.checkName.${name}`) : name)
        const statusIcon = (status: string) => {
          if (status === 'pass') return checkIcon(true)
          if (status === 'fail') return checkIcon(false)
          if (status === 'info') {
            return <i className="ri-information-line" aria-label={status} style={{ color: 'var(--mui-palette-text-secondary)', fontSize: 18 }} />
          }
          return <i className="ri-error-warning-line" aria-label={status} style={{ color: 'var(--mui-palette-warning-main)', fontSize: 18 }} />
        }
        const structuredNames = [...new Set(results.flatMap(r => (r.checks ?? []).map(c => c.name)))]
        const globalChecks = (validationResult.global.checks ?? []).filter(c => !SKIPPED_GLOBAL_CHECKS.has(c.name))
        const issues: Record<'error' | 'warning' | 'info', string[]> = { error: [], warning: [], info: [] }
        const addIssue = (who: string, c: CheckResult) => {
          if (c.status === 'pass') return
          const severity = c.status === 'fail' ? 'error' : c.status === 'info' ? 'info' : 'warning'
          issues[severity].push(`${who}: ${c.detail || checkLabel(c.name)}`)
        }
        results.forEach((r, i) => (r.checks ?? []).forEach(c => addIssue(nodes[i]?.name || r.ip, c)))
        globalChecks.forEach(c => addIssue(checkLabel(c.name), c))
        const issueTitles: Record<'error' | 'warning' | 'info', string | null> = {
          error: t('wizard.checkIssuesBlocking'),
          warning: t('wizard.checkIssuesWarnings'),
          info: null,
        }
        return (
          <Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, borderBottom: 2, borderColor: 'divider' }}>{t('wizard.checkColumn')}</TableCell>
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
                        {check.label === t('wizard.checkDocker') && results.some(r => r.dockerVersion) && (
                          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                            ({results.find(r => r.dockerVersion)?.dockerVersion})
                          </Typography>
                        )}
                      </TableCell>
                      {check.values.map((ok, i) => (
                        <TableCell key={i} align="center" sx={{ py: 0.75 }}>
                          {ok === undefined ? <Typography variant="caption" color="text.secondary">{t('wizard.notAvailable')}</Typography> : checkIcon(ok, check.label === pgCompatibleLabel)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {structuredNames.map((name) => (
                    <TableRow key={`check-${name}`}>
                      <TableCell sx={{ py: 0.75 }}>{checkLabel(name)}</TableCell>
                      {results.map((r, i) => {
                        const c = r.checks?.find(x => x.name === name)
                        return (
                          <TableCell key={i} align="center" sx={{ py: 0.75 }}>
                            {c ? statusIcon(c.status) : <Typography variant="caption" color="text.secondary">{t('wizard.notAvailable')}</Typography>}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell sx={{ py: 0.75, fontWeight: 600, borderTop: 2, borderColor: 'divider' }}>{t('wizard.vipAvailable', { vip })}</TableCell>
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
                          {t('wizard.externalUrlDetected', { url: validationResult.global.externalUrl })}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            {globalChecks.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>
                  {t('wizard.globalChecksTitle')}
                </Typography>
                {globalChecks.map(c => (
                  <Box key={c.name} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {statusIcon(c.status)}
                    <Typography variant="body2">{checkLabel(c.name)}</Typography>
                  </Box>
                ))}
              </Box>
            )}
            {(['error', 'warning', 'info'] as const).filter(sev => issues[sev].length > 0).map(sev => (
              <Alert key={sev} severity={sev} sx={{ mt: 1.5 }}>
                {issueTitles[sev] && <Typography variant="body2" sx={{ fontWeight: 600 }}>{issueTitles[sev]}</Typography>}
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {issues[sev].map((line, i) => (
                    <Typography key={i} component="li" variant="body2">{line}</Typography>
                  ))}
                </Box>
              </Alert>
            ))}
            {validationPassed && (
              <Alert severity="success" sx={{ mt: 2 }}>{t('wizard.allChecksPassed')}</Alert>
            )}
            {!validationPassed && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="error" sx={{ mb: 1 }}>{t('wizard.checksFailed')}</Alert>
                <Button variant="outlined" onClick={handleValidate}>{t('wizard.retryValidation')}</Button>
              </Box>
            )}
          </Box>
        )
      })()}
    </Box>
  )

  const renderDeployment = () => (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>{t('wizard.stepDeployment')}</Typography>
      {!deploying && !deployDone && !deployError && config?.deploymentState === 'failed' && (
        <Box>
          <Alert severity="error" sx={{ mb: 2 }}>{t('wizard.previousFailed')}</Alert>
          <Button variant="contained" color="warning" onClick={handleRetryDeploy}>{t('wizard.retryDeployment')}</Button>
        </Box>
      )}
      {!deploying && !deployDone && !deployError && config?.deploymentState !== 'failed' && (
        <Box>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('wizard.deployIntro')}
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('wizard.disconnectWarning')}
          </Alert>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('wizard.backupInfo', { path: BACKUP_PATH })}
          </Alert>
          <FormControlLabel
            sx={{ display: 'block', mb: 2 }}
            control={<Checkbox checked={snapshotConfirmed} onChange={(e) => setSnapshotConfirmed(e.target.checked)} />}
            label={(
              <span>
                {t('wizard.snapshotConfirm')}
                {' '}(<Link href={RUNBOOK_URL} target="_blank" rel="noopener noreferrer">{t('wizard.snapshotRunbookLink')}</Link>)
              </span>
            )}
          />
          <Button variant="contained" color="primary" onClick={handleDeploy} disabled={!snapshotConfirmed}>
            {t('wizard.deployButton')}
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
              {t('wizard.stepProgress', { completed: completedSteps, total: totalSteps })}
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
                {t('wizard.conversionInProgress', { elapsed: `${Math.floor(conversionElapsed / 60)}:${String(conversionElapsed % 60).padStart(2, '0')}` })}
              </Typography>
              <Typography variant="caption" component="div" sx={{ mb: 1 }}>
                {conversionElapsed < 15
                  ? t('wizard.conversionPhase1')
                  : conversionElapsed < 45
                    ? t('wizard.conversionPhase2')
                    : conversionElapsed < 90
                      ? t('wizard.conversionPhase3')
                      : t('wizard.conversionPhaseLong')
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
            {logExpanded ? t('wizard.hideLog') : t('wizard.showLog')}
          </Button>
          <Collapse in={logExpanded}>
            <Box sx={{ maxHeight: 300, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, p: 1 }}>
              {deploySteps.map((step) => (
                <Box key={step.step} sx={{ mb: 0.5 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>
                    [{step.status === 'done' ? 'OK' : step.status === 'failed' ? 'FAIL' : step.status === 'running' ? '...' : '--'}]
                    {' '}{t('wizard.logStep', { step: step.step, label: step.label })}
                    {step.detail ? ` - ${step.detail}` : ''}
                    {step.error ? ` - ${step.error}` : ''}
                  </Typography>
                </Box>
              ))}
              {conversionPhase && deploying && (
                <Box sx={{ mb: 0.5 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'inherit', color: 'info.main' }}>
                    [...] {t('wizard.logConversionRunning')}
                  </Typography>
                </Box>
              )}
            </Box>
          </Collapse>
          {deployError && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="error" sx={{ mb: 1 }}>{deployError}</Alert>
              <Button variant="outlined" onClick={handleRetryDeploy}>{t('wizard.retryResume')}</Button>
            </Box>
          )}
          {deployDone && (
            <Box sx={{ mt: 2 }}>
              {completion.external ? (
                <>
                  <Alert severity="success" sx={{ mb: 2 }}>
                    {t('wizard.successExternal', { url: completion.url })}
                  </Alert>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {t('wizard.successExternalNote', { vip })}
                  </Alert>
                </>
              ) : (
                <>
                  <Alert severity="success" sx={{ mb: 2 }}>
                    {t('wizard.successVip', { vip })}
                  </Alert>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {t('wizard.successVipNote', { vip })}
                  </Alert>
                </>
              )}
              <Button variant="contained" onClick={onDeployed}>{t('wizard.viewDashboard')}</Button>
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
      <Typography variant="h5" sx={{ mb: 3 }}>{t('wizard.title')}</Typography>
      <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
        {WIZARD_STEP_KEYS.map((key) => (
          <Step key={key}>
            <StepLabel>{t(`wizard.${key}`)}</StepLabel>
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
                {t('wizard.back')}
              </Button>
              <Button
                variant="contained"
                disabled={!canNext()}
                onClick={() => setActiveStep(s => s + 1)}
              >
                {t('wizard.next')}
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
