'use client'

import React, { useEffect, useMemo, useState } from 'react'
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
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

import { AllVmItem } from './InventoryTree'

function CreateLxcDialog({ 
  open, 
  onClose,
  allVms = [],
  onCreated
}: { 
  open: boolean
  onClose: () => void
  allVms: AllVmItem[]
  onCreated?: (vmid: string, connId: string, node: string) => void
}) {
  const t = useTranslations()
  const theme = useTheme()

  const [activeTab, setActiveTab] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Données dynamiques
  const [connections, setConnections] = useState<any[]>([])
  const [nodes, setNodes] = useState<any[]>([])
  const [storages, setStorages] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)
  
  // Formulaire - Général
  const [selectedConnection, setSelectedConnection] = useState('')
  const [selectedNode, setSelectedNode] = useState('')
  const [ctid, setCtid] = useState('')
  const [ctidError, setCtidError] = useState<string | null>(null)
  const [hostname, setHostname] = useState('')
  const [unprivileged, setUnprivileged] = useState(true)
  const [nesting, setNesting] = useState(false)
  const [resourcePool, setResourcePool] = useState('')
  const [rootPassword, setRootPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [sshKeys, setSshKeys] = useState('')
  const [startOnBoot, setStartOnBoot] = useState(false)
  
  // Formulaire - Template
  const [templateStorage, setTemplateStorage] = useState('')
  const [template, setTemplate] = useState('')
  
  // Formulaire - Disks
  const [rootStorage, setRootStorage] = useState('')
  const [rootSize, setRootSize] = useState(8)
  
  // Formulaire - CPU
  const [cpuCores, setCpuCores] = useState(1)
  const [cpuLimit, setCpuLimit] = useState(0)
  const [cpuUnits, setCpuUnits] = useState(1024)
  
  // Formulaire - Memory
  const [memorySize, setMemorySize] = useState(512)
  const [swapSize, setSwapSize] = useState(512)
  
  // Formulaire - Network
  const [networkName, setNetworkName] = useState('eth0')
  const [networkBridge, setNetworkBridge] = useState('vmbr0')
  const [ipConfig, setIpConfig] = useState('dhcp')
  const [ip4, setIp4] = useState('')
  const [gw4, setGw4] = useState('')
  const [ip6Config, setIp6Config] = useState('auto')
  const [ip6, setIp6] = useState('')
  const [gw6, setGw6] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [vlanTag, setVlanTag] = useState('')
  const [mtu, setMtu] = useState('')
  const [rateLimit, setRateLimit] = useState('')
  
  // Formulaire - DNS
  const [dnsServer, setDnsServer] = useState('')
  const [searchDomain, setSearchDomain] = useState('')

  // Calculer le prochain CTID disponible (global sur toutes les VMs)
  useEffect(() => {
    if (allVms.length > 0) {
      const usedIds = allVms.map(vm => parseInt(String(vm.vmid), 10))
      
      let nextId = 100

      while (usedIds.includes(nextId)) {
        nextId++
      }

      setCtid(String(nextId))
      setCtidError(null)
    }
  }, [allVms])

  // Valider le CTID quand il change
  const handleCtidChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '')

    setCtid(numericValue)
    
    if (!numericValue) {
      setCtidError(null)
      
return
    }
    
    const ctidNum = parseInt(numericValue, 10)
    
    if (ctidNum < 100) {
      setCtidError(t('inventory.createLxc.ctIdMin'))
      
return
    }

    if (ctidNum > 999999999) {
      setCtidError(t('inventory.createLxc.ctIdMax'))
      
return
    }
    
    const isUsed = allVms.some(vm => parseInt(String(vm.vmid), 10) === ctidNum)

    if (isUsed) {
      setCtidError(t('inventory.createLxc.ctIdInUse', { id: ctidNum }))
      
return
    }
    
    setCtidError(null)
  }

  // Charger toutes les connexions et tous leurs nodes
  const loadAllData = async () => {
    setLoadingData(true)

    try {
      const connRes = await fetch('/api/v1/connections?type=pve')
      const connJson = await connRes.json()
      const connectionsList = connJson.data || []

      setConnections(connectionsList)

      const allNodes: any[] = []

      await Promise.all(
        connectionsList.map(async (conn: any) => {
          try {
            const nodesRes = await fetch(`/api/v1/connections/${encodeURIComponent(conn.id)}/nodes`)
            const nodesJson = await nodesRes.json()
            const nodesList = nodesJson.data || []

            nodesList.forEach((node: any) => {
              const cpuPct = node.maxcpu ? (node.cpu || 0) * 100 : 0
              const memPct = node.maxmem ? ((node.mem || 0) / node.maxmem) * 100 : 0
              allNodes.push({
                ...node,
                connId: conn.id,
                connName: conn.name,
                cpuPct,
                memPct,
              })
            })
          } catch (e) {
            console.error(`Error loading nodes for connection ${conn.id}:`, e)
          }
        })
      )

      setNodes(allNodes)

      if (allNodes.length > 0 && !selectedNode) {
        setSelectedNode(allNodes[0].node)
        setSelectedConnection(allNodes[0].connId)
      }

    } catch (e) {
      console.error('Error loading data:', e)
    } finally {
      setLoadingData(false)
    }
  }

  // Grouper les nodes par cluster avec stats agrégées
  const groupedNodes = useMemo(() => {
    const groups: {
      connId: string
      connName: string
      isCluster: boolean
      nodes: any[]
      avgCpu: number
      avgMem: number
    }[] = []

    const connMap = new Map<string, any[]>()
    nodes.forEach(n => {
      if (!connMap.has(n.connId)) {
        connMap.set(n.connId, [])
      }
      connMap.get(n.connId)!.push(n)
    })

    connMap.forEach((nodeList, connId) => {
      const connName = nodeList[0]?.connName || connId
      const onlineNodes = nodeList.filter(n => n.status === 'online')
      const avgCpu = onlineNodes.length > 0
        ? onlineNodes.reduce((sum, n) => sum + (n.cpuPct || 0), 0) / onlineNodes.length
        : 0
      const avgMem = onlineNodes.length > 0
        ? onlineNodes.reduce((sum, n) => sum + (n.memPct || 0), 0) / onlineNodes.length
        : 0

      groups.push({
        connId,
        connName,
        isCluster: nodeList.length > 1,
        nodes: nodeList.sort((a, b) => a.node.localeCompare(b.node)),
        avgCpu,
        avgMem,
      })
    })

    return groups.sort((a, b) => a.connName.localeCompare(b.connName))
  }, [nodes])

  // Trouver le meilleur node d'un cluster
  const findBestNode = (connId: string): string | null => {
    const group = groupedNodes.find(g => g.connId === connId)
    if (!group) return null

    const onlineNodes = group.nodes.filter(n => n.status === 'online')
    if (onlineNodes.length === 0) return null

    const bestNode = onlineNodes.reduce((best, node) => {
      const score = (node.cpuPct || 0) + (node.memPct || 0)
      const bestScore = (best.cpuPct || 0) + (best.memPct || 0)
      return score < bestScore ? node : best
    })

    return bestNode.node
  }

  useEffect(() => {
    if (open) {
      setActiveTab(0)
      setError(null)
      loadAllData()
    }
  }, [open])

  useEffect(() => {
    if (selectedConnection && selectedNode) {
      loadStorages(selectedConnection)
    }
  }, [selectedConnection, selectedNode])

  // Quand on sélectionne un node ou cluster
  const handleNodeChange = (value: string) => {
    if (value.startsWith('cluster:')) {
      const connId = value.replace('cluster:', '')
      const bestNode = findBestNode(connId)
      if (bestNode) {
        setSelectedNode(bestNode)
        setSelectedConnection(connId)
      }
    } else {
      setSelectedNode(value)
      const nodeData = nodes.find(n => n.node === value)
      if (nodeData) {
        setSelectedConnection(nodeData.connId)
      }
    }
  }

  const loadStorages = async (connId: string) => {
    try {
      const storagesRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/storage`)
      const storagesJson = await storagesRes.json()
      
      setStorages(storagesJson.data || [])
      
      const templateStorages = (storagesJson.data || []).filter((s: any) => s.content?.includes('vztmpl'))

      const diskStorages = (storagesJson.data || []).filter((s: any) => 
        s.content?.includes('rootdir') || s.content?.includes('images')
      )
      
      if (templateStorages.length > 0 && !templateStorage) {
        setTemplateStorage(templateStorages[0].storage)
      }

      if (diskStorages.length > 0 && !rootStorage) {
        setRootStorage(diskStorages[0].storage)
      }
    } catch (e) {
      console.error('Error loading storages:', e)
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    
    try {
      if (rootPassword && rootPassword !== confirmPassword) {
        throw new Error(t('inventory.createLxc.passwordsDoNotMatch'))
      }

      const payload: any = {
        vmid: parseInt(ctid, 10),
        hostname: hostname,
        cores: cpuCores,
        memory: memorySize,
        swap: swapSize,
        unprivileged: unprivileged ? 1 : 0,
        onboot: startOnBoot ? 1 : 0,
        rootfs: `${rootStorage}:${rootSize}`,
      }

      if (templateStorage && template) {
        payload.ostemplate = `${templateStorage}:vztmpl/${template}`
      }

      if (cpuLimit > 0) payload.cpulimit = cpuLimit
      if (cpuUnits !== 1024) payload.cpuunits = cpuUnits
      if (nesting) payload.features = 'nesting=1'

      // Network
      let net0 = `name=${networkName},bridge=${networkBridge}`

      if (ipConfig === 'static' && ip4) {
        net0 += `,ip=${ip4}`
        if (gw4) net0 += `,gw=${gw4}`
      } else if (ipConfig === 'dhcp') {
        net0 += ',ip=dhcp'
      }

      if (ip6Config === 'static' && ip6) {
        net0 += `,ip6=${ip6}`
        if (gw6) net0 += `,gw6=${gw6}`
      } else if (ip6Config === 'auto') {
        net0 += ',ip6=auto'
      } else if (ip6Config === 'dhcp') {
        net0 += ',ip6=dhcp'
      }

      if (firewall) net0 += ',firewall=1'
      if (vlanTag) net0 += `,tag=${vlanTag}`
      if (rateLimit) net0 += `,rate=${rateLimit}`
      payload.net0 = net0

      if (dnsServer) payload.nameserver = dnsServer
      if (searchDomain) payload.searchdomain = searchDomain
      if (rootPassword) payload.password = rootPassword
      if (sshKeys) payload['ssh-public-keys'] = sshKeys
      if (resourcePool) payload.pool = resourcePool

      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/guests/lxc/${encodeURIComponent(selectedNode)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.error || `HTTP ${res.status}`)
      }

      onCreated?.(ctid, selectedConnection, selectedNode)
      onClose()
    } catch (e: any) {
      setError(e?.message || t('inventory.createLxc.errorCreatingContainer'))
    } finally {
      setCreating(false)
    }
  }

  const tabs = [
    t('inventory.createLxc.tabs.general'),
    t('inventory.createLxc.tabs.template'),
    t('inventory.createLxc.tabs.disks'),
    t('inventory.createLxc.tabs.cpu'),
    t('inventory.createLxc.tabs.memory'),
    t('inventory.createLxc.tabs.network'),
    t('inventory.createLxc.tabs.dns'),
    t('inventory.createLxc.tabs.confirm'),
  ]
  
  const templateStoragesList = storages.filter(s => s.content?.includes('vztmpl'))
  const diskStoragesList = storages.filter(s => s.content?.includes('rootdir') || s.content?.includes('images'))

  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // General
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.createLxc.node')}</InputLabel>
              <Select
                value={selectedNode}
                onChange={(e) => handleNodeChange(e.target.value)}
                label={t('inventory.createLxc.node')}
                MenuProps={{ PaperProps: { sx: { maxHeight: 400 } } }}
              >
                {groupedNodes.map(group => [
                  // Cluster header (si multi-nodes)
                  group.isCluster && (
                    <MenuItem
                      key={`cluster:${group.connId}`}
                      value={`cluster:${group.connId}`}
                      sx={{
                        bgcolor: 'action.hover',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:hover': { bgcolor: 'action.selected' }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                        <i className="ri-cloud-fill" style={{ fontSize: 16, color: theme.palette.primary.main }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight={600}>
                            {group.connName}
                            <Typography component="span" sx={{ ml: 1, opacity: 0.6, fontSize: '0.8em' }}>
                              ({t('inventory.createLxc.auto')})
                            </Typography>
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1.5} sx={{ mr: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 70 }}>
                            <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>CPU</Typography>
                            <Box sx={{ width: 40, height: 14, position: 'relative', bgcolor: 'action.disabledBackground', borderRadius: 0, overflow: 'hidden' }}>
                              <Box sx={{ width: `${Math.min(100, group.avgCpu)}%`, height: '100%', bgcolor: group.avgCpu > 90 ? 'error.main' : 'primary.main', borderRadius: 0 }} />
                              <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{group.avgCpu.toFixed(0)}%</Typography>
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 70 }}>
                            <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>RAM</Typography>
                            <Box sx={{ width: 40, height: 14, position: 'relative', bgcolor: 'action.disabledBackground', borderRadius: 0, overflow: 'hidden' }}>
                              <Box sx={{ width: `${Math.min(100, group.avgMem)}%`, height: '100%', bgcolor: group.avgMem > 90 ? 'error.main' : 'primary.main', borderRadius: 0 }} />
                              <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{group.avgMem.toFixed(0)}%</Typography>
                            </Box>
                          </Box>
                        </Stack>
                      </Box>
                    </MenuItem>
                  ),
                  // Nodes du groupe
                  ...group.nodes.map(n => {
                    const isMaintenance = n.hastate === 'maintenance'
                    const isDisabled = n.status !== 'online' || isMaintenance

                    return (
                    <MenuItem
                      key={`${n.connId}-${n.node}`}
                      value={n.node}
                      disabled={isDisabled}
                      sx={{ pl: group.isCluster ? 4 : 2 }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                        <i
                          className={isMaintenance ? 'ri-tools-line' : 'ri-server-line'}
                          style={{
                            fontSize: 14,
                            color: isMaintenance ? theme.palette.warning.main : n.status === 'online' ? theme.palette.success.main : theme.palette.text.disabled
                          }}
                        />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ opacity: isDisabled ? 0.5 : 1 }}>
                            {n.node}
                            {!group.isCluster && (
                              <Typography component="span" sx={{ ml: 1, opacity: 0.6, fontSize: '0.8em' }}>
                                ({n.connName})
                              </Typography>
                            )}
                          </Typography>
                        </Box>
                        {n.status === 'online' && !isMaintenance && (
                          <Stack direction="row" spacing={1.5} sx={{ mr: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 70 }}>
                              <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>CPU</Typography>
                              <Box sx={{ width: 40, height: 14, position: 'relative', bgcolor: 'action.disabledBackground', borderRadius: 0, overflow: 'hidden' }}>
                                <Box sx={{ width: `${Math.min(100, n.cpuPct || 0)}%`, height: '100%', bgcolor: (n.cpuPct || 0) > 90 ? 'error.main' : 'primary.main', borderRadius: 0 }} />
                                <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{(n.cpuPct || 0).toFixed(0)}%</Typography>
                              </Box>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 70 }}>
                              <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>RAM</Typography>
                              <Box sx={{ width: 40, height: 14, position: 'relative', bgcolor: 'action.disabledBackground', borderRadius: 0, overflow: 'hidden' }}>
                                <Box sx={{ width: `${Math.min(100, n.memPct || 0)}%`, height: '100%', bgcolor: (n.memPct || 0) > 90 ? 'error.main' : 'primary.main', borderRadius: 0 }} />
                                <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{(n.memPct || 0).toFixed(0)}%</Typography>
                              </Box>
                            </Box>
                          </Stack>
                        )}
                        {isMaintenance && (
                          <Chip label="maintenance" size="small" color="warning" sx={{ height: 18, fontSize: 10 }} />
                        )}
                        {n.status !== 'online' && !isMaintenance && (
                          <Chip label="offline" size="small" sx={{ height: 18, fontSize: 10 }} />
                        )}
                      </Box>
                    </MenuItem>
                    )
                  })
                ]).flat().filter(Boolean)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.createLxc.resourcePool')}</InputLabel>
              <Select value={resourcePool} onChange={(e) => setResourcePool(e.target.value)} label={t('inventory.createLxc.resourcePool')}>
                <MenuItem value="">({t('common.none')})</MenuItem>
              </Select>
            </FormControl>
            
            <TextField 
              label="CT ID" 
              value={ctid} 
              onChange={(e) => handleCtidChange(e.target.value)} 
              size="small" 
              error={!!ctidError}
              helperText={ctidError}
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
            />
            <Box />
            
            <TextField label={t('inventory.createLxc.hostname')} value={hostname} onChange={(e) => setHostname(e.target.value)} size="small" />
            <Box />
            
            <FormControlLabel 
              control={<Switch checked={unprivileged} onChange={(e) => setUnprivileged(e.target.checked)} size="small" />} 
              label={t('inventory.createLxc.unprivilegedContainer')}
            />
            <FormControlLabel 
              control={<Switch checked={nesting} onChange={(e) => setNesting(e.target.checked)} size="small" />} 
              label={t('inventory.createLxc.nesting')}
            />
            
            <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
            
            <TextField 
              label={t('inventory.createLxc.password')}
              value={rootPassword} 
              onChange={(e) => setRootPassword(e.target.value)} 
              size="small" 
              type="password"
            />
            <TextField 
              label={t('inventory.createLxc.confirmPassword')}
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              size="small" 
              type="password"
              error={confirmPassword !== '' && rootPassword !== confirmPassword}
            />
            
            <TextField 
              label={t('inventory.createLxc.sshPublicKey')}
              value={sshKeys} 
              onChange={(e) => setSshKeys(e.target.value)} 
              size="small" 
              multiline
              rows={2}
              sx={{ gridColumn: '1 / -1' }}
              placeholder="ssh-rsa AAAA..."
            />
          </Box>
        )

      case 1: // Template
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.createLxc.storage')}</InputLabel>
              <Select value={templateStorage} onChange={(e) => setTemplateStorage(e.target.value)} label={t('inventory.createLxc.storage')}>
                {templateStoragesList.map(s => <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>)}
              </Select>
            </FormControl>
            <Box />

            <TextField
              label={t('inventory.createLxc.template')}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              size="small"
              sx={{ gridColumn: '1 / -1' }}
              placeholder={t('inventory.createLxc.templatePlaceholder')}
              helperText={t('inventory.createLxc.templateHelperText')}
            />
          </Box>
        )

      case 2: // Disks
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.createLxc.storage')}</InputLabel>
              <Select value={rootStorage} onChange={(e) => setRootStorage(e.target.value)} label={t('inventory.createLxc.storage')}>
                {diskStoragesList.map(s => (
                  <MenuItem key={s.storage} value={s.storage}>{s.storage} ({s.type})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box />

            <TextField
              label={t('inventory.createLxc.diskSizeGib')}
              value={rootSize} 
              onChange={(e) => setRootSize(parseInt(e.target.value) || 1)} 
              size="small" 
              type="number"
              inputProps={{ min: 1, max: 1000 }}
            />
          </Box>
        )

      case 3: // CPU
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label={t('inventory.createLxc.cores')}
              value={cpuCores} 
              onChange={(e) => setCpuCores(parseInt(e.target.value) || 1)} 
              size="small" 
              type="number"
              inputProps={{ min: 1, max: 128 }}
            />
            <Box />
            
            <TextField
              label={t('inventory.createLxc.cpuLimit')}
              value={cpuLimit === 0 ? '' : cpuLimit} 
              onChange={(e) => setCpuLimit(parseFloat(e.target.value) || 0)} 
              size="small" 
              type="number"
              placeholder={t('inventory.createLxc.unlimited')}
              inputProps={{ min: 0, max: cpuCores, step: 0.1 }}
            />
            <TextField
              label={t('inventory.createLxc.cpuUnits')}
              value={cpuUnits} 
              onChange={(e) => setCpuUnits(parseInt(e.target.value) || 1024)} 
              size="small" 
              type="number"
            />
          </Box>
        )

      case 4: // Memory
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label={t('inventory.createLxc.memoryMib')}
              value={memorySize} 
              onChange={(e) => setMemorySize(parseInt(e.target.value) || 128)} 
              size="small" 
              type="number"
              inputProps={{ min: 16, step: 32 }}
            />
            <Box />
            
            <TextField
              label={t('inventory.createLxc.swapMib')}
              value={swapSize} 
              onChange={(e) => setSwapSize(parseInt(e.target.value) || 0)} 
              size="small" 
              type="number"
              inputProps={{ min: 0, step: 32 }}
            />
          </Box>
        )

      case 5: // Network
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label={t('inventory.createLxc.networkName')}
              value={networkName}
              onChange={(e) => setNetworkName(e.target.value)}
              size="small"
            />
            <TextField
              label={t('inventory.createLxc.bridge')}
              value={networkBridge}
              onChange={(e) => setNetworkBridge(e.target.value)}
              size="small"
            />
            
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.createLxc.ipv4')}</InputLabel>
              <Select value={ipConfig} onChange={(e) => setIpConfig(e.target.value)} label={t('inventory.createLxc.ipv4')}>
                <MenuItem value="dhcp">{t('inventory.createLxc.dhcp')}</MenuItem>
                <MenuItem value="static">{t('inventory.createLxc.static')}</MenuItem>
                <MenuItem value="manual">{t('inventory.createLxc.manual')}</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.createLxc.ipv6')}</InputLabel>
              <Select value={ip6Config} onChange={(e) => setIp6Config(e.target.value)} label={t('inventory.createLxc.ipv6')}>
                <MenuItem value="auto">{t('inventory.createLxc.slaac')}</MenuItem>
                <MenuItem value="dhcp">{t('inventory.createLxc.dhcp')}</MenuItem>
                <MenuItem value="static">{t('inventory.createLxc.static')}</MenuItem>
                <MenuItem value="manual">{t('inventory.createLxc.manual')}</MenuItem>
              </Select>
            </FormControl>
            
            {ipConfig === 'static' && (
              <>
                <TextField
                  label={t('inventory.createLxc.ipv4Cidr')}
                  value={ip4} 
                  onChange={(e) => setIp4(e.target.value)} 
                  size="small"
                  placeholder="192.168.1.100/24"
                />
                <TextField
                  label={t('inventory.createLxc.gatewayIpv4')}
                  value={gw4} 
                  onChange={(e) => setGw4(e.target.value)} 
                  size="small"
                  placeholder="192.168.1.1"
                />
              </>
            )}
            
            {ip6Config === 'static' && (
              <>
                <TextField
                  label={t('inventory.createLxc.ipv6Cidr')}
                  value={ip6} 
                  onChange={(e) => setIp6(e.target.value)} 
                  size="small"
                />
                <TextField
                  label={t('inventory.createLxc.gatewayIpv6')}
                  value={gw6} 
                  onChange={(e) => setGw6(e.target.value)} 
                  size="small"
                />
              </>
            )}
            
            <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
            
            <FormControlLabel 
              control={<Switch checked={firewall} onChange={(e) => setFirewall(e.target.checked)} size="small" />} 
              label={t('inventory.createLxc.firewall')}
            />
            <TextField
              label={t('inventory.createLxc.vlanTag')}
              value={vlanTag}
              onChange={(e) => setVlanTag(e.target.value)}
              size="small"
              placeholder={t('inventory.createLxc.noVlan')}
            />
            
            <TextField
              label={t('inventory.createLxc.mtu')}
              value={mtu}
              onChange={(e) => setMtu(e.target.value)}
              size="small"
              placeholder={t('inventory.createLxc.sameasBridge')}
            />
            <TextField
              label={t('inventory.createLxc.rateLimitMbs')}
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              size="small"
              placeholder={t('inventory.createLxc.unlimited')}
            />
          </Box>
        )

      case 6: // DNS
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label={t('inventory.createLxc.dnsDomain')}
              value={searchDomain}
              onChange={(e) => setSearchDomain(e.target.value)}
              size="small"
              placeholder={t('inventory.createLxc.useHostSettings')}
            />
            <Box />

            <TextField
              label={t('inventory.createLxc.dnsServers')}
              value={dnsServer}
              onChange={(e) => setDnsServer(e.target.value)}
              size="small"
              placeholder={t('inventory.createLxc.useHostSettings')}
            />
          </Box>
        )

      case 7: // Confirm
        return (
          <Box>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('inventory.createLxc.reviewSettingsLxc')}
            </Alert>
            <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}>
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmNode')}</b> {selectedNode}</Typography>
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmCtId')}</b> {ctid}</Typography>
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmHostname')}</b> {hostname}</Typography>
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmUnprivileged')}</b> {unprivileged ? t('common.yes') : t('common.no')}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmTemplate')}</b> {templateStorage}:vztmpl/{template || `(${t('common.none')})`}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmRootDisk')}</b> {rootStorage}:{rootSize}GB</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmCpu')}</b> {t('inventory.createLxc.coreCount', { count: cpuCores })}{cpuLimit > 0 ? `, ${t('inventory.createLxc.limitLabel', { limit: cpuLimit })}` : ''}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmMemory')}</b> {memorySize} MiB, {t('inventory.createLxc.confirmSwap')} {swapSize} MiB</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>{t('inventory.createLxc.confirmNetwork')}</b> {networkName} on {networkBridge} ({ipConfig})</Typography>
            </Box>
          </Box>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ 
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,150,200,0.15)' : 'primary.light',
        color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.contrastText',
        display: 'flex', 
        alignItems: 'center', 
        gap: 1,
        py: 1.5
      }}>
        <i className="ri-instance-line" style={{ fontSize: 20 }} />
        {t('inventory.createLxc.title')}
      </DialogTitle>
      
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {tabs.map((label, idx) => (
            <Tab 
              key={label} 
              label={label} 
              sx={{ 
                minWidth: 80,
                fontWeight: activeTab === idx ? 700 : 400,
              }} 
            />
          ))}
        </Tabs>
      </Box>
      
      <DialogContent sx={{ minHeight: 350, pt: 3 }}>
        {loadingData ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          renderTabContent()
        )}
      </DialogContent>
      
      <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} disabled={creating}>{t('common.cancel')}</Button>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={() => setActiveTab(prev => Math.max(0, prev - 1))}
          disabled={activeTab === 0 || creating}
        >
          {t('common.back')}
        </Button>
        {activeTab < tabs.length - 1 ? (
          <Button onClick={() => setActiveTab(prev => prev + 1)} variant="contained">
            {t('common.next')}
          </Button>
        ) : (
          <Button
            onClick={handleCreate}
            variant="contained"
            color="primary"
            disabled={creating || !ctid || !selectedNode || !!ctidError}
            startIcon={creating ? <CircularProgress size={16} /> : null}
          >
            {t('common.create')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}


export default CreateLxcDialog
