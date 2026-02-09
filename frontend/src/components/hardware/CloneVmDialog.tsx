'use client'

import React, { useState, useEffect, useMemo } from 'react'
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
  Alert,
  CircularProgress,
  Divider,
  Chip,
} from '@mui/material'

import { formatBytes } from '@/utils/format'
import { type NodeInfo, calculateNodeScore, formatMemory } from './utils'

// ==================== CLONE VM DIALOG ====================
type CloneVmDialogProps = {
  open: boolean
  onClose: () => void
  onClone: (params: { targetNode: string; newVmid: number; name: string; targetStorage?: string; format?: string; pool?: string; full: boolean }) => Promise<void>
  connId: string
  currentNode: string
  vmName: string
  vmid: string
  nextVmid: number
  pools?: string[]
  existingVmids?: number[]  // Liste des VMIDs déjà utilisés
}

export function CloneVmDialog({ open, onClose, onClone, connId, currentNode, vmName, vmid, nextVmid, pools = [], existingVmids = [] }: CloneVmDialogProps) {
  const t = useTranslations()
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [storages, setStorages] = useState<{ storage: string; type: string; avail?: number; total?: number; shared?: number }[]>([])
  const [resourcePools, setResourcePools] = useState<{ poolid: string; comment?: string }[]>([])
  const [nodesLoading, setNodesLoading] = useState(false)
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [poolsLoading, setPoolsLoading] = useState(false)

  // Form fields
  const [targetNode, setTargetNode] = useState(currentNode)
  const [newVmid, setNewVmid] = useState(nextVmid)
  const [name, setName] = useState('')
  const [targetStorage, setTargetStorage] = useState('')
  const [format, setFormat] = useState('qcow2')
  const [pool, setPool] = useState('')
  const [fullClone, setFullClone] = useState(true)

  // Validation du VMID
  const vmidError = useMemo(() => {
    if (!newVmid) return t('hardware.vmIdRequired')
    if (newVmid < 100) return t('hardware.vmIdMinimum')
    if (newVmid > 999999999) return t('hardware.vmIdTooLarge')
    if (existingVmids.includes(newVmid)) return t('hardware.vmIdAlreadyUsed', { id: newVmid })

return null
  }, [newVmid, existingVmids, t])

  // Charger les nodes du cluster
  useEffect(() => {
    if (!open || !connId) return

    const loadNodes = async () => {
      setNodesLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`)
        const json = await res.json()

        if (json.data && Array.isArray(json.data)) {
          const availableNodes = json.data
            .filter((n: NodeInfo) => n.status === 'online')
            .map((n: NodeInfo) => ({
              node: n.node,
              status: n.status,
              cpu: n.cpu,
              maxcpu: n.maxcpu,
              mem: n.mem,
              maxmem: n.maxmem
            }))

          setNodes(availableNodes)
        }
      } catch (e: any) {
        console.error('Error loading nodes:', e)
      } finally {
        setNodesLoading(false)
      }
    }

    loadNodes()
  }, [open, connId])

  // Charger les pools de ressources
  useEffect(() => {
    if (!open || !connId) return

    const loadPools = async () => {
      setPoolsLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/pools`)
        const json = await res.json()

        if (json.data && Array.isArray(json.data)) {
          setResourcePools(json.data.map((p: any) => ({
            poolid: p.poolid,
            comment: p.comment
          })))
        }
      } catch (e: any) {
        console.error('Error loading pools:', e)


        // Si l'API n'existe pas ou échoue, utiliser les pools passés en props
        if (pools.length > 0) {
          setResourcePools(pools.map(p => ({ poolid: p })))
        }
      } finally {
        setPoolsLoading(false)
      }
    }

    loadPools()
  }, [open, connId, pools])

  // Charger les storages du node cible
  useEffect(() => {
    if (!open || !connId || !targetNode) return

    const loadStorages = async () => {
      setStoragesLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(targetNode)}/storages`)
        const json = await res.json()

        if (json.data && Array.isArray(json.data)) {
          const diskStorages = json.data
            .filter((s: any) =>
              s.content?.includes('images') || s.type === 'zfspool' || s.type === 'lvmthin' || s.type === 'lvm' || s.type === 'dir' || s.type === 'nfs' || s.type === 'cifs' || s.type === 'rbd'
            )
            .map((s: any) => ({
              storage: s.storage,
              type: s.type,
              avail: s.avail,
              total: s.total,
              shared: s.shared
            }))

          setStorages(diskStorages)
        }
      } catch (e: any) {
        console.error('Error loading storages:', e)
      } finally {
        setStoragesLoading(false)
      }
    }

    loadStorages()

    // Reset storage when node changes
    setTargetStorage('')
  }, [open, connId, targetNode])

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTargetNode(currentNode)
      setNewVmid(nextVmid)
      setName('')
      setTargetStorage('')
      setFormat('qcow2')
      setPool('')
      setFullClone(true)
      setError(null)
    }
  }, [open, currentNode, nextVmid])

  const getRecommendedNodeLocal = (nodeList: NodeInfo[]): NodeInfo | null => {
    if (nodeList.length === 0) return null

return nodeList.reduce((best, current) => {
      const bestScore = calculateNodeScore(best)
      const currentScore = calculateNodeScore(current)


return currentScore > bestScore ? current : best
    }, nodeList[0])
  }

  const handleClone = async () => {
    if (vmidError) {
      setError(vmidError)

return
    }

    setCloning(true)
    setError(null)

    try {
      await onClone({
        targetNode,
        newVmid,
        name,
        targetStorage: targetStorage || undefined,
        format: targetStorage ? format : undefined,
        pool: pool || undefined,
        full: fullClone
      })
      onClose()
    } catch (e: any) {
      setError(e.message || t('hardware.cloneError'))
    } finally {
      setCloning(false)
    }
  }

  const recommendedNode = getRecommendedNodeLocal(nodes)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-file-copy-line" style={{ fontSize: 24 }} />
        {t('hardware.cloneTitle', { vmName, vmid })}
      </DialogTitle>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 1 }}>
          {/* Target Node */}
          <FormControl fullWidth size="small">
            <InputLabel>Target node</InputLabel>
            <Select
              value={targetNode}
              onChange={(e) => setTargetNode(e.target.value)}
              label="Target node"
              disabled={nodesLoading}
              MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
            >
              {nodes.map((node) => {
                const cpuPercent = (node.cpu || 0) * 100
                const memPercent = node.maxmem && node.mem ? (node.mem / node.maxmem) * 100 : 0
                const isRecommended = recommendedNode?.node === node.node

                return (
                  <MenuItem key={node.node} value={node.node} sx={{ py: 1 }}>
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-server-line" style={{ fontSize: 14, opacity: 0.7 }} />
                          <Typography variant="body2" fontWeight={500}>{node.node}</Typography>
                          {isRecommended && (
                            <Chip label="★" size="small" color="success" sx={{ height: 16, fontSize: '0.6rem', minWidth: 20, '& .MuiChip-label': { px: 0.5 } }} />
                          )}
                        </Box>
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>{node.maxcpu}c</Typography>
                      </Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.7, minWidth: 28 }}>CPU</Typography>
                          <Box sx={{ flex: 1, height: 3, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${cpuPercent}%`, bgcolor: cpuPercent > 80 ? 'error.main' : cpuPercent > 60 ? 'warning.main' : 'success.main' }} />
                          </Box>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6, minWidth: 24 }}>{cpuPercent.toFixed(0)}%</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.7, minWidth: 28 }}>RAM</Typography>
                          <Box sx={{ flex: 1, height: 3, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${memPercent}%`, bgcolor: memPercent > 80 ? 'error.main' : memPercent > 60 ? 'warning.main' : 'success.main' }} />
                          </Box>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6, minWidth: 24 }}>{memPercent.toFixed(0)}%</Typography>
                        </Box>
                      </Box>
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>

          {/* Target Storage */}
          <FormControl fullWidth size="small">
            <InputLabel>Target Storage</InputLabel>
            <Select
              value={targetStorage}
              onChange={(e) => setTargetStorage(e.target.value)}
              label="Target Storage"
              disabled={storagesLoading}
              MenuProps={{ PaperProps: { sx: { maxHeight: 350 } } }}
            >
              <MenuItem value="">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-link" style={{ fontSize: 14, opacity: 0.7 }} />
                  <Typography variant="body2">Same as source</Typography>
                </Box>
              </MenuItem>

              {storages.length > 0 && <Divider sx={{ my: 0.5 }} />}

              {storages.map((s) => {
                const usedPercent = s.total && s.avail ? ((s.total - s.avail) / s.total) * 100 : 0

                return (
                  <MenuItem key={s.storage} value={s.storage} sx={{ py: 1 }}>
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                          <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                        </Box>
                        <Chip
                          label={s.type}
                          size="small"
                          variant="outlined"
                          sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                        />
                      </Box>
                      {s.total && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ flex: 1, height: 3, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                            <Box sx={{
                              height: '100%',
                              width: `${usedPercent}%`,
                              bgcolor: usedPercent > 90 ? 'error.main' : usedPercent > 75 ? 'warning.main' : 'success.main'
                            }} />
                          </Box>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7, minWidth: 100, textAlign: 'right' }}>
                            {formatBytes(s.avail)} / {formatBytes(s.total)}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>

          {/* VM ID */}
          <TextField
            size="small"
            label="VM ID"
            type="number"
            value={newVmid}
            onChange={(e) => setNewVmid(parseInt(e.target.value) || 0)}
            inputProps={{ min: 100, max: 999999999 }}
            required
            error={!!vmidError}
            helperText={vmidError}
          />

          {/* Format */}
          <FormControl fullWidth size="small" disabled={!targetStorage}>
            <InputLabel>Format</InputLabel>
            <Select value={format} onChange={(e) => setFormat(e.target.value)} label="Format">
              <MenuItem value="qcow2">QEMU image format (qcow2)</MenuItem>
              <MenuItem value="raw">Raw disk image (raw)</MenuItem>
              <MenuItem value="vmdk">VMware image format (vmdk)</MenuItem>
            </Select>
          </FormControl>

          {/* Name */}
          <TextField
            size="small"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('hardware.optional')}
          />

          {/* Resource Pool */}
          <FormControl fullWidth size="small">
            <InputLabel>Resource Pool</InputLabel>
            <Select
              value={pool}
              onChange={(e) => setPool(e.target.value)}
              label="Resource Pool"
              disabled={poolsLoading}
            >
              <MenuItem value="">
                <Typography variant="body2" sx={{ opacity: 0.7 }}>{t('hardware.none')}</Typography>
              </MenuItem>
              {resourcePools.map((p) => (
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
        </Box>

        {/* Mode de clonage */}
        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={fullClone}
                onChange={(e) => setFullClone(e.target.checked)}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Full Clone</Typography>
                <Typography variant="caption" color="text.secondary">
                  {fullClone
                    ? t('hardware.fullCopyDescription')
                    : t('hardware.linkedCloneDescription')}
                </Typography>
              </Box>
            }
          />
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={cloning}>{t('hardware.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleClone}
          disabled={cloning || !!vmidError}
          startIcon={cloning ? <CircularProgress size={16} /> : <i className="ri-file-copy-line" />}
        >
          {cloning ? t('hardware.cloning') : t('hardware.clone')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
