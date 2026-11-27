'use client'

// KubernetesDeployWizard: the multi-step, multi-distro (Talos / k3s / RKE2 / kubeadm) provisioning wizard. Pure
// presentational JSX cloned from templates/DeployWizard's step architecture
// (STEP_LABELS, one renderXStep() per step, switch(activeStep), canProceed
// gate, MUI Dialog/Stepper, Back/Next/Deploy footer). ALL provisioning logic
// (shape, defaults, validation, request building, tfvars preview) lives in
// the tested @/lib/k8s/provision/* modules; this file only wires state to
// those functions and to the two network calls needed to submit + follow a
// run (POST /provision, then ProvisionProgress for polling).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  DialogTitle,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Slider,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material'

import { supportsVmDisks } from '@/lib/proxmox/storage'
import { formatBytes } from '@/utils/format'
import { defaultWizardState, MIN_CORES, MIN_MEMORY, MIN_DISK } from '@/lib/k8s/provision/types'
import type { WizardState, WizardNodeAddr } from '@/lib/k8s/provision/types'
import { validateProvision } from '@/lib/k8s/provision/validate'
import { buildProvisionRequest } from '@/lib/k8s/provision/buildRequest'
import { tfvarsPreview } from '@/lib/k8s/provision/tfvarsPreview'
import { defaultRanges, rangeErrors, rangesConfigurable } from '@/lib/k8s/provision/networks'
import ProvisionProgress from '@/components/k8s/ProvisionProgress'

interface KubernetesDeployWizardProps {
  open: boolean
  onClose: () => void
  onCreated?: (clusterId: string) => void
}

const STEP_TARGET = 0
const STEP_DISTRO = 1
const STEP_TOPOLOGY = 2
const STEP_NETWORK = 3
const STEP_REVIEW = 4
const STEP_PROGRESS = 5

const STEP_LABELS = [
  'kubernetes.provision.steps.target',
  'kubernetes.provision.steps.distro',
  'kubernetes.provision.steps.topology',
  'kubernetes.provision.steps.network',
  'kubernetes.provision.steps.review',
  'kubernetes.provision.steps.progress',
] as const

interface Connection {
  id: string
  name: string
  type: string
}

interface NodeInfo {
  node: string
  status: string
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
}

interface StorageInfo {
  storage: string
  content?: string
  type: string
  enabled?: number
  total?: number
  used?: number
  avail?: number
}

interface BridgeChoice {
  iface: string
  type: string
  displayName?: string | null
}

const CORES_MARKS = [1, 2, 4, 8, 16, 32]
const MEMORY_MARKS = [2048, 4096, 8192, 16384, 32768, 65536]
const DISK_MARKS = [10, 20, 40, 80, 160, 320, 640]

