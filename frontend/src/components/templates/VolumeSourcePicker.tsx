'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

export interface VolumeLocation {
  connectionId: string
  node: string
  volumeId: string
}

interface VolumeSourcePickerProps {
  connections: Array<{ id: string; name: string }>
  value: VolumeLocation
  onChange: (value: VolumeLocation) => void
}

/** Cluster, node, storage and volume of a volume-mode image: its source, or
 * one of its copies on another cluster (#44). */
export default function VolumeSourcePicker({ connections, value, onChange }: VolumeSourcePickerProps) {
  const t = useTranslations()
  const { connectionId, node, volumeId } = value

  const [nodes, setNodes] = useState<any[]>([])
  const [storages, setStorages] = useState<any[]>([])
  const [selectedStorage, setSelectedStorage] = useState(volumeId.split(':')[0] || '')
  const [volumes, setVolumes] = useState<any[]>([])
  const [loadingVolumes, setLoadingVolumes] = useState(false)

  // Fetch nodes
  useEffect(() => {
    if (!connectionId) { setNodes([]); return }
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes`)
      .then(r => r.json())
      .then(res => {
        const nodeList = (res.data || []).filter((n: any) => n.status === 'online')
        setNodes(nodeList)
        if (nodeList.length === 1 && !node) onChange({ ...value, node: nodeList[0].node })
      })
      .catch(() => setNodes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on cluster change only
  }, [connectionId])

  // Fetch storages
  useEffect(() => {
    if (!connectionId || !node) { setStorages([]); return }
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/storages`)
      .then(r => r.json())
      .then(res => {
        const stList = (res.data || []).filter((s: any) => s.enabled !== 0)
        setStorages(stList)
      })
      .catch(() => setStorages([]))
  }, [connectionId, node])

  // Fetch volumes from storage
  useEffect(() => {
    if (!connectionId || !node || !selectedStorage) { setVolumes([]); return }
    setLoadingVolumes(true)
    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(selectedStorage)}/content`)
      .then(r => r.json())
      .then(res => {
        // Filter to importable image files
        const vols = (res.data || []).filter((v: any) => {
          const vol = v.volid || ''
          return vol.match(/\.(qcow2|raw|vmdk|img|iso)$/i) || v.content === 'import' || v.content === 'images'
        })
        setVolumes(vols)
        setLoadingVolumes(false)
      })
      .catch(() => { setVolumes([]); setLoadingVolumes(false) })
  }, [connectionId, node, selectedStorage])

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
        <FormControl size="small">
          <InputLabel>{t('templates.deploy.target.connection')}</InputLabel>
          <Select
            value={connectionId}
            onChange={e => { setSelectedStorage(''); onChange({ connectionId: e.target.value, node: '', volumeId }) }}
            label={t('templates.deploy.target.connection')}
          >
            {connections.map(c => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" disabled={!connectionId}>
          <InputLabel>{t('templates.deploy.target.node')}</InputLabel>
          <Select
            value={nodes.some(n => n.node === node) ? node : ''}
            onChange={e => { setSelectedStorage(''); onChange({ ...value, node: e.target.value }) }}
            label={t('templates.deploy.target.node')}
          >
            {nodes.map((n: any) => (
              <MenuItem key={n.node} value={n.node}>{n.node}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" disabled={!node}>
          <InputLabel>{t('templates.deploy.target.storage')}</InputLabel>
          <Select
            value={storages.some(s => s.storage === selectedStorage) ? selectedStorage : ''}
            onChange={e => setSelectedStorage(e.target.value)}
            label={t('templates.deploy.target.storage')}
          >
            {storages.map((s: any) => (
              <MenuItem key={s.storage} value={s.storage}>
                {s.storage} ({s.type})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Volume list */}
      {loadingVolumes ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : volumes.length > 0 ? (
        <Box sx={{ maxHeight: 200, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {volumes.map((v: any) => (
            <Box
              key={v.volid}
              onClick={() => onChange({ ...value, volumeId: v.volid })}
              sx={{
                px: 1.5, py: 0.75,
                cursor: 'pointer',
                bgcolor: volumeId === v.volid ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
                display: 'flex', alignItems: 'center', gap: 1,
                borderBottom: 1, borderColor: 'divider',
                '&:last-child': { borderBottom: 0 },
              }}
            >
              <i className="ri-file-line" style={{ fontSize: 14, opacity: 0.5 }} />
              <Typography variant="body2" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }}>
                {v.volid}
              </Typography>
              {v.size && (
                <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>
                  {(v.size / 1073741824).toFixed(1)} GB
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      ) : selectedStorage ? (
        <Typography variant="body2" sx={{ opacity: 0.5, fontStyle: 'italic' }}>
          {t('templates.catalog.noVolumes')}
        </Typography>
      ) : null}

      <TextField
        size="small"
        label={t('templates.catalog.volumeIdLabel')}
        value={volumeId}
        onChange={e => onChange({ ...value, volumeId: e.target.value })}
        required
        fullWidth
        placeholder="local:import/my-image.qcow2"
        helperText={t('templates.catalog.volumeIdHelp')}
      />
    </Stack>
  )
}
