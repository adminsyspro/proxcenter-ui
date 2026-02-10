'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
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
  Tooltip,
  Divider,
  Chip,
} from '@mui/material'

import { formatBytes } from '@/utils/format'
import { type NodeInfo, type StorageInfo, calculateNodeScore, getRecommendedNode, formatMemory } from './utils'

type LocalDiskInfo = {
  id: string
  storage: string
  size: number
  format?: string
  isLocal?: boolean  // true si stockage local (commence par "local")
}

type MigrateVmDialogProps = {
  open: boolean
  onClose: () => void
  onMigrate: (targetNode: string, online: boolean, targetStorage?: string, withLocalDisks?: boolean) => Promise<void>
  connId: string
  currentNode: string
  vmName: string
  vmid: string
  vmStatus: string
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
  // Intel
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
  // AMD
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

export function MigrateVmDialog({ open, onClose, onMigrate, connId, currentNode, vmName, vmid, vmStatus }: MigrateVmDialogProps) {
  const t = useTranslations()
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [nodesLoading, setNodesLoading] = useState(false)
  const [selectedNode, setSelectedNode] = useState<string>('')
  const [onlineMigration, setOnlineMigration] = useState(true)
  const [vmDisks, setVmDisks] = useState<LocalDiskInfo[]>([])  // Tous les disques de la VM
  const [storages, setStorages] = useState<StorageInfo[]>([])
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [selectedStorage, setSelectedStorage] = useState<string>('__current__') // __current__ = garder le layout actuel

  // CPU Compatibility states
  const [nodesCpuInfo, setNodesCpuInfo] = useState<Record<string, NodeCpuInfo>>({})
  const [vmCpuType, setVmCpuType] = useState<string>('') // Type CPU configuré dans la VM
  const [cpuInfoLoading, setCpuInfoLoading] = useState(false)

  // Calculer les stockages actuels uniques
  const currentStorageNames = useMemo(() => {
    const names = [...new Set(vmDisks.map(d => d.storage))]


return names.sort()
  }, [vmDisks])

  // Vérifier si la VM a des disques locaux
  const hasLocalDisks = useMemo(() => {
    return vmDisks.some(d => d.isLocal)
  }, [vmDisks])

  // Charger les nodes disponibles
  useEffect(() => {
    if (!open || !connId) return

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
        setError('Impossible de charger la liste des nodes')
      } finally {
        setNodesLoading(false)
      }
    }

    loadNodes()
  }, [open, connId, currentNode])

  // Charger la config VM pour détecter les disques
  useEffect(() => {
    if (!open || !connId || !vmid || !currentNode) return

    const loadVmConfig = async () => {
      try {
        // Déterminer le type de VM (on essaie qemu d'abord)
        let vmType = 'qemu'
        let configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/qemu/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)

        if (!configRes.ok) {
          vmType = 'lxc'
          configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/lxc/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)
        }

        if (!configRes.ok) {
          setVmDisks([])

return
        }

        const configJson = await configRes.json()
        const config = configJson.data || {}

        // Chercher TOUS les disques de la VM
        const foundDisks: LocalDiskInfo[] = []

        // Patterns pour les disques: scsi0, virtio0, ide0, sata0, efidisk0, tpmstate0 pour QEMU
        // rootfs, mp0, mp1, etc. pour LXC
        const diskPatterns = vmType === 'qemu'
          ? /^(scsi|virtio|ide|sata|efidisk|tpmstate)\d+$/
          : /^(rootfs|mp\d+)$/

        for (const [key, value] of Object.entries(config)) {
          if (diskPatterns.test(key) && typeof value === 'string') {
            // Format: "CephStoragePool:vm-111-disk-0,size=750G" ou "local-lvm:vm-111-disk-0,size=32G"
            const diskStr = value as string
            const storageMatch = diskStr.match(/^([^:]+):/)

            if (storageMatch) {
              const storageName = storageMatch[1]

              // Extraire la taille
              const sizeMatch = diskStr.match(/size=(\d+(?:\.\d+)?)(G|T|M)?/)
              let sizeGB = 0

              if (sizeMatch) {
                sizeGB = parseFloat(sizeMatch[1])
                if (sizeMatch[2] === 'T') sizeGB *= 1024
                else if (sizeMatch[2] === 'M') sizeGB /= 1024
              }

              // Extraire le format
              const formatMatch = diskStr.match(/\.(qcow2|raw|vmdk)/)

              // Vérifier si c'est un stockage local
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
      } catch (e) {
        console.error('Error loading VM config:', e)
        setVmDisks([])
      }
    }

    loadVmConfig()
  }, [open, connId, vmid, currentNode])

  // Charger les infos CPU des nodes et le type CPU de la VM
  useEffect(() => {
    if (!open || !connId || !currentNode || !vmid) return

    const loadCpuInfo = async () => {
      setCpuInfoLoading(true)

      try {
        // 1. Charger le type CPU de la VM
        let vmType = 'qemu'
        let configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/qemu/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)

        if (!configRes.ok) {
          vmType = 'lxc'
          configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/lxc/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)
        }

        if (configRes.ok) {
          const configJson = await configRes.json()
          const config = configJson.data || {}

          // Extraire le type CPU - format: "cpu: host" ou "cpu: x86-64-v2-AES,flags=+aes"
          const cpuConfig = config.cpu || ''
          const cpuTypeMatch = cpuConfig.match(/^([^,]+)/)
          if (cpuTypeMatch) {
            setVmCpuType(cpuTypeMatch[1])
          } else if (vmType === 'lxc') {
            // LXC utilise toujours le CPU de l'hôte
            setVmCpuType('host')
          }
        }

        // 2. Charger les infos CPU de tous les nodes
        const nodesRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`)
        const nodesJson = await nodesRes.json()

        if (nodesJson.data && Array.isArray(nodesJson.data)) {
          const cpuInfoMap: Record<string, NodeCpuInfo> = {}

          // Charger le statut de chaque node pour obtenir les infos CPU
          await Promise.all(nodesJson.data.map(async (node: any) => {
            try {
              const statusRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node.node)}/status`)
              const statusJson = await statusRes.json()

              if (statusJson.data) {
                const cpuInfo = statusJson.data.cpuinfo || {}
                const cpuModel = cpuInfo.model || 'Unknown'

                // Déterminer le niveau CPU recommandé basé sur le modèle
                let recommendedCpuType = 'x86-64-v2-AES' // Default safe

                for (const [modelKey, cpuType] of Object.entries(CPU_MODEL_GENERATIONS)) {
                  if (cpuModel.toLowerCase().includes(modelKey.toLowerCase())) {
                    recommendedCpuType = cpuType
                    break
                  }
                }

                cpuInfoMap[node.node] = {
                  node: node.node,
                  cpuModel,
                  sockets: cpuInfo.sockets || 1,
                  cores: cpuInfo.cores || 1,
                  recommendedCpuType
                }
              }
            } catch (e) {
              console.error(`Error loading CPU info for node ${node.node}:`, e)
            }
          }))

          setNodesCpuInfo(cpuInfoMap)
        }
      } catch (e) {
        console.error('Error loading CPU info:', e)
      } finally {
        setCpuInfoLoading(false)
      }
    }

    loadCpuInfo()
  }, [open, connId, currentNode, vmid])

  // Calculer la compatibilité CPU entre source et cible
  const getCpuCompatibility = useCallback((targetNodeName: string): { compatible: boolean; warning: boolean; message: string; color: string } => {
    if (!vmCpuType || !nodesCpuInfo[currentNode] || !nodesCpuInfo[targetNodeName]) {
      return { compatible: true, warning: false, message: '', color: '' }
    }

    const sourceInfo = nodesCpuInfo[currentNode]
    const targetInfo = nodesCpuInfo[targetNodeName]

    // Si la VM utilise cpu: host
    if (vmCpuType === 'host') {
      // Vérifier si les CPUs sont identiques (même modèle)
      const sameCpuModel = sourceInfo.cpuModel === targetInfo.cpuModel

      if (sameCpuModel) {
        return {
          compatible: true,
          warning: false,
          message: t('hardware.cpuHostIdentical'),
          color: '#4caf50'
        }
      }

      // Vérifier si les CPUs sont du même type/famille
      const sameVendor = (sourceInfo.cpuModel.includes('Intel') && targetInfo.cpuModel.includes('Intel')) ||
                        (sourceInfo.cpuModel.includes('AMD') && targetInfo.cpuModel.includes('AMD')) ||
                        (sourceInfo.cpuModel.includes('EPYC') && targetInfo.cpuModel.includes('EPYC'))

      if (!sameVendor) {
        return {
          compatible: false,
          warning: true,
          message: t('hardware.cpuHostDifferentVendor'),
          color: '#f44336'
        }
      }

      // Même vendeur mais modèle différent - avertissement léger
      return {
        compatible: true,
        warning: true,
        message: t('hardware.cpuHostSimilar'),
        color: '#ff9800'
      }
    }

    // Pour les autres types CPU, vérifier les niveaux de compatibilité
    const vmCpuLevel = CPU_COMPATIBILITY_LEVELS[vmCpuType]?.level || 0
    const targetRecommendedLevel = CPU_COMPATIBILITY_LEVELS[targetInfo.recommendedCpuType]?.level || 0

    if (vmCpuLevel > targetRecommendedLevel) {
      return {
        compatible: false,
        warning: true,
        message: t('hardware.cpuLevelTooHigh', { vmCpu: vmCpuType, targetMax: targetInfo.recommendedCpuType }),
        color: '#f44336'
      }
    }

    return {
      compatible: true,
      warning: false,
      message: t('hardware.cpuCompatible'),
      color: '#4caf50'
    }
  }, [vmCpuType, nodesCpuInfo, currentNode, t])

  // Vérifier si tous les nodes ont le même CPU (pour adapter les messages)
  const allNodesSameCpu = useMemo(() => {
    const cpuModels = Object.values(nodesCpuInfo).map(n => n.cpuModel)
    if (cpuModels.length === 0) return false
    return cpuModels.every(m => m === cpuModels[0])
  }, [nodesCpuInfo])

  // Charger les storages disponibles sur le node sélectionné
  useEffect(() => {
    if (!open || !connId || !selectedNode) {
      setStorages([])

return
    }

    const loadStorages = async () => {
      setStoragesLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(selectedNode)}/storages`)
        const json = await res.json()

        if (json.data && Array.isArray(json.data)) {
          // Filtrer pour ne garder que les storages qui supportent les images disque (images, rootdir)
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

    // Reset storage selection when node changes
    setSelectedStorage('__current__')
  }, [open, connId, selectedNode])

  const formatCpu = (cpu?: number): string => {
    if (cpu === undefined) return '\u2014'

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

  const handleMigrate = async () => {
    if (!selectedNode) {
      setError(t('hardware.selectDestinationNode'))

return
    }

    setMigrating(true)
    setError(null)

    try {
      // Passer le storage seulement s'il est différent de '__current__'
      const targetStorage = selectedStorage !== '__current__' ? selectedStorage : undefined

      // Passer withLocalDisks si on a des disques locaux ou si on change de stockage
      const withLocalDisks = hasLocalDisks || !!targetStorage

      await onMigrate(selectedNode, onlineMigration, targetStorage, withLocalDisks)
      onClose()
    } catch (e: any) {
      setError(e.message || t('hardware.migrationError'))
    } finally {
      setMigrating(false)
    }
  }

  const isVmRunning = vmStatus === 'running'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-swap-box-line" style={{ fontSize: 24 }} />
        {t('hardware.migrateTitle', { vmName, vmid })}
      </DialogTitle>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="info" icon={<i className="ri-server-line" />}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Typography variant="body2">
                {t('hardware.currentNode')} <strong>{currentNode}</strong>
              </Typography>
              {nodesCpuInfo[currentNode] && (
                <Chip
                  icon={<i className="ri-cpu-line" style={{ fontSize: 11 }} />}
                  label={nodesCpuInfo[currentNode].cpuModel}
                  size="small"
                  variant="outlined"
                  sx={{
                    height: 20,
                    fontSize: '0.6rem',
                    '& .MuiChip-label': { px: 0.5 },
                    '& .MuiChip-icon': { ml: 0.5, mr: -0.25, fontSize: 11 },
                    borderColor: 'divider',
                  }}
                />
              )}
            </Box>
          </Alert>

          {/* Affichage du type CPU de la VM */}
          {vmCpuType && (
            <Alert
              severity={vmCpuType === 'host' && !allNodesSameCpu ? 'warning' : 'info'}
              icon={<i className="ri-cpu-line" />}
              sx={{ py: 1 }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  VM CPU Type: <code style={{
                    backgroundColor: 'rgba(0,0,0,0.1)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontFamily: 'monospace'
                  }}>{vmCpuType}</code>
                </Typography>
                {vmCpuType === 'host' && allNodesSameCpu && (
                  <Typography variant="caption" sx={{ opacity: 0.8, color: 'success.main', display: 'block', mt: 0.5 }}>
                    ✓ {t('hardware.cpuHostAllIdentical')}
                  </Typography>
                )}
                {vmCpuType !== 'host' && CPU_COMPATIBILITY_LEVELS[vmCpuType] && (
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    {CPU_COMPATIBILITY_LEVELS[vmCpuType].description}
                  </Typography>
                )}
              </Box>
              {vmCpuType === 'host' && !allNodesSameCpu && (
                <Chip
                  label={t('hardware.cpuWarning')}
                  size="small"
                  color="warning"
                  sx={{ height: 20, fontSize: '0.65rem', mt: 1 }}
                />
              )}
            </Alert>
          )}

          {/* Avertissement pour cpu: host - seulement si CPUs différents */}
          {vmCpuType === 'host' && onlineMigration && !allNodesSameCpu && (
            <Alert severity="error" icon={<i className="ri-error-warning-fill" />}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                {t('hardware.cpuHostMigrationWarning')}
              </Typography>
              <Typography variant="caption">
                {t('hardware.cpuHostMigrationTip')}
              </Typography>
            </Alert>
          )}

          {/* Avertissement pour les disques sur stockage local */}
          {hasLocalDisks && (
            <Alert
              severity="warning"
              icon={<i className="ri-alert-line" />}
              sx={{
                '& .MuiAlert-message': { width: '100%' }
              }}
            >
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

          <Typography variant="subtitle2" sx={{ mt: 1 }}>
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
            <Stack spacing={0.75}>
              {nodes.map((node) => {
                const cpuPercent = getCpuPercent(node)
                const memPercent = getMemoryPercent(node)
                const recommended = isRecommended(node)
                const cpuCompat = getCpuCompatibility(node.node)
                const nodeCpuInfo = nodesCpuInfo[node.node]

                return (
                  <Box
                    key={node.node}
                    onClick={() => setSelectedNode(node.node)}
                    sx={{
                      p: 1.25,
                      border: '1px solid',
                      borderColor: selectedNode === node.node ? 'primary.main' : cpuCompat.warning && !cpuCompat.compatible ? 'error.main' : 'divider',
                      borderRadius: 1.5,
                      cursor: 'pointer',
                      bgcolor: selectedNode === node.node ? 'action.selected' : 'transparent',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    {/* Header: Nom + Status + Badge Recommandé */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <i className="ri-server-line" style={{ fontSize: 14, opacity: 0.7 }} />
                          {node.node}
                        </Typography>
                        {recommended && (
                          <Chip
                            label={t('hardware.recommended')}
                            size="small"
                            color="success"
                            sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.75 } }}
                          />
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {/* CPU Compatibility indicator */}
                        {vmCpuType && nodeCpuInfo && (
                          <Tooltip title={cpuCompat.message || `CPU: ${nodeCpuInfo.cpuModel}`}>
                            <Chip
                              icon={<i className={cpuCompat.compatible ? "ri-checkbox-circle-fill" : "ri-error-warning-fill"} style={{ fontSize: 12 }} />}
                              label={nodeCpuInfo.recommendedCpuType}
                              size="small"
                              sx={{
                                height: 18,
                                fontSize: '0.6rem',
                                '& .MuiChip-label': { px: 0.5 },
                                '& .MuiChip-icon': { ml: 0.5, mr: -0.25 },
                                bgcolor: cpuCompat.compatible ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)',
                                color: cpuCompat.color,
                                borderColor: cpuCompat.color,
                              }}
                              variant="outlined"
                            />
                          </Tooltip>
                        )}
                        <Chip
                          label={node.status}
                          size="small"
                          color={node.status === 'online' ? 'success' : 'default'}
                          variant="outlined"
                          sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.75 } }}
                        />
                      </Box>
                    </Box>

                    {/* CPU Model info - affichage en badge */}
                    {nodeCpuInfo && (
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Chip
                          icon={<i className="ri-cpu-line" style={{ fontSize: 11 }} />}
                          label={nodeCpuInfo.cpuModel}
                          size="small"
                          variant="outlined"
                          sx={{
                            height: 20,
                            fontSize: '0.6rem',
                            '& .MuiChip-label': { px: 0.5 },
                            '& .MuiChip-icon': { ml: 0.5, mr: -0.25, fontSize: 11 },
                            opacity: 0.8,
                            borderColor: 'divider',
                          }}
                        />
                        <Typography variant="caption" sx={{ opacity: 0.5, fontSize: '0.6rem' }}>
                          {nodeCpuInfo.sockets}×{nodeCpuInfo.cores} cores
                        </Typography>
                      </Box>
                    )}

                    {/* CPU & RAM sur une ligne */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                      {/* CPU */}
                      <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.8 }}>
                            CPU {formatCpu(node.cpu)}
                          </Typography>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.6 }}>
                            {node.maxcpu}c
                          </Typography>
                        </Box>
                        <Box sx={{ height: 4, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                          <Box sx={{
                            height: '100%',
                            width: `${cpuPercent}%`,
                            bgcolor: cpuPercent > 80 ? 'error.main' : cpuPercent > 60 ? 'warning.main' : 'success.main',
                            borderRadius: 0.5
                          }} />
                        </Box>
                      </Box>

                      {/* RAM */}
                      <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.8 }}>
                            RAM {Math.round(memPercent)}%
                          </Typography>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.6 }}>
                            {formatMemory(node.maxmem)}
                          </Typography>
                        </Box>
                        <Box sx={{ height: 4, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                          <Box sx={{
                            height: '100%',
                            width: `${memPercent}%`,
                            bgcolor: memPercent > 80 ? 'error.main' : memPercent > 60 ? 'warning.main' : 'success.main',
                            borderRadius: 0.5
                          }} />
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                )
              })}
            </Stack>
          )}

          {/* Sélecteur de stockage cible */}
          {nodes.length > 0 && selectedNode && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                {t('hardware.targetStorageLabel')}
              </Typography>

              {!hasLocalDisks && (
                <Alert severity="info" sx={{ mt: 0.5, mb: 1, py: 0.5 }}>
                  <Typography variant="caption">
                    {t('hardware.sharedStorageInfo', { storages: currentStorageNames.join(', ') })}
                  </Typography>
                </Alert>
              )}

              {storagesLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="caption" color="text.secondary">
                    {t('hardware.loadingStorages')}
                  </Typography>
                </Box>
              ) : (
                <FormControl fullWidth size="small" sx={{ mt: 0.5 }} disabled={!hasLocalDisks}>
                  <Select
                    value={hasLocalDisks ? selectedStorage : '__current__'}
                    onChange={(e) => setSelectedStorage(e.target.value)}
                    MenuProps={{
                      PaperProps: {
                        sx: { maxHeight: 300 }
                      }
                    }}
                  >
                    <MenuItem value="__current__">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-layout-line" style={{ fontSize: 16, opacity: 0.7 }} />
                        <Typography variant="body2">
                          {t('hardware.keepCurrentStorage', { storage: currentStorageNames.length > 0 ? currentStorageNames.join(', ') : t('hardware.loading') })}
                        </Typography>
                        {hasLocalDisks && (
                          <Chip
                            label="local"
                            size="small"
                            color="warning"
                            sx={{ height: 16, fontSize: '0.6rem', ml: 1 }}
                          />
                        )}
                      </Box>
                    </MenuItem>

                    {hasLocalDisks && storages.length > 0 && <Divider sx={{ my: 0.5 }} />}

                    {hasLocalDisks && storages.map((storage) => {
                      const isCurrent = currentStorageNames.includes(storage.storage)


return (
                      <MenuItem key={storage.storage} value={storage.storage}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-hard-drive-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                            <Typography variant="body2">{storage.storage}</Typography>
                            {isCurrent && (
                              <Chip
                                label={t('hardware.currentLabel')}
                                size="small"
                                color="info"
                                variant="outlined"
                                sx={{ height: 16, fontSize: '0.6rem' }}
                              />
                            )}
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Chip
                              label={storage.type}
                              size="small"
                              variant="outlined"
                              sx={{ height: 18, fontSize: '0.6rem' }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, textAlign: 'right' }}>
                              {formatBytes(storage.avail)}
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.5, minWidth: 70, textAlign: 'right' }}>
                              {formatBytes(storage.total)}
                            </Typography>
                          </Box>
                        </Box>
                      </MenuItem>
                    )})}
                  </Select>
                </FormControl>
              )}

              {hasLocalDisks && selectedStorage === '__current__' && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  💡 {t('hardware.selectSharedStorageTip')}
                </Typography>
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

              {!isVmRunning && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  {t('hardware.vmStoppedColdMigration')}
                </Alert>
              )}
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={migrating}>{t('hardware.cancel')}</Button>
        {(() => {
          const selectedNodeCompat = selectedNode ? getCpuCompatibility(selectedNode) : null
          const isCpuIncompatible = selectedNodeCompat && !selectedNodeCompat.compatible

          return (
            <Tooltip title={isCpuIncompatible ? t('hardware.cpuIncompatibleBlocked') : ''}>
              <span>
                <Button
                  variant="contained"
                  onClick={handleMigrate}
                  disabled={migrating || !selectedNode || nodes.length === 0 || isCpuIncompatible}
                  color={isCpuIncompatible ? 'error' : 'primary'}
                  startIcon={migrating ? <CircularProgress size={16} /> : <i className={isCpuIncompatible ? "ri-error-warning-line" : "ri-swap-box-line"} />}
                >
                  {migrating ? t('hardware.migrating') : isCpuIncompatible ? t('hardware.cpuIncompatible') : t('hardware.migrate')}
                </Button>
              </span>
            </Tooltip>
          )
        })()}
      </DialogActions>
    </Dialog>
  )
}
