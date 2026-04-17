'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getOsSvgIcon } from '@/lib/utils/osIcons'

import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  ListSubheader,
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
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { formatBytes } from '@/utils/format'
import { AllVmItem } from './InventoryTree'

type DiskConfig = {
  bus: string
  index: number
  storage: string
  size: number
  format: string
  cache: string
  discard: boolean
  ioThread: boolean
  ssd: boolean
  backup: boolean
  /** When true, import an existing disk image instead of creating an empty one.
   *  Uses PVE 8.2+ import-from syntax: `target:0,import-from=source:volid`. */
  importMode: boolean
  /** Source storage containing the disk image to import (e.g. "local", "nfs-images"). */
  importStorage: string
  /** Full volume ID to import (e.g. "local:iso/myvm.qcow2" or "nfs:images/disk.raw"). */
  importVolume: string
}

const createDefaultDisk = (): DiskConfig => ({
  bus: 'scsi',
  index: 0,
  storage: '',
  size: 32,
  format: 'raw',
  cache: 'none',
  discard: false,
  ioThread: true,
  ssd: false,
  backup: true,
  importMode: false,
  importStorage: '',
  importVolume: '',
})

type NicConfig = {
  bridge: string
  model: string
  vlanTag: string
  macAddress: string
  firewall: boolean
  disconnect: boolean
  rateLimit: string
  mtu: string
}

const createDefaultNic = (): NicConfig => ({
  bridge: 'vmbr0',
  model: 'virtio',
  vlanTag: '',
  macAddress: 'auto',
  firewall: true,
  disconnect: false,
  rateLimit: '',
  mtu: '1500',
})

