'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
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

function CreateVmDialog({
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
  
  // États du formulaire
  const [activeTab, setActiveTab] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Données dynamiques
  const [connections, setConnections] = useState<any[]>([])
  const [nodes, setNodes] = useState<any[]>([])
  const [storages, setStorages] = useState<any[]>([])
  const [isoImages, setIsoImages] = useState<any[]>([])
  const [networks, setNetworks] = useState<any[]>([])
  const [pools, setPools] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)
  
  // Formulaire - Général
  const [selectedConnection, setSelectedConnection] = useState('')
  const [selectedNode, setSelectedNode] = useState('')
  const [vmid, setVmid] = useState('')
  const [vmidError, setVmidError] = useState<string | null>(null)
  const [vmName, setVmName] = useState('')
  const [resourcePool, setResourcePool] = useState('')
  const [startOnBoot, setStartOnBoot] = useState(false)
  const [startupOrder, setStartupOrder] = useState('')
  const [startupDelay, setStartupDelay] = useState('')
  const [shutdownTimeout, setShutdownTimeout] = useState('')
  
  // Formulaire - OS
  const [osMediaType, setOsMediaType] = useState<'iso' | 'none'>('iso')
  const [isoStorage, setIsoStorage] = useState('')
  const [isoImage, setIsoImage] = useState('')
  const [guestOsType, setGuestOsType] = useState('Linux')
  const [guestOsVersion, setGuestOsVersion] = useState('l26')
  
  // Formulaire - System
  const [graphicCard, setGraphicCard] = useState('default')
  const [machine, setMachine] = useState('i440fx')
  const [bios, setBios] = useState('seabios')
  const [scsiController, setScsiController] = useState('virtio-scsi-single')
  const [qemuAgent, setQemuAgent] = useState(false)
  const [addTpm, setAddTpm] = useState(false)
  
  // Formulaire - Disks
  const [diskBus, setDiskBus] = useState('scsi')
  const [diskStorage, setDiskStorage] = useState('')
  const [diskSize, setDiskSize] = useState(32)
  const [diskFormat, setDiskFormat] = useState('raw')
  const [diskCache, setDiskCache] = useState('none')
  const [diskDiscard, setDiskDiscard] = useState(false)
  const [diskIoThread, setDiskIoThread] = useState(true)
  const [diskSsd, setDiskSsd] = useState(false)
  const [diskBackup, setDiskBackup] = useState(true)
  
  // Formulaire - CPU
  const [cpuSockets, setCpuSockets] = useState(1)
  const [cpuCores, setCpuCores] = useState(1)
  const [cpuType, setCpuType] = useState('x86-64-v2-AES')
  const [cpuUnits, setCpuUnits] = useState(100)
  const [cpuLimit, setCpuLimit] = useState(0)
  const [enableNuma, setEnableNuma] = useState(false)
  
  // Formulaire - Memory
  const [memorySize, setMemorySize] = useState(2048)
  const [minMemory, setMinMemory] = useState(2048)
  const [ballooning, setBallooning] = useState(true)
  
  // Formulaire - Network
  const [noNetwork, setNoNetwork] = useState(false)
  const [networkBridge, setNetworkBridge] = useState('vmbr0')
  const [networkModel, setNetworkModel] = useState('virtio')
  const [vlanTag, setVlanTag] = useState('')
  const [macAddress, setMacAddress] = useState('auto')
  const [firewall, setFirewall] = useState(true)
  const [networkDisconnect, setNetworkDisconnect] = useState(false)
  const [rateLimit, setRateLimit] = useState('')
  const [mtu, setMtu] = useState('1500')

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(0)
      setError(null)
      loadAllData()
    }
  }, [open])

  // Charger les storages quand un node est sélectionné
  useEffect(() => {
    if (selectedConnection && selectedNode) {
      loadStorages(selectedConnection)
    }
  }, [selectedConnection, selectedNode])

  // Charger les ISOs quand un storage ISO est sélectionné
  useEffect(() => {
    if (selectedConnection && isoStorage && selectedNode) {
      loadIsoImages(selectedConnection, selectedNode, isoStorage)
    }
  }, [selectedConnection, selectedNode, isoStorage])

  // Calculer le prochain VMID disponible (global sur toutes les connexions)
  // Ne définir le VMID que s'il n'est pas déjà renseigné par l'utilisateur
  const [vmidInitialized, setVmidInitialized] = useState(false)

  // Réinitialiser le flag quand le dialog s'ouvre
  useEffect(() => {
    if (open) {
      setVmidInitialized(false)
    }
  }, [open])

  useEffect(() => {
    if (allVms.length > 0 && !vmidInitialized && open) {
      const usedVmids = allVms.map(vm => parseInt(String(vm.vmid), 10))

      let nextId = 100

      while (usedVmids.includes(nextId)) {
        nextId++
      }

      setVmid(String(nextId))
      setVmidError(null)
      setVmidInitialized(true)
    }
  }, [allVms, vmidInitialized, open])

  // Valider le VMID quand il change
  const handleVmidChange = (value: string) => {
    // Autoriser uniquement les chiffres
    const numericValue = value.replace(/[^0-9]/g, '')

    setVmid(numericValue)
    
    // Vérifier si le VMID est valide
    if (!numericValue) {
      setVmidError(null)
      
return
    }
    
    const vmidNum = parseInt(numericValue, 10)
    
    // Vérifier les limites Proxmox (100-999999999)
    if (vmidNum < 100) {
      setVmidError('VM ID must be >= 100')
      
return
    }

    if (vmidNum > 999999999) {
      setVmidError('VM ID must be <= 999999999')
      
return
    }
    
    // Vérifier si le VMID est déjà utilisé
    const isUsed = allVms.some(vm => parseInt(String(vm.vmid), 10) === vmidNum)

    if (isUsed) {
      setVmidError(`VM ID ${vmidNum} is already in use`)
      
return
    }
    
    setVmidError(null)
  }

  // Charger toutes les connexions et tous leurs nodes
  const loadAllData = async () => {
    setLoadingData(true)

    try {
      // 1. Charger les connexions
      const connRes = await fetch('/api/v1/connections?type=pve')
      const connJson = await connRes.json()
      const connectionsList = connJson.data || []

      setConnections(connectionsList)

      // 2. Charger les nodes de toutes les connexions en parallèle
      const allNodes: any[] = []

      await Promise.all(
        connectionsList.map(async (conn: any) => {
          try {
            const nodesRes = await fetch(`/api/v1/connections/${encodeURIComponent(conn.id)}/nodes`)
            const nodesJson = await nodesRes.json()
            const nodesList = nodesJson.data || []

            // Ajouter l'info de connexion et calculs de pourcentages à chaque node
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

      // 3. Sélectionner le premier node par défaut
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

    // Grouper par connexion
    const connMap = new Map<string, any[]>()
    nodes.forEach(n => {
      if (!connMap.has(n.connId)) {
        connMap.set(n.connId, [])
      }
      connMap.get(n.connId)!.push(n)
    })

    // Créer les groupes avec stats
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

  // Trouver le meilleur node d'un cluster (moins de charge CPU+RAM)
  const findBestNode = (connId: string): string | null => {
    const group = groupedNodes.find(g => g.connId === connId)
    if (!group) return null

    const onlineNodes = group.nodes.filter(n => n.status === 'online')
    if (onlineNodes.length === 0) return null

    // Score = CPU% + RAM%, le plus bas est le meilleur
    const bestNode = onlineNodes.reduce((best, node) => {
      const score = (node.cpuPct || 0) + (node.memPct || 0)
      const bestScore = (best.cpuPct || 0) + (best.memPct || 0)
      return score < bestScore ? node : best
    })

    return bestNode.node
  }

  // Quand on sélectionne un node ou cluster
  const handleNodeChange = (value: string) => {
    // Check if it's a cluster selection (format: "cluster:connId")
    if (value.startsWith('cluster:')) {
      const connId = value.replace('cluster:', '')
      const bestNode = findBestNode(connId)
      if (bestNode) {
        setSelectedNode(bestNode)
        setSelectedConnection(connId)
      }
    } else {
      // Regular node selection
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
      
      // Sélectionner les storages par défaut
      const isoStorages = (storagesJson.data || []).filter((s: any) => s.content?.includes('iso'))

      const diskStorages = (storagesJson.data || []).filter((s: any) => 
        s.content?.includes('images') || s.content?.includes('rootdir')
      )
      
      if (isoStorages.length > 0 && !isoStorage) {
        setIsoStorage(isoStorages[0].storage)
      }

      if (diskStorages.length > 0 && !diskStorage) {
        setDiskStorage(diskStorages[0].storage)
      }
    } catch (e) {
      console.error('Error loading storages:', e)
    }
  }

  const loadIsoImages = async (connId: string, node: string, storage: string) => {
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=iso`
      )

      if (res.ok) {
        const json = await res.json()

        setIsoImages(json.data || [])
      }
    } catch (e) {
      // API might not exist, fallback to empty
      setIsoImages([])
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    
    try {
      const payload: any = {
        vmid: parseInt(vmid, 10),
        ostype: guestOsVersion,
        sockets: cpuSockets,
        cores: cpuCores,
        memory: memorySize,
        scsihw: scsiController,
        agent: qemuAgent ? 1 : 0,
        onboot: startOnBoot ? 1 : 0,
      }

      // Nom (optionnel)
      if (vmName) payload.name = vmName

      // CPU type (seulement si différent de défaut)
      if (cpuType && cpuType !== 'kvm64') payload.cpu = cpuType

      // Ballooning
      if (ballooning && minMemory < memorySize) {
        payload.balloon = minMemory
      }

      // BIOS (seulement si OVMF/UEFI)
      if (bios === 'ovmf') payload.bios = 'ovmf'

      // Machine type - utiliser le format Proxmox correct
      if (machine === 'q35') payload.machine = 'q35'

      // i440fx est le défaut, pas besoin de l'envoyer

      // Disque
      if (diskStorage) {
        let diskConfig = `${diskStorage}:${diskSize}`

        if (diskFormat !== 'raw') diskConfig += `,format=${diskFormat}`
        if (diskCache !== 'none') diskConfig += `,cache=${diskCache}`
        if (diskDiscard) diskConfig += ',discard=on'
        if (diskIoThread) diskConfig += ',iothread=1'
        if (diskSsd) diskConfig += ',ssd=1'
        if (!diskBackup) diskConfig += ',backup=0'
        
        payload[`${diskBus}0`] = diskConfig
      }

      // ISO
      if (osMediaType === 'iso' && isoStorage && isoImage) {
        payload.cdrom = `${isoStorage}:iso/${isoImage}`
      }

      // Réseau
      if (!noNetwork) {
        let net0 = `${networkModel},bridge=${networkBridge}`

        if (vlanTag) net0 += `,tag=${vlanTag}`
        if (macAddress && macAddress !== 'auto') net0 += `,macaddr=${macAddress}`
        if (firewall) net0 += ',firewall=1'
        if (rateLimit) net0 += `,rate=${rateLimit}`
        if (networkDisconnect) net0 += ',link_down=1'
        payload.net0 = net0
      }

      // CPU
      if (cpuUnits !== 1024) payload.cpuunits = cpuUnits
      if (cpuLimit > 0) payload.cpulimit = cpuLimit
      if (enableNuma) payload.numa = 1

      // Startup
      if (startupOrder || startupDelay || shutdownTimeout) {
        const parts = []

        if (startupOrder) parts.push(`order=${startupOrder}`)
        if (startupDelay) parts.push(`up=${startupDelay}`)
        if (shutdownTimeout) parts.push(`down=${shutdownTimeout}`)
        payload.startup = parts.join(',')
      }

      // Pool
      if (resourcePool) payload.pool = resourcePool

      console.log('Creating VM with payload:', payload)

      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/guests/qemu/${encodeURIComponent(selectedNode)}`,
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

      // Appeler le callback avec les infos de la VM créée
      onCreated?.(vmid, selectedConnection, selectedNode)
      onClose()
    } catch (e: any) {
      setError(e?.message || t('errors.addError'))
    } finally {
      setCreating(false)
    }
  }

  const tabs = ['General', 'OS', 'System', 'Disks', 'CPU', 'Memory', 'Network', 'Confirm']
  
  // Filtrer les storages selon leur contenu
  const isoStoragesList = storages.filter(s => s.content?.includes('iso'))
  const diskStoragesList = storages.filter(s => s.content?.includes('images') || s.content?.includes('rootdir'))

  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // General
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Node</InputLabel>
              <Select
                value={selectedNode}
                onChange={(e) => handleNodeChange(e.target.value)}
                label="Node"
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
                              (auto)
                            </Typography>
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1.5} sx={{ mr: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 70 }}>
                            <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>CPU</Typography>
                            <Box sx={{ width: 40, height: 6, bgcolor: 'action.disabledBackground', borderRadius: 1, overflow: 'hidden' }}>
                              <Box sx={{ width: `${Math.min(100, group.avgCpu)}%`, height: '100%', bgcolor: group.avgCpu > 80 ? 'error.main' : group.avgCpu > 50 ? 'warning.main' : 'success.main', borderRadius: 1 }} />
                            </Box>
                            <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600 }}>{group.avgCpu.toFixed(0)}%</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 70 }}>
                            <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>RAM</Typography>
                            <Box sx={{ width: 40, height: 6, bgcolor: 'action.disabledBackground', borderRadius: 1, overflow: 'hidden' }}>
                              <Box sx={{ width: `${Math.min(100, group.avgMem)}%`, height: '100%', bgcolor: group.avgMem > 80 ? 'error.main' : group.avgMem > 50 ? 'warning.main' : 'primary.main', borderRadius: 1 }} />
                            </Box>
                            <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600 }}>{group.avgMem.toFixed(0)}%</Typography>
                          </Box>
                        </Stack>
                      </Box>
                    </MenuItem>
                  ),
                  // Nodes du groupe
                  ...group.nodes.map(n => (
                    <MenuItem
                      key={`${n.connId}-${n.node}`}
                      value={n.node}
                      disabled={n.status !== 'online'}
                      sx={{ pl: group.isCluster ? 4 : 2 }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                        <i
                          className="ri-server-line"
                          style={{
                            fontSize: 14,
                            color: n.status === 'online' ? theme.palette.success.main : theme.palette.text.disabled
                          }}
                        />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ opacity: n.status === 'online' ? 1 : 0.5 }}>
                            {n.node}
                            {!group.isCluster && (
                              <Typography component="span" sx={{ ml: 1, opacity: 0.6, fontSize: '0.8em' }}>
                                ({n.connName})
                              </Typography>
                            )}
                          </Typography>
                        </Box>
                        {n.status === 'online' && (
                          <Stack direction="row" spacing={1.5} sx={{ mr: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 70 }}>
                              <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>CPU</Typography>
                              <Box sx={{ width: 40, height: 6, bgcolor: 'action.disabledBackground', borderRadius: 1, overflow: 'hidden' }}>
                                <Box sx={{ width: `${Math.min(100, n.cpuPct || 0)}%`, height: '100%', bgcolor: (n.cpuPct || 0) > 80 ? 'error.main' : (n.cpuPct || 0) > 50 ? 'warning.main' : 'success.main', borderRadius: 1 }} />
                              </Box>
                              <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600 }}>{(n.cpuPct || 0).toFixed(0)}%</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 70 }}>
                              <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>RAM</Typography>
                              <Box sx={{ width: 40, height: 6, bgcolor: 'action.disabledBackground', borderRadius: 1, overflow: 'hidden' }}>
                                <Box sx={{ width: `${Math.min(100, n.memPct || 0)}%`, height: '100%', bgcolor: (n.memPct || 0) > 80 ? 'error.main' : (n.memPct || 0) > 50 ? 'warning.main' : 'primary.main', borderRadius: 1 }} />
                              </Box>
                              <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600 }}>{(n.memPct || 0).toFixed(0)}%</Typography>
                            </Box>
                          </Stack>
                        )}
                        {n.status !== 'online' && (
                          <Chip label="offline" size="small" sx={{ height: 18, fontSize: 10 }} />
                        )}
                      </Box>
                    </MenuItem>
                  ))
                ]).flat().filter(Boolean)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Resource Pool</InputLabel>
              <Select value={resourcePool} onChange={(e) => setResourcePool(e.target.value)} label="Resource Pool">
                <MenuItem value="">({t('common.none')})</MenuItem>
              </Select>
            </FormControl>
            <TextField 
              label="VM ID" 
              value={vmid} 
              onChange={(e) => handleVmidChange(e.target.value)} 
              size="small" 
              error={!!vmidError}
              helperText={vmidError}
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
            />
            <Box />
            <TextField label="Name" value={vmName} onChange={(e) => setVmName(e.target.value)} size="small" fullWidth />
            <Box />
            <FormControlLabel 
              control={<Switch checked={startOnBoot} onChange={(e) => setStartOnBoot(e.target.checked)} size="small" />} 
              label="Start at boot" 
            />
            <Box />
            <TextField label="Start/Shutdown order" value={startupOrder} onChange={(e) => setStartupOrder(e.target.value)} size="small" placeholder="any" />
            <Box />
            <TextField label="Startup delay" value={startupDelay} onChange={(e) => setStartupDelay(e.target.value)} size="small" placeholder="default" />
            <Box />
            <TextField label="Shutdown timeout" value={shutdownTimeout} onChange={(e) => setShutdownTimeout(e.target.value)} size="small" placeholder="default" />
          </Box>
        )

      case 1: // OS
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <Box sx={{ gridColumn: '1 / -1' }}>
              <FormControl component="fieldset">
                <Stack spacing={1}>
                  <FormControlLabel
                    control={<Switch checked={osMediaType === 'iso'} onChange={(e) => setOsMediaType(e.target.checked ? 'iso' : 'none')} size="small" />}
                    label="Use CD/DVD disc image file (iso)"
                  />
                </Stack>
              </FormControl>
            </Box>
            
            {osMediaType === 'iso' && (
              <>
                <FormControl fullWidth size="small">
                  <InputLabel>Storage</InputLabel>
                  <Select value={isoStorage} onChange={(e) => setIsoStorage(e.target.value)} label="Storage">
                    {isoStoragesList.map(s => <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>)}
                  </Select>
                </FormControl>
                <Typography variant="subtitle2" sx={{ alignSelf: 'center', fontWeight: 600 }}>Guest OS:</Typography>
                
                <FormControl fullWidth size="small">
                  <InputLabel>ISO image</InputLabel>
                  <Select value={isoImage} onChange={(e) => setIsoImage(e.target.value)} label="ISO image">
                    {isoImages.length > 0 ? (
                      isoImages.map((iso: any) => (
                        <MenuItem key={iso.volid || iso.name} value={iso.name || iso.volid?.split('/').pop()}>
                          {iso.name || iso.volid?.split('/').pop()}
                        </MenuItem>
                      ))
                    ) : (
                      <MenuItem value="" disabled>{t('common.noData')}</MenuItem>
                    )}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select value={guestOsType} onChange={(e) => setGuestOsType(e.target.value)} label="Type">
                    <MenuItem value="Linux">Linux</MenuItem>
                    <MenuItem value="Windows">Windows</MenuItem>
                    <MenuItem value="Solaris">Solaris</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                  </Select>
                </FormControl>
                
                <Box />
                <FormControl fullWidth size="small">
                  <InputLabel>Version</InputLabel>
                  <Select value={guestOsVersion} onChange={(e) => setGuestOsVersion(e.target.value)} label="Version">
                    {guestOsType === 'Linux' && [
                      <MenuItem key="l26" value="l26">6.x - 2.6 Kernel</MenuItem>,
                      <MenuItem key="l24" value="l24">2.4 Kernel</MenuItem>,
                    ]}
                    {guestOsType === 'Windows' && [
                      <MenuItem key="win11" value="win11">11/2022</MenuItem>,
                      <MenuItem key="win10" value="win10">10/2016/2019</MenuItem>,
                      <MenuItem key="win8" value="win8">8/2012</MenuItem>,
                      <MenuItem key="win7" value="win7">7/2008r2</MenuItem>,
                    ]}
                    {guestOsType === 'Solaris' && <MenuItem value="solaris">Solaris Kernel</MenuItem>}
                    {guestOsType === 'Other' && <MenuItem value="other">Other</MenuItem>}
                  </Select>
                </FormControl>
              </>
            )}
            
            {osMediaType === 'none' && (
              <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
                Do not use any media
              </Typography>
            )}
          </Box>
        )

      case 2: // System
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Graphic card</InputLabel>
              <Select value={graphicCard} onChange={(e) => setGraphicCard(e.target.value)} label="Graphic card">
                <MenuItem value="default">Default</MenuItem>
                <MenuItem value="std">Standard VGA</MenuItem>
                <MenuItem value="vmware">VMware compatible</MenuItem>
                <MenuItem value="qxl">SPICE (qxl)</MenuItem>
                <MenuItem value="virtio">VirtIO-GPU</MenuItem>
                <MenuItem value="none">None</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>SCSI Controller</InputLabel>
              <Select value={scsiController} onChange={(e) => setScsiController(e.target.value)} label="SCSI Controller">
                <MenuItem value="virtio-scsi-single">VirtIO SCSI single</MenuItem>
                <MenuItem value="virtio-scsi-pci">VirtIO SCSI</MenuItem>
                <MenuItem value="lsi">LSI 53C895A</MenuItem>
                <MenuItem value="lsi53c810">LSI 53C810</MenuItem>
                <MenuItem value="megasas">MegaRAID SAS</MenuItem>
                <MenuItem value="pvscsi">VMware PVSCSI</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Machine</InputLabel>
              <Select value={machine} onChange={(e) => setMachine(e.target.value)} label="Machine">
                <MenuItem value="i440fx">Default (i440fx)</MenuItem>
                <MenuItem value="q35">q35</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel 
              control={<Switch checked={qemuAgent} onChange={(e) => setQemuAgent(e.target.checked)} size="small" />} 
              label="Qemu Agent" 
            />
            <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>Firmware</Typography>
            <Box />
            <FormControl fullWidth size="small">
              <InputLabel>BIOS</InputLabel>
              <Select value={bios} onChange={(e) => setBios(e.target.value)} label="BIOS">
                <MenuItem value="seabios">Default (SeaBIOS)</MenuItem>
                <MenuItem value="ovmf">OVMF (UEFI)</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel 
              control={<Switch checked={addTpm} onChange={(e) => setAddTpm(e.target.checked)} size="small" />} 
              label="Add TPM" 
            />
          </Box>
        )

      case 3: // Disks
        return (
          <Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Chip label="scsi0" variant="outlined" sx={{ fontFamily: 'monospace' }} />
              <Tabs value={0} sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5 } }}>
                <Tab label="Disk" />
                <Tab label="Bandwidth" disabled />
              </Tabs>
            </Box>
            
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ minWidth: 100 }}>Bus/Device:</Typography>
                <FormControl size="small" sx={{ minWidth: 100 }}>
                  <Select value={diskBus} onChange={(e) => setDiskBus(e.target.value)}>
                    <MenuItem value="scsi">SCSI</MenuItem>
                    <MenuItem value="virtio">VirtIO Block</MenuItem>
                    <MenuItem value="sata">SATA</MenuItem>
                    <MenuItem value="ide">IDE</MenuItem>
                  </Select>
                </FormControl>
                <TextField size="small" value="0" disabled sx={{ width: 60 }} />
              </Stack>
              <FormControl fullWidth size="small">
                <InputLabel>Cache</InputLabel>
                <Select value={diskCache} onChange={(e) => setDiskCache(e.target.value)} label="Cache">
                  <MenuItem value="none">Default (No cache)</MenuItem>
                  <MenuItem value="directsync">Direct sync</MenuItem>
                  <MenuItem value="writethrough">Write through</MenuItem>
                  <MenuItem value="writeback">Write back</MenuItem>
                  <MenuItem value="unsafe">Write back (unsafe)</MenuItem>
                </Select>
              </FormControl>
              
              <Typography variant="body2">SCSI Controller: {scsiController}</Typography>
              <FormControlLabel 
                control={<Switch checked={diskDiscard} onChange={(e) => setDiskDiscard(e.target.checked)} size="small" />} 
                label="Discard" 
              />
              
              <FormControl fullWidth size="small">
                <InputLabel>Storage</InputLabel>
                <Select value={diskStorage} onChange={(e) => setDiskStorage(e.target.value)} label="Storage">
                  {diskStoragesList.map(s => (
                    <MenuItem key={s.storage} value={s.storage}>
                      {s.storage} ({s.type})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControlLabel 
                control={<Switch checked={diskIoThread} onChange={(e) => setDiskIoThread(e.target.checked)} size="small" />} 
                label="IO thread" 
              />
              
              <TextField 
                label="Disk size (GiB)" 
                value={diskSize} 
                onChange={(e) => setDiskSize(parseInt(e.target.value) || 0)} 
                size="small" 
                type="number" 
              />
              <Box />
              
              <Typography variant="body2" sx={{ opacity: 0.7 }}>Format: {diskFormat}</Typography>
              <Box />
              
              <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
              
              <FormControlLabel 
                control={<Switch checked={diskSsd} onChange={(e) => setDiskSsd(e.target.checked)} size="small" />} 
                label="SSD emulation" 
              />
              <FormControlLabel 
                control={<Switch checked={diskBackup} onChange={(e) => setDiskBackup(e.target.checked)} size="small" />} 
                label="Backup" 
              />
            </Box>
          </Box>
        )

      case 4: // CPU
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField 
              label="Sockets" 
              value={cpuSockets} 
              onChange={(e) => setCpuSockets(parseInt(e.target.value) || 1)} 
              size="small" 
              type="number"
              inputProps={{ min: 1, max: 4 }}
            />
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select value={cpuType} onChange={(e) => setCpuType(e.target.value)} label="Type">
                <MenuItem value="x86-64-v2-AES">x86-64-v2-AES</MenuItem>
                <MenuItem value="host">host</MenuItem>
                <MenuItem value="kvm64">kvm64</MenuItem>
                <MenuItem value="qemu64">qemu64</MenuItem>
                <MenuItem value="max">max</MenuItem>
              </Select>
            </FormControl>
            
            <TextField 
              label="Cores" 
              value={cpuCores} 
              onChange={(e) => setCpuCores(parseInt(e.target.value) || 1)} 
              size="small" 
              type="number"
              inputProps={{ min: 1, max: 128 }}
            />
            <Typography variant="body2" sx={{ alignSelf: 'center' }}>
              Total cores: <b>{cpuSockets * cpuCores}</b>
            </Typography>
            
            <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
            
            <TextField 
              label="VCPUs" 
              value={cpuSockets * cpuCores} 
              size="small" 
              disabled
            />
            <TextField 
              label="CPU units" 
              value={cpuUnits} 
              onChange={(e) => setCpuUnits(parseInt(e.target.value) || 100)} 
              size="small" 
              type="number"
            />
            
            <TextField 
              label="CPU limit" 
              value={cpuLimit === 0 ? 'unlimited' : cpuLimit} 
              onChange={(e) => setCpuLimit(e.target.value === 'unlimited' ? 0 : parseFloat(e.target.value) || 0)} 
              size="small" 
              placeholder="unlimited"
            />
            <FormControlLabel 
              control={<Switch checked={enableNuma} onChange={(e) => setEnableNuma(e.target.checked)} size="small" />} 
              label="Enable NUMA" 
            />
          </Box>
        )

      case 5: // Memory
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField 
              label="Memory (MiB)" 
              value={memorySize} 
              onChange={(e) => setMemorySize(parseInt(e.target.value) || 512)} 
              size="small" 
              type="number"
              inputProps={{ min: 16, step: 128 }}
            />
            <Box />
            
            <TextField 
              label="Minimum memory (MiB)" 
              value={minMemory} 
              onChange={(e) => setMinMemory(parseInt(e.target.value) || 512)} 
              size="small" 
              type="number"
              inputProps={{ min: 16, step: 128 }}
              disabled={!ballooning}
            />
            <Box />
            
            <Typography variant="body2" sx={{ opacity: 0.7 }}>Shares: Default (1000)</Typography>
            <Box />
            
            <FormControlLabel 
              control={<Switch checked={ballooning} onChange={(e) => setBallooning(e.target.checked)} size="small" />} 
              label="Ballooning Device" 
            />
          </Box>
        )

      case 6: // Network
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControlLabel 
              control={<Switch checked={noNetwork} onChange={(e) => setNoNetwork(e.target.checked)} size="small" />} 
              label="No network device" 
              sx={{ gridColumn: '1 / -1' }}
            />
            
            {!noNetwork && (
              <>
                <TextField 
                  label="Bridge" 
                  value={networkBridge} 
                  onChange={(e) => setNetworkBridge(e.target.value)} 
                  size="small"
                />
                <FormControl fullWidth size="small">
                  <InputLabel>Model</InputLabel>
                  <Select value={networkModel} onChange={(e) => setNetworkModel(e.target.value)} label="Model">
                    <MenuItem value="virtio">VirtIO (paravirtualized)</MenuItem>
                    <MenuItem value="e1000">Intel E1000</MenuItem>
                    <MenuItem value="rtl8139">Realtek RTL8139</MenuItem>
                    <MenuItem value="vmxnet3">VMware vmxnet3</MenuItem>
                  </Select>
                </FormControl>
                
                <TextField 
                  label="VLAN Tag" 
                  value={vlanTag} 
                  onChange={(e) => setVlanTag(e.target.value)} 
                  size="small"
                  placeholder="no VLAN"
                />
                <TextField 
                  label="MAC address" 
                  value={macAddress} 
                  onChange={(e) => setMacAddress(e.target.value)} 
                  size="small"
                  placeholder="auto"
                />
                
                <FormControlLabel 
                  control={<Switch checked={firewall} onChange={(e) => setFirewall(e.target.checked)} size="small" />} 
                  label="Firewall" 
                />
                <Box />
                
                <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
                
                <FormControlLabel 
                  control={<Switch checked={networkDisconnect} onChange={(e) => setNetworkDisconnect(e.target.checked)} size="small" />} 
                  label="Disconnect" 
                />
                <TextField 
                  label="Rate limit (MB/s)" 
                  value={rateLimit} 
                  onChange={(e) => setRateLimit(e.target.value)} 
                  size="small"
                  placeholder="unlimited"
                />
                
                <TextField 
                  label="MTU" 
                  value={mtu} 
                  onChange={(e) => setMtu(e.target.value)} 
                  size="small"
                  placeholder="1500 (1 = bridge MTU)"
                />
              </>
            )}
          </Box>
        )

      case 7: // Confirm
        return (
          <Box>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Alert severity="info" sx={{ mb: 2 }}>
              Review your settings before creating the VM
            </Alert>
            <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}>
              <Typography variant="body2"><b>Node:</b> {selectedNode}</Typography>
              <Typography variant="body2"><b>VM ID:</b> {vmid}</Typography>
              <Typography variant="body2"><b>Name:</b> {vmName}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>OS:</b> {guestOsType} {guestOsVersion}</Typography>
              {osMediaType === 'iso' && <Typography variant="body2"><b>ISO:</b> {isoStorage}:iso/{isoImage}</Typography>}
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Machine:</b> {machine} / {bios}</Typography>
              <Typography variant="body2"><b>SCSI:</b> {scsiController}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Disk:</b> {diskBus}0 - {diskStorage}:{diskSize}GB</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>CPU:</b> {cpuSockets} socket(s) × {cpuCores} core(s) = {cpuSockets * cpuCores} vCPU(s), type={cpuType}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2"><b>Memory:</b> {memorySize} MiB {ballooning ? `(balloon min: ${minMemory} MiB)` : ''}</Typography>
              <Divider sx={{ my: 1 }} />
              {!noNetwork ? (
                <Typography variant="body2"><b>Network:</b> {networkModel} on {networkBridge}{vlanTag ? ` (VLAN ${vlanTag})` : ''}</Typography>
              ) : (
                <Typography variant="body2"><b>Network:</b> None</Typography>
              )}
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
        <i className="ri-computer-line" style={{ fontSize: 20 }} />
        Create: Virtual Machine
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
        <Button onClick={onClose} disabled={creating}>Cancel</Button>
        <Box sx={{ flex: 1 }} />
        <Button 
          onClick={() => setActiveTab(prev => Math.max(0, prev - 1))} 
          disabled={activeTab === 0 || creating}
        >
          Back
        </Button>
        {activeTab < tabs.length - 1 ? (
          <Button onClick={() => setActiveTab(prev => prev + 1)} variant="contained">
            Next
          </Button>
        ) : (
          <Button 
            onClick={handleCreate} 
            variant="contained" 
            color="primary"
            disabled={creating || !vmid || !selectedNode || !!vmidError}
            startIcon={creating ? <CircularProgress size={16} /> : null}
          >
            Create
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}


export default CreateVmDialog
