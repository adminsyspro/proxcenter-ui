'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Tooltip,
  Divider,
  Chip,
  InputAdornment,
  Collapse,
  IconButton,
} from '@mui/material'

import { useLicense, Features } from '@/contexts/LicenseContext'

import { formatBytes } from '@/utils/format'

// Types
type NodeInfo = {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
}

type StorageInfo = {
  storage: string
  type: string
  avail?: number
  total?: number
  shared?: number
  content?: string
}

type LocalDiskInfo = {
  id: string
  storage: string
  size: number
  format?: string
  isLocal: boolean
}

// Types CPU connus avec leur niveau de compatibilité
const CPU_COMPATIBILITY_LEVELS: Record<string, { level: number; label: string; description: string; color: string }> = {
  'qemu64': { level: 1, label: 'qemu64', description: 'Basic QEMU CPU - Maximum compatibility', color: '#9e9e9e' },
  'kvm64': { level: 2, label: 'kvm64', description: 'Basic KVM CPU', color: '#9e9e9e' },
  'x86-64-v2': { level: 3, label: 'x86-64-v2', description: 'Nehalem+ (2008+)', color: '#4caf50' },
  'x86-64-v2-AES': { level: 4, label: 'x86-64-v2-AES', description: 'Westmere+ with AES (2010+) - Recommended', color: '#4caf50' },
  'x86-64-v3': { level: 5, label: 'x86-64-v3', description: 'Haswell+ (2013+)', color: '#2196f3' },
  'x86-64-v4': { level: 6, label: 'x86-64-v4', description: 'Skylake-X+ with AVX-512 (2017+)', color: '#9c27b0' },
  'host': { level: 99, label: 'host', description: 'Pass-through host CPU - No live migration', color: '#f44336' },
}

// Mapping des modèles CPU physiques vers leur génération approximative
const CPU_MODEL_GENERATIONS: Record<string, string> = {
  'Nehalem': 'x86-64-v2',
  'Westmere': 'x86-64-v2-AES',
  'SandyBridge': 'x86-64-v2-AES',
  'IvyBridge': 'x86-64-v2-AES',
  'Haswell': 'x86-64-v3',
  'Broadwell': 'x86-64-v3',
  'Skylake': 'x86-64-v3',
  'Cascadelake': 'x86-64-v3',
  'Icelake': 'x86-64-v4',
  'Sapphirerapids': 'x86-64-v4',
  'Opteron': 'x86-64-v2',
  'EPYC': 'x86-64-v3',
  'EPYC-Rome': 'x86-64-v3',
  'EPYC-Milan': 'x86-64-v3',
  'EPYC-Genoa': 'x86-64-v4',
}

type NodeCpuInfo = {
  node: string
  cpuModel: string
  cpuFlags?: string[]
  sockets: number
  cores: number
  recommendedCpuType: string
}

// Type pour les connexions distantes (autres clusters)
type RemoteConnection = {
  id: string
  name: string
  host: string
  status?: 'online' | 'offline' | 'unknown'
  nodes?: NodeInfo[]
}

type MigrateVmDialogProps = {
  open: boolean
  onClose: () => void
  onMigrate: (targetNode: string, online: boolean, targetStorage?: string, withLocalDisks?: boolean) => Promise<void>
  onCrossClusterMigrate?: (params: CrossClusterMigrateParams) => Promise<void>
  connId: string
  currentNode: string
  vmName: string
  vmid: string
  vmStatus: string
  vmType?: 'qemu' | 'lxc'
  isCluster?: boolean // false = standalone node, only show cross-cluster migration
}

export type CrossClusterMigrateParams = {
  targetConnectionId: string
  targetNode: string
  targetVmid?: number
  targetStorage: string
  targetBridge: string
  online: boolean
  deleteSource: boolean
  bwlimit?: number
}

