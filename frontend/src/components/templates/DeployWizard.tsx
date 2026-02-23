'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

import type { CloudImage } from '@/lib/templates/cloudImages'
import DeploymentProgress from './DeploymentProgress'

interface DeployWizardProps {
  open: boolean
  onClose: () => void
  image: CloudImage | null
  prefillBlueprint?: any | null
}

const STEP_LABELS = [
  'templates.deploy.steps.image',
  'templates.deploy.steps.target',
  'templates.deploy.steps.hardware',
  'templates.deploy.steps.cloudInit',
  'templates.deploy.steps.review',
  'templates.deploy.steps.progress',
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
  content: string
  total: number
  used: number
  avail: number
  type: string
}

export default function DeployWizard({ open, onClose, image, prefillBlueprint }: DeployWizardProps) {
  const t = useTranslations()
  const [activeStep, setActiveStep] = useState(0)
  const [deploying, setDeploying] = useState(false)
  const [deploymentId, setDeploymentId] = useState<string | null>(null)
  const [deployError, setDeployError] = useState<string | null>(null)

  // Target step
  const [connections, setConnections] = useState<Connection[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [node, setNode] = useState('')
  const [storages, setStorages] = useState<StorageInfo[]>([])
  const [storage, setStorage] = useState('')
  const [vmid, setVmid] = useState<number>(100)
  const [vmName, setVmName] = useState('')

  // Hardware step
  const [cores, setCores] = useState(2)
  const [sockets, setSockets] = useState(1)
  const [memory, setMemory] = useState(2048)
  const [diskSize, setDiskSize] = useState('20G')
  const [scsihw, setScsihw] = useState('virtio-scsi-single')
  const [networkModel, setNetworkModel] = useState('virtio')
  const [networkBridge, setNetworkBridge] = useState('vmbr0')
  const [vlanTag, setVlanTag] = useState<number | ''>('')
  const [cpu, setCpu] = useState('host')
  const [agent, setAgent] = useState(true)

  // Cloud-init step
  const [ciuser, setCiuser] = useState('')
  const [sshKeys, setSshKeys] = useState('')
  const [ipconfig0, setIpconfig0] = useState('ip=dhcp')
  const [nameserver, setNameserver] = useState('')
  const [searchdomain, setSearchdomain] = useState('')

  // Save as blueprint
  const [saveAsBlueprint, setSaveAsBlueprint] = useState(false)
  const [blueprintName, setBlueprintName] = useState('')

  // Reset state on open
  useEffect(() => {
    if (!open) return
    setActiveStep(0)
    setDeploying(false)
    setDeploymentId(null)
    setDeployError(null)

    if (image) {
      setCores(image.recommendedCores)
      setMemory(image.recommendedMemory)
      setDiskSize(image.defaultDiskSize)
      setVmName('')
    }

    // Prefill from blueprint
    if (prefillBlueprint) {
      try {
        const hw = typeof prefillBlueprint.hardware === 'string'
          ? JSON.parse(prefillBlueprint.hardware)
          : prefillBlueprint.hardware
        setCores(hw.cores || 2)
        setSockets(hw.sockets || 1)
        setMemory(hw.memory || 2048)
        setDiskSize(hw.diskSize || '20G')
        setScsihw(hw.scsihw || 'virtio-scsi-single')
        setNetworkModel(hw.networkModel || 'virtio')
        setNetworkBridge(hw.networkBridge || 'vmbr0')
        setVlanTag(hw.vlanTag || '')
        setCpu(hw.cpu || 'host')
        setAgent(hw.agent !== false)
      } catch { /* ignore */ }

      try {
        const ci = prefillBlueprint.cloudInit
          ? (typeof prefillBlueprint.cloudInit === 'string'
            ? JSON.parse(prefillBlueprint.cloudInit)
            : prefillBlueprint.cloudInit)
          : null
        if (ci) {
          setCiuser(ci.ciuser || '')
          setSshKeys(ci.sshKeys || '')
          setIpconfig0(ci.ipconfig0 || 'ip=dhcp')
          setNameserver(ci.nameserver || '')
          setSearchdomain(ci.searchdomain || '')
        }
      } catch { /* ignore */ }
    }
  }, [open, image, prefillBlueprint])

  // Fetch connections
  useEffect(() => {
    if (!open) return
    fetch('/api/v1/connections?type=pve')
      .then(r => r.json())
      .then(res => {
        const conns = res.data || []
        setConnections(conns)
        if (conns.length === 1) setConnectionId(conns[0].id)
      })
      .catch(() => {})
  }, [open])

  // Fetch nodes when connection changes
  useEffect(() => {
    if (!connectionId) { setNodes([]); setNode(''); return }
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes`)
      .then(r => r.json())
      .then(res => {
        const nodeList = (res.data || []).filter((n: any) => n.status === 'online')
        setNodes(nodeList)
        if (nodeList.length === 1) setNode(nodeList[0].node)
      })
      .catch(() => setNodes([]))
  }, [connectionId])

  // Fetch storages + next VMID when node changes
  useEffect(() => {
    if (!connectionId || !node) { setStorages([]); return }

    // Fetch storages that support images content
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/storages`)
      .then(r => r.json())
      .then(res => {
        const stList = (res.data || []).filter((s: any) =>
          s.content?.includes('images') || s.content?.includes('rootdir')
        )
        setStorages(stList)
        if (stList.length > 0 && !storage) setStorage(stList[0].storage)
      })
      .catch(() => setStorages([]))

    // Try to get next available VMID
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/nextid`)
      .then(r => r.json())
      .then(res => {
        if (res.data) setVmid(Number(res.data) || 100)
      })
      .catch(() => {})
  }, [connectionId, node])

  const handleNext = useCallback(() => {
    setActiveStep(s => Math.min(s + 1, STEP_LABELS.length - 1))
  }, [])

  const handleBack = useCallback(() => {
    setActiveStep(s => Math.max(s - 1, 0))
  }, [])

  const handleDeploy = useCallback(async () => {
    if (!image) return
    setDeploying(true)
    setDeployError(null)
    setActiveStep(5) // Progress step

    try {
      const body = {
        connectionId,
        node,
        storage,
        vmid,
        vmName: vmName || undefined,
        imageSlug: image.slug,
        blueprintId: prefillBlueprint?.id || undefined,
        hardware: {
          cores,
          sockets,
          memory,
          diskSize,
          scsihw,
          networkModel,
          networkBridge,
          vlanTag: vlanTag || null,
          ostype: image.ostype,
          agent,
          cpu,
        },
        cloudInit: {
          ciuser: ciuser || undefined,
          sshKeys: sshKeys || undefined,
          ipconfig0,
          nameserver: nameserver || undefined,
          searchdomain: searchdomain || undefined,
        },
        saveAsBlueprint,
        blueprintName: saveAsBlueprint ? blueprintName : undefined,
      }

      const res = await fetch('/api/v1/templates/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (data.data?.deploymentId) {
        setDeploymentId(data.data.deploymentId)
      }
      if (data.error) {
        setDeployError(data.error)
        setDeploying(false)
      }
    } catch (err: any) {
      setDeployError(err.message || 'Deploy failed')
      setDeploying(false)
    }
  }, [
    image, connectionId, node, storage, vmid, vmName, cores, sockets, memory,
    diskSize, scsihw, networkModel, networkBridge, vlanTag, cpu, agent,
    ciuser, sshKeys, ipconfig0, nameserver, searchdomain,
    saveAsBlueprint, blueprintName, prefillBlueprint,
  ])

  const handleDeployComplete = useCallback((status: 'completed' | 'failed', error?: string) => {
    setDeploying(false)
    if (status === 'failed' && error) setDeployError(error)
  }, [])

  const canProceed = useMemo(() => {
    switch (activeStep) {
      case 0: return !!image
      case 1: return !!connectionId && !!node && !!storage && vmid >= 100
      case 2: return cores >= 1 && memory >= 128 && !!diskSize
      case 3: return true
      case 4: return true
      default: return false
    }
  }, [activeStep, image, connectionId, node, storage, vmid, cores, memory, diskSize])

  // ─── Step renderers ────────────────────────────────────────────────

  const renderImageStep = () => {
    if (!image) return null
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              width: 56, height: 56, borderRadius: 2, bgcolor: 'action.hover',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <i className={image.logoIcon} style={{ fontSize: 28 }} />
          </Box>
          <Box>
            <Typography variant="h6">{image.name}</Typography>
            <Typography variant="body2" sx={{ opacity: 0.6 }}>
              {image.arch} &middot; {image.format} &middot; {image.ostype}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {image.tags.map(tag => (
            <Chip key={tag} label={tag} size="small" />
          ))}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('templates.catalog.recommendedSpecs')}</Typography>
            <Typography variant="body2">
              {image.recommendedCores} {t('templates.catalog.cores')} / {image.recommendedMemory >= 1024 ? `${image.recommendedMemory / 1024} GB` : `${image.recommendedMemory} MB`} RAM / {image.defaultDiskSize} {t('templates.deploy.hardware.disk')}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('templates.catalog.minimumSpecs')}</Typography>
            <Typography variant="body2">
              {image.minCores} {t('templates.catalog.cores')} / {image.minMemory >= 1024 ? `${image.minMemory / 1024} GB` : `${image.minMemory} MB`} RAM
            </Typography>
          </Box>
        </Box>
      </Box>
    )
  }

  const renderTargetStep = () => (
    <Stack spacing={2}>
      <FormControl size="small" fullWidth required>
        <InputLabel>{t('templates.deploy.target.connection')}</InputLabel>
        <Select
          value={connectionId}
          onChange={e => { setConnectionId(e.target.value); setNode(''); setStorage('') }}
          label={t('templates.deploy.target.connection')}
        >
          {connections.map(c => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth required disabled={!connectionId}>
        <InputLabel>{t('templates.deploy.target.node')}</InputLabel>
        <Select
          value={node}
          onChange={e => { setNode(e.target.value); setStorage('') }}
          label={t('templates.deploy.target.node')}
        >
          {nodes.map(n => (
            <MenuItem key={n.node} value={n.node}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <Typography variant="body2">{n.node}</Typography>
                <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>
                  CPU: {(n.cpu * 100).toFixed(0)}% &middot; RAM: {((n.mem / n.maxmem) * 100).toFixed(0)}%
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth required disabled={!node}>
        <InputLabel>{t('templates.deploy.target.storage')}</InputLabel>
        <Select
          value={storage}
          onChange={e => setStorage(e.target.value)}
          label={t('templates.deploy.target.storage')}
        >
          {storages.map(s => (
            <MenuItem key={s.storage} value={s.storage}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <Typography variant="body2">{s.storage}</Typography>
                <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>
                  {s.type} &middot; {((s.avail || 0) / 1073741824).toFixed(1)} GB {t('templates.deploy.target.available')}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <TextField
          size="small"
          label={t('templates.deploy.target.vmid')}
          type="number"
          value={vmid}
          onChange={e => setVmid(parseInt(e.target.value) || 100)}
          required
          slotProps={{ htmlInput: { min: 100 } }}
        />
        <TextField
          size="small"
          label={t('templates.deploy.target.vmName')}
          value={vmName}
          onChange={e => setVmName(e.target.value)}
          placeholder={image ? `${image.slug}-${vmid}` : ''}
        />
      </Box>
    </Stack>
  )

  const renderHardwareStep = () => (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
      <TextField
        size="small"
        label={t('templates.deploy.hardware.cores')}
        type="number"
        value={cores}
        onChange={e => setCores(parseInt(e.target.value) || 1)}
        slotProps={{ htmlInput: { min: 1, max: 128 } }}
      />
      <TextField
        size="small"
        label={t('templates.deploy.hardware.sockets')}
        type="number"
        value={sockets}
        onChange={e => setSockets(parseInt(e.target.value) || 1)}
        slotProps={{ htmlInput: { min: 1, max: 4 } }}
      />
      <TextField
        size="small"
        label={t('templates.deploy.hardware.memory')}
        type="number"
        value={memory}
        onChange={e => setMemory(parseInt(e.target.value) || 512)}
        helperText="MB"
        slotProps={{ htmlInput: { min: 128, step: 256 } }}
      />
      <TextField
        size="small"
        label={t('templates.deploy.hardware.diskSize')}
        value={diskSize}
        onChange={e => setDiskSize(e.target.value)}
      />
      <FormControl size="small">
        <InputLabel>{t('templates.deploy.hardware.scsiController')}</InputLabel>
        <Select value={scsihw} onChange={e => setScsihw(e.target.value)} label={t('templates.deploy.hardware.scsiController')}>
          <MenuItem value="virtio-scsi-single">VirtIO SCSI Single</MenuItem>
          <MenuItem value="virtio-scsi-pci">VirtIO SCSI</MenuItem>
          <MenuItem value="lsi">LSI 53C895A</MenuItem>
          <MenuItem value="megasas">MegaRAID SAS</MenuItem>
        </Select>
      </FormControl>
      <FormControl size="small">
        <InputLabel>{t('templates.deploy.hardware.cpuType')}</InputLabel>
        <Select value={cpu} onChange={e => setCpu(e.target.value)} label={t('templates.deploy.hardware.cpuType')}>
          <MenuItem value="host">host</MenuItem>
          <MenuItem value="x86-64-v2-AES">x86-64-v2-AES</MenuItem>
          <MenuItem value="kvm64">kvm64</MenuItem>
        </Select>
      </FormControl>
      <TextField
        size="small"
        label={t('templates.deploy.hardware.bridge')}
        value={networkBridge}
        onChange={e => setNetworkBridge(e.target.value)}
      />
      <TextField
        size="small"
        label={t('templates.deploy.hardware.vlan')}
        type="number"
        value={vlanTag}
        onChange={e => setVlanTag(e.target.value ? parseInt(e.target.value) : '')}
        placeholder={t('templates.deploy.hardware.vlanPlaceholder')}
        slotProps={{ htmlInput: { min: 1, max: 4094 } }}
      />
      <FormControlLabel
        control={<Switch checked={agent} onChange={(_, v) => setAgent(v)} size="small" />}
        label={t('templates.deploy.hardware.qemuAgent')}
        sx={{ gridColumn: 'span 2' }}
      />
    </Box>
  )

  const renderCloudInitStep = () => (
    <Stack spacing={2}>
      <TextField
        size="small"
        label={t('templates.deploy.cloudInit.user')}
        value={ciuser}
        onChange={e => setCiuser(e.target.value)}
        placeholder="ubuntu"
        fullWidth
      />
      <TextField
        size="small"
        label={t('templates.deploy.cloudInit.sshKeys')}
        value={sshKeys}
        onChange={e => setSshKeys(e.target.value)}
        multiline
        rows={3}
        fullWidth
        placeholder="ssh-ed25519 AAAA... user@host"
      />
      <TextField
        size="small"
        label={t('templates.deploy.cloudInit.ipConfig')}
        value={ipconfig0}
        onChange={e => setIpconfig0(e.target.value)}
        fullWidth
        helperText={t('templates.deploy.cloudInit.ipConfigHelp')}
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <TextField
          size="small"
          label={t('templates.deploy.cloudInit.nameserver')}
          value={nameserver}
          onChange={e => setNameserver(e.target.value)}
          placeholder="1.1.1.1"
        />
        <TextField
          size="small"
          label={t('templates.deploy.cloudInit.searchdomain')}
          value={searchdomain}
          onChange={e => setSearchdomain(e.target.value)}
          placeholder="local.lan"
        />
      </Box>
    </Stack>
  )

  const renderReviewStep = () => {
    if (!image) return null

    const selectedConn = connections.find(c => c.id === connectionId)

    return (
      <Stack spacing={2}>
        {/* Image */}
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>{t('templates.deploy.steps.image')}</Typography>
          <Typography variant="body2">{image.name}</Typography>
        </Box>
        <Divider />

        {/* Target */}
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>{t('templates.deploy.steps.target')}</Typography>
          <Typography variant="body2">
            {selectedConn?.name} &rarr; {node} &rarr; {storage}
          </Typography>
          <Typography variant="body2">
            VMID: {vmid} {vmName && `(${vmName})`}
          </Typography>
        </Box>
        <Divider />

        {/* Hardware */}
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>{t('templates.deploy.steps.hardware')}</Typography>
          <Typography variant="body2">
            {cores}C &times; {sockets}S / {memory >= 1024 ? `${memory / 1024} GB` : `${memory} MB`} RAM / {diskSize} / {networkBridge}{vlanTag ? ` (VLAN ${vlanTag})` : ''}
          </Typography>
        </Box>
        <Divider />

        {/* Cloud-Init */}
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.6 }}>{t('templates.deploy.steps.cloudInit')}</Typography>
          <Typography variant="body2">
            {ciuser ? `${t('templates.deploy.cloudInit.user')}: ${ciuser}` : t('templates.deploy.cloudInit.noUser')} &middot; {ipconfig0}
          </Typography>
          {sshKeys && (
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {sshKeys.split('\n').filter(Boolean).length} SSH key(s)
            </Typography>
          )}
        </Box>
        <Divider />

        {/* Save as blueprint option */}
        <FormControlLabel
          control={<Switch checked={saveAsBlueprint} onChange={(_, v) => setSaveAsBlueprint(v)} size="small" />}
          label={t('templates.deploy.review.saveBlueprint')}
        />
        {saveAsBlueprint && (
          <TextField
            size="small"
            label={t('templates.deploy.review.blueprintName')}
            value={blueprintName}
            onChange={e => setBlueprintName(e.target.value)}
            fullWidth
            placeholder={image.name}
          />
        )}
      </Stack>
    )
  }

  const renderProgressStep = () => {
    if (deploymentId) {
      return <DeploymentProgress deploymentId={deploymentId} onComplete={handleDeployComplete} />
    }

    if (deployError) {
      return (
        <Alert severity="error" sx={{ mt: 2 }}>
          {deployError}
        </Alert>
      )
    }

    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  const stepContent = useMemo(() => {
    switch (activeStep) {
      case 0: return renderImageStep()
      case 1: return renderTargetStep()
      case 2: return renderHardwareStep()
      case 3: return renderCloudInitStep()
      case 4: return renderReviewStep()
      case 5: return renderProgressStep()
      default: return null
    }
  }, [
    activeStep, image, connections, connectionId, nodes, node, storages, storage,
    vmid, vmName, cores, sockets, memory, diskSize, scsihw, networkModel,
    networkBridge, vlanTag, cpu, agent, ciuser, sshKeys, ipconfig0, nameserver,
    searchdomain, saveAsBlueprint, blueprintName, deploymentId, deployError, deploying, t,
  ])

  const isProgressStep = activeStep === 5

  return (
    <Dialog open={open} onClose={isProgressStep && deploying ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-rocket-2-line" style={{ fontSize: 22 }} />
        {t('templates.deploy.title')}
      </DialogTitle>

      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }} alternativeLabel>
          {STEP_LABELS.map(label => (
            <Step key={label}>
              <StepLabel>{t(label as any)}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box sx={{ minHeight: 300 }}>
          {stepContent}
        </Box>
      </DialogContent>

      {!isProgressStep && (
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Box sx={{ flex: 1 }} />
          {activeStep > 0 && (
            <Button onClick={handleBack}>{t('common.back')}</Button>
          )}
          {activeStep < 4 ? (
            <Button variant="contained" onClick={handleNext} disabled={!canProceed}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              onClick={handleDeploy}
              disabled={deploying}
              startIcon={deploying ? <CircularProgress size={18} /> : <i className="ri-rocket-2-line" style={{ fontSize: 16 }} />}
            >
              {t('templates.deploy.review.deployNow')}
            </Button>
          )}
        </DialogActions>
      )}

      {isProgressStep && !deploying && (
        <DialogActions>
          <Button variant="contained" onClick={onClose}>
            {deployError ? t('common.close') : t('common.done')}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}
