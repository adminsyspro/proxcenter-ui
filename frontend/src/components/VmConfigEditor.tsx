'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  Alert,
  useTheme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SaveIcon from '@mui/icons-material/Save'
import RefreshIcon from '@mui/icons-material/Refresh'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type VmConfig = {

  // Basic
  name?: string
  description?: string
  tags?: string
  onboot?: boolean
  protection?: boolean
  
  // CPU
  cores?: number
  sockets?: number
  cpu?: string // CPU type
  vcpus?: number
  cpulimit?: number
  cpuunits?: number
  numa?: boolean
  
  // Memory
  memory?: number // MB
  balloon?: number // MB, 0 = disabled
  shares?: number
  
  // Boot
  boot?: string
  bootdisk?: string
  bios?: string // seabios, ovmf
  machine?: string // pc, q35
  
  // Agent
  agent?: string // "enabled=1,fstrim_cloned_disks=1"
  
  // Network interfaces (net0, net1, etc.)
  [key: `net${number}`]: string | undefined
  
  // Disks (scsi0, virtio0, ide0, etc.)
  [key: string]: any
}

type DiskInfo = {
  id: string
  storage: string
  size: string
  format?: string
  cache?: string
  iothread?: boolean
}

type NetworkInfo = {
  id: string
  model: string
  bridge: string
  macaddr?: string
  tag?: number // VLAN
  firewall?: boolean
  rate?: number // MB/s limit
}

type VmConfigEditorProps = {
  open: boolean
  onClose: () => void
  connId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: string
  vmName?: string
  onSaved?: () => void
}

/* ------------------------------------------------------------------ */
/* Tab Panel                                                           */
/* ------------------------------------------------------------------ */

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return (
    <Box role="tabpanel" hidden={value !== index} sx={{ py: 2 }}>
      {value === index && children}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Section Header                                                      */
/* ------------------------------------------------------------------ */

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, mt: 1 }}>
      <i className={icon} style={{ fontSize: 18, opacity: 0.7 }} />
      <Typography variant="subtitle2" fontWeight={700} sx={{ opacity: 0.9 }}>
        {title}
      </Typography>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Slider with Input                                                   */
/* ------------------------------------------------------------------ */

function SliderWithInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  marks,
  helperText,
  disabled,
}: {
  label: string
  value: number
  onChange: (val: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  marks?: { value: number; label: string }[]
  helperText?: string
  disabled?: boolean
}) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
        <TextField
          size="small"
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          InputProps={{
            endAdornment: unit ? <InputAdornment position="end">{unit}</InputAdornment> : undefined,
          }}
          sx={{ width: 120 }}
          inputProps={{ min, max, step }}
        />
      </Box>
      <Slider
        value={value}
        onChange={(_, val) => onChange(val as number)}
        min={min}
        max={max}
        step={step}
        marks={marks}
        disabled={disabled}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${v}${unit}`}
      />
      {helperText && (
        <Typography variant="caption" color="text.secondary">
          {helperText}
        </Typography>
      )}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Parse helpers                                                       */
/* ------------------------------------------------------------------ */

function parseNetworkConfig(netStr: string): Partial<NetworkInfo> {
  // Format: "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1,tag=100"
  const parts = netStr.split(',')
  const result: Partial<NetworkInfo> = {}
  
  for (const part of parts) {
    const [key, val] = part.split('=')

    if (key === 'bridge') result.bridge = val
    else if (key === 'tag') result.tag = Number(val)
    else if (key === 'firewall') result.firewall = val === '1'
    else if (key === 'rate') result.rate = Number(val)
    else if (['virtio', 'e1000', 'rtl8139', 'vmxnet3'].includes(key)) {
      result.model = key
      result.macaddr = val
    }
  }
  
  return result
}

function buildNetworkConfig(net: Partial<NetworkInfo>): string {
  const parts: string[] = []

  if (net.model && net.macaddr) parts.push(`${net.model}=${net.macaddr}`)
  if (net.bridge) parts.push(`bridge=${net.bridge}`)
  if (net.tag) parts.push(`tag=${net.tag}`)
  if (net.firewall) parts.push('firewall=1')
  if (net.rate) parts.push(`rate=${net.rate}`)
  
return parts.join(',')
}

function parseDiskSize(sizeStr: string): number {
  // "32G" -> 32, "100M" -> 0.1
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)(G|M|T)?$/i)

  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = (match[2] || 'G').toUpperCase()

  if (unit === 'T') return num * 1024
  if (unit === 'M') return num / 1024
  
return num
}

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function VmConfigEditor({
  open,
  onClose,
  connId,
  node,
  type,
  vmid,
  vmName,
  onSaved,
}: VmConfigEditorProps) {
  const theme = useTheme()
  const t = useTranslations()
  const [tabIndex, setTabIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [requiresRestart, setRequiresRestart] = useState(false)
  
  // Original config (for diff)
  const [originalConfig, setOriginalConfig] = useState<VmConfig>({})
  
  // Editable config
  const [config, setConfig] = useState<VmConfig>({})
  
  // Parsed network interfaces
  const [networks, setNetworks] = useState<NetworkInfo[]>([])
  
  // Available options
  const [cpuTypes, setCpuTypes] = useState<string[]>(['host', 'kvm64', 'qemu64', 'max'])
  const [machineTypes, setMachineTypes] = useState<string[]>(['pc', 'q35'])
  
  // Max resources (from node)
  const [maxCores, setMaxCores] = useState(128)
  const [maxMemory, setMaxMemory] = useState(512 * 1024) // 512 GB
  
  /* ------------------------------------------------------------------ */
  /* Fetch config                                                        */
  /* ------------------------------------------------------------------ */
  
  const fetchConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(
        `/api/v1/connections/${connId}/guests/${type}/${node}/${vmid}/config`
      )
      
      if (!res.ok) throw new Error(`Erreur ${res.status}`)
      
      const json = await res.json()
      const data = json.data || json
      
      setOriginalConfig(data)
      setConfig(data)
      
      // Parse network interfaces
      const nets: NetworkInfo[] = []

      for (let i = 0; i < 10; i++) {
        const netKey = `net${i}` as keyof VmConfig

        if (data[netKey]) {
          const parsed = parseNetworkConfig(data[netKey])

          nets.push({
            id: `net${i}`,
            model: parsed.model || 'virtio',
            bridge: parsed.bridge || 'vmbr0',
            macaddr: parsed.macaddr,
            tag: parsed.tag,
            firewall: parsed.firewall,
            rate: parsed.rate,
          })
        }
      }

      setNetworks(nets)
      
    } catch (e: any) {
      setError(e.message || t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }, [connId, node, type, vmid])
  
  useEffect(() => {
    if (open) {
      fetchConfig()
      setSuccess(false)
      setRequiresRestart(false)
    }
  }, [open, fetchConfig])
  
  /* ------------------------------------------------------------------ */
  /* Update config                                                       */
  /* ------------------------------------------------------------------ */
  
  const updateConfig = (key: keyof VmConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    
    // Some changes require restart
    if (['cpu', 'sockets', 'numa', 'machine', 'bios'].includes(String(key))) {
      setRequiresRestart(true)
    }
  }
  
  /* ------------------------------------------------------------------ */
  /* Save config                                                         */
  /* ------------------------------------------------------------------ */
  
  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    
    try {
      // Build diff - only send changed values
      const changes: Record<string, any> = {}
      
      for (const [key, value] of Object.entries(config)) {
        if (JSON.stringify(value) !== JSON.stringify(originalConfig[key as keyof VmConfig])) {
          changes[key] = value
        }
      }
      
      // Update network configs
      networks.forEach((net, idx) => {
        const netKey = `net${idx}`
        const newVal = buildNetworkConfig(net)

        if (newVal !== originalConfig[netKey as keyof VmConfig]) {
          changes[netKey] = newVal
        }
      })
      
      if (Object.keys(changes).length === 0) {
        setError(t('common.noData'))
        setSaving(false)

return
      }
      
      const res = await fetch(
        `/api/v1/connections/${connId}/guests/${type}/${node}/${vmid}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changes),
        }
      )
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))

        throw new Error(errData.error || `Erreur ${res.status}`)
      }
      
      setSuccess(true)
      setOriginalConfig({ ...config })
      onSaved?.()
      
      // Auto-close after success
      setTimeout(() => {
        onClose()
      }, 1500)
      
    } catch (e: any) {
      setError(e.message || t('settings.saveError'))
    } finally {
      setSaving(false)
    }
  }
  
  /* ------------------------------------------------------------------ */
  /* Check if modified                                                   */
  /* ------------------------------------------------------------------ */
  
  const isModified = JSON.stringify(config) !== JSON.stringify(originalConfig)
  
  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3, maxHeight: '90vh' }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, pb: 1 }}>
        <i className="ri-settings-3-line" style={{ fontSize: 24 }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>
            Configuration {type === 'lxc' ? 'LXC' : 'VM'} {vmid}
          </Typography>
          {vmName && (
            <Typography variant="body2" color="text.secondary">
              {vmName}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <Divider />
      
      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tabs
          value={tabIndex}
          onChange={(_, v) => setTabIndex(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab icon={<i className="ri-information-line" />} iconPosition="start" label={t('vmConfig.tabs.general')} />
          <Tab icon={<i className="ri-cpu-line" />} iconPosition="start" label={t('vmConfig.tabs.cpu')} />
          <Tab icon={<i className="ri-ram-line" />} iconPosition="start" label={t('vmConfig.tabs.memory')} />
          <Tab icon={<i className="ri-hard-drive-2-line" />} iconPosition="start" label={t('vmConfig.tabs.disks')} />
          <Tab icon={<i className="ri-global-line" />} iconPosition="start" label={t('vmConfig.tabs.network')} />
          <Tab icon={<i className="ri-play-circle-line" />} iconPosition="start" label={t('vmConfig.tabs.boot')} />
          <Tab icon={<i className="ri-tools-line" />} iconPosition="start" label={t('vmConfig.tabs.advanced')} />
        </Tabs>
      </Box>
      
      <DialogContent sx={{ minHeight: 400 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Error/Success alerts */}
            <Collapse in={!!error}>
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            </Collapse>
            
            <Collapse in={success}>
              <Alert severity="success" sx={{ mb: 2 }}>
                {t('settings.savedSuccess')}
              </Alert>
            </Collapse>
            
            <Collapse in={requiresRestart && isModified}>
              <Alert severity="warning" sx={{ mb: 2 }} icon={<WarningAmberIcon />}>
                {t('vmConfig.restartWarning')}
              </Alert>
            </Collapse>
            
            {/* Tab: Général */}
            <TabPanel value={tabIndex} index={0}>
              <Stack spacing={3}>
                <TextField
                  label={t('vmConfig.name')}
                  value={config.name || ''}
                  onChange={(e) => updateConfig('name', e.target.value)}
                  fullWidth
                  helperText={t('vmConfig.nameHelper')}
                />
                
                <TextField
                  label={t('vmConfig.description')}
                  value={config.description || ''}
                  onChange={(e) => updateConfig('description', e.target.value)}
                  fullWidth
                  multiline
                  rows={3}
                  helperText={t('vmConfig.descriptionHelper')}
                />
                
                <TextField
                  label={t('vmConfig.tags')}
                  value={config.tags || ''}
                  onChange={(e) => updateConfig('tags', e.target.value)}
                  fullWidth
                  helperText={t('vmConfig.tagsHelper')}
                />
                
                <Divider />
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(config.onboot)}
                      onChange={(e) => updateConfig('onboot', e.target.checked ? 1 : 0)}
                    />
                  }
                  label={t('vmConfig.startOnBoot')}
                />
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(config.protection)}
                      onChange={(e) => updateConfig('protection', e.target.checked ? 1 : 0)}
                    />
                  }
                  label={t('vmConfig.deleteProtection')}
                />
              </Stack>
            </TabPanel>
            
            {/* Tab: CPU */}
            <TabPanel value={tabIndex} index={1}>
              <Stack spacing={3}>
                <SliderWithInput
                  label={t('vmConfig.cpuCores')}
                  value={config.cores || 1}
                  onChange={(val) => updateConfig('cores', val)}
                  min={1}
                  max={Math.min(maxCores, 128)}
                  helperText={t('vmConfig.cpuCoresHelper')}
                />
                
                <SliderWithInput
                  label={t('vmConfig.sockets')}
                  value={config.sockets || 1}
                  onChange={(val) => updateConfig('sockets', val)}
                  min={1}
                  max={4}
                  helperText={t('vmConfig.socketsHelper')}
                />
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
                  <i className="ri-cpu-line" style={{ fontSize: 24, opacity: 0.7 }} />
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      Total: {(config.cores || 1) * (config.sockets || 1)} vCPUs
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {config.cores || 1} cœurs × {config.sockets || 1} socket(s)
                    </Typography>
                  </Box>
                </Box>
                
                <Divider />
                
                <FormControl fullWidth>
                  <InputLabel>{t('vmConfig.cpuType')}</InputLabel>
                  <Select
                    value={config.cpu || 'kvm64'}
                    label={t('vmConfig.cpuType')}
                    onChange={(e) => updateConfig('cpu', e.target.value)}
                  >
                    <MenuItem value="host">{t('vmConfig.cpuTypeHost')}</MenuItem>
                    <MenuItem value="max">{t('vmConfig.cpuTypeMax')}</MenuItem>
                    <MenuItem value="kvm64">{t('vmConfig.cpuTypeKvm64')}</MenuItem>
                    <MenuItem value="qemu64">{t('vmConfig.cpuTypeQemu64')}</MenuItem>
                    <MenuItem value="x86-64-v2">x86-64-v2</MenuItem>
                    <MenuItem value="x86-64-v3">x86-64-v3</MenuItem>
                    <MenuItem value="x86-64-v4">x86-64-v4</MenuItem>
                  </Select>
                  <FormHelperText>
                    {t('vmConfig.cpuTypeHelper')}
                  </FormHelperText>
                </FormControl>
                
                <Divider />
                
                <SliderWithInput
                  label={t('vmConfig.cpuLimit')}
                  value={config.cpulimit || 0}
                  onChange={(val) => updateConfig('cpulimit', val)}
                  min={0}
                  max={(config.cores || 1) * (config.sockets || 1)}
                  step={0.1}
                  helperText={t('vmConfig.cpuLimitHelper')}
                />
                
                <SliderWithInput
                  label={t('vmConfig.cpuUnits')}
                  value={config.cpuunits || 1024}
                  onChange={(val) => updateConfig('cpuunits', val)}
                  min={2}
                  max={262144}
                  step={1}
                  helperText={t('vmConfig.cpuUnitsHelper')}
                />
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(config.numa)}
                      onChange={(e) => updateConfig('numa', e.target.checked ? 1 : 0)}
                    />
                  }
                  label={t('vmConfig.enableNuma')}
                />
              </Stack>
            </TabPanel>
            
            {/* Tab: Mémoire */}
            <TabPanel value={tabIndex} index={2}>
              <Stack spacing={3}>
                <SliderWithInput
                  label={t('vmConfig.memoryRam')}
                  value={config.memory || 512}
                  onChange={(val) => updateConfig('memory', val)}
                  min={64}
                  max={Math.min(maxMemory, 512 * 1024)}
                  step={256}
                  unit=" MB"
                  helperText={t('vmConfig.memoryHelper', { gb: ((config.memory || 512) / 1024).toFixed(1) })}
                />
                
                <Divider />
                
                <SectionHeader icon="ri-swap-line" title={t('vmConfig.ballooning')} />
                
                <SliderWithInput
                  label={t('vmConfig.balloonMin')}
                  value={config.balloon || 0}
                  onChange={(val) => updateConfig('balloon', val)}
                  min={0}
                  max={config.memory || 512}
                  step={64}
                  unit=" MB"
                  helperText={t('vmConfig.balloonHelper')}
                />
                
                {(config.balloon || 0) > 0 && (
                  <Alert severity="info">
                    {t('vmConfig.balloonInfo', { min: config.balloon, max: config.memory })}
                  </Alert>
                )}
                
                <SliderWithInput
                  label={t('vmConfig.memoryShares')}
                  value={config.shares || 1000}
                  onChange={(val) => updateConfig('shares', val)}
                  min={0}
                  max={50000}
                  step={10}
                  helperText={t('vmConfig.memorySharesHelper')}
                />
              </Stack>
            </TabPanel>
            
            {/* Tab: Disques */}
            <TabPanel value={tabIndex} index={3}>
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('vmConfig.disksNotImplemented')}
              </Alert>

              <SectionHeader icon="ri-hard-drive-2-line" title={t('vmConfig.currentDisks')} />
              
              <Stack spacing={2}>
                {Object.entries(config)
                  .filter(([key]) => /^(scsi|virtio|ide|sata)\d+$/.test(key))
                  .map(([key, value]) => (
                    <Box
                      key={key}
                      sx={{
                        p: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        bgcolor: 'action.hover',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 20, opacity: 0.7 }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight={600}>
                            {key.toUpperCase()}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                            {String(value).substring(0, 100)}...
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  ))}
              </Stack>
            </TabPanel>
            
            {/* Tab: Réseau */}
            <TabPanel value={tabIndex} index={4}>
              <SectionHeader icon="ri-global-line" title={t('vmConfig.networkInterfaces')} />
              
              <Stack spacing={2}>
                {networks.map((net, idx) => (
                  <Box
                    key={net.id}
                    sx={{
                      p: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                      <i className="ri-ethernet-line" style={{ fontSize: 20 }} />
                      <Typography variant="subtitle2" fontWeight={700}>
                        {net.id.toUpperCase()}
                      </Typography>
                      <Chip label={net.model} size="small" variant="outlined" />
                    </Box>
                    
                    <Stack spacing={2}>
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <FormControl size="small" sx={{ minWidth: 120 }}>
                          <InputLabel>{t('vmConfig.model')}</InputLabel>
                          <Select
                            value={net.model}
                            label={t('vmConfig.model')}
                            onChange={(e) => {
                              const newNets = [...networks]

                              newNets[idx].model = e.target.value
                              setNetworks(newNets)
                            }}
                          >
                            <MenuItem value="virtio">{t('vmConfig.virtioRecommended')}</MenuItem>
                            <MenuItem value="e1000">Intel E1000</MenuItem>
                            <MenuItem value="rtl8139">Realtek RTL8139</MenuItem>
                            <MenuItem value="vmxnet3">VMware vmxnet3</MenuItem>
                          </Select>
                        </FormControl>
                        
                        <TextField
                          size="small"
                          label="Bridge"
                          value={net.bridge}
                          onChange={(e) => {
                            const newNets = [...networks]

                            newNets[idx].bridge = e.target.value
                            setNetworks(newNets)
                          }}
                          sx={{ width: 120 }}
                        />
                        
                        <TextField
                          size="small"
                          label="VLAN Tag"
                          type="number"
                          value={net.tag || ''}
                          onChange={(e) => {
                            const newNets = [...networks]

                            newNets[idx].tag = e.target.value ? Number(e.target.value) : undefined
                            setNetworks(newNets)
                          }}
                          sx={{ width: 100 }}
                          inputProps={{ min: 1, max: 4094 }}
                        />
                        
                        <TextField
                          size="small"
                          label="Rate Limit"
                          type="number"
                          value={net.rate || ''}
                          onChange={(e) => {
                            const newNets = [...networks]

                            newNets[idx].rate = e.target.value ? Number(e.target.value) : undefined
                            setNetworks(newNets)
                          }}
                          sx={{ width: 120 }}
                          InputProps={{
                            endAdornment: <InputAdornment position="end">MB/s</InputAdornment>,
                          }}
                        />
                      </Box>
                      
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                          size="small"
                          label="MAC Address"
                          value={net.macaddr || ''}
                          onChange={(e) => {
                            const newNets = [...networks]

                            newNets[idx].macaddr = e.target.value
                            setNetworks(newNets)
                          }}
                          sx={{ flex: 1 }}
                          placeholder="AA:BB:CC:DD:EE:FF"
                        />
                        
                        <FormControlLabel
                          control={
                            <Switch
                              checked={net.firewall || false}
                              onChange={(e) => {
                                const newNets = [...networks]

                                newNets[idx].firewall = e.target.checked
                                setNetworks(newNets)
                              }}
                              size="small"
                            />
                          }
                          label="Firewall"
                        />
                      </Box>
                    </Stack>
                  </Box>
                ))}
                
                {networks.length === 0 && (
                  <Alert severity="info">{t('common.noData')}</Alert>
                )}
              </Stack>
            </TabPanel>
            
            {/* Tab: Boot */}
            <TabPanel value={tabIndex} index={5}>
              <Stack spacing={3}>
                <TextField
                  label={t('vmConfig.bootOrder')}
                  value={config.boot || ''}
                  onChange={(e) => updateConfig('boot', e.target.value)}
                  fullWidth
                  helperText={t('vmConfig.bootOrderHelper')}
                />

                <TextField
                  label={t('vmConfig.bootDisk')}
                  value={config.bootdisk || ''}
                  onChange={(e) => updateConfig('bootdisk', e.target.value)}
                  fullWidth
                  helperText={t('vmConfig.bootDiskHelper')}
                />
                
                <Divider />
                
                <FormControl fullWidth>
                  <InputLabel>{t('vmConfig.bios')}</InputLabel>
                  <Select
                    value={config.bios || 'seabios'}
                    label={t('vmConfig.bios')}
                    onChange={(e) => updateConfig('bios', e.target.value)}
                  >
                    <MenuItem value="seabios">SeaBIOS (Legacy)</MenuItem>
                    <MenuItem value="ovmf">OVMF (UEFI)</MenuItem>
                  </Select>
                  <FormHelperText>
                    {t('vmConfig.biosHelper')}
                  </FormHelperText>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>{t('vmConfig.machineType')}</InputLabel>
                  <Select
                    value={config.machine || 'pc'}
                    label={t('vmConfig.machineType')}
                    onChange={(e) => updateConfig('machine', e.target.value)}
                  >
                    <MenuItem value="pc">{t('vmConfig.machineTypeCompatible')}</MenuItem>
                    <MenuItem value="q35">{t('vmConfig.machineTypeModern')}</MenuItem>
                  </Select>
                  <FormHelperText>
                    {t('vmConfig.machineTypeHelper')}
                  </FormHelperText>
                </FormControl>
              </Stack>
            </TabPanel>
            
            {/* Tab: Avancé */}
            <TabPanel value={tabIndex} index={6}>
              <Stack spacing={3}>
                <SectionHeader icon="ri-spy-line" title={t('vmConfig.qemuAgent')} />

                <FormControlLabel
                  control={
                    <Switch
                      checked={config.agent?.includes('enabled=1') || false}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateConfig('agent', 'enabled=1,fstrim_cloned_disks=1')
                        } else {
                          updateConfig('agent', 'enabled=0')
                        }
                      }}
                    />
                  }
                  label={t('vmConfig.enableQemuAgent')}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: -2 }}>
                  {t('vmConfig.qemuAgentHelper')}
                </Typography>
                
                <Divider />
                
                <SectionHeader icon="ri-shield-check-line" title={t('vmConfig.security')} />
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(config.protection)}
                      onChange={(e) => updateConfig('protection', e.target.checked ? 1 : 0)}
                    />
                  }
                  label={t('vmConfig.deleteProtection')}
                />
                
                <Divider />
                
                <SectionHeader icon="ri-code-line" title={t('vmConfig.rawConfig')} />

                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t('vmConfig.advancedArgsWarning')}
                </Alert>

                <TextField
                  label={t('vmConfig.advancedArgs')}
                  value={config.args || ''}
                  onChange={(e) => updateConfig('args' as keyof VmConfig, e.target.value)}
                  fullWidth
                  multiline
                  rows={2}
                  helperText={t('vmConfig.qemuArgsHelper')}
                />
              </Stack>
            </TabPanel>
          </>
        )}
      </DialogContent>
      
      <Divider />
      
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          startIcon={<RefreshIcon />}
          onClick={fetchConfig}
          disabled={loading || saving}
        >
          {t('common.refresh')}
        </Button>
        
        <Box sx={{ flex: 1 }} />
        
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          onClick={handleSave}
          disabled={loading || saving || !isModified}
        >
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