// Tab Panel component
function TabPanel({ children, value, index, ...other }: { children?: React.ReactNode; value: number; index: number; [key: string]: any }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`migrate-tabpanel-${index}`}
      aria-labelledby={`migrate-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  )
}

export function MigrateVmDialog({
  open,
  onClose,
  onMigrate,
  onCrossClusterMigrate,
  connId,
  currentNode,
  vmName,
  vmid,
  vmStatus,
  vmType = 'qemu',
  isCluster = true
}: MigrateVmDialogProps) {
  const t = useTranslations()
  const { hasFeature, loading: licenseLoading } = useLicense()

  // Check if cross-cluster migration feature is available
  const crossClusterAvailable = !licenseLoading && hasFeature(Features.CROSS_CLUSTER_MIGRATION)

  // Tab state: 0 = Local Migration, 1 = Cross-Cluster Migration
  const [activeTab, setActiveTab] = useState(0)
  
  // Common states
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // ========== LOCAL MIGRATION STATES ==========
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [nodesLoading, setNodesLoading] = useState(false)
  const [selectedNode, setSelectedNode] = useState<string>('')
  const [onlineMigration, setOnlineMigration] = useState(true)
  const [vmDisks, setVmDisks] = useState<LocalDiskInfo[]>([])
  const [storages, setStorages] = useState<StorageInfo[]>([])
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [selectedStorage, setSelectedStorage] = useState<string>('__current__')
  
  // CPU Compatibility states
  const [nodesCpuInfo, setNodesCpuInfo] = useState<Record<string, NodeCpuInfo>>({})
  const [vmCpuType, setVmCpuType] = useState<string>('')
  const [cpuInfoLoading, setCpuInfoLoading] = useState(false)
  
  // ========== CROSS-CLUSTER MIGRATION STATES ==========
  const [remoteConnections, setRemoteConnections] = useState<RemoteConnection[]>([])
  const [remoteConnectionsLoading, setRemoteConnectionsLoading] = useState(false)
  const [selectedRemoteConn, setSelectedRemoteConn] = useState<string>('')
  const [remoteNodes, setRemoteNodes] = useState<NodeInfo[]>([])
  const [remoteNodesLoading, setRemoteNodesLoading] = useState(false)
  const [selectedRemoteNode, setSelectedRemoteNode] = useState<string>('')
  const [remoteStorages, setRemoteStorages] = useState<StorageInfo[]>([])
  const [remoteStoragesLoading, setRemoteStoragesLoading] = useState(false)
  const [selectedRemoteStorage, setSelectedRemoteStorage] = useState<string>('')
  const [remoteBridges, setRemoteBridges] = useState<string[]>([])
  const [remoteBridgesLoading, setRemoteBridgesLoading] = useState(false)
  const [selectedRemoteBridge, setSelectedRemoteBridge] = useState<string>('')
  const [targetVmid, setTargetVmid] = useState<number | ''>('')
  const [deleteSourceAfter, setDeleteSourceAfter] = useState(false)
  const [bwLimit, setBwLimit] = useState<number | ''>('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  // ========== HA STATE ==========
  const [isHaManaged, setIsHaManaged] = useState(false)
  const [haState, setHaState] = useState<string>('')
  const [haGroup, setHaGroup] = useState<string>('')
  const [haLoading, setHaLoading] = useState(false)
  const [haRemoving, setHaRemoving] = useState(false)
  
  // ========== PRE-MIGRATION VALIDATION ==========
  type ValidationIssue = {
    type: 'error' | 'warning'
    code: string
    message: string
    details?: string
  }
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [validationLoading, setValidationLoading] = useState(false)
  const [validationDone, setValidationDone] = useState(false)
  
  // Calculer les stockages actuels uniques
  const currentStorageNames = useMemo(() => {
    const names = [...new Set(vmDisks.map(d => d.storage))]
    return names.sort()
  }, [vmDisks])
  
  // Vérifier si la VM a des disques locaux
  const hasLocalDisks = useMemo(() => {
    return vmDisks.some(d => d.isLocal)
  }, [vmDisks])
  
  // Reset states when dialog opens
  useEffect(() => {
    if (open) {
      // If standalone (not cluster), default to cross-cluster tab
      setActiveTab(isCluster ? 0 : 1)
      setError(null)
      setSelectedNode('')
      setSelectedRemoteConn('')
      setSelectedRemoteNode('')
      setSelectedRemoteStorage('')
      setSelectedRemoteBridge('')
      setTargetVmid('')
      setDeleteSourceAfter(false)
      setBwLimit('')
      setIsHaManaged(false)
      setHaState('')
      setHaGroup('')
      setValidationIssues([])
      setValidationDone(false)
    }
  }, [open])
  
  // ========== LOCAL MIGRATION: Load nodes ==========
  useEffect(() => {
    if (!open || !connId || activeTab !== 0) return
    
    const loadNodes = async () => {
      setNodesLoading(true)
      setError(null)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const availableNodes = json.data
            .filter((n: any) => n.node !== currentNode && n.status === 'online' && n.hastate !== 'maintenance')
            .map((n: NodeInfo) => ({
              node: n.node,
              status: n.status,
              cpu: n.cpu,
              maxcpu: n.maxcpu,
              mem: n.mem,
              maxmem: n.maxmem
            }))

          setNodes(availableNodes)

          if (availableNodes.length > 0) {
            const recommended = getRecommendedNode(availableNodes)
            setSelectedNode(recommended.node)
          }
        }
      } catch (e: any) {
        console.error('Error loading nodes:', e)
        setError('Failed to load nodes list')
      } finally {
        setNodesLoading(false)
      }
    }

    loadNodes()
  }, [open, connId, currentNode, activeTab])
  
  // ========== LOCAL MIGRATION: Load VM config to detect disks ==========
  useEffect(() => {
    if (!open || !connId || !vmid || !currentNode) return
    
    const loadVmConfig = async () => {
      try {
        let configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/${vmType}/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)
        
        if (!configRes.ok) {
          setVmDisks([])
          return
        }
        
        const configJson = await configRes.json()
        const config = configJson.data || {}
        
        const foundDisks: LocalDiskInfo[] = []
        const diskPatterns = vmType === 'qemu' 
          ? /^(scsi|virtio|ide|sata|efidisk|tpmstate)\d+$/
          : /^(rootfs|mp\d+)$/
        
        for (const [key, value] of Object.entries(config)) {
          if (diskPatterns.test(key) && typeof value === 'string') {
            const diskStr = value as string
            const storageMatch = diskStr.match(/^([^:]+):/)
            
            if (storageMatch) {
              const storageName = storageMatch[1]
              const sizeMatch = diskStr.match(/size=(\d+(?:\.\d+)?)(G|T|M)?/)
              let sizeGB = 0
              if (sizeMatch) {
                sizeGB = parseFloat(sizeMatch[1])
                if (sizeMatch[2] === 'T') sizeGB *= 1024
                else if (sizeMatch[2] === 'M') sizeGB /= 1024
              }
              
              const formatMatch = diskStr.match(/\.(qcow2|raw|vmdk)/)
              const isLocal = storageName.startsWith('local')
              
              foundDisks.push({
                id: key,
                storage: storageName,
                size: sizeGB,
                format: formatMatch ? formatMatch[1] : undefined,
                isLocal
              })
            }
          }
        }
        
        setVmDisks(foundDisks)
        
        // Also get CPU type
        const cpuConfig = config.cpu || ''
        const cpuTypeMatch = cpuConfig.match(/^([^,]+)/)
        if (cpuTypeMatch) {
          setVmCpuType(cpuTypeMatch[1])
        } else if (vmType === 'lxc') {
          setVmCpuType('host')
        }
      } catch (e) {
        console.error('Error loading VM config:', e)
        setVmDisks([])
      }
    }
    
    loadVmConfig()
  }, [open, connId, vmid, currentNode, vmType])
  
  // ========== LOAD HA STATUS ==========
  useEffect(() => {
    if (!open || !connId || !vmid) return
    
    const loadHaStatus = async () => {
      setHaLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha`)
        
        if (!res.ok) {
          setIsHaManaged(false)
          return
        }
        
        const json = await res.json()
        const resources = json.data?.resources || []
        
        // Chercher si cette VM est dans les ressources HA
        // Le format du sid est "vm:VMID" ou "ct:VMID"
        const vmSid = `${vmType === 'lxc' ? 'ct' : 'vm'}:${vmid}`
        const haResource = resources.find((r: any) => r.sid === vmSid)
        
        if (haResource) {
          setIsHaManaged(true)
          setHaState(haResource.state || 'unknown')
          setHaGroup(haResource.group || '')
        } else {
          setIsHaManaged(false)
          setHaState('')
          setHaGroup('')
        }
      } catch (e) {
        console.error('Error loading HA status:', e)
        setIsHaManaged(false)
      } finally {
        setHaLoading(false)
      }
    }
    
    loadHaStatus()
  }, [open, connId, vmid, vmType])
  
  // ========== LOCAL MIGRATION: Load storages for selected node ==========
  useEffect(() => {
    if (!open || !connId || !selectedNode || activeTab !== 0) {
      setStorages([])
      return
    }
    
    const loadStorages = async () => {
      setStoragesLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(selectedNode)}/storages`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const diskStorages = json.data
            .filter((s: StorageInfo) => {
              const content = s.content || ''
              return content.includes('images') || content.includes('rootdir')
            })
            .map((s: StorageInfo) => ({
              storage: s.storage,
              type: s.type,
              avail: s.avail,
              total: s.total,
              shared: s.shared,
              content: s.content
            }))
          
          setStorages(diskStorages)
        }
      } catch (e) {
        console.error('Error loading storages:', e)
        setStorages([])
      } finally {
        setStoragesLoading(false)
      }
    }
    
    loadStorages()
    setSelectedStorage('__current__')
  }, [open, connId, selectedNode, activeTab])
  
  // ========== CROSS-CLUSTER: Load available connections ==========
  useEffect(() => {
    if (!open || activeTab !== 1) return
    
    const loadConnections = async () => {
      setRemoteConnectionsLoading(true)
      
      try {
        // Only fetch PVE connections (not PBS)
        const res = await fetch('/api/v1/connections?type=pve')
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          // Filter out current connection and ensure only PVE type
          const otherConnections = json.data
            .filter((c: any) => c.id !== connId && c.type === 'pve')
            .map((c: any) => ({
              id: c.id,
              name: c.name || c.baseUrl,
              host: c.baseUrl,
              status: c.status || 'unknown'
            }))
          
          setRemoteConnections(otherConnections)
        }
      } catch (e) {
        console.error('Error loading connections:', e)
        setRemoteConnections([])
      } finally {
        setRemoteConnectionsLoading(false)
      }
    }
    
    loadConnections()
  }, [open, activeTab, connId])
  
  // ========== CROSS-CLUSTER: Load nodes from selected remote connection ==========
  useEffect(() => {
    if (!open || !selectedRemoteConn || activeTab !== 1) {
      setRemoteNodes([])
      return
    }
    
    const loadRemoteNodes = async () => {
      setRemoteNodesLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(selectedRemoteConn)}/nodes`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const availableNodes = json.data
            .filter((n: any) => n.status === 'online' && n.hastate !== 'maintenance')
            .map((n: NodeInfo) => ({
              node: n.node,
              status: n.status,
              cpu: n.cpu,
              maxcpu: n.maxcpu,
              mem: n.mem,
              maxmem: n.maxmem
            }))

          setRemoteNodes(availableNodes)

          if (availableNodes.length > 0) {
            setSelectedRemoteNode(availableNodes[0].node)
          }
        }
      } catch (e) {
        console.error('Error loading remote nodes:', e)
        setRemoteNodes([])
      } finally {
        setRemoteNodesLoading(false)
      }
    }
    
    loadRemoteNodes()
  }, [open, selectedRemoteConn, activeTab])
  
  // ========== CROSS-CLUSTER: Load storages and bridges from remote node ==========
  useEffect(() => {
    if (!open || !selectedRemoteConn || !selectedRemoteNode || activeTab !== 1) {
      setRemoteStorages([])
      setRemoteBridges([])
      return
    }
    
    const loadRemoteResources = async () => {
      setRemoteStoragesLoading(true)
      setRemoteBridgesLoading(true)
      setSelectedRemoteStorage('')
      setSelectedRemoteBridge('')
      
      try {
        // Load storages
        const storageRes = await fetch(`/api/v1/connections/${encodeURIComponent(selectedRemoteConn)}/nodes/${encodeURIComponent(selectedRemoteNode)}/storages`)
        const storageJson = await storageRes.json()
        
        if (storageJson.data && Array.isArray(storageJson.data)) {
          const diskStorages = storageJson.data
            .filter((s: StorageInfo) => {
              const content = s.content || ''
              return content.includes('images') || content.includes('rootdir')
            })
          setRemoteStorages(diskStorages)
          
          if (diskStorages.length > 0 && !selectedRemoteStorage) {
            setSelectedRemoteStorage(diskStorages[0].storage)
          }
        }
        
        // Load network bridges
        const networkRes = await fetch(`/api/v1/connections/${encodeURIComponent(selectedRemoteConn)}/nodes/${encodeURIComponent(selectedRemoteNode)}/network`)
        const networkJson = await networkRes.json()
        
        if (networkJson.data && Array.isArray(networkJson.data)) {
          const bridges = networkJson.data
            .filter((n: any) => n.type === 'bridge' || n.type === 'OVSBridge')
            .map((n: any) => n.iface)
          setRemoteBridges(bridges)
          
          if (bridges.length > 0 && !selectedRemoteBridge) {
            // Default to vmbr0 if exists
            setSelectedRemoteBridge(bridges.includes('vmbr0') ? 'vmbr0' : bridges[0])
          }
        }
      } catch (e) {
        console.error('Error loading remote resources:', e)
      } finally {
        setRemoteStoragesLoading(false)
        setRemoteBridgesLoading(false)
      }
    }
    
    loadRemoteResources()
  }, [open, selectedRemoteConn, selectedRemoteNode, activeTab])
  
  // Helper functions
  const getRecommendedNode = (nodeList: NodeInfo[]): NodeInfo => {
    return nodeList.reduce((best, current) => {
      const bestScore = calculateNodeScore(best)
      const currentScore = calculateNodeScore(current)
      return currentScore > bestScore ? current : best
    }, nodeList[0])
  }
  
  const calculateNodeScore = (node: NodeInfo): number => {
    const cpuFree = node.maxcpu ? (1 - (node.cpu || 0)) * 100 : 50
    const memFree = node.maxmem && node.mem ? ((node.maxmem - node.mem) / node.maxmem) * 100 : 50
    return cpuFree * 0.4 + memFree * 0.6
  }
  
  const formatMemory = (bytes?: number): string => {
    if (!bytes) return '—'
    const gb = bytes / 1024 / 1024 / 1024
    return `${gb.toFixed(1)} GB`
  }
  
  const formatCpu = (cpu?: number): string => {
    if (cpu === undefined) return '—'
    return `${(cpu * 100).toFixed(0)}%`
  }
  
  const getMemoryPercent = (node: NodeInfo): number => {
    if (!node.maxmem || !node.mem) return 0
    return (node.mem / node.maxmem) * 100
  }
  
  const getCpuPercent = (node: NodeInfo): number => {
    return (node.cpu || 0) * 100
  }
  
  const isRecommended = (node: NodeInfo): boolean => {
    if (nodes.length === 0) return false
    const recommended = getRecommendedNode(nodes)
    return recommended.node === node.node
  }
  
  // Handle local migration
  const handleLocalMigrate = async () => {
    if (!selectedNode) {
      setError(t('hardware.selectDestinationNode'))
      return
    }
    
    setMigrating(true)
    setError(null)
    
    try {
      const targetStorage = selectedStorage !== '__current__' ? selectedStorage : undefined
      const withLocalDisks = hasLocalDisks || !!targetStorage
      await onMigrate(selectedNode, onlineMigration, targetStorage, withLocalDisks)
      onClose()
    } catch (e: any) {
      setError(e.message || t('hardware.migrationError'))
    } finally {
      setMigrating(false)
    }
  }
  
  // Handle cross-cluster migration
  const handleCrossClusterMigrate = async () => {
    if (!selectedRemoteConn || !selectedRemoteNode || !selectedRemoteStorage || !selectedRemoteBridge) {
      setError('Please fill all required fields')
      return
    }
    
    if (!onCrossClusterMigrate) {
      setError('Cross-cluster migration is not configured')
      return
    }
    
    setMigrating(true)
    setError(null)
    
    try {
      await onCrossClusterMigrate({
        targetConnectionId: selectedRemoteConn,
        targetNode: selectedRemoteNode,
        targetVmid: targetVmid ? Number(targetVmid) : undefined,
        targetStorage: selectedRemoteStorage,
        targetBridge: selectedRemoteBridge,
        online: onlineMigration && vmStatus === 'running',
        deleteSource: deleteSourceAfter,
        bwlimit: bwLimit ? Number(bwLimit) : undefined,
      })
      onClose()
    } catch (e: any) {
      setError(e.message || 'Cross-cluster migration failed')
    } finally {
      setMigrating(false)
    }
  }
  
  // Handle HA removal
  const handleRemoveHa = async () => {
    setHaRemoving(true)
    setError(null)
    
    try {
      const sid = `${vmType === 'lxc' ? 'ct' : 'vm'}:${vmid}`
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/ha/${encodeURIComponent(sid)}`,
        { method: 'DELETE' }
      )
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `HTTP ${res.status}`)
      }
      
      // Rafraîchir le statut HA après suppression
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Recharger le statut HA
      const haRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha`)
      if (haRes.ok) {
        const haJson = await haRes.json()
        const resources = haJson.data?.resources || []
        const vmSid = `${vmType === 'lxc' ? 'ct' : 'vm'}:${vmid}`
        const haResource = resources.find((r: any) => r.sid === vmSid)
        
        if (haResource) {
          setIsHaManaged(true)
          setHaState(haResource.state || 'unknown')
          setHaGroup(haResource.group || '')
        } else {
          setIsHaManaged(false)
          setHaState('')
          setHaGroup('')
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to remove HA')
    } finally {
      setHaRemoving(false)
    }
  }
  
  // Validate cross-cluster migration compatibility
  const validateCrossClusterMigration = async () => {
    if (!selectedRemoteConn || !selectedRemoteNode || !selectedRemoteStorage || !selectedRemoteBridge) {
      return
    }
    
    setValidationLoading(true)
    setValidationIssues([])
    
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${vmType}/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/remote-migrate/check`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetConnectionId: selectedRemoteConn,
            targetNode: selectedRemoteNode,
            targetStorage: selectedRemoteStorage,
            targetBridge: selectedRemoteBridge,
          })
        }
      )
      
      if (res.ok) {
        const data = await res.json()
        setValidationIssues(data.issues || [])
        setValidationDone(true)
      }
    } catch (e) {
      console.error('Validation failed:', e)
    } finally {
      setValidationLoading(false)
    }
  }
  
  // Auto-validate when all required fields are filled
  useEffect(() => {
    if (activeTab === 1 && selectedRemoteConn && selectedRemoteNode && selectedRemoteStorage && selectedRemoteBridge) {
      setValidationDone(false)
      const timer = setTimeout(() => {
        validateCrossClusterMigration()
      }, 500) // Debounce
      return () => clearTimeout(timer)
    }
  }, [activeTab, selectedRemoteConn, selectedRemoteNode, selectedRemoteStorage, selectedRemoteBridge])
  
  const isVmRunning = vmStatus === 'running'
  const hasValidationErrors = validationIssues.some(i => i.type === 'error')
  const hasValidationWarnings = validationIssues.some(i => i.type === 'warning')
  const selectedRemoteConnInfo = remoteConnections.find(c => c.id === selectedRemoteConn)
  
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <i className="ri-swap-box-line" style={{ fontSize: 24 }} />
        <Box>
          <Typography variant="h6" component="span">
            {t('hardware.migrateTitle', { vmName, vmid })}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.7 }}>
            {currentNode} • {vmType.toUpperCase()} • {vmStatus}
          </Typography>
        </Box>
      </DialogTitle>
      
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        {isCluster ? (
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            sx={{
              minHeight: 42,
              '& .MuiTab-root': {
                minHeight: 42,
                textTransform: 'none',
                fontWeight: 500,
              }
            }}
          >
            <Tab
              icon={<i className="ri-server-line" style={{ fontSize: 16 }} />}
              iconPosition="start"
              label={t('hardware.localMigration')}
              sx={{ gap: 1 }}
            />
            <Tab
              icon={<i className="ri-global-line" style={{ fontSize: 16, opacity: crossClusterAvailable ? 1 : 0.4 }} />}
              iconPosition="start"
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: crossClusterAvailable ? 1 : 0.5 }}>
                  {t('hardware.crossCluster.tabLabel')}
                  {crossClusterAvailable ? (
                    <Chip
                      label={t('hardware.crossCluster.beta')}
                      size="small"
                      color="warning"
                      sx={{ height: 18, fontSize: '0.6rem' }}
                    />
                  ) : (
                    <Chip
                      label="Enterprise"
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText'
                      }}
                    />
                  )}
                </Box>
              }
              sx={{ gap: 1 }}
              disabled={!onCrossClusterMigrate || !crossClusterAvailable}
            />
          </Tabs>
        ) : (
          /* Standalone: only cross-cluster migration available */
          <Box sx={{ py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-global-line" style={{ fontSize: 18 }} />
            <Typography variant="subtitle2" fontWeight={600}>
              {t('hardware.crossCluster.tabLabel')}
            </Typography>
            {crossClusterAvailable ? (
              <Chip
                label={t('hardware.crossCluster.beta')}
                size="small"
                color="warning"
                sx={{ height: 18, fontSize: '0.6rem' }}
              />
            ) : (
              <Chip
                label="Enterprise"
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText'
                }}
              />
            )}
          </Box>
        )}
      </Box>
      
      <DialogContent sx={{ minHeight: 400 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        
        {/* ========== TAB 0: LOCAL MIGRATION ========== */}
        <TabPanel value={activeTab} index={0}>
          <Stack spacing={2}>
            <Alert severity="info" icon={<i className="ri-server-line" />}>
              <Typography variant="body2">
                {t('hardware.currentNode')} <strong>{currentNode}</strong>
              </Typography>
            </Alert>
            
            {/* Warning for local disks */}
            {hasLocalDisks && (
              <Alert severity="warning" icon={<i className="ri-alert-line" />}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                  {t('hardware.localDiskMigration')}
                </Typography>
                {vmDisks.filter(d => d.isLocal).map((disk, idx) => (
                  <Typography key={idx} variant="caption" component="div" sx={{ opacity: 0.9 }}>
                    {disk.storage}:{vmid}/{disk.id}{disk.format ? `.${disk.format}` : ''} ({disk.size.toFixed(2)} GiB)
                  </Typography>
                ))}
              </Alert>
            )}
            
            <Typography variant="subtitle2">
              {t('hardware.selectDestinationNodeLabel')}
            </Typography>
            
            {nodesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={32} />
              </Box>
            ) : nodes.length === 0 ? (
              <Alert severity="warning">
                {t('hardware.noNodeAvailable')}
              </Alert>
            ) : (
              <Stack spacing={0.5}>
                {nodes.map((node) => {
                  const cpuPercent = getCpuPercent(node)
                  const memPercent = getMemoryPercent(node)
                  const recommended = isRecommended(node)

                  return (
                    <Box
                      key={node.node}
                      onClick={() => setSelectedNode(node.node)}
                      sx={{
                        px: 1.25,
                        py: 0.75,
                        border: '1px solid',
                        borderColor: selectedNode === node.node ? 'primary.main' : 'divider',
                        borderRadius: 1.5,
                        cursor: 'pointer',
                        bgcolor: selectedNode === node.node ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        position: 'relative',
                      }}
                    >
                      {recommended && (
                        <Tooltip title={t('hardware.recommended')} arrow>
                          <Box sx={{ position: 'absolute', top: -8, right: -8, color: 'warning.main', fontSize: 16, lineHeight: 1, bgcolor: 'background.paper', borderRadius: '50%', display: 'flex' }}>
                            <i className="ri-star-fill" />
                          </Box>
                        </Tooltip>
                      )}

                      <Typography variant="body2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 100, flexShrink: 0 }}>
                        <i className="ri-server-line" style={{ fontSize: 14, opacity: 0.7 }} />
                        {node.node}
                      </Typography>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1 }}>
                        <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.6, minWidth: 22 }}>CPU</Typography>
                        <Box sx={{ flex: 1, position: 'relative' }}>
                          <Box sx={{ height: 14, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${cpuPercent}%`, bgcolor: cpuPercent > 90 ? 'error.main' : 'primary.main', borderRadius: 0 }} />
                          </Box>
                          <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                            {formatCpu(node.cpu)}
                          </Typography>
                        </Box>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1 }}>
                        <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.6, minWidth: 26 }}>RAM</Typography>
                        <Box sx={{ flex: 1, position: 'relative' }}>
                          <Box sx={{ height: 14, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${memPercent}%`, bgcolor: memPercent > 90 ? 'error.main' : 'primary.main', borderRadius: 0 }} />
                          </Box>
                          <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                            {Math.round(memPercent)}%
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  )
                })}
              </Stack>
            )}
            
            {/* Storage selector */}
            {nodes.length > 0 && selectedNode && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  {t('hardware.targetStorageLabel')}
                </Typography>
                
                {storagesLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">
                      {t('hardware.loadingStorages')}
                    </Typography>
                  </Box>
                ) : (
                  <FormControl fullWidth size="small" disabled={!hasLocalDisks}>
                    <Select
                      value={hasLocalDisks ? selectedStorage : '__current__'}
                      onChange={(e) => setSelectedStorage(e.target.value)}
                    >
                      <MenuItem value="__current__">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-layout-line" style={{ fontSize: 16, opacity: 0.7 }} />
                          <Typography variant="body2">
                            {t('hardware.keepCurrentStorage', { storage: currentStorageNames.join(', ') || '...' })}
                          </Typography>
                        </Box>
                      </MenuItem>
                      
                      {hasLocalDisks && storages.length > 0 && <Divider sx={{ my: 0.5 }} />}
                      
                      {hasLocalDisks && storages.map((storage) => (
                        <MenuItem key={storage.storage} value={storage.storage}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-hard-drive-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                              <Typography variant="body2">{storage.storage}</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <Chip label={storage.type} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
                              <Typography variant="caption" color="text.secondary">
                                {formatBytes(storage.avail)}
                              </Typography>
                            </Box>
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </>
            )}
            
            {nodes.length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                
                <FormControlLabel
                  control={
                    <Checkbox 
                      checked={onlineMigration} 
                      onChange={(e) => setOnlineMigration(e.target.checked)} 
                      size="small"
                      disabled={!isVmRunning}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{t('hardware.onlineMigration')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {isVmRunning
                          ? t('hardware.vmWillStayActive')
                          : t('hardware.onlineOnlyFeature')}
                      </Typography>
                    </Box>
                  }
                />
              </>
            )}
          </Stack>
        </TabPanel>
        
        {/* ========== TAB 1: CROSS-CLUSTER MIGRATION ========== */}
        <TabPanel value={activeTab} index={1}>
          <Stack spacing={2.5}>
            {/* Warning for LXC containers */}
            {vmType === 'lxc' && (
              <Alert severity="warning" icon={<i className="ri-alert-line" />}>
                <Typography variant="body2" fontWeight={600}>
                  {t('hardware.crossCluster.lxcNotSupported')}
                </Typography>
                <Typography variant="caption">
                  {t('hardware.crossCluster.lxcNotSupportedDesc')}
                </Typography>
              </Alert>
            )}
            
            {/* Warning for HA-managed VMs */}
            {isHaManaged && (
              <Alert severity="error" icon={<i className="ri-shield-check-line" />}>
                <Typography variant="body2" fontWeight={600}>
                  {t('hardware.crossCluster.haNotSupported')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Typography variant="caption">
                    {t('hardware.crossCluster.haNotSupportedDesc')}{haGroup ? ` ${t('hardware.crossCluster.haInGroup', { group: haGroup })}` : ''}.
                    {' '}{t('hardware.crossCluster.haCurrentState')}
                  </Typography>
                  <Chip
                    icon={<i className="ri-shield-check-line" style={{ fontSize: 12 }} />}
                    label={`HA: ${haState || 'managed'}`}
                    size="small"
                    color="error"
                    sx={{ height: 20, fontSize: '0.65rem' }}
                  />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Typography variant="caption">
                    {t('hardware.crossCluster.haRemoveInstructions')}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={handleRemoveHa}
                    disabled={haRemoving}
                    startIcon={haRemoving ? <CircularProgress size={14} /> : <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />}
                    sx={{ 
                      height: 26, 
                      fontSize: '0.7rem',
                      textTransform: 'none',
                      minWidth: 'auto',
                      px: 1.5
                    }}
                  >
                    {haRemoving ? t('common.loading') : t('hardware.crossCluster.haRemoveButton')}
                  </Button>
                </Box>
              </Alert>
            )}
            
            {/* Source info */}
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('hardware.crossCluster.source')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-computer-line" style={{ fontSize: 20 }} />
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={600}>{vmName}</Typography>
                      {isHaManaged && (
                        <Chip
                          icon={<i className="ri-shield-check-line" style={{ fontSize: 12 }} />}
                          label={`HA: ${haState || 'managed'}`}
                          size="small"
                          color="error"
                          sx={{ height: 20, fontSize: '0.65rem' }}
                        />
                      )}
                    </Box>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      VMID {vmid} • {currentNode}
                    </Typography>
                  </Box>
                </Box>
                {vmDisks.length > 0 && (
                  <Chip
                    icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 12 }} />}
                    label={`${vmDisks.length} disk${vmDisks.length > 1 ? 's' : ''} (${vmDisks.reduce((acc, d) => acc + d.size, 0).toFixed(1)} GiB)`}
                    size="small"
                    variant="outlined"
                    sx={{ height: 22, fontSize: '0.65rem' }}
                  />
                )}
              </Box>
            </Box>
            
            <Box sx={{ display: 'flex', justifyContent: 'center', my: -1 }}>
              <i className="ri-arrow-down-line" style={{ fontSize: 24, opacity: 0.3 }} />
            </Box>
            
            {/* Target Cluster Selection */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-global-line" style={{ fontSize: 16 }} />
                {t('hardware.crossCluster.targetCluster')}
              </Typography>
              
              {remoteConnectionsLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" color="text.secondary">{t('hardware.crossCluster.loadingConnections')}</Typography>
                </Box>
              ) : remoteConnections.length === 0 ? (
                <Alert severity="warning">
                  {t('hardware.crossCluster.noConnectionsAvailable')}
                </Alert>
              ) : (
                <FormControl fullWidth size="small">
                  <InputLabel>{t('hardware.crossCluster.selectTargetCluster')}</InputLabel>
                  <Select
                    value={selectedRemoteConn}
                    onChange={(e) => {
                      setSelectedRemoteConn(e.target.value)
                      setSelectedRemoteNode('')
                      setSelectedRemoteStorage('')
                      setSelectedRemoteBridge('')
                    }}
                    label={t('hardware.crossCluster.selectTargetCluster')}
                  >
                    {remoteConnections.map((conn) => (
                      <MenuItem key={conn.id} value={conn.id}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                          <i className={conn.status === 'online' ? 'ri-checkbox-circle-fill' : conn.status === 'offline' ? 'ri-close-circle-fill' : 'ri-server-line'} 
                             style={{ fontSize: 14, color: conn.status === 'online' ? '#4caf50' : conn.status === 'offline' ? '#f44336' : 'inherit' }} />
                          <Typography variant="body2" fontWeight={500}>{conn.name}</Typography>
                          <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{conn.host}</Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Box>
            
            {/* Target Node Selection */}
            {selectedRemoteConn && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-server-line" style={{ fontSize: 16 }} />
                  {t('hardware.crossCluster.targetNode')}
                </Typography>
                
                {remoteNodesLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">{t('hardware.crossCluster.loadingNodes')}</Typography>
                  </Box>
                ) : remoteNodes.length === 0 ? (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    {t('hardware.noNodeAvailable')}
                  </Alert>
                ) : (
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('hardware.crossCluster.selectTargetNode')}</InputLabel>
                    <Select
                      value={selectedRemoteNode}
                      onChange={(e) => {
                        setSelectedRemoteNode(e.target.value)
                        setSelectedRemoteStorage('')
                        setSelectedRemoteBridge('')
                      }}
                      label={t('hardware.crossCluster.selectTargetNode')}
                    >
                      {remoteNodes.map((node) => (
                        <MenuItem key={node.node} value={node.node}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <Typography variant="body2">{node.node}</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                CPU {formatCpu(node.cpu)} • RAM {formatMemory(node.mem)}/{formatMemory(node.maxmem)}
                              </Typography>
                              <Chip 
                                label={node.status} 
                                size="small" 
                                color={node.status === 'online' ? 'success' : 'default'}
                                sx={{ height: 18, fontSize: '0.6rem' }}
                              />
                            </Box>
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Box>
            )}
            
            {/* Target Storage and Bridge */}
            {selectedRemoteNode && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                    {t('hardware.crossCluster.targetStorage')}
                  </Typography>
                  
                  {remoteStoragesLoading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <FormControl fullWidth size="small">
                      <InputLabel>Storage</InputLabel>
                      <Select
                        value={selectedRemoteStorage}
                        onChange={(e) => setSelectedRemoteStorage(e.target.value)}
                        label="Storage"
                      >
                        {remoteStorages.map((s) => (
                          <MenuItem key={s.storage} value={s.storage}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                              <Typography variant="body2">{s.storage}</Typography>
                              <Chip label={s.type} size="small" sx={{ height: 16, fontSize: '0.6rem' }} />
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
                
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-git-branch-line" style={{ fontSize: 16 }} />
                    {t('hardware.crossCluster.targetBridge')}
                  </Typography>
                  
                  {remoteBridgesLoading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('hardware.crossCluster.networkBridge')}</InputLabel>
                      <Select
                        value={selectedRemoteBridge}
                        onChange={(e) => setSelectedRemoteBridge(e.target.value)}
                        label={t('hardware.crossCluster.networkBridge')}
                      >
                        {remoteBridges.map((bridge) => (
                          <MenuItem key={bridge} value={bridge}>
                            {bridge}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
              </Box>
            )}
            
            {/* Validation Results */}
            {selectedRemoteNode && selectedRemoteStorage && selectedRemoteBridge && (
              <Box sx={{ mt: 1 }}>
                {validationLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">
                      {t('hardware.crossCluster.validating')}
                    </Typography>
                  </Box>
                ) : validationDone && validationIssues.length > 0 ? (
                  <Stack spacing={1}>
                    {validationIssues.map((issue, idx) => (
                      <Alert 
                        key={idx} 
                        severity={issue.type === 'error' ? 'error' : 'warning'}
                        sx={{ py: 0.5 }}
                        icon={<i className={issue.type === 'error' ? 'ri-close-circle-line' : 'ri-alert-line'} style={{ fontSize: 18 }} />}
                      >
                        <Typography variant="body2" fontWeight={500}>
                          {issue.message}
                        </Typography>
                        {issue.details && (
                          <Typography variant="caption" sx={{ opacity: 0.8 }}>
                            {issue.details}
                          </Typography>
                        )}
                      </Alert>
                    ))}
                  </Stack>
                ) : validationDone && validationIssues.length === 0 ? (
                  <Alert severity="success" sx={{ py: 0.5 }} icon={<i className="ri-checkbox-circle-line" style={{ fontSize: 18 }} />}>
                    <Typography variant="body2">
                      {t('hardware.crossCluster.validationSuccess')}
                    </Typography>
                  </Alert>
                ) : null}
              </Box>
            )}
            
            {/* Advanced Options */}
            {selectedRemoteNode && (
              <>
                <Box 
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 1, 
                    cursor: 'pointer',
                    opacity: 0.8,
                    '&:hover': { opacity: 1 }
                  }}
                >
                  <i className={showAdvanced ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
                  <Typography variant="body2" fontWeight={500}>{t('hardware.crossCluster.advancedOptions')}</Typography>
                </Box>
                
                <Collapse in={showAdvanced}>
                  <Stack spacing={2} sx={{ pl: 2, pt: 1 }}>
                    <TextField
                      label={t('hardware.crossCluster.targetVmId')}
                      type="number"
                      size="small"
                      value={targetVmid}
                      onChange={(e) => setTargetVmid(e.target.value ? parseInt(e.target.value) : '')}
                      helperText={t('hardware.crossCluster.targetVmIdHelp')}
                      inputProps={{ min: 100, max: 999999999 }}
                    />
                    
                    <TextField
                      label={t('hardware.crossCluster.bandwidthLimit')}
                      type="number"
                      size="small"
                      value={bwLimit}
                      onChange={(e) => setBwLimit(e.target.value ? parseInt(e.target.value) : '')}
                      helperText={t('hardware.crossCluster.bandwidthLimitHelp')}
                      InputProps={{
                        endAdornment: <InputAdornment position="end">KiB/s</InputAdornment>
                      }}
                    />
                    
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={deleteSourceAfter}
                          onChange={(e) => setDeleteSourceAfter(e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2">{t('hardware.crossCluster.deleteSourceVm')}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('hardware.crossCluster.deleteSourceVmDesc')}
                          </Typography>
                        </Box>
                      }
                    />
                  </Stack>
                </Collapse>
              </>
            )}
            
            {/* Online migration option */}
            {selectedRemoteNode && (
              <>
                <Divider />
                
                <FormControlLabel
                  control={
                    <Checkbox 
                      checked={onlineMigration} 
                      onChange={(e) => setOnlineMigration(e.target.checked)} 
                      size="small"
                      disabled={!isVmRunning}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{t('hardware.crossCluster.liveMigration')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {isVmRunning
                          ? t('hardware.crossCluster.liveMigrationDesc')
                          : t('hardware.crossCluster.vmStopped')}
                      </Typography>
                    </Box>
                  }
                />
                
                {isVmRunning && onlineMigration && (
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    <Typography variant="caption">
                      {t('hardware.crossCluster.liveMigrationInfo')}
                    </Typography>
                  </Alert>
                )}
              </>
            )}
          </Stack>
        </TabPanel>
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={migrating}>
          {t('hardware.cancel')}
        </Button>
        
        {activeTab === 0 ? (
          <Button 
            variant="contained" 
            onClick={handleLocalMigrate} 
            disabled={migrating || !selectedNode || nodes.length === 0}
            startIcon={migrating ? <CircularProgress size={16} /> : <i className="ri-swap-box-line" />}
          >
            {migrating ? t('hardware.migrating') : t('hardware.migrate')}
          </Button>
        ) : (
          <Button 
            variant="contained" 
            onClick={handleCrossClusterMigrate} 
            disabled={migrating || !selectedRemoteConn || !selectedRemoteNode || !selectedRemoteStorage || !selectedRemoteBridge || vmType === 'lxc' || isHaManaged || hasValidationErrors || validationLoading}
            startIcon={migrating ? <CircularProgress size={16} /> : <i className="ri-global-line" />}
            color={hasValidationWarnings && !hasValidationErrors ? 'warning' : 'primary'}
          >
            {migrating ? t('hardware.crossCluster.migrating') : t('hardware.crossCluster.startMigration')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

export default MigrateVmDialog
