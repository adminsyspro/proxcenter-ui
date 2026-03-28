'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
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
import { AllVmItem } from './InventoryTree'

function CreateLxcDialog({
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

  const [activeTab, setActiveTab] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Données dynamiques
  const [connections, setConnections] = useState<any[]>([])
  const [nodes, setNodes] = useState<any[]>([])
  const [storages, setStorages] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [pools, setPools] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)

  // Formulaire - Général
  const [selectedConnection, setSelectedConnection] = useState('')
  const [selectedNodeValue, setSelectedNodeValue] = useState('')
  const [resolvedNode, setResolvedNode] = useState('')
  const [pendingClusterSelect, setPendingClusterSelect] = useState<string | null>(null)
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

  // UI collapse states
  const [securityExpanded, setSecurityExpanded] = useState(false)
  const [bootSectionExpanded, setBootSectionExpanded] = useState(false)
  const [cpuAdvancedExpanded, setCpuAdvancedExpanded] = useState(false)
  const [netAdvancedExpanded, setNetAdvancedExpanded] = useState(false)

  // Calculer le prochain CTID disponible (global sur toutes les VMs)
  useEffect(() => {
    if (allVms.length > 0) {
      const usedIds = allVms.map(vm => Number.parseInt(String(vm.vmid), 10))

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

    const ctidNum = Number.parseInt(numericValue, 10)

    if (ctidNum < 100) {
      setCtidError(t('inventory.createLxc.ctIdMin'))

return
    }

    if (ctidNum > 999999999) {
      setCtidError(t('inventory.createLxc.ctIdMax'))

return
    }

    const isUsed = allVms.some(vm => Number.parseInt(String(vm.vmid), 10) === ctidNum)

    if (isUsed) {
      setCtidError(t('inventory.createLxc.ctIdInUse', { id: ctidNum }))

return
    }

    setCtidError(null)
  }

  // Générer le prochain CTID disponible pour la connexion sélectionnée
  const generateNextCtid = () => {
    const scopedVms = selectedConnection
      ? allVms.filter(vm => vm.connId === selectedConnection)
      : allVms
    const usedIds = new Set(scopedVms.map(vm => Number.parseInt(String(vm.vmid), 10)))

    let nextId = 100
    while (usedIds.has(nextId)) {
      nextId++
    }

    setCtid(String(nextId))
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

      if (allNodes.length > 0) {
        if (defaultConnId && defaultNode) {
          const match = allNodes.find((n: any) => n.connId === defaultConnId && n.node === defaultNode)
          const target = match || allNodes[0]
          setSelectedNodeValue(target.node)
          setResolvedNode(target.node)
          setSelectedConnection(target.connId)
        } else if (defaultConnId) {
          const clusterNodes = allNodes.filter((n: any) => n.connId === defaultConnId)
          if (clusterNodes.length > 0) {
            setPendingClusterSelect(defaultConnId)
            setSelectedConnection(defaultConnId)
          } else {
            setSelectedNodeValue(allNodes[0].node)
            setResolvedNode(allNodes[0].node)
            setSelectedConnection(allNodes[0].connId)
          }
        } else {
          setSelectedNodeValue(allNodes[0].node)
          setResolvedNode(allNodes[0].node)
          setSelectedConnection(allNodes[0].connId)
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
      setSelectedNodeValue('')
      setResolvedNode('')
      setSelectedConnection('')
      setPendingClusterSelect(null)
      loadAllData()
    }
  }, [open])

  useEffect(() => {
    if (selectedConnection && resolvedNode) {
      loadStorages(selectedConnection)
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
      }
    } else {
      setResolvedNode(value)
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
        vmid: Number.parseInt(ctid, 10),
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
        `/api/v1/connections/${encodeURIComponent(selectedConnection)}/guests/lxc/${encodeURIComponent(resolvedNode)}`,
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

      onCreated?.(ctid, selectedConnection, resolvedNode)
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

  const formatGib = (mib: number) => mib >= 1024 ? `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GiB` : `${mib} MiB`

  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // General
        return (
          <Stack spacing={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.createLxc.node')}</InputLabel>
              <Select
                value={selectedNodeValue}
                onChange={(e) => handleNodeChange(e.target.value)}
                label={t('inventory.createLxc.node')}
                MenuProps={{ PaperProps: { sx: { maxHeight: 400 } } }}
              >
                {groupedNodes.map(group => [
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
              <InputLabel>{t('inventory.createLxc.resourcePool')}</InputLabel>
              <Select value={resourcePool} onChange={(e) => setResourcePool(e.target.value)} label={t('inventory.createLxc.resourcePool')}>
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
              label="CT ID"
              value={ctid}
              onChange={(e) => handleCtidChange(e.target.value)}
              size="small"
              error={!!ctidError}
              helperText={ctidError}
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title={t('inventory.createLxc.generateCtId')}>
                        <IconButton size="small" onClick={generateNextCtid} edge="end">
                          <i className="ri-refresh-line" style={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  )
                }
              }}
            />

            <TextField label={t('inventory.createLxc.hostname')} value={hostname} onChange={(e) => setHostname(e.target.value)} size="small" />

            {/* Container options */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControlLabel
                control={<Switch checked={unprivileged} onChange={(e) => setUnprivileged(e.target.checked)} size="small" />}
                label={<Typography variant="body2" fontSize={12}>{t('inventory.createLxc.unprivilegedContainer')}</Typography>}
              />
              <FormControlLabel
                control={<Switch checked={nesting} onChange={(e) => setNesting(e.target.checked)} size="small" />}
                label={<Typography variant="body2" fontSize={12}>{t('inventory.createLxc.nesting')}</Typography>}
              />
            </Box>

            {/* Boot — collapsible */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              <Box
                onClick={() => setBootSectionExpanded(v => !v)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
              >
                <i className={bootSectionExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                <i className="ri-timer-line" style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createVm.bootShutdown')}</Typography>
                <Box sx={{ flex: 1 }} />
                {startOnBoot && <Chip label={t('inventory.createLxc.startAtBoot')} size="small" variant="outlined" color="success" sx={{ fontSize: 10, height: 20 }} />}
              </Box>
              <Collapse in={bootSectionExpanded}>
                <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
                  <FormControlLabel
                    control={<Switch checked={startOnBoot} onChange={(e) => setStartOnBoot(e.target.checked)} size="small" />}
                    label={t('inventory.createLxc.startAtBoot')}
                  />
                </Box>
              </Collapse>
            </Box>

            {/* Security — collapsible */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              <Box
                onClick={() => setSecurityExpanded(v => !v)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
              >
                <i className={securityExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                <i className="ri-lock-line" style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createLxc.security')}</Typography>
                <Box sx={{ flex: 1 }} />
                {rootPassword && <Chip label={t('inventory.createLxc.passwordSet')} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                {sshKeys && <Chip label="SSH" size="small" variant="outlined" color="info" sx={{ fontSize: 10, height: 20 }} />}
              </Box>
              <Collapse in={securityExpanded}>
                <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
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
                  </Box>
                  <TextField
                    label={t('inventory.createLxc.sshPublicKey')}
                    value={sshKeys}
                    onChange={(e) => setSshKeys(e.target.value)}
                    size="small"
                    multiline
                    rows={2}
                    fullWidth
                    placeholder="ssh-rsa AAAA..."
                  />
                </Box>
              </Collapse>
            </Box>
          </Stack>
        )

      case 1: // Template
        return (
          <Stack spacing={1.5}>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <i className="ri-file-list-3-line" style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={600} fontSize={13}>{t('inventory.createLxc.tabs.template')}</Typography>
              </Box>
              <Stack spacing={1.5}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('inventory.createLxc.storage')}</InputLabel>
                  <Select value={templateStorage} onChange={(e) => setTemplateStorage(e.target.value)} label={t('inventory.createLxc.storage')}>
                    {templateStoragesList.map(s => <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField
                  label={t('inventory.createLxc.template')}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  size="small"
                  fullWidth
                  placeholder={t('inventory.createLxc.templatePlaceholder')}
                  helperText={t('inventory.createLxc.templateHelperText')}
                />
              </Stack>
            </Box>
          </Stack>
        )

      case 2: // Disks
        return (
          <Stack spacing={1.5}>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <i className="ri-hard-drive-3-line" style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={600} fontSize={13}>rootfs</Typography>
                <Box sx={{ flex: 1 }} />
                <Chip label={`${rootSize} GiB`} size="small" color="primary" sx={{ fontSize: 11, fontWeight: 700 }} />
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('inventory.createLxc.storage')}</InputLabel>
                  <Select value={rootStorage} onChange={(e) => setRootStorage(e.target.value)} label={t('inventory.createLxc.storage')}>
                    {diskStoragesList.map(s => (
                      <MenuItem key={s.storage} value={s.storage}>{s.storage} ({s.type})</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label={t('inventory.createLxc.diskSizeGib')}
                  value={rootSize}
                  onChange={(e) => setRootSize(Number.parseInt(e.target.value) || 1)}
                  size="small"
                  type="number"
                  inputProps={{ min: 1, max: 1000 }}
                />
              </Box>
            </Box>
          </Stack>
        )

      case 3: // CPU
        {
          const cpuPresets = [1, 2, 4, 8, 16]
          return (
            <Stack spacing={2}>
              {/* Quick presets */}
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{t('inventory.createLxc.cores')}: {cpuCores}</Typography>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {cpuPresets.map(v => (
                    <Chip
                      key={v}
                      label={`${v} core${v > 1 ? 's' : ''}`}
                      size="small"
                      variant={cpuCores === v ? 'filled' : 'outlined'}
                      color={cpuCores === v ? 'primary' : 'default'}
                      onClick={() => setCpuCores(v)}
                      sx={{ fontWeight: cpuCores === v ? 700 : 400, cursor: 'pointer' }}
                    />
                  ))}
                </Box>
              </Box>

              <TextField
                label={t('inventory.createLxc.cores')}
                value={cpuCores}
                onChange={(e) => setCpuCores(Number.parseInt(e.target.value) || 1)}
                size="small"
                type="number"
                inputProps={{ min: 1, max: 128 }}
                sx={{ maxWidth: 200 }}
              />

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
                      label={t('inventory.createLxc.cpuLimit')}
                      value={cpuLimit === 0 ? '' : cpuLimit}
                      onChange={(e) => setCpuLimit(Number.parseFloat(e.target.value) || 0)}
                      size="small"
                      type="number"
                      placeholder={t('inventory.createLxc.unlimited')}
                      inputProps={{ min: 0, max: cpuCores, step: 0.1 }}
                    />
                    <TextField
                      label={t('inventory.createLxc.cpuUnits')}
                      value={cpuUnits}
                      onChange={(e) => setCpuUnits(Number.parseInt(e.target.value) || 1024)}
                      size="small"
                      type="number"
                    />
                  </Box>
                </Collapse>
              </Box>
            </Stack>
          )
        }

      case 4: // Memory
        {
          const memoryMarks = [128, 256, 512, 1024, 2048, 4096, 8192, 16384]
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
            return Math.round(raw / 32) * 32 || 32
          }

          return (
            <Stack spacing={2}>
              {/* Memory label + presets */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {t('inventory.createLxc.memoryMib')}: {formatGib(memorySize)}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {[256, 512, 1024, 2048, 4096, 8192].map(v => (
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
                  sx={{ '& .MuiSlider-markLabel': { fontSize: '0.6rem' } }}
                />
              </Box>

              <TextField
                label={t('inventory.createLxc.memoryMib')}
                value={memorySize}
                onChange={(e) => setMemorySize(Number.parseInt(e.target.value) || 128)}
                size="small"
                type="number"
                inputProps={{ min: 16, step: 32 }}
                sx={{ maxWidth: 200 }}
              />

              <Divider />

              {/* Swap */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {t('inventory.createLxc.swapMib')}: {formatGib(swapSize)}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {[0, 256, 512, 1024, 2048].map(v => (
                    <Chip
                      key={v}
                      label={v === 0 ? 'None' : formatGib(v)}
                      size="small"
                      variant={swapSize === v ? 'filled' : 'outlined'}
                      color={swapSize === v ? 'primary' : 'default'}
                      onClick={() => setSwapSize(v)}
                      sx={{ fontWeight: swapSize === v ? 700 : 400, cursor: 'pointer', height: 24, fontSize: 11 }}
                    />
                  ))}
                </Box>
              </Box>

              <TextField
                label={t('inventory.createLxc.swapMib')}
                value={swapSize}
                onChange={(e) => setSwapSize(Number.parseInt(e.target.value) || 0)}
                size="small"
                type="number"
                inputProps={{ min: 0, step: 32 }}
                sx={{ maxWidth: 200 }}
              />
            </Stack>
          )
        }

      case 5: // Network
        return (
          <Stack spacing={1.5}>
            {/* Main network card */}
            <Box sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ bgcolor: alpha(theme.palette.primary.main, 0.04), px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Chip label="net0" size="small" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, height: 24 }} />
                <Typography variant="body2" fontSize={12} fontWeight={700}>{networkBridge}</Typography>
                <Typography variant="body2" fontSize={12} sx={{ opacity: 0.6 }}>{networkName}</Typography>
                <Chip label={ipConfig.toUpperCase()} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                {firewall && <Chip label="FW" size="small" color="success" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
              </Box>

              <Box sx={{ px: 2, pb: 2, pt: 1.5 }}>
                {/* Essential fields */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
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
                </Box>

                {/* IPv4 + IPv6 */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
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
                </Box>

                {ipConfig === 'static' && (
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
                    <TextField label={t('inventory.createLxc.ipv4Cidr')} value={ip4} onChange={(e) => setIp4(e.target.value)} size="small" placeholder="192.168.1.100/24" />
                    <TextField label={t('inventory.createLxc.gatewayIpv4')} value={gw4} onChange={(e) => setGw4(e.target.value)} size="small" placeholder="192.168.1.1" />
                  </Box>
                )}

                {ip6Config === 'static' && (
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
                    <TextField label={t('inventory.createLxc.ipv6Cidr')} value={ip6} onChange={(e) => setIp6(e.target.value)} size="small" />
                    <TextField label={t('inventory.createLxc.gatewayIpv6')} value={gw6} onChange={(e) => setGw6(e.target.value)} size="small" />
                  </Box>
                )}

                {/* Advanced — collapsible */}
                <Typography
                  variant="caption"
                  fontWeight={700}
                  sx={{ display: 'block', opacity: 0.5, mb: 1, mt: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer' }}
                  onClick={() => setNetAdvancedExpanded(v => !v)}
                >
                  <i className={netAdvancedExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }} />
                  {t('inventory.createVm.advancedOptions')}
                </Typography>
                <Collapse in={netAdvancedExpanded}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                    <FormControlLabel control={<Switch checked={firewall} onChange={(e) => setFirewall(e.target.checked)} size="small" />} label={<Typography variant="body2" fontSize={12}>{t('inventory.createLxc.firewall')}</Typography>} />
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
                    <TextField label={t('inventory.createLxc.vlanTag')} value={vlanTag} onChange={(e) => setVlanTag(e.target.value)} size="small" placeholder={t('inventory.createLxc.noVlan')} />
                    <TextField label={t('inventory.createLxc.mtu')} value={mtu} onChange={(e) => setMtu(e.target.value)} size="small" placeholder={t('inventory.createLxc.sameasBridge')} />
                    <TextField label={t('inventory.createLxc.rateLimitMbs')} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} size="small" placeholder={t('inventory.createLxc.unlimited')} />
                  </Box>
                </Collapse>
              </Box>
            </Box>
          </Stack>
        )

      case 6: // DNS
        return (
          <Stack spacing={1.5}>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <i className="ri-global-line" style={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2" fontWeight={600} fontSize={13}>DNS</Typography>
              </Box>
              <Stack spacing={1.5}>
                <TextField
                  label={t('inventory.createLxc.dnsDomain')}
                  value={searchDomain}
                  onChange={(e) => setSearchDomain(e.target.value)}
                  size="small"
                  fullWidth
                  placeholder={t('inventory.createLxc.useHostSettings')}
                />
                <TextField
                  label={t('inventory.createLxc.dnsServers')}
                  value={dnsServer}
                  onChange={(e) => setDnsServer(e.target.value)}
                  size="small"
                  fullWidth
                  placeholder={t('inventory.createLxc.useHostSettings')}
                />
              </Stack>
            </Box>
          </Stack>
        )

      case 7: // Confirm
        {
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
                {t('inventory.createLxc.reviewSettingsLxc')}
              </Alert>
              <Stack spacing={1.5}>
                {/* General */}
                {confirmCard('ri-instance-line', 'General', (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    <Chip label={`Node: ${resolvedNode}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    <Chip label={`CT ${ctid}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    {hostname && <Chip label={hostname} size="small" color="primary" sx={{ fontSize: 11 }} />}
                    {unprivileged && <Chip label="Unprivileged" size="small" variant="outlined" color="info" sx={{ fontSize: 11 }} />}
                    {nesting && <Chip label="Nesting" size="small" variant="outlined" sx={{ fontSize: 11 }} />}
                  </Box>
                ))}

                {/* Template */}
                {confirmCard('ri-file-list-3-line', t('inventory.createLxc.tabs.template'), (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    <Chip label={template ? `${templateStorage}:vztmpl/${template}` : `(${t('common.none')})`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                  </Box>
                ))}

                {/* Disk + CPU + Memory */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
                  {confirmCard('ri-hard-drive-3-line', 'rootfs', (
                    <Box sx={{ display: 'flex', gap: 0.75 }}>
                      <Chip label={`${rootSize} GiB`} size="small" color="primary" sx={{ fontSize: 11, fontWeight: 700 }} />
                      <Chip label={rootStorage} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    </Box>
                  ))}
                  {confirmCard('ri-cpu-line', 'CPU', (
                    <Box sx={{ display: 'flex', gap: 0.75 }}>
                      <Chip label={`${cpuCores} core${cpuCores > 1 ? 's' : ''}`} size="small" color="primary" sx={{ fontSize: 11, fontWeight: 700 }} />
                    </Box>
                  ))}
                  {confirmCard('ri-ram-line', t('inventory.createLxc.tabs.memory'), (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      <Chip label={formatGib(memorySize)} size="small" color="primary" sx={{ fontSize: 11, fontWeight: 700 }} />
                      <Chip label={`Swap: ${formatGib(swapSize)}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                    </Box>
                  ))}
                </Box>

                {/* Network */}
                {confirmCard('ri-global-line', t('inventory.createLxc.tabs.network'), (
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                    <Chip label="net0" size="small" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, height: 22 }} />
                    <Typography variant="body2" fontSize={12}>{networkName} on {networkBridge} ({ipConfig})</Typography>
                    {firewall && <Chip label="FW" size="small" color="success" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                  </Box>
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
        icon={<i className="ri-instance-line" style={{ fontSize: 20 }} />}
        sx={{
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,150,200,0.15)' : 'primary.light',
          color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.contrastText',
          py: 1.5
        }}
      >
        {t('inventory.createLxc.title')}
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
            disabled={creating || !ctid || !resolvedNode || !!ctidError}
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