function NumericTextField({
  value,
  onChange,
  fallback,
  parse = Number.parseInt,
  ...rest
}: Omit<React.ComponentProps<typeof TextField>, 'value' | 'onChange'> & {
  value: number
  onChange: (v: number) => void
  fallback: number
  parse?: (s: string) => number
}) {
  const [raw, setRaw] = useState<string>(String(value))

  useEffect(() => {
    setRaw(String(value))
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value

    setRaw(text)

    if (text === '' || text === '-') return

    const num = parse(text)

    if (Number.isFinite(num)) onChange(num)
  }

  const handleBlur = () => {
    if (raw === '' || raw === '-') {
      onChange(fallback)
      setRaw(String(fallback))

      return
    }

    const num = parse(raw)

    if (!Number.isFinite(num)) {
      onChange(fallback)
      setRaw(String(fallback))
    }
  }

  return <TextField value={raw} onChange={handleChange} onBlur={handleBlur} {...rest} />
}

function CreateVmDialog({
  open,
  onClose,
  allVms = [],
  onCreated,
  defaultConnId,
  defaultNode,
}: {
  open: boolean
  onClose: () => void
  allVms: AllVmItem[]
  onCreated?: (vmid: string, connId: string, node: string) => void
  defaultConnId?: string
  defaultNode?: string
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
  const [bridges, setBridges] = useState<any[]>([])
  const [pools, setPools] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)
  
  // Formulaire - Général
  const [selectedConnection, setSelectedConnection] = useState('')
  const [selectedNodeValue, setSelectedNodeValue] = useState('')  // valeur du Select (peut être "cluster:xxx" ou "pve1")
  const [resolvedNode, setResolvedNode] = useState('')            // vrai node pour les API calls
  const [pendingClusterSelect, setPendingClusterSelect] = useState<string | null>(null)
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
  
  // Formulaire - Disks (array-based)
  const [disks, setDisks] = useState<DiskConfig[]>([createDefaultDisk()])
  const [expandedDisks, setExpandedDisks] = useState<Set<number>>(new Set([0]))
  // Cache of fetched volume lists per disk index + source storage, keyed as "idx:storage"
  const [importVolumes, setImportVolumes] = useState<Record<string, { volid: string; format?: string; size?: number }[]>>({})
  
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
  
  // UI collapse states
  const [bootSectionExpanded, setBootSectionExpanded] = useState(false)
  const [cpuAdvancedExpanded, setCpuAdvancedExpanded] = useState(false)
  const [memAdvancedExpanded, setMemAdvancedExpanded] = useState(false)
  const [selectedOsPreset, setSelectedOsPreset] = useState<string | null>(null)

  // Formulaire - Network (array-based)
  const [noNetwork, setNoNetwork] = useState(false)
  const [nics, setNics] = useState<NicConfig[]>([createDefaultNic()])
  const [expandedNics, setExpandedNics] = useState<Set<number>>(new Set([0]))

  // Load next VMID from the Proxmox cluster API
  const loadNextVmid = async (connId: string) => {
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/nextid`)
      if (res.ok) {
        const json = await res.json()
        if (json.data) {
          setVmid(String(json.data))
          setVmidError(null)
          return
        }
      }
    } catch (e) {
      console.error('Error loading next VMID from API:', e)
    }
    // Fallback: client-side computation
    const usedVmids = new Set(allVms.map(vm => Number.parseInt(String(vm.vmid), 10)))
    let nextId = 100
    while (usedVmids.has(nextId)) nextId++
    setVmid(String(nextId))
    setVmidError(null)
  }

  // Load bridges from node
  const loadBridges = async (connId: string, node: string) => {
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/network`
      )
      if (res.ok) {
        const json = await res.json()
        const allInterfaces = json.data || []
        const bridgeList = allInterfaces.filter((iface: any) =>
          iface.type === 'bridge' || iface.type === 'OVSBridge'
        )
        setBridges(bridgeList)
        if (bridgeList.length > 0) {
          setNics(prev => prev.map(nic =>
            bridgeList.some((b: any) => b.iface === nic.bridge) ? nic : { ...nic, bridge: bridgeList[0].iface }
          ))
        }
      }
    } catch (e) {
      console.error('Error loading bridges:', e)
      setBridges([])
    }
  }

  // Disk array helpers
  const addDisk = () => {
    setDisks(prev => {
      const bus = 'scsi'
      const usedIndices = prev.filter(d => d.bus === bus).map(d => d.index)
      let nextIndex = 0
      while (usedIndices.includes(nextIndex)) nextIndex++
      setExpandedDisks(s => new Set(s).add(prev.length))
      return [...prev, { ...createDefaultDisk(), bus, index: nextIndex, storage: prev[0]?.storage || '' }]
    })
  }

  const removeDisk = (idx: number) => {
    setDisks(prev => prev.filter((_, i) => i !== idx))
  }

  const updateDisk = (idx: number, updates: Partial<DiskConfig>) => {
    setDisks(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], ...updates }
      if (updates.bus && updates.bus !== prev[idx].bus) {
        const usedIndices = prev.filter((d, i) => i !== idx && d.bus === updates.bus).map(d => d.index)
        let nextIndex = 0
        while (usedIndices.includes(nextIndex)) nextIndex++
        updated[idx].index = nextIndex
      }
      return updated
    })
  }

  // NIC array helpers
  const addNic = () => {
    setNics(prev => {
      setExpandedNics(s => new Set(s).add(prev.length))
      return [...prev, { ...createDefaultNic(), bridge: prev[0]?.bridge || 'vmbr0' }]
    })
  }

  const removeNic = (idx: number) => {
    setNics(prev => prev.filter((_, i) => i !== idx))
  }

  const updateNic = (idx: number, updates: Partial<NicConfig>) => {
    setNics(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], ...updates }
      return updated
    })
  }

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(0)
      setError(null)
      setSelectedNodeValue('')
      setResolvedNode('')
      setSelectedConnection('')
      setPendingClusterSelect(null)
      setDisks([createDefaultDisk()])
      setNics([createDefaultNic()])
      setExpandedNics(new Set([0]))
      setNoNetwork(false)
      loadAllData()
    }
  }, [open])

  // Charger les storages quand un node est sélectionné
  useEffect(() => {
    if (selectedConnection && resolvedNode) {
      loadStorages(selectedConnection)
    }
  }, [selectedConnection, resolvedNode])

  // Charger les bridges quand un node est sélectionné
  useEffect(() => {
    if (selectedConnection && resolvedNode) {
      loadBridges(selectedConnection, resolvedNode)
    }
  }, [selectedConnection, resolvedNode])

  // Charger les pools de ressources quand la connexion change
  useEffect(() => {
    if (!open || !selectedConnection) {
      setPools([])
      return
    }

    const loadPools = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(selectedConnection)}/pools`)
        const json = await res.json()

        if (json.data && Array.isArray(json.data)) {
          setPools(json.data.map((p: any) => ({ poolid: p.poolid, comment: p.comment })))
        }
      } catch (e) {
        console.error('Error loading pools:', e)
        setPools([])
      }
    }

    loadPools()
  }, [open, selectedConnection])

  // Charger les ISOs quand un storage ISO est sélectionné
  useEffect(() => {
    if (selectedConnection && isoStorage && resolvedNode) {
      loadIsoImages(selectedConnection, resolvedNode, isoStorage)
    }
  }, [selectedConnection, resolvedNode, isoStorage])

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
    
    const vmidNum = Number.parseInt(numericValue, 10)
    
    // Vérifier les limites Proxmox (100-999999999)
    if (vmidNum < 100) {
      setVmidError(t('inventory.createVm.vmIdMin'))
      
return
    }

    if (vmidNum > 999999999) {
      setVmidError(t('inventory.createVm.vmIdMax'))
      
return
    }
    
    // Vérifier si le VMID est déjà utilisé
    const isUsed = allVms.some(vm => Number.parseInt(String(vm.vmid), 10) === vmidNum)

    if (isUsed) {
      setVmidError(t('inventory.createVm.vmIdInUse', { id: vmidNum }))
      
return
    }
    
    setVmidError(null)
  }

  // Générer le prochain VMID disponible via API
  const generateNextVmid = async () => {
    if (selectedConnection) {
      await loadNextVmid(selectedConnection)
    } else {
      const usedVmids = new Set(allVms.map(vm => Number.parseInt(String(vm.vmid), 10)))
      let nextId = 100
      while (usedVmids.has(nextId)) nextId++
      setVmid(String(nextId))
      setVmidError(null)
    }
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

      // 3. Sélectionner le node par défaut (priorité au defaultNode/defaultConnId)
      if (allNodes.length > 0) {
        if (defaultConnId && defaultNode) {
          const match = allNodes.find((n: any) => n.connId === defaultConnId && n.node === defaultNode)
          const target = match || allNodes[0]
          setSelectedNodeValue(target.node)
          setResolvedNode(target.node)
          setSelectedConnection(target.connId)
          loadNextVmid(target.connId)
        } else if (defaultConnId) {
          const clusterNodes = allNodes.filter((n: any) => n.connId === defaultConnId)
          if (clusterNodes.length > 0) {
            setPendingClusterSelect(defaultConnId)
            setSelectedConnection(defaultConnId)
            loadNextVmid(defaultConnId)
          } else {
            setSelectedNodeValue(allNodes[0].node)
            setResolvedNode(allNodes[0].node)
            setSelectedConnection(allNodes[0].connId)
            loadNextVmid(allNodes[0].connId)
          }
        } else {
          setSelectedNodeValue(allNodes[0].node)
          setResolvedNode(allNodes[0].node)
          setSelectedConnection(allNodes[0].connId)
          loadNextVmid(allNodes[0].connId)
        }
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

  // Appliquer la sélection cluster en attente une fois groupedNodes calculé
  useEffect(() => {
    if (pendingClusterSelect && groupedNodes.length > 0) {
      const group = groupedNodes.find(g => g.connId === pendingClusterSelect)
      if (group && group.isCluster) {
        handleNodeChange(`cluster:${pendingClusterSelect}`)
      } else if (group) {
        const nodeName = group.nodes[0]?.node || ''
        setSelectedNodeValue(nodeName)
        setResolvedNode(nodeName)
        setSelectedConnection(pendingClusterSelect)
      }
      setPendingClusterSelect(null)
    }
  }, [pendingClusterSelect, groupedNodes])

  // Quand on sélectionne un node ou cluster
  const handleNodeChange = (value: string) => {
    setSelectedNodeValue(value)
    if (value.startsWith('cluster:')) {
      const connId = value.replaceAll('cluster:', '')
      const bestNode = findBestNode(connId)
      if (bestNode) {
        setResolvedNode(bestNode)
        setSelectedConnection(connId)
        loadNextVmid(connId)
      }
    } else {
      setResolvedNode(value)
      const nodeData = nodes.find(n => n.node === value)
      if (nodeData) {
        setSelectedConnection(nodeData.connId)
        loadNextVmid(nodeData.connId)
      }
    }
  }

  const loadStorages = async (connId: string) => {
    try {
      const storagesRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/storage`)
      const storagesJson = await storagesRes.json()
      
      const allStorages = storagesJson.data || []
      setStorages(allStorages)

      // Auto-select defaults from filtered storages (only shared + local for resolvedNode)
      const filteredIso = allStorages.filter((s: any) =>
        s.content?.includes('iso') && (s.shared || s.node === resolvedNode)
      )
      const filteredDisk = allStorages.filter((s: any) =>
        (s.content?.includes('images') || s.content?.includes('rootdir')) && (s.shared || s.node === resolvedNode)
      )

      if (filteredIso.length > 0 && !isoStorage) {
        setIsoStorage(filteredIso[0].storage)
      }

      if (filteredDisk.length > 0) {
        setDisks(prev => {
          if (prev.length > 0 && !prev[0].storage) {
            const updated = [...prev]
            updated[0] = { ...updated[0], storage: filteredDisk[0].storage }
            return updated
          }
          return prev
        })
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
        vmid: Number.parseInt(vmid, 10),
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

      // Disques
      for (const disk of disks) {
        if (disk.importMode && disk.storage && disk.importVolume) {
          // Import existing disk: PVE 8.2+ syntax
          // target-storage:0 means "auto-allocate from source size"
          // import-from=<source-volid> points to the existing disk image
          let diskConfig = `${disk.storage}:0,import-from=${disk.importVolume}`
          if (disk.format !== 'raw') diskConfig += `,format=${disk.format}`
          if (disk.cache !== 'none') diskConfig += `,cache=${disk.cache}`
          if (disk.discard) diskConfig += ',discard=on'
          if (disk.ioThread) diskConfig += ',iothread=1'
          if (disk.ssd) diskConfig += ',ssd=1'
          if (!disk.backup) diskConfig += ',backup=0'
          payload[`${disk.bus}${disk.index}`] = diskConfig
        } else if (disk.storage) {
          // Create new empty disk
          let diskConfig = `${disk.storage}:${disk.size}`
          if (disk.format !== 'raw') diskConfig += `,format=${disk.format}`
          if (disk.cache !== 'none') diskConfig += `,cache=${disk.cache}`
          if (disk.discard) diskConfig += ',discard=on'
          if (disk.ioThread) diskConfig += ',iothread=1'
          if (disk.ssd) diskConfig += ',ssd=1'
          if (!disk.backup) diskConfig += ',backup=0'
          payload[`${disk.bus}${disk.index}`] = diskConfig
        }
      }

      // ISO
      if (osMediaType === 'iso' && isoStorage && isoImage) {
        payload.cdrom = `${isoStorage}:iso/${isoImage}`
      }

      // Réseau
      if (!noNetwork) {
        nics.forEach((nic, i) => {
          let netStr = `${nic.model},bridge=${nic.bridge}`
          if (nic.vlanTag) netStr += `,tag=${nic.vlanTag}`
          if (nic.macAddress && nic.macAddress !== 'auto') netStr += `,macaddr=${nic.macAddress}`
          if (nic.firewall) netStr += ',firewall=1'
          if (nic.rateLimit) netStr += `,rate=${nic.rateLimit}`
          if (nic.disconnect) netStr += ',link_down=1'
          ;(payload as any)[`net${i}`] = netStr
        })
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
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/guests/qemu/${encodeURIComponent(resolvedNode)}`,
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
      onCreated?.(vmid, selectedConnection, resolvedNode)
      onClose()
    } catch (e: any) {
      setError(e?.message || t('errors.addError'))
    } finally {
      setCreating(false)
    }
  }

  const tabs = [
    t('inventory.createVm.tabs.general'),
    t('inventory.createVm.tabs.os'),
    t('inventory.createVm.tabs.system'),
    t('inventory.createVm.tabs.disks'),
    t('inventory.createVm.tabs.cpu'),
    t('inventory.createVm.tabs.memory'),
    t('inventory.createVm.tabs.network'),
    t('inventory.createVm.tabs.confirm'),
  ]
  
  // Filtrer les storages selon leur contenu ET le node sélectionné
  const isoStoragesList = useMemo(() =>
    storages.filter(s => s.content?.includes('iso') && (s.shared || s.node === resolvedNode)),
    [storages, resolvedNode]
  )
  const diskStoragesList = useMemo(() =>
    storages.filter(s => (s.content?.includes('images') || s.content?.includes('rootdir')) && (s.shared || s.node === resolvedNode)),
    [storages, resolvedNode]
  )

  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // General
        return (
          <Stack spacing={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.createVm.node')}</InputLabel>
              <Select
                value={selectedNodeValue}
                onChange={(e) => handleNodeChange(e.target.value)}
                label={t('inventory.createVm.node')}
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
                        <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}>
                          <i className="ri-server-fill" style={{ fontSize: 16, color: theme.palette.primary.main }} />
                          <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: group.nodes.every((nn: any) => nn.status === 'online') ? 'success.main' : 'warning.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                        </Box>
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
                        <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                          <img
                            src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
                            alt="" width={14} height={14}
                            style={{ opacity: n.status === 'online' ? 0.8 : 0.3 }}
                          />
                          <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: isMaintenance ? 'warning.main' : n.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                        </Box>
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
              <InputLabel>{t('inventory.createVm.resourcePool')}</InputLabel>
              <Select value={resourcePool} onChange={(e) => setResourcePool(e.target.value)} label={t('inventory.createVm.resourcePool')}>
                <MenuItem value="">({t('common.none')})</MenuItem>
                {pools.map((p) => (
                  <MenuItem key={p.poolid} value={p.poolid}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-folder-line" style={{ fontSize: 14, opacity: 0.7 }} />
                      <Box>
                        <Typography variant="body2">{p.poolid}</Typography>
                        {p.comment && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem' }}>
                            {p.comment}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </MenuItem>
                ))}
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
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title={t('inventory.createVm.generateVmId')}>
                        <IconButton size="small" onClick={generateNextVmid} edge="end">
                          <i className="ri-refresh-line" style={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  )
                }
              }}
            />
            <TextField label={t('inventory.createVm.vmName')} value={vmName} onChange={(e) => setVmName(e.target.value)} size="small" fullWidth />

            {/* Boot & Shutdown — collapsible */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              <Box
                onClick={() => setBootSectionExpanded(v => !v)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
              >
                <i className={bootSectionExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                <i className="ri-timer-line" style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createVm.bootShutdown')}</Typography>
                <Box sx={{ flex: 1 }} />
                {startOnBoot && <Chip label={t('inventory.createVm.startAtBoot')} size="small" variant="outlined" color="success" sx={{ fontSize: 10, height: 20 }} />}
              </Box>
              <Collapse in={bootSectionExpanded}>
                <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                  <FormControlLabel
                    control={<Switch checked={startOnBoot} onChange={(e) => setStartOnBoot(e.target.checked)} size="small" />}
                    label={t('inventory.createVm.startAtBoot')}
                    sx={{ gridColumn: '1 / -1' }}
                  />
                  <TextField label={t('inventory.createVm.startupShutdownOrder')} value={startupOrder} onChange={(e) => setStartupOrder(e.target.value)} size="small" placeholder="any" />
                  <TextField label={t('inventory.createVm.startupDelay')} value={startupDelay} onChange={(e) => setStartupDelay(e.target.value)} size="small" placeholder="default" />
                  <TextField label={t('inventory.createVm.shutdownTimeout')} value={shutdownTimeout} onChange={(e) => setShutdownTimeout(e.target.value)} size="small" placeholder="default" />
                </Box>
              </Collapse>
            </Box>
          </Stack>
        )

      case 1: // OS
        {
          const osPresets: { id: string; label: string; icon?: string; svgIcon?: string; type: string; version: string }[] = [
            { id: 'ubuntu', label: 'Ubuntu', svgIcon: '/images/os/ubuntu.svg', type: 'Linux', version: 'l26' },
            { id: 'debian', label: 'Debian', svgIcon: '/images/os/debian.svg', type: 'Linux', version: 'l26' },
            { id: 'centos', label: 'CentOS / Rocky', svgIcon: '/images/os/centos.svg', type: 'Linux', version: 'l26' },
            { id: 'rhel', label: 'RHEL', svgIcon: '/images/os/redhat.svg', type: 'Linux', version: 'l26' },
            { id: 'fedora', label: 'Fedora', svgIcon: '/images/os/fedora.svg', type: 'Linux', version: 'l26' },
            { id: 'win11', label: 'Windows 11', icon: 'ri-windows-fill', type: 'Windows', version: 'win11' },
            { id: 'win10', label: 'Windows 10', icon: 'ri-windows-fill', type: 'Windows', version: 'win10' },
            { id: 'winserver', label: 'Windows Server', icon: 'ri-windows-fill', type: 'Windows', version: 'win11' },
          ]

          return (
            <Stack spacing={2}>
              {/* Quick presets */}
              <Box>
                <Typography variant="caption" fontWeight={700} sx={{ display: 'block', opacity: 0.5, mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {t('inventory.createVm.osPresets')}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                  {osPresets.map((p) => {
                    const isActive = selectedOsPreset === p.id
                    return (
                      <Box
                        key={p.id}
                        onClick={() => { setGuestOsType(p.type); setGuestOsVersion(p.version); setSelectedOsPreset(p.id) }}
                        sx={{
                          border: '1px solid', borderColor: isActive ? 'primary.main' : 'divider', borderRadius: 2,
                          px: 1.5, py: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1,
                          bgcolor: isActive ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                          transition: 'all 0.15s',
                          '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.03) },
                        }}
                      >
                        {p.svgIcon
                          ? <img src={p.svgIcon} alt="" width={20} height={20} style={{ opacity: isActive ? 1 : 0.5 }} />
                          : <i className={p.icon} style={{ fontSize: 20, opacity: isActive ? 1 : 0.5 }} />
                        }
                        <Typography variant="body2" fontSize={12} fontWeight={isActive ? 700 : 400}>{p.label}</Typography>
                      </Box>
                    )
                  })}
                </Box>
              </Box>

              {/* ISO media section */}
              <Box sx={{ border: '1px solid', borderColor: osMediaType === 'iso' ? 'primary.main' : 'divider', borderRadius: 2, overflow: 'hidden', transition: 'border-color 0.2s' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25 }}>
                  <i className="ri-disc-line" style={{ fontSize: 16, opacity: 0.6 }} />
                  <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createVm.installMedia')}</Typography>
                  <Box sx={{ flex: 1 }} />
                  <FormControlLabel
                    control={<Switch checked={osMediaType === 'iso'} onChange={(e) => setOsMediaType(e.target.checked ? 'iso' : 'none')} size="small" />}
                    label=""
                    sx={{ mr: 0 }}
                  />
                </Box>

                <Collapse in={osMediaType === 'iso'}>
                  <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('inventory.createVm.storage')}</InputLabel>
                      <Select value={isoStorage} onChange={(e) => setIsoStorage(e.target.value)} label={t('inventory.createVm.storage')}>
                        {isoStoragesList.map(s => (
                          <MenuItem key={s.id || s.storage} value={s.storage}>
                            {s.storage} ({s.type}){!s.shared && s.node ? ` — ${s.node}` : ''}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('inventory.createVm.isoImage')}</InputLabel>
                      <Select value={isoImage} onChange={(e) => setIsoImage(e.target.value)} label={t('inventory.createVm.isoImage')}>
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
                  </Box>
                </Collapse>

                {osMediaType === 'none' && (
                  <Box sx={{ px: 2, pb: 2, display: 'flex', alignItems: 'center', gap: 1, opacity: 0.4 }}>
                    <i className="ri-close-circle-line" style={{ fontSize: 16 }} />
                    <Typography variant="body2" fontSize={12}>{t('inventory.createVm.doNotUseMedia')}</Typography>
                  </Box>
                )}
              </Box>

              {/* Guest OS type + version */}
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  {guestOsType === 'Linux' ? <img src="/images/os/linux.svg" alt="" width={16} height={16} style={{ opacity: 0.6 }} />
                    : guestOsType === 'Windows' ? <i className="ri-windows-fill" style={{ fontSize: 16, opacity: 0.6 }} />
                    : guestOsType === 'Solaris' ? <i className="ri-sun-line" style={{ fontSize: 16, opacity: 0.6 }} />
                    : <i className="ri-question-line" style={{ fontSize: 16, opacity: 0.6 }} />}
                  <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createVm.guestOs')}</Typography>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('inventory.createVm.osType')}</InputLabel>
                    <Select
                      value={guestOsType}
                      onChange={(e) => setGuestOsType(e.target.value)}
                      label={t('inventory.createVm.osType')}
                      renderValue={(val) => (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {val === 'Linux' ? <img src="/images/os/linux.svg" alt="" width={18} height={18} style={{ opacity: 0.8 }} />
                            : val === 'Windows' ? <i className="ri-windows-fill" style={{ fontSize: 18, opacity: 0.8 }} />
                            : val === 'Solaris' ? <i className="ri-sun-line" style={{ fontSize: 18, opacity: 0.8 }} />
                            : <i className="ri-question-line" style={{ fontSize: 18, opacity: 0.8 }} />}
                          {t(`inventory.createVm.os${val}`)}
                        </Box>
                      )}
                    >
                      <MenuItem value="Linux"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><img src="/images/os/linux.svg" alt="" width={18} height={18} style={{ opacity: 0.8 }} />{t('inventory.createVm.osLinux')}</Box></MenuItem>
                      <MenuItem value="Windows"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-windows-fill" style={{ fontSize: 18, opacity: 0.8 }} />{t('inventory.createVm.osWindows')}</Box></MenuItem>
                      <MenuItem value="Solaris"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-sun-line" style={{ fontSize: 18, opacity: 0.8 }} />{t('inventory.createVm.osSolaris')}</Box></MenuItem>
                      <MenuItem value="Other"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-question-line" style={{ fontSize: 18, opacity: 0.8 }} />{t('inventory.createVm.osOther')}</Box></MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('inventory.createVm.osVersion')}</InputLabel>
                    <Select value={guestOsVersion} onChange={(e) => setGuestOsVersion(e.target.value)} label={t('inventory.createVm.osVersion')}>
                      {guestOsType === 'Linux' && [
                        <MenuItem key="l26" value="l26">Linux 6.x - 2.6 Kernel</MenuItem>,
                        <MenuItem key="l24" value="l24">Linux 2.4 Kernel</MenuItem>,
                      ]}
                      {guestOsType === 'Windows' && [
                        <MenuItem key="win11" value="win11">Windows 11/2022/2025</MenuItem>,
                        <MenuItem key="win10" value="win10">Windows 10/2016/2019</MenuItem>,
                        <MenuItem key="win8" value="win8">Windows 8.x/2012/2012r2</MenuItem>,
                        <MenuItem key="win7" value="win7">Windows 7/2008r2</MenuItem>,
                        <MenuItem key="wvista" value="wvista">Windows Vista/2008</MenuItem>,
                        <MenuItem key="wxp" value="wxp">Windows XP/2003</MenuItem>,
                        <MenuItem key="w2k" value="w2k">Windows 2000</MenuItem>,
                      ]}
                      {guestOsType === 'Solaris' && <MenuItem value="solaris">Solaris Kernel</MenuItem>}
                      {guestOsType === 'Other' && <MenuItem value="other">Other</MenuItem>}
                    </Select>
                  </FormControl>
                </Box>
              </Box>
            </Stack>
          )
        }

      case 2: // System
        return (
          <Stack spacing={1.5}>
            {/* Hardware card */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <i className="ri-cpu-line" style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createVm.hardware')}</Typography>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('inventory.createVm.machine')}</InputLabel>
                  <Select value={machine} onChange={(e) => setMachine(e.target.value)} label={t('inventory.createVm.machine')}>
                    <MenuItem value="i440fx">Default (i440fx)</MenuItem>
                    <MenuItem value="q35">q35</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('inventory.createVm.scsiController')}</InputLabel>
                  <Select value={scsiController} onChange={(e) => setScsiController(e.target.value)} label={t('inventory.createVm.scsiController')}>
                    <MenuItem value="virtio-scsi-single">VirtIO SCSI single</MenuItem>
                    <MenuItem value="virtio-scsi-pci">VirtIO SCSI</MenuItem>
                    <MenuItem value="lsi">LSI 53C895A</MenuItem>
                    <MenuItem value="lsi53c810">LSI 53C810</MenuItem>
                    <MenuItem value="megasas">MegaRAID SAS</MenuItem>
                    <MenuItem value="pvscsi">VMware PVSCSI</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('inventory.createVm.graphicCard')}</InputLabel>
                  <Select value={graphicCard} onChange={(e) => setGraphicCard(e.target.value)} label={t('inventory.createVm.graphicCard')}>
                    <MenuItem value="default">Default</MenuItem>
                    <MenuItem value="std">Standard VGA</MenuItem>
                    <MenuItem value="vmware">VMware compatible</MenuItem>
                    <MenuItem value="qxl">SPICE (qxl)</MenuItem>
                    <MenuItem value="virtio">VirtIO-GPU</MenuItem>
                    <MenuItem value="none">None</MenuItem>
                  </Select>
                </FormControl>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <FormControlLabel
                    control={<Switch checked={qemuAgent} onChange={(e) => setQemuAgent(e.target.checked)} size="small" />}
                    label={<Typography variant="body2" fontSize={12}>{t('inventory.createVm.qemuAgent')}</Typography>}
                  />
                </Box>
              </Box>
            </Box>

            {/* Firmware card */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <i className="ri-flashlight-line" style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createVm.firmware')}</Typography>
              </Box>
              {/* BIOS presets */}
              <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5 }}>
                {([
                  { val: 'seabios', label: 'SeaBIOS (Legacy)', icon: 'ri-terminal-box-line' },
                  { val: 'ovmf', label: 'OVMF (UEFI)', icon: 'ri-shield-check-line' },
                ] as const).map(fw => (
                  <Box
                    key={fw.val}
                    onClick={() => setBios(fw.val)}
                    sx={{
                      flex: 1, border: '1px solid', borderColor: bios === fw.val ? 'primary.main' : 'divider', borderRadius: 2,
                      px: 1.5, py: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1,
                      bgcolor: bios === fw.val ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                      transition: 'all 0.15s',
                      '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.03) },
                    }}
                  >
                    <i className={fw.icon} style={{ fontSize: 18, opacity: bios === fw.val ? 1 : 0.5 }} />
                    <Typography variant="body2" fontSize={12} fontWeight={bios === fw.val ? 700 : 400}>{fw.label}</Typography>
                  </Box>
                ))}
              </Box>
              <FormControlLabel
                control={<Switch checked={addTpm} onChange={(e) => setAddTpm(e.target.checked)} size="small" />}
                label={<Typography variant="body2" fontSize={12}>{t('inventory.createVm.addTpm')}</Typography>}
              />
              {bios === 'ovmf' && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.5 }}>
                  {t('inventory.createVm.uefiHint')}
                </Typography>
              )}
            </Box>
          </Stack>
        )

      case 3: // Disks
        return (
          <Stack spacing={1.5}>
            {disks.map((disk, diskIdx) => {
              const isExpanded = expandedDisks.has(diskIdx)
              const toggleExpand = () => setExpandedDisks(s => { const n = new Set(s); n.has(diskIdx) ? n.delete(diskIdx) : n.add(diskIdx); return n })
              const storageName = diskStoragesList.find(s => s.storage === disk.storage)
              return (
                <Box key={diskIdx} sx={{ border: '1px solid', borderColor: isExpanded ? 'primary.main' : 'divider', borderRadius: 2, overflow: 'hidden', transition: 'border-color 0.2s' }}>
                  {/* Compact header line */}
                  <Box
                    onClick={toggleExpand}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer', bgcolor: isExpanded ? alpha(theme.palette.primary.main, 0.04) : 'transparent', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) } }}
                  >
                    <i className={isExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                    <Chip label={`${disk.bus}${disk.index}`} size="small" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, height: 24 }} />
                    {disk.importMode ? (
                      <>
                        <Chip label="Import" size="small" color="info" variant="outlined" sx={{ height: 20, fontSize: 10 }} />
                        <Typography variant="body2" fontSize={12} sx={{ opacity: 0.6 }} noWrap>{disk.importVolume ? disk.importVolume.split('/').pop() : '—'}</Typography>
                      </>
                    ) : (
                      <>
                        <Typography variant="body2" fontSize={12} sx={{ opacity: 0.6 }}>{disk.storage || '—'}{storageName ? ` (${storageName.type})` : ''}</Typography>
                        <Typography variant="body2" fontSize={12} fontWeight={700}>{disk.size} GiB</Typography>
                      </>
                    )}
                    <Typography variant="body2" fontSize={11} sx={{ opacity: 0.4 }}>{disk.format}</Typography>
                    <Box sx={{ flex: 1 }} />
                    {disks.length > 1 && (
                      <Tooltip title="Remove disk">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeDisk(diskIdx) }} color="error" sx={{ p: 0.5 }}>
                          <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>

                  {/* Expanded content */}
                  <Collapse in={isExpanded}>
                    <Box sx={{ px: 2, pb: 2, pt: 1 }}>
                      {/* Mode toggle: New disk / Import existing */}
                      <Box sx={{ display: 'flex', gap: 0.75, mb: 2 }}>
                        {([
                          { mode: false, label: t('inventory.createVm.newDisk'), icon: 'ri-add-circle-line' },
                          { mode: true, label: t('inventory.createVm.importDisk'), icon: 'ri-download-2-line' },
                        ] as const).map(opt => (
                          <Box
                            key={String(opt.mode)}
                            onClick={() => updateDisk(diskIdx, { importMode: opt.mode })}
                            sx={{
                              flex: 1, border: '1px solid', borderColor: disk.importMode === opt.mode ? 'primary.main' : 'divider', borderRadius: 1.5,
                              px: 1.5, py: 0.75, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1,
                              bgcolor: disk.importMode === opt.mode ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                              transition: 'all 0.15s',
                              '&:hover': { borderColor: 'primary.main' },
                            }}
                          >
                            <i className={opt.icon} style={{ fontSize: 16, opacity: disk.importMode === opt.mode ? 1 : 0.5 }} />
                            <Typography variant="body2" fontSize={12} fontWeight={disk.importMode === opt.mode ? 700 : 400}>{opt.label}</Typography>
                          </Box>
                        ))}
                      </Box>

                      {/* Essential fields */}
                      {disk.importMode ? (
                        /* ── Import mode: bus + target storage + source storage + volume picker ── */
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2 }}>
                          <FormControl size="small">
                            <InputLabel>{t('inventory.createVm.busDevice')}</InputLabel>
                            <Select value={disk.bus} onChange={(e) => updateDisk(diskIdx, { bus: e.target.value })} label={t('inventory.createVm.busDevice')}>
                              <MenuItem value="scsi">SCSI</MenuItem>
                              <MenuItem value="virtio">VirtIO Block</MenuItem>
                              <MenuItem value="sata">SATA</MenuItem>
                              <MenuItem value="ide">IDE</MenuItem>
                            </Select>
                          </FormControl>
                          <FormControl size="small">
                            <InputLabel>{t('inventory.createVm.storage')} ({t('inventory.createVm.target')})</InputLabel>
                            <Select value={disk.storage} onChange={(e) => updateDisk(diskIdx, { storage: e.target.value })} label={`${t('inventory.createVm.storage')} (${t('inventory.createVm.target')})`} renderValue={(val) => { const s = diskStoragesList.find(x => x.storage === val); return s ? `${s.storage}${!s.shared && s.node ? ` — ${s.node}` : ''}` : String(val) }}>
                              {diskStoragesList.map(s => {
                                const total = s.total || 0
                                const used = s.used || 0
                                const avail = s.avail ?? (total - used)
                                const usagePct = total > 0 ? Math.round((used / total) * 100) : 0
                                const usageColor = usagePct > 90 ? 'error' : usagePct > 75 ? 'warning' : 'primary'
                                return (
                                  <MenuItem key={s.id || s.storage} value={s.storage}>
                                    <Box sx={{ width: '100%' }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
                                        <Typography variant="body2" fontSize={13}>{s.storage}{!s.shared && s.node ? ` — ${s.node}` : ''}</Typography>
                                        {total > 0 && <Typography variant="caption" color="text.secondary">{formatBytes(avail)} free / {formatBytes(total)}</Typography>}
                                      </Box>
                                      {total > 0 && <LinearProgress variant="determinate" value={usagePct} color={usageColor as any} sx={{ height: 4, borderRadius: 1 }} />}
                                    </Box>
                                  </MenuItem>
                                )
                              })}
                            </Select>
                          </FormControl>
                          <FormControl size="small">
                            <InputLabel>{t('inventory.createVm.sourceStorage')}</InputLabel>
                            <Select
                              value={disk.importStorage}
                              onChange={(e) => {
                                updateDisk(diskIdx, { importStorage: e.target.value, importVolume: '' })
                                // Fetch available volumes from the source storage
                                if (e.target.value && selectedConnection && resolvedNode) {
                                  fetch(`/api/v1/connections/${encodeURIComponent(selectedConnection)}/nodes/${encodeURIComponent(resolvedNode)}/storage/${encodeURIComponent(e.target.value)}/content?content=images,import`)
                                    .then(r => r.json())
                                    .then(d => {
                                      const vols = (d.data || []).map((v: any) => ({ volid: v.volid, format: v.format, size: v.size }))
                                      setImportVolumes(prev => ({ ...prev, [`${diskIdx}:${e.target.value}`]: vols }))
                                    })
                                    .catch(() => {})
                                }
                              }}
                              label={t('inventory.createVm.sourceStorage')}
                              renderValue={(val) => { const s = diskStoragesList.find(x => x.storage === val); return s ? `${s.storage}` : String(val) }}
                            >
                              {diskStoragesList.map(s => (
                                <MenuItem key={s.id || s.storage} value={s.storage}>
                                  {s.storage} ({s.type})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <FormControl size="small">
                            <InputLabel>{t('inventory.createVm.diskImage')}</InputLabel>
                            <Select
                              value={disk.importVolume}
                              onChange={(e) => updateDisk(diskIdx, { importVolume: e.target.value })}
                              label={t('inventory.createVm.diskImage')}
                              disabled={!disk.importStorage}
                            >
                              {(importVolumes[`${diskIdx}:${disk.importStorage}`] || []).map((v: any) => (
                                <MenuItem key={v.volid} value={v.volid}>
                                  {v.volid.includes('/') ? v.volid.split('/').pop() : v.volid}
                                  {v.size ? ` (${(v.size / 1073741824).toFixed(1)} GB)` : ''}
                                </MenuItem>
                              ))}
                              {(importVolumes[`${diskIdx}:${disk.importStorage}`] || []).length === 0 && disk.importStorage && (
                                <MenuItem disabled>{t('common.noData')}</MenuItem>
                              )}
                            </Select>
                          </FormControl>
                        </Box>
                      ) : (
                        /* ── New disk mode: bus + storage + size ── */
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, mb: 2 }}>
                          <FormControl size="small">
                            <InputLabel>{t('inventory.createVm.busDevice')}</InputLabel>
                            <Select value={disk.bus} onChange={(e) => updateDisk(diskIdx, { bus: e.target.value })} label={t('inventory.createVm.busDevice')}>
                              <MenuItem value="scsi">SCSI</MenuItem>
                              <MenuItem value="virtio">VirtIO Block</MenuItem>
                              <MenuItem value="sata">SATA</MenuItem>
                              <MenuItem value="ide">IDE</MenuItem>
                            </Select>
                          </FormControl>
                          <FormControl size="small">
                            <InputLabel>{t('inventory.createVm.storage')}</InputLabel>
                            <Select value={disk.storage} onChange={(e) => updateDisk(diskIdx, { storage: e.target.value })} label={t('inventory.createVm.storage')} renderValue={(val) => { const s = diskStoragesList.find(x => x.storage === val); return s ? `${s.storage}${!s.shared && s.node ? ` — ${s.node}` : ''}` : String(val) }}>
                              {diskStoragesList.map(s => {
                                const total = s.total || 0
                                const used = s.used || 0
                                const avail = s.avail ?? (total - used)
                                const usagePct = total > 0 ? Math.round((used / total) * 100) : 0
                                const usageColor = usagePct > 90 ? 'error' : usagePct > 75 ? 'warning' : 'primary'
                                return (
                                  <MenuItem key={s.id || s.storage} value={s.storage}>
                                    <Box sx={{ width: '100%' }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
                                        <Typography variant="body2" fontSize={13}>{s.storage}{!s.shared && s.node ? ` — ${s.node}` : ''}</Typography>
                                        {total > 0 && <Typography variant="caption" color="text.secondary">{formatBytes(avail)} free / {formatBytes(total)}</Typography>}
                                      </Box>
                                      {total > 0 && <LinearProgress variant="determinate" value={usagePct} color={usageColor as any} sx={{ height: 4, borderRadius: 1 }} />}
                                    </Box>
                                  </MenuItem>
                                )
                              })}
                            </Select>
                          </FormControl>
                          <TextField
                            label={t('inventory.createVm.diskSizeGib')}
                            value={disk.size}
                            onChange={(e) => updateDisk(diskIdx, { size: Number.parseInt(e.target.value) || 0 })}
                            size="small"
                            type="number"
                          />
                        </Box>
                      )}

                      {diskIdx === 0 && (
                        <Typography variant="caption" sx={{ display: 'block', opacity: 0.5, mb: 1.5 }}>{t('inventory.createVm.scsiControllerLabel', { controller: scsiController })} — {t('inventory.createVm.format', { format: disk.format })}</Typography>
                      )}
                      {diskIdx !== 0 && (
                        <Typography variant="caption" sx={{ display: 'block', opacity: 0.5, mb: 1.5 }}>{t('inventory.createVm.format', { format: disk.format })}</Typography>
                      )}

                      {/* Advanced options */}
                      <Typography variant="caption" fontWeight={700} sx={{ display: 'block', opacity: 0.5, mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {t('inventory.createVm.advancedOptions')}
                      </Typography>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                        <FormControl size="small">
                          <InputLabel>{t('inventory.createVm.cache')}</InputLabel>
                          <Select value={disk.cache} onChange={(e) => updateDisk(diskIdx, { cache: e.target.value })} label={t('inventory.createVm.cache')}>
                            <MenuItem value="none">{t('inventory.createVm.defaultNoCache')}</MenuItem>
                            <MenuItem value="directsync">{t('inventory.createVm.directSync')}</MenuItem>
                            <MenuItem value="writethrough">{t('inventory.createVm.writeThrough')}</MenuItem>
                            <MenuItem value="writeback">{t('inventory.createVm.writeBack')}</MenuItem>
                            <MenuItem value="unsafe">{t('inventory.createVm.writeBackUnsafe')}</MenuItem>
                          </Select>
                        </FormControl>
                        <Box />
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                        <FormControlLabel control={<Switch checked={disk.discard} onChange={(e) => updateDisk(diskIdx, { discard: e.target.checked })} size="small" />} label={<Typography variant="body2" fontSize={12}>{t('inventory.createVm.discard')}</Typography>} />
                        <FormControlLabel control={<Switch checked={disk.ioThread} onChange={(e) => updateDisk(diskIdx, { ioThread: e.target.checked })} size="small" />} label={<Typography variant="body2" fontSize={12}>{t('inventory.createVm.ioThread')}</Typography>} />
                        <FormControlLabel control={<Switch checked={disk.ssd} onChange={(e) => updateDisk(diskIdx, { ssd: e.target.checked })} size="small" />} label={<Typography variant="body2" fontSize={12}>{t('inventory.createVm.ssdEmulation')}</Typography>} />
                        <FormControlLabel control={<Switch checked={disk.backup} onChange={(e) => updateDisk(diskIdx, { backup: e.target.checked })} size="small" />} label={<Typography variant="body2" fontSize={12}>{t('inventory.createVm.backup')}</Typography>} />
                      </Box>
                    </Box>
                  </Collapse>
                </Box>
              )
            })}
            <Button
              variant="outlined"
              size="small"
              startIcon={<i className="ri-add-line" />}
              onClick={addDisk}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('inventory.createVm.addDisk') || 'Add Disk'}
            </Button>
          </Stack>
        )

      case 4: // CPU
        {
          const totalVcpus = cpuSockets * cpuCores
          const cpuPresets = [1, 2, 4, 8, 16, 32]
          return (
            <Stack spacing={2}>
              {/* Quick presets */}
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{t('inventory.createVm.totalCores', { count: totalVcpus })}</Typography>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {cpuPresets.map(v => (
                    <Chip
                      key={v}
                      label={`${v} vCPU`}
                      size="small"
                      variant={totalVcpus === v ? 'filled' : 'outlined'}
                      color={totalVcpus === v ? 'primary' : 'default'}
                      onClick={() => { setCpuSockets(1); setCpuCores(v) }}
                      sx={{ fontWeight: totalVcpus === v ? 700 : 400, cursor: 'pointer' }}
                    />
                  ))}
                </Box>
              </Box>

              {/* Sockets × Cores + Type */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <NumericTextField
                  label={t('inventory.createVm.sockets')}
                  value={cpuSockets}
                  onChange={setCpuSockets}
                  fallback={1}
                  size="small"
                  type="number"
                  inputProps={{ min: 1, max: 4 }}
                />
                <NumericTextField
                  label={t('inventory.createVm.cores')}
                  value={cpuCores}
                  onChange={setCpuCores}
                  fallback={1}
                  size="small"
                  type="number"
                  inputProps={{ min: 1, max: 128 }}
                />
                <FormControl fullWidth size="small" sx={{ gridColumn: '1 / -1' }}>
                  <InputLabel>{t('inventory.createVm.cpuType')}</InputLabel>
                  <Select value={cpuType} onChange={(e) => setCpuType(e.target.value)} label={t('inventory.createVm.cpuType')}>
                    <ListSubheader>Special</ListSubheader>
                    <MenuItem value="host">host</MenuItem>
                    <MenuItem value="max">max</MenuItem>
                    <MenuItem value="kvm64">kvm64</MenuItem>
                    <MenuItem value="kvm32">kvm32</MenuItem>
                    <MenuItem value="qemu64">qemu64</MenuItem>
                    <MenuItem value="qemu32">qemu32</MenuItem>
                    <ListSubheader>x86-64 Levels</ListSubheader>
                    <MenuItem value="x86-64-v2">x86-64-v2</MenuItem>
                    <MenuItem value="x86-64-v2-AES">x86-64-v2-AES (Recommended)</MenuItem>
                    <MenuItem value="x86-64-v3">x86-64-v3</MenuItem>
                    <MenuItem value="x86-64-v4">x86-64-v4</MenuItem>
                    <ListSubheader>Intel</ListSubheader>
                    <MenuItem value="Conroe">Conroe</MenuItem>
                    <MenuItem value="Penryn">Penryn</MenuItem>
                    <MenuItem value="Nehalem">Nehalem</MenuItem>
                    <MenuItem value="Westmere">Westmere</MenuItem>
                    <MenuItem value="SandyBridge">SandyBridge</MenuItem>
                    <MenuItem value="IvyBridge">IvyBridge</MenuItem>
                    <MenuItem value="Haswell">Haswell</MenuItem>
                    <MenuItem value="Broadwell">Broadwell</MenuItem>
                    <MenuItem value="Skylake-Client">Skylake-Client</MenuItem>
                    <MenuItem value="Skylake-Server">Skylake-Server</MenuItem>
                    <MenuItem value="Cascadelake-Server">Cascadelake-Server</MenuItem>
                    <MenuItem value="Cooperlake">Cooperlake</MenuItem>
                    <MenuItem value="Icelake-Server">Icelake-Server</MenuItem>
                    <MenuItem value="SapphireRapids">SapphireRapids</MenuItem>
                    <MenuItem value="GraniteRapids">GraniteRapids</MenuItem>
                    <ListSubheader>AMD</ListSubheader>
                    <MenuItem value="Opteron_G5">Opteron G5</MenuItem>
                    <MenuItem value="EPYC">EPYC</MenuItem>
                    <MenuItem value="EPYC-Rome">EPYC-Rome</MenuItem>
                    <MenuItem value="EPYC-Milan">EPYC-Milan</MenuItem>
                    <MenuItem value="EPYC-Genoa">EPYC-Genoa</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              {/* Advanced — collapsible */}
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                <Box
                  onClick={() => setCpuAdvancedExpanded(v => !v)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
                >
                  <i className={cpuAdvancedExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                  <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createVm.advancedOptions')}</Typography>
                </Box>
                <Collapse in={cpuAdvancedExpanded}>
                  <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                    <TextField
                      label={t('inventory.createVm.vcpus')}
                      value={totalVcpus}
                      size="small"
                      disabled
                    />
                    <NumericTextField
                      label={t('inventory.createVm.cpuUnits')}
                      value={cpuUnits}
                      onChange={setCpuUnits}
                      fallback={100}
                      size="small"
                      type="number"
                    />
                    <TextField
                      label={t('inventory.createVm.cpuLimit')}
                      value={cpuLimit === 0 ? 'unlimited' : cpuLimit}
                      onChange={(e) => setCpuLimit(e.target.value === 'unlimited' ? 0 : Number.parseFloat(e.target.value) || 0)}
                      size="small"
                      placeholder="unlimited"
                    />
                    <FormControlLabel
                      control={<Switch checked={enableNuma} onChange={(e) => setEnableNuma(e.target.checked)} size="small" />}
                      label={t('inventory.createVm.enableNuma')}
                    />
                  </Box>
                </Collapse>
              </Box>
            </Stack>
          )
        }

      case 5: // Memory
        {
          const memoryMarks = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]
          const memoryToSlider = (mib: number) => {
            for (let i = memoryMarks.length - 1; i >= 0; i--) {
              if (mib >= memoryMarks[i]) return i + (mib - memoryMarks[i]) / (memoryMarks[Math.min(i + 1, memoryMarks.length - 1)] - memoryMarks[i])
            }
            return 0
          }
          const sliderToMemory = (val: number) => {
            const idx = Math.floor(val)
            const frac = val - idx
            if (idx >= memoryMarks.length - 1) return memoryMarks[memoryMarks.length - 1]
            const raw = memoryMarks[idx] + frac * (memoryMarks[idx + 1] - memoryMarks[idx])
            return Math.round(raw / 128) * 128 || 128
          }
          const formatGib = (mib: number) => mib >= 1024 ? `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GiB` : `${mib} MiB`

          return (
            <Stack spacing={2}>
              {/* Label + presets on same line */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {t('inventory.createVm.memoryMib')}: {formatGib(memorySize)}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {[512, 1024, 2048, 4096, 8192, 16384, 32768].map(v => (
                    <Chip
                      key={v}
                      label={formatGib(v)}
                      size="small"
                      variant={memorySize === v ? 'filled' : 'outlined'}
                      color={memorySize === v ? 'primary' : 'default'}
                      onClick={() => setMemorySize(v)}
                      sx={{ fontWeight: memorySize === v ? 700 : 400, cursor: 'pointer', height: 24, fontSize: 11 }}
                    />
                  ))}
                </Box>
              </Box>

              {/* Slider */}
              <Box sx={{ px: 1 }}>
                <Slider
                  value={memoryToSlider(memorySize)}
                  min={0}
                  max={memoryMarks.length - 1}
                  step={0.01}
                  onChange={(_, val) => setMemorySize(sliderToMemory(val as number))}
                  marks={memoryMarks.map((m, i) => ({ value: i, label: formatGib(m) }))}
                  valueLabelDisplay="auto"
                  valueLabelFormat={() => formatGib(memorySize)}
                  sx={{ '& .MuiSlider-markLabel': { fontSize: '0.65rem' } }}
                />
              </Box>

              <NumericTextField
                label={t('inventory.createVm.memoryMib')}
                value={memorySize}
                onChange={setMemorySize}
                fallback={512}
                size="small"
                type="number"
                inputProps={{ min: 128, step: 128 }}
                sx={{ maxWidth: 200 }}
              />

              {/* Advanced — collapsible */}
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                <Box
                  onClick={() => setMemAdvancedExpanded(v => !v)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
                >
                  <i className={memAdvancedExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                  <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createVm.advancedOptions')}</Typography>
                  <Box sx={{ flex: 1 }} />
                  {ballooning && <Chip label={t('inventory.createVm.ballooningDevice')} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                </Box>
                <Collapse in={memAdvancedExpanded}>
                  <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                    <FormControlLabel
                      control={<Switch checked={ballooning} onChange={(e) => setBallooning(e.target.checked)} size="small" />}
                      label={t('inventory.createVm.ballooningDevice')}
                      sx={{ gridColumn: '1 / -1' }}
                    />
                    <NumericTextField
                      label={t('inventory.createVm.minMemoryMib')}
                      value={minMemory}
                      onChange={setMinMemory}
                      fallback={512}
                      size="small"
                      type="number"
                      inputProps={{ min: 128, step: 128 }}
                      disabled={!ballooning}
                    />
                    <Typography variant="body2" sx={{ opacity: 0.7, alignSelf: 'center' }}>{t('inventory.createVm.sharesDefault')}</Typography>
                  </Box>
                </Collapse>
              </Box>
            </Stack>
          )
        }

      case 6: // Network
        return (
          <Stack spacing={1.5}>
            <FormControlLabel
              control={<Switch checked={noNetwork} onChange={(e) => setNoNetwork(e.target.checked)} size="small" />}
              label={t('inventory.createVm.noNetworkDevice')}
            />

            {!noNetwork && nics.map((nic, nicIdx) => {
              const isExpanded = expandedNics.has(nicIdx)
              const toggleExpand = () => setExpandedNics(s => { const n = new Set(s); n.has(nicIdx) ? n.delete(nicIdx) : n.add(nicIdx); return n })
              return (
                <Box key={nicIdx} sx={{ border: '1px solid', borderColor: isExpanded ? 'primary.main' : 'divider', borderRadius: 2, overflow: 'hidden', transition: 'border-color 0.2s' }}>
                  {/* Compact header */}
                  <Box
                    onClick={toggleExpand}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer', bgcolor: isExpanded ? alpha(theme.palette.primary.main, 0.04) : 'transparent', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) } }}
                  >
                    <i className={isExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                    <Chip label={`net${nicIdx}`} size="small" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, height: 24 }} />
                    <Typography variant="body2" fontSize={12} fontWeight={700}>{nic.bridge}</Typography>
                    <Typography variant="body2" fontSize={12} sx={{ opacity: 0.6 }}>{nic.model === 'virtio' ? 'VirtIO' : nic.model}</Typography>
                    {nic.vlanTag && <Chip label={`VLAN ${nic.vlanTag}`} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                    {nic.firewall && <Chip label="FW" size="small" color="success" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                    <Box sx={{ flex: 1 }} />
                    {nics.length > 1 && (
                      <Tooltip title="Remove NIC">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeNic(nicIdx) }} color="error" sx={{ p: 0.5 }}>
                          <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>

                  {/* Expanded content */}
                  <Collapse in={isExpanded}>
                    <Box sx={{ px: 2, pb: 2, pt: 1 }}>
                      {/* Essential fields */}
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2 }}>
                        <FormControl size="small">
                          <InputLabel>{t('inventory.createVm.bridge')}</InputLabel>
                          <Select value={nic.bridge} onChange={(e) => updateNic(nicIdx, { bridge: e.target.value })} label={t('inventory.createVm.bridge')}>
                            {bridges.length > 0 ? (
                              bridges.map((b: any) => (
                                <MenuItem key={b.iface} value={b.iface}>
                                  {b.iface}{b.type === 'OVSBridge' ? ' (OVS)' : ''}{b.comments ? ` — ${b.comments}` : ''}{b.cidr ? ` (${b.cidr})` : ''}
                                </MenuItem>
                              ))
                            ) : (
                              <MenuItem value={nic.bridge}>{nic.bridge}</MenuItem>
                            )}
                          </Select>
                        </FormControl>
                        <FormControl size="small">
                          <InputLabel>{t('inventory.createVm.model')}</InputLabel>
                          <Select value={nic.model} onChange={(e) => updateNic(nicIdx, { model: e.target.value })} label={t('inventory.createVm.model')}>
                            <MenuItem value="virtio">VirtIO (paravirtualized)</MenuItem>
                            <MenuItem value="e1000">Intel E1000</MenuItem>
                            <MenuItem value="rtl8139">Realtek RTL8139</MenuItem>
                            <MenuItem value="vmxnet3">VMware vmxnet3</MenuItem>
                          </Select>
                        </FormControl>
                        <TextField
                          label={t('inventory.createVm.vlanTag')}
                          value={nic.vlanTag}
                          onChange={(e) => updateNic(nicIdx, { vlanTag: e.target.value })}
                          size="small"
                          placeholder="no VLAN"
                        />
                        <TextField
                          label={t('inventory.createVm.macAddress')}
                          value={nic.macAddress}
                          onChange={(e) => updateNic(nicIdx, { macAddress: e.target.value })}
                          size="small"
                          placeholder="auto"
                        />
                      </Box>

                      {/* Advanced options */}
                      <Typography variant="caption" fontWeight={700} sx={{ display: 'block', opacity: 0.5, mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {t('inventory.createVm.advancedOptions')}
                      </Typography>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                        <TextField
                          label={t('inventory.createVm.rateLimitMbs')}
                          value={nic.rateLimit}
                          onChange={(e) => updateNic(nicIdx, { rateLimit: e.target.value })}
                          size="small"
                          placeholder="unlimited"
                        />
                        <TextField
                          label={t('inventory.createVm.mtu')}
                          value={nic.mtu}
                          onChange={(e) => updateNic(nicIdx, { mtu: e.target.value })}
                          size="small"
                          placeholder="1500 (1 = bridge MTU)"
                        />
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                        <FormControlLabel control={<Switch checked={nic.firewall} onChange={(e) => updateNic(nicIdx, { firewall: e.target.checked })} size="small" />} label={<Typography variant="body2" fontSize={12}>{t('inventory.createVm.firewall')}</Typography>} />
                        <FormControlLabel control={<Switch checked={nic.disconnect} onChange={(e) => updateNic(nicIdx, { disconnect: e.target.checked })} size="small" />} label={<Typography variant="body2" fontSize={12}>{t('inventory.createVm.disconnect')}</Typography>} />
                      </Box>
                    </Box>
                  </Collapse>
                </Box>
              )
            })}

            {!noNetwork && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<i className="ri-add-line" />}
                onClick={addNic}
                sx={{ alignSelf: 'flex-start' }}
              >
                {t('inventory.createVm.addNic') || 'Add NIC'}
              </Button>
            )}
          </Stack>
        )

      case 7: // Confirm
        {
          const formatGibConfirm = (mib: number) => mib >= 1024 ? `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GiB` : `${mib} MiB`
          const confirmCard = (icon: string, title: string, items: React.ReactNode) => (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <i className={icon} style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>{title}</Typography>
              </Box>
              {items}
            </Box>
          )
          return (
            <Box>
              {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('inventory.createVm.reviewSettingsVm')}
              </Alert>
              <Stack spacing={1.5}>
                {/* General */}
                {confirmCard('ri-server-line', 'General', (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    <Chip label={`Node: ${resolvedNode}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    <Chip label={`ID: ${vmid}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    {vmName && <Chip label={vmName} size="small" color="primary" sx={{ fontSize: 11 }} />}
                  </Box>
                ))}

                {/* OS */}
                {confirmCard('ri-disc-line', 'OS', (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    <Chip icon={guestOsType === 'Linux' ? <img src="/images/os/linux.svg" alt="" width={16} height={16} /> : <i className={guestOsType === 'Windows' ? 'ri-windows-fill' : 'ri-question-line'} />} label={`${guestOsType} ${guestOsVersion}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    {osMediaType === 'iso' && isoImage && <Chip label={isoImage} size="small" variant="outlined" sx={{ fontSize: 11 }} />}
                  </Box>
                ))}

                {/* System */}
                {confirmCard('ri-settings-3-line', 'System', (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    <Chip label={`${machine} / ${bios}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    <Chip label={scsiController} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    {qemuAgent && <Chip label="QEMU Agent" size="small" color="info" variant="outlined" sx={{ fontSize: 11 }} />}
                  </Box>
                ))}

                {/* Disks */}
                {confirmCard('ri-hard-drive-3-line', `${t('inventory.createVm.tabs.disks')} (${disks.length})`, (
                  <Stack spacing={0.5}>
                    {disks.map((disk, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                        <Chip label={`${disk.bus}${disk.index}`} size="small" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, height: 22 }} />
                        <Typography variant="body2" fontSize={12}>{disk.storage} — {disk.size} GiB — {disk.format}</Typography>
                      </Box>
                    ))}
                  </Stack>
                ))}

                {/* CPU + Memory side by side */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                  {confirmCard('ri-cpu-line', 'CPU', (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      <Chip label={`${cpuSockets * cpuCores} vCPU`} size="small" color="primary" sx={{ fontSize: 11, fontWeight: 700 }} />
                      <Chip label={cpuType} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                      <Chip label={`${cpuSockets}s × ${cpuCores}c`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    </Box>
                  ))}
                  {confirmCard('ri-ram-line', t('inventory.createVm.tabs.memory'), (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      <Chip label={formatGibConfirm(memorySize)} size="small" color="primary" sx={{ fontSize: 11, fontWeight: 700 }} />
                      {ballooning && <Chip label={`Balloon: ${formatGibConfirm(minMemory)}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />}
                    </Box>
                  ))}
                </Box>

                {/* Network */}
                {confirmCard('ri-global-line', `${t('inventory.createVm.tabs.network')} (${noNetwork ? 0 : nics.length})`, (
                  noNetwork ? (
                    <Typography variant="body2" fontSize={12} sx={{ opacity: 0.5 }}>No network</Typography>
                  ) : (
                    <Stack spacing={0.5}>
                      {nics.map((nic, i) => (
                        <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                          <Chip label={`net${i}`} size="small" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, height: 22 }} />
                          <Typography variant="body2" fontSize={12}>{nic.model === 'virtio' ? 'VirtIO' : nic.model} on {nic.bridge}</Typography>
                          {nic.vlanTag && <Chip label={`VLAN ${nic.vlanTag}`} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                          {nic.firewall && <Chip label="FW" size="small" color="success" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                        </Box>
                      ))}
                    </Stack>
                  )
                ))}
              </Stack>
            </Box>
          )
        }

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <AppDialogTitle
        onClose={onClose}
        icon={<i className="ri-computer-line" style={{ fontSize: 20 }} />}
        sx={{
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,150,200,0.15)' : 'primary.light',
          color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.contrastText',
          py: 1.5
        }}
      >
        Create: Virtual Machine
      </AppDialogTitle>
      
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
            disabled={creating || !vmid || !resolvedNode || !!vmidError}
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