const formatCores = (v: number) => `${v} ${v === 1 ? 'vCPU' : 'vCPUs'}`
const formatMemory = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(v % 1024 === 0 ? 0 : 1)} GB` : `${v} MB`)
const formatDisk = (v: number) => `${v} GB`

/** Log-style slider (marks + free-typed override), mirroring DeployWizard's
 *  cores/memory/disk sliders. Declared at module scope (not inside the
 *  wizard's render body) so its component identity stays stable across
 *  re-renders and typed inputs do not lose focus. */
function SizeSlider({
  label,
  value,
  min,
  marks,
  unit,
  onChange,
  formatValue,
}: {
  label: string
  value: number
  min: number
  marks: number[]
  unit?: string
  onChange: (v: number) => void
  formatValue: (v: number) => string
}) {
  const sliderMax = marks[marks.length - 1]

  const valueToSlider = (v: number) => {
    for (let i = marks.length - 1; i >= 0; i--) {
      if (v >= marks[i]) {
        const upper = marks[Math.min(i + 1, marks.length - 1)]
        return upper === marks[i] ? i : i + (v - marks[i]) / (upper - marks[i])
      }
    }
    return 0
  }
  const sliderToValue = (pos: number) => {
    const idx = Math.floor(pos)
    const frac = pos - idx
    if (idx >= marks.length - 1) return marks[marks.length - 1]
    const raw = marks[idx] + frac * (marks[idx + 1] - marks[idx])
    return Math.max(min, Math.round(raw))
  }

  const slotProps: Record<string, unknown> = { htmlInput: { min } }
  if (unit) {
    slotProps.input = {
      endAdornment: (
        <InputAdornment position="end" sx={{ '& p': { fontSize: 11, opacity: 0.6 } }}>
          {unit}
        </InputAdornment>
      ),
    }
  }

  return (
    <Box sx={{ px: 1.5 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {formatValue(value)}
        </Typography>
      </Stack>
      <Stack direction="row" alignItems="center" spacing={5}>
        <Box sx={{ flex: 1, pr: 2 }}>
          <Slider
            size="small"
            value={valueToSlider(Math.min(value, sliderMax))}
            min={0}
            max={marks.length - 1}
            step={0.01}
            onChange={(_, v) => onChange(sliderToValue(v as number))}
            marks={marks.map((m, i) => ({ value: i, label: formatValue(m) }))}
            valueLabelDisplay="auto"
            valueLabelFormat={() => formatValue(value)}
            sx={{ '& .MuiSlider-markLabel': { fontSize: '0.65rem' } }}
          />
        </Box>
        <TextField
          size="small"
          type="number"
          value={value}
          onChange={e => onChange(Math.max(min, Number.parseInt(e.target.value, 10) || min))}
          slotProps={slotProps}
          sx={{ width: 120 }}
        />
      </Stack>
    </Box>
  )
}

/** One IP + VMID row for a control-plane or worker node, labelled with its
 *  derived name (clusterName-role-index, matching buildRequest.ts). Declared
 *  at module scope for the same stable-identity reason as SizeSlider. */
function NodeAddrRow({
  label,
  ip,
  vmid,
  onIpChange,
  onVmidChange,
}: {
  label: string
  ip: string
  vmid: number
  onIpChange: (ip: string) => void
  onVmidChange: (vmid: number) => void
}) {
  const t = useTranslations()
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '160px 1fr 130px', gap: 2, alignItems: 'center' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <img src="/images/kubernetes-logo.svg" alt="" width={16} height={16} style={{ flexShrink: 0 }} />
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {label}
        </Typography>
      </Box>
      <TextField
        size="small"
        label={t('kubernetes.provision.network.ip')}
        value={ip}
        onChange={e => onIpChange(e.target.value.trim())}
        placeholder="10.0.1.10"
      />
      <TextField
        size="small"
        type="number"
        label={t('kubernetes.provision.network.vmid')}
        value={vmid || ''}
        onChange={e => onVmidChange(Number.parseInt(e.target.value, 10) || 0)}
        slotProps={{ htmlInput: { min: 100 } }}
      />
    </Box>
  )
}

/** Storage name + capacity bar rendered inside a datastore <MenuItem>, shared
 *  by the image- and VM-datastore selects. Declared at module scope for the
 *  same stable-identity reason as SizeSlider/NodeAddrRow. */
function StorageOptionContent({ s }: { s: StorageInfo }) {
  const hasUsage = typeof s.total === 'number' && s.total > 0
  const usedPct = hasUsage ? Math.round(((s.used ?? 0) / (s.total as number)) * 100) : 0
  const barColor = usedPct > 90 ? 'error.main' : usedPct > 70 ? 'warning.main' : 'success.main'

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
      <Typography variant="body2" sx={{ flexShrink: 0 }}>
        {s.storage}
      </Typography>
      {hasUsage && (
        <>
          <LinearProgress
            variant="determinate"
            value={usedPct}
            sx={{
              flex: 1,
              minWidth: 60,
              height: 6,
              borderRadius: 1,
              bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': { borderRadius: 1, bgcolor: barColor },
            }}
          />
          <Typography variant="caption" sx={{ opacity: 0.5, flexShrink: 0 }}>
            {formatBytes(s.avail ?? 0)} free
          </Typography>
        </>
      )}
    </Box>
  )
}

/** Selectable distribution card (Talos / k3s). Declared at module scope for
 *  the same stable-identity reason as SizeSlider. The name renders in the
 *  default font: user-facing distro names are never monospace. */
function DistroCard({
  selected,
  logo,
  name,
  description,
  chip,
  onSelect,
}: {
  selected: boolean
  logo: string
  name: string
  description: string
  chip: string
  onSelect: () => void
}) {
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        p: 2,
        border: '2px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: 2,
        cursor: 'pointer',
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': { borderColor: selected ? 'primary.main' : 'text.disabled' },
      }}
    >
      <img src={logo} alt="" width={28} height={28} style={{ flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1">{name}</Typography>
        <Typography variant="body2" sx={{ opacity: 0.6 }}>
          {description}
        </Typography>
      </Box>
      <Chip label={chip} size="small" sx={{ ml: 'auto', flexShrink: 0 }} />
    </Box>
  )
}

export default function KubernetesDeployWizard({ open, onClose, onCreated }: KubernetesDeployWizardProps) {
  const t = useTranslations()
  const theme = useTheme()

  const [state, setState] = useState<WizardState>(defaultWizardState())
  const [activeStep, setActiveStep] = useState(STEP_TARGET)

  const [connections, setConnections] = useState<Connection[]>([])
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [imageDatastores, setImageDatastores] = useState<StorageInfo[]>([])
  const [vmDatastores, setVmDatastores] = useState<StorageInfo[]>([])
  const [snippetDatastores, setSnippetDatastores] = useState<StorageInfo[]>([])
  const [bridges, setBridges] = useState<BridgeChoice[]>([])

  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  // Best-effort next-free VMID counter for this connection. Consumed (and
  // incremented) each time the topology step grows the CP/worker arrays, so
  // newly added nodes start with a sensible VMID instead of 0. Nice-to-have
  // only: if the fetch fails we just fall back to 0 (user types it in).
  const nextVmidRef = useRef<number | null>(null)

  const setField = useCallback(<K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setState(s => ({ ...s, [key]: value }))
  }, [])

  // Reset the whole wizard every time it is (re)opened.
  useEffect(() => {
    if (!open) return
    setState(defaultWizardState())
    setActiveStep(STEP_TARGET)
    setDeploying(false)
    setDeployError(null)
    setRunId(null)
    nextVmidRef.current = null
  }, [open])

  // Target step: connections.
  useEffect(() => {
    if (!open) return
    fetch('/api/v1/connections?type=pve')
      .then(r => r.json())
      .then(res => {
        const conns: Connection[] = res.data || []
        setConnections(conns)
        if (conns.length === 1) setField('connectionId', conns[0].id)
      })
      .catch(() => {})
  }, [open, setField])

  // Target step: nodes for the selected connection, plus a best-effort
  // next-VMID prefetch (consumed later by the topology step).
  useEffect(() => {
    const connectionId = state.connectionId
    if (!connectionId) {
      setNodes([])
      return
    }
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes`)
      .then(r => r.json())
      .then(res => {
        const list = ((res.data || []) as NodeInfo[]).filter(n => n.status === 'online')
        setNodes(list)
        if (list.length === 1) setField('pveNode', list[0].node)
      })
      .catch(() => setNodes([]))

    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/nextid`)
      .then(r => r.json())
      .then(res => {
        const n = Number(res.data)
        nextVmidRef.current = Number.isFinite(n) ? n : null
      })
      .catch(() => {
        nextVmidRef.current = null
      })
  }, [state.connectionId, setField])

  // Target step: datastores + bridge/VLAN choices for the selected node.
  useEffect(() => {
    const { connectionId, pveNode } = state
    if (!connectionId || !pveNode) {
      setImageDatastores([])
      setVmDatastores([])
      setSnippetDatastores([])
      setBridges([])
      return
    }

    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(pveNode)}/storages`)
      .then(r => r.json())
      .then(res => {
        const all = (res.data || []) as StorageInfo[]

        // Every module downloads its image with the Proxmox "import" content
        // type; a datastore that only takes ISO files would refuse it.
        const images = all.filter(s => s.enabled !== 0 && s.content?.includes('import'))
        setImageDatastores(images)
        if (images.length === 1) setField('imageDatastore', images[0].storage)

        const vmDisks = all.filter(
          s => supportsVmDisks(s.type) && s.enabled !== 0 && (s.content?.includes('images') || s.content?.includes('rootdir')),
        )
        setVmDatastores(vmDisks)
        if (vmDisks.length === 1) setField('vmDatastore', vmDisks[0].storage)

        // k3s cloud-init user-data is delivered via a datastore with the
        // Proxmox "snippets" content type (spike O1).
        const snippets = all.filter(s => s.enabled !== 0 && s.content?.includes('snippets'))
        setSnippetDatastores(snippets)
        if (snippets.length === 1) setField('snippetDatastore', snippets[0].storage)
      })
      .catch(() => {
        setImageDatastores([])
        setVmDatastores([])
        setSnippetDatastores([])
      })

    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/network-choices?node=${encodeURIComponent(pveNode)}`)
      .then(r => r.json())
      .then(res => {
        const choices = Array.isArray(res?.data) ? res.data : []
        const list: BridgeChoice[] = choices.map((c: any) => ({
          iface: c.name,
          type: c.kind === 'vnet' ? 'vnet' : c.kind === 'shared' ? 'shared' : (c.type || 'bridge'),
          displayName: c.displayName ?? null,
        }))
        setBridges(list)
        if (list.length === 1) setField('bridge', list[0].iface)
      })
      .catch(() => setBridges([]))
  }, [state.connectionId, state.pveNode, setField])

  const handleConnectionChange = (id: string) => {
    setState(s => ({ ...s, connectionId: id, pveNode: '', imageDatastore: '', vmDatastore: '', snippetDatastore: '', bridge: '', vlan: 0 }))
  }
  const handleNodeChange = (node: string) => {
    setState(s => ({ ...s, pveNode: node, imageDatastore: '', vmDatastore: '', snippetDatastore: '', bridge: '', vlan: 0 }))
  }
  const handleBridgeChange = (iface: string) => {
    const chosen = bridges.find(b => b.iface === iface)
    setState(s => ({ ...s, bridge: iface, vlan: chosen?.type === 'vnet' ? 0 : s.vlan }))
  }

  const takeNextVmid = (): number => {
    if (nextVmidRef.current == null) return 0
    const v = nextVmidRef.current
    nextVmidRef.current = v + 1
    return v
  }

  const handleCpCountChange = (count: number) => {
    setState(s => {
      const list = s.controlPlane
      if (count === list.length) return s
      if (count < list.length) return { ...s, controlPlane: list.slice(0, count) }
      const additions: WizardNodeAddr[] = Array.from({ length: count - list.length }, () => ({ ip: '', vmid: takeNextVmid() }))
      return { ...s, controlPlane: [...list, ...additions] }
    })
  }
  const handleWorkerCountChange = (count: number) => {
    setState(s => {
      const list = s.workers
      if (count === list.length) return s
      if (count < list.length) return { ...s, workers: list.slice(0, count) }
      const additions: WizardNodeAddr[] = Array.from({ length: count - list.length }, () => ({ ip: '', vmid: takeNextVmid() }))
      return { ...s, workers: [...list, ...additions] }
    })
  }
  const updateCpNode = (index: number, patch: Partial<WizardNodeAddr>) => {
    setState(s => ({ ...s, controlPlane: s.controlPlane.map((n, i) => (i === index ? { ...n, ...patch } : n)) }))
  }
  const updateWorkerNode = (index: number, patch: Partial<WizardNodeAddr>) => {
    setState(s => ({ ...s, workers: s.workers.map((n, i) => (i === index ? { ...n, ...patch } : n)) }))
  }

  const handleNext = useCallback(() => setActiveStep(s => Math.min(s + 1, STEP_REVIEW)), [])
  const handleBack = useCallback(() => setActiveStep(s => Math.max(s - 1, STEP_TARGET)), [])

  const handleDeploy = useCallback(async () => {
    setDeploying(true)
    setDeployError(null)
    try {
      const req = buildProvisionRequest(state)
      const idem = crypto.randomUUID()
      const res = await fetch('/api/v1/k8s/clusters/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idem },
        body: JSON.stringify(req),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 202 && body?.runId) {
        setRunId(body.runId)
        setActiveStep(STEP_PROGRESS)
      } else {
        const code = typeof body?.error === 'string' ? body.error : ''
        setDeployError(
          code === 'invalid_request' && body?.message
            ? t('kubernetes.provision.error.invalid_request', { message: body.message })
            : t.has(`kubernetes.provision.error.${code}`)
              ? t(`kubernetes.provision.error.${code}`)
              : t('kubernetes.provision.error.generic'),
        )
      }
    } catch (e: any) {
      setDeployError(t('kubernetes.provision.error.generic'))
    } finally {
      setDeploying(false)
    }
  }, [state, t])

  const validationErrors = useMemo(() => validateProvision(state), [state])

  // Pod and service ranges against the node network, checked as addresses are typed.
  const networkRangeErrors = useMemo(
    () => rangeErrors({
      distro: state.distro,
      podCIDR: state.podCIDR,
      serviceCIDR: state.serviceCIDR,
      subnetPrefix: state.subnetPrefix,
      nodeIps: [...state.controlPlane, ...state.workers].map(n => n.ip).filter(Boolean),
    }),
    [state.distro, state.podCIDR, state.serviceCIDR, state.subnetPrefix, state.controlPlane, state.workers],
  )
  const rangeErrorText = (field: 'pod' | 'service'): string | null => {
    const e = networkRangeErrors.find(x => x.field === field)
    if (!e) return null
    if (e.code === 'cidrInvalid') return t('kubernetes.provision.error.cidrInvalid', { cidr: e.cidr })
    if (e.code === 'cidrOverlapNodes') return t('kubernetes.provision.error.cidrOverlapNodes', { cidr: e.cidr, nodes: e.nodes })
    return t('kubernetes.provision.error.cidrOverlapEach')
  }

  const canProceed = useMemo(() => {
    switch (activeStep) {
      case STEP_TARGET:
        return (
          !!state.clusterName.trim() &&
          !!state.connectionId &&
          !!state.pveNode &&
          !!state.imageDatastore &&
          !!state.vmDatastore &&
          !!state.bridge
        )
      case STEP_DISTRO:
        // Mirrors validateProvision's per-distro required fields (FT2).
        if (state.distro === 'talos') {
          return !!state.talosVersion && !!state.kubernetesVersion && !!state.schematicId
        }
        if (state.distro === 'k3s') {
          return !!state.k3sVersion && !!state.snippetDatastore && !!state.osImageUrl && !!state.osImageChecksum
        }
        if (state.distro === 'rke2') {
          return !!state.rke2Version && !!state.snippetDatastore && !!state.osImageUrl && !!state.osImageChecksum
        }
        if (state.distro === 'kubeadm') {
          return (
            !!state.kubeadmVersion &&
            (state.cni === 'calico' || state.cni === 'cilium') &&
            !!state.snippetDatastore &&
            !!state.osImageUrl &&
            !!state.osImageChecksum
          )
        }
        return false
      case STEP_TOPOLOGY: {
        const cpCount = state.controlPlane.length
        return cpCount === 1 || (cpCount >= 3 && cpCount % 2 === 1)
      }
      case STEP_NETWORK: {
        if (state.distro === 'kubeadm' && !state.controlPlaneVip) return false
        if (!state.gateway || state.dns.length === 0) return false
        if (networkRangeErrors.length > 0) return false
        const allNodes = [...state.controlPlane, ...state.workers]
        if (allNodes.length === 0) return false
        const seenIps = new Set<string>()
        for (const n of allNodes) {
          if (!n.ip || !n.vmid) return false
          if (seenIps.has(n.ip)) return false
          seenIps.add(n.ip)
        }
        return true
      }
      case STEP_REVIEW:
        return validationErrors.length === 0
      default:
        return false
    }
  }, [activeStep, state, validationErrors, networkRangeErrors])

  // ---- Step renderers ------------------------------------------------

  const renderTargetStep = () => {
    const selectedBridgeIsVnet = bridges.find(b => b.iface === state.bridge)?.type === 'vnet'
    return (
      <Stack spacing={2}>
        <TextField
          size="small"
          fullWidth
          required
          label={t('kubernetes.provision.target.clusterName')}
          value={state.clusterName}
          onChange={e => setField('clusterName', e.target.value)}
          placeholder="talos-prod"
          helperText={t('kubernetes.provision.target.clusterNameHelp')}
        />

        <FormControl size="small" fullWidth required>
          <InputLabel>{t('kubernetes.provision.target.connection')}</InputLabel>
          <Select
            value={state.connectionId}
            label={t('kubernetes.provision.target.connection')}
            onChange={e => handleConnectionChange(e.target.value)}
          >
            {connections.map(c => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth required disabled={!state.connectionId}>
          <InputLabel>{t('kubernetes.provision.target.node')}</InputLabel>
          <Select value={state.pveNode} label={t('kubernetes.provision.target.node')} onChange={e => handleNodeChange(e.target.value)}>
            {nodes.map(n => (
              <MenuItem key={n.node} value={n.node}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <img
                    src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
                    alt=""
                    width={16}
                    height={16}
                    style={{ opacity: 0.8, flexShrink: 0 }}
                  />
                  <Typography variant="body2">{n.node}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>
                    CPU: {(n.cpu * 100).toFixed(0)}% &middot; RAM: {((n.mem / n.maxmem) * 100).toFixed(0)}%
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <FormControl size="small" fullWidth required disabled={!state.pveNode}>
            <InputLabel>{t('kubernetes.provision.target.imageDatastore')}</InputLabel>
            <Select
              value={state.imageDatastore}
              label={t('kubernetes.provision.target.imageDatastore')}
              onChange={e => setField('imageDatastore', e.target.value)}
            >
              {imageDatastores.map(s => (
                <MenuItem key={s.storage} value={s.storage}>
                  <StorageOptionContent s={s} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth required disabled={!state.pveNode}>
            <InputLabel>{t('kubernetes.provision.target.vmDatastore')}</InputLabel>
            <Select
              value={state.vmDatastore}
              label={t('kubernetes.provision.target.vmDatastore')}
              onChange={e => setField('vmDatastore', e.target.value)}
            >
              {vmDatastores.map(s => (
                <MenuItem key={s.storage} value={s.storage}>
                  <StorageOptionContent s={s} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {state.pveNode && imageDatastores.length === 0 && (
          <Alert severity="warning" variant="outlined">
            {t('kubernetes.provision.target.noImageDatastore')}
          </Alert>
        )}
        {state.pveNode && vmDatastores.length === 0 && (
          <Alert severity="warning" variant="outlined">
            {t('kubernetes.provision.target.noVmDatastore')}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 2 }}>
          <FormControl size="small" fullWidth required disabled={!state.pveNode}>
            <InputLabel>{t('kubernetes.provision.target.bridge')}</InputLabel>
            <Select value={state.bridge} label={t('kubernetes.provision.target.bridge')} onChange={e => handleBridgeChange(e.target.value)}>
              {bridges.map(b => (
                <MenuItem key={b.iface} value={b.iface}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                    {b.type === 'vnet' && (
                      <Box component="i" className="ri-shield-keyhole-line" sx={{ fontSize: 14, color: 'primary.main' }} />
                    )}
                    <Typography variant="body2">{b.displayName || b.iface}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            type="number"
            label={t('kubernetes.provision.target.vlan')}
            value={state.vlan || ''}
            onChange={e => setField('vlan', Number.parseInt(e.target.value, 10) || 0)}
            disabled={selectedBridgeIsVnet}
            placeholder={t('kubernetes.provision.target.vlanPlaceholder')}
            slotProps={{ htmlInput: { min: 1, max: 4094 } }}
          />
        </Box>

        {state.pveNode && bridges.length === 0 && (
          <Alert severity="warning" variant="outlined">
            {t('kubernetes.provision.target.noBridges')}
          </Alert>
        )}
      </Stack>
    )
  }

  const renderDistroStep = () => (
    <Stack spacing={2}>
      <Typography variant="body2" sx={{ opacity: 0.7 }}>
        {t('kubernetes.provision.distro.select')}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <DistroCard
          selected={state.distro === 'talos'}
          logo="/images/talos-logo.webp"
          name={t('kubernetes.provision.distro.talos')}
          description={t('kubernetes.provision.distro.talosDesc')}
          chip={t('kubernetes.provision.distro.cni')}
          onSelect={() => setField('distro', 'talos')}
        />
        <DistroCard
          selected={state.distro === 'k3s'}
          logo="/images/k3s-logo.png"
          name={t('kubernetes.provision.distro.k3s')}
          description={t('kubernetes.provision.distro.k3sDesc')}
          chip={t('kubernetes.provision.distro.cni')}
          onSelect={() => setField('distro', 'k3s')}
        />
        <DistroCard
          selected={state.distro === 'rke2'}
          logo="/images/rke2-logo.svg"
          name={t('kubernetes.provision.distro.rke2')}
          description={t('kubernetes.provision.distro.rke2Desc')}
          chip={t('kubernetes.provision.distro.cni')}
          onSelect={() => setField('distro', 'rke2')}
        />
        <DistroCard
          selected={state.distro === 'kubeadm'}
          logo="/images/kubernetes-logo.svg"
          name={t('kubernetes.provision.distro.kubeadm')}
          description={t('kubernetes.provision.distro.kubeadmDesc')}
          chip={t('kubernetes.provision.distro.kubeadmChip')}
          onSelect={() => {
            setField('distro', 'kubeadm')
            if (state.controlPlane.length === 1) handleCpCountChange(3)
          }}
        />
      </Box>

      {state.distro === 'talos' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {t('kubernetes.provision.distro.talosVersion')}
            </Typography>
            <Typography variant="body2">{state.talosVersion}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {t('kubernetes.provision.distro.kubernetesVersion')}
            </Typography>
            <Typography variant="body2">{state.kubernetesVersion}</Typography>
          </Box>
        </Box>
      )}

      {state.distro === 'k3s' && (
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              required
              label={t('kubernetes.provision.distro.k3sVersion')}
              value={state.k3sVersion}
              onChange={e => setField('k3sVersion', e.target.value.trim())}
            />
            <FormControl size="small" fullWidth required>
              <InputLabel>{t('kubernetes.provision.distro.snippetDatastore')}</InputLabel>
              <Select
                value={state.snippetDatastore}
                label={t('kubernetes.provision.distro.snippetDatastore')}
                onChange={e => setField('snippetDatastore', e.target.value)}
              >
                {snippetDatastores.map(s => (
                  <MenuItem key={s.storage} value={s.storage}>
                    <StorageOptionContent s={s} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {t('kubernetes.provision.distro.snippetDatastoreHelp')}
          </Typography>
          {snippetDatastores.length === 0 && (
            <Alert severity="warning" variant="outlined">
              {t('kubernetes.provision.distro.noSnippetDatastore')}
            </Alert>
          )}
          <TextField
            size="small"
            fullWidth
            required
            label={t('kubernetes.provision.distro.osImageUrl')}
            value={state.osImageUrl}
            onChange={e => setField('osImageUrl', e.target.value.trim())}
          />
          <TextField
            size="small"
            fullWidth
            required
            label={t('kubernetes.provision.distro.osImageChecksum')}
            value={state.osImageChecksum}
            onChange={e => setField('osImageChecksum', e.target.value.trim())}
          />
          <Alert severity="info" variant="outlined">
            {t('kubernetes.provision.distro.k3sHaNote')}
          </Alert>
        </Stack>
      )}

      {state.distro === 'rke2' && (
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              required
              label={t('kubernetes.provision.distro.rke2Version')}
              value={state.rke2Version}
              onChange={e => setField('rke2Version', e.target.value.trim())}
            />
            <FormControl size="small" fullWidth required>
              <InputLabel>{t('kubernetes.provision.distro.snippetDatastore')}</InputLabel>
              <Select
                value={state.snippetDatastore}
                label={t('kubernetes.provision.distro.snippetDatastore')}
                onChange={e => setField('snippetDatastore', e.target.value)}
              >
                {snippetDatastores.map(s => (
                  <MenuItem key={s.storage} value={s.storage}>
                    <StorageOptionContent s={s} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {t('kubernetes.provision.distro.snippetDatastoreHelp')}
          </Typography>
          {snippetDatastores.length === 0 && (
            <Alert severity="warning" variant="outlined">
              {t('kubernetes.provision.distro.noSnippetDatastore')}
            </Alert>
          )}
          <TextField
            size="small"
            fullWidth
            required
            label={t('kubernetes.provision.distro.osImageUrl')}
            value={state.osImageUrl}
            onChange={e => setField('osImageUrl', e.target.value.trim())}
          />
          <TextField
            size="small"
            fullWidth
            required
            label={t('kubernetes.provision.distro.osImageChecksum')}
            value={state.osImageChecksum}
            onChange={e => setField('osImageChecksum', e.target.value.trim())}
          />
          <Alert severity="info" variant="outlined">
            {t('kubernetes.provision.distro.rke2HaNote')}
          </Alert>
        </Stack>
      )}

      {state.distro === 'kubeadm' && (
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              required
              label={t('kubernetes.provision.distro.kubeadmVersion')}
              value={state.kubeadmVersion}
              onChange={e => setField('kubeadmVersion', e.target.value.trim())}
            />
            <FormControl size="small" fullWidth required>
              <InputLabel>{t('kubernetes.provision.distro.snippetDatastore')}</InputLabel>
              <Select
                value={state.snippetDatastore}
                label={t('kubernetes.provision.distro.snippetDatastore')}
                onChange={e => setField('snippetDatastore', e.target.value)}
              >
                {snippetDatastores.map(s => (
                  <MenuItem key={s.storage} value={s.storage}>
                    <StorageOptionContent s={s} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {t('kubernetes.provision.distro.snippetDatastoreHelp')}
          </Typography>
          {snippetDatastores.length === 0 && (
            <Alert severity="warning" variant="outlined">
              {t('kubernetes.provision.distro.noSnippetDatastore')}
            </Alert>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, alignItems: 'center' }}>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 600, display: 'block', mb: 1 }}>
                {t('kubernetes.provision.distro.cniSelect')}
              </Typography>
              <ToggleButtonGroup
                value={state.cni}
                exclusive
                size="small"
                onChange={(_, v) => {
                  if (v) setField('cni', v)
                }}
              >
                <ToggleButton value="calico">Calico</ToggleButton>
                <ToggleButton value="cilium">Cilium</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>
          <TextField
            size="small"
            fullWidth
            required
            label={t('kubernetes.provision.distro.osImageUrl')}
            value={state.osImageUrl}
            onChange={e => setField('osImageUrl', e.target.value.trim())}
          />
          <TextField
            size="small"
            fullWidth
            required
            label={t('kubernetes.provision.distro.osImageChecksum')}
            value={state.osImageChecksum}
            onChange={e => setField('osImageChecksum', e.target.value.trim())}
          />
          <Alert severity="info" variant="outlined">
            {t('kubernetes.provision.distro.kubeadmHaNote')}
          </Alert>
        </Stack>
      )}
    </Stack>
  )

  const renderTopologyStep = () => (
    <Stack spacing={3}>
      <Box>
        <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 600, display: 'block', mb: 1 }}>
          {t('kubernetes.provision.topology.cpCount')}
        </Typography>
        <ToggleButtonGroup
          value={state.controlPlane.length}
          exclusive
          size="small"
          onChange={(_, v) => {
            if (v) handleCpCountChange(v)
          }}
        >
          <ToggleButton value={1}>1</ToggleButton>
          <ToggleButton value={3}>3</ToggleButton>
          <ToggleButton value={5}>5</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Divider />

      <Typography variant="overline" sx={{ opacity: 0.6 }}>
        {t('kubernetes.provision.topology.cpSizing')}
      </Typography>
      <SizeSlider
        label={t('kubernetes.provision.topology.cores')}
        value={state.cpCores}
        min={MIN_CORES}
        marks={CORES_MARKS}
        onChange={v => setField('cpCores', v)}
        formatValue={formatCores}
      />
      <SizeSlider
        label={t('kubernetes.provision.topology.memory')}
        value={state.cpMemory}
        min={MIN_MEMORY}
        marks={MEMORY_MARKS}
        unit="MB"
        onChange={v => setField('cpMemory', v)}
        formatValue={formatMemory}
      />
      <SizeSlider
        label={t('kubernetes.provision.topology.disk')}
        value={state.cpDisk}
        min={MIN_DISK}
        marks={DISK_MARKS}
        unit="GB"
        onChange={v => setField('cpDisk', v)}
        formatValue={formatDisk}
      />

      <Divider />

      <TextField
        size="small"
        type="number"
        label={t('kubernetes.provision.topology.workerCount')}
        value={state.workers.length}
        onChange={e => handleWorkerCountChange(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
        slotProps={{ htmlInput: { min: 0, max: 32 } }}
        sx={{ width: 180 }}
      />

      {state.workers.length > 0 && (
        <>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>
            {t('kubernetes.provision.topology.workerSizing')}
          </Typography>
          <SizeSlider
            label={t('kubernetes.provision.topology.cores')}
            value={state.workerCores}
            min={MIN_CORES}
            marks={CORES_MARKS}
            onChange={v => setField('workerCores', v)}
            formatValue={formatCores}
          />
          <SizeSlider
            label={t('kubernetes.provision.topology.memory')}
            value={state.workerMemory}
            min={MIN_MEMORY}
            marks={MEMORY_MARKS}
            unit="MB"
            onChange={v => setField('workerMemory', v)}
            formatValue={formatMemory}
          />
          <SizeSlider
            label={t('kubernetes.provision.topology.disk')}
            value={state.workerDisk}
            min={MIN_DISK}
            marks={DISK_MARKS}
            unit="GB"
            onChange={v => setField('workerDisk', v)}
            formatValue={formatDisk}
          />
        </>
      )}

    </Stack>
  )

  const renderNetworkStep = () => (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 2 }}>
        <TextField
          size="small"
          type="number"
          label={t('kubernetes.provision.network.subnetPrefix')}
          value={state.subnetPrefix}
          onChange={e => setField('subnetPrefix', Number.parseInt(e.target.value, 10) || 24)}
          slotProps={{ htmlInput: { min: 1, max: 32 } }}
        />
        <TextField
          size="small"
          label={t('kubernetes.provision.network.gateway')}
          value={state.gateway}
          onChange={e => setField('gateway', e.target.value.trim())}
          placeholder="10.0.0.1"
        />
      </Box>
      {rangesConfigurable(state.distro) ? (
        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              label={t('kubernetes.provision.network.podCidr')}
              value={state.podCIDR}
              onChange={e => setField('podCIDR', e.target.value.trim())}
              placeholder={defaultRanges(state.distro).pod}
              error={!!rangeErrorText('pod')}
              helperText={rangeErrorText('pod') ?? undefined}
            />
            <TextField
              size="small"
              label={t('kubernetes.provision.network.serviceCidr')}
              value={state.serviceCIDR}
              onChange={e => setField('serviceCIDR', e.target.value.trim())}
              placeholder={defaultRanges(state.distro).service}
              error={!!rangeErrorText('service')}
              helperText={rangeErrorText('service') ?? undefined}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {t('kubernetes.provision.network.cidrHelp')}
          </Typography>
        </Box>
      ) : (
        networkRangeErrors.length > 0 && (
          <Alert severity="error">{rangeErrorText('pod') ?? rangeErrorText('service')}</Alert>
        )
      )}
      {state.distro === 'kubeadm' && (
        <TextField
          size="small"
          fullWidth
          required
          label={t('kubernetes.provision.network.vip')}
          value={state.controlPlaneVip}
          onChange={e => setField('controlPlaneVip', e.target.value.trim())}
          placeholder="10.0.0.100"
          helperText={t('kubernetes.provision.network.vipHelp')}
        />
      )}
      <TextField
        size="small"
        fullWidth
        label={t('kubernetes.provision.network.dns')}
        value={state.dns.join(', ')}
        onChange={e =>
          setField(
            'dns',
            e.target.value
              .split(/[\s,]+/)
              .map(v => v.trim())
              .filter(Boolean),
          )
        }
        placeholder="1.1.1.1, 8.8.8.8"
        helperText={t('kubernetes.provision.network.dnsHelp')}
      />

      <Divider />
      <Typography variant="overline" sx={{ opacity: 0.6 }}>
        {t('kubernetes.provision.network.controlPlaneNodes')}
      </Typography>
      <Stack spacing={1.5}>
        {state.controlPlane.map((n, i) => (
          <NodeAddrRow
            key={i}
            label={`${state.clusterName || 'cluster'}-cp-${i + 1}`}
            ip={n.ip}
            vmid={n.vmid}
            onIpChange={ip => updateCpNode(i, { ip })}
            onVmidChange={vmid => updateCpNode(i, { vmid })}
          />
        ))}
      </Stack>

      {state.workers.length > 0 && (
        <>
          <Divider />
          <Typography variant="overline" sx={{ opacity: 0.6 }}>
            {t('kubernetes.provision.network.workerNodes')}
          </Typography>
          <Stack spacing={1.5}>
            {state.workers.map((n, i) => (
              <NodeAddrRow
                key={i}
                label={`${state.clusterName || 'cluster'}-worker-${i + 1}`}
                ip={n.ip}
                vmid={n.vmid}
                onIpChange={ip => updateWorkerNode(i, { ip })}
                onVmidChange={vmid => updateWorkerNode(i, { vmid })}
              />
            ))}
          </Stack>
        </>
      )}
    </Stack>
  )

  const renderReviewStep = () => {
    const preview = tfvarsPreview(buildProvisionRequest(state))
    return (
      <Stack spacing={2}>
        {validationErrors.length > 0 && (
          <Alert severity="warning">
            <Stack spacing={0.5}>
              {validationErrors.map(msg => (
                <Typography key={msg} variant="body2">
                  {msg}
                </Typography>
              ))}
            </Stack>
          </Alert>
        )}

        <Box>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>
            {t('kubernetes.provision.review.summary')}
          </Typography>
          <Typography variant="body2">
            {state.clusterName} &middot; {t('kubernetes.provision.review.nodes', { cp: state.controlPlane.length, workers: state.workers.length })}
          </Typography>
        </Box>

        <Box
          component="pre"
          sx={{
            fontFamily: 'monospace',
            fontSize: 12,
            p: 2,
            borderRadius: 1,
            bgcolor: 'action.hover',
            overflow: 'auto',
            maxHeight: 320,
          }}
        >
          {preview}
        </Box>

        {deployError && <Alert severity="error">{deployError}</Alert>}
      </Stack>
    )
  }

  const renderProgressStep = () => {
    if (!runId) {
      return <Alert severity="error">{deployError || t('kubernetes.provision.progress.noRun')}</Alert>
    }
    return (
      <ProvisionProgress
        key={runId}
        runId={runId}
        clusterName={state.clusterName}
        connectionId={state.connectionId}
        onDone={id => onCreated?.(id)}
        onClose={onClose}
      />
    )
  }

  let stepContent: ReactNode = null
  switch (activeStep) {
    case STEP_TARGET:
      stepContent = renderTargetStep()
      break
    case STEP_DISTRO:
      stepContent = renderDistroStep()
      break
    case STEP_TOPOLOGY:
      stepContent = renderTopologyStep()
      break
    case STEP_NETWORK:
      stepContent = renderNetworkStep()
      break
    case STEP_REVIEW:
      stepContent = renderReviewStep()
      break
    case STEP_PROGRESS:
      stepContent = renderProgressStep()
      break
  }

  const isProgressStep = activeStep === STEP_PROGRESS

  return (
    <Dialog open={open} onClose={deploying ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <img src="/images/kubernetes-logo.svg" alt="" width={24} height={24} style={{ flexShrink: 0 }} />
        {t('kubernetes.provision.title')}
      </DialogTitle>

      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mt: 3, mb: 3 }} alternativeLabel>
          {STEP_LABELS.map(label => (
            <Step key={label}>
              <StepLabel>{t(label as any)}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box sx={{ minHeight: 300 }}>{stepContent}</Box>
      </DialogContent>

      {!isProgressStep && (
        <DialogActions>
          <Button onClick={onClose} disabled={deploying}>
            {t('common.cancel')}
          </Button>
          <Box sx={{ flex: 1 }} />
          {activeStep > STEP_TARGET && (
            <Button onClick={handleBack} disabled={deploying}>
              {t('common.back')}
            </Button>
          )}
          {activeStep < STEP_REVIEW ? (
            <Button variant="contained" onClick={handleNext} disabled={!canProceed}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              onClick={handleDeploy}
              disabled={deploying || !canProceed}
              startIcon={deploying ? <CircularProgress size={18} /> : <i className="ri-rocket-2-line" style={{ fontSize: 16 }} />}
            >
              {t('kubernetes.provision.review.deployNow')}
            </Button>
          )}
        </DialogActions>
      )}

      {isProgressStep && (
        <DialogActions>
          <Button variant="contained" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}
