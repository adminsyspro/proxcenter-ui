'use client'

import { useEffect, useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

interface SnapshotEntry {
  vmid: number
  vmName: string
  vmType: 'qemu' | 'lxc'
  vmStatus: string
  node: string
  name: string
  description: string
  snaptime: number
  vmstate: boolean
  parent: string | null
}

interface SnapshotsTabProps {
  connectionId: string
  node?: string
}

type SortField = 'snaptime' | 'vmid' | 'node' | 'name'
type SortDir = 'asc' | 'desc'

export default function SnapshotsTab({ connectionId, node }: SnapshotsTabProps) {
  const t = useTranslations('snapshotsTab')
  const theme = useTheme()
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [nodeFilter, setNodeFilter] = useState<string>('')
  const [sortField, setSortField] = useState<SortField>('snaptime')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [vmCount, setVmCount] = useState(0)

  const fetchSnapshots = async () => {
    setLoading(true)
    try {
      const url = node
        ? `/api/v1/connections/${encodeURIComponent(connectionId)}/snapshots?node=${encodeURIComponent(node)}`
        : `/api/v1/connections/${encodeURIComponent(connectionId)}/snapshots`
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
        setSnapshots(json.data?.snapshots || [])
        setVmCount(json.data?.vmCount || 0)
      }
    } catch (e) {
      console.error('Failed to fetch snapshots:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSnapshots()
  }, [connectionId, node])

  const nodes = useMemo(() => {
    const set = new Set<string>()
    for (const s of snapshots) set.add(s.node)
    return Array.from(set).sort()
  }, [snapshots])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'snaptime' ? 'desc' : 'asc')
    }
  }

  const filtered = useMemo(() => {
    let list = snapshots

    if (nodeFilter) {
      list = list.filter(s => s.node === nodeFilter)
    }

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          s.vmName.toLowerCase().includes(q) ||
          String(s.vmid).includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.node.toLowerCase().includes(q)
      )
    }

    list = [...list].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortField === 'snaptime') return (a.snaptime - b.snaptime) * dir
      if (sortField === 'vmid') return (a.vmid - b.vmid) * dir
      const av = a[sortField] || ''
      const bv = b[sortField] || ''
      return av.localeCompare(bv) * dir
    })

    return list
  }, [snapshots, nodeFilter, search, sortField, sortDir])

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Skeleton variant="rounded" width={200} height={36} />
          <Skeleton variant="rounded" width={150} height={36} />
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <TableCell key={i}><Skeleton width={80} /></TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {[1, 2, 3, 4, 5].map(row => (
                <TableRow key={row}>
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <TableCell key={i}><Skeleton width={60 + Math.random() * 40} /></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    )
  }

  if (snapshots.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
        <i className="ri-camera-line" style={{ fontSize: 48, opacity: 0.3, marginBottom: 16 }} />
        <Typography variant="body1" fontWeight={600}>
          {t('noSnapshots')}
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.6 }}>
          {t('noSnapshotsDesc')}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<i className="ri-refresh-line" />}
          onClick={fetchSnapshots}
          sx={{ mt: 2 }}
        >
          {t('refresh')}
        </Button>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Header: stats + search + filters + refresh */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Chip
            icon={<i className="ri-camera-line" style={{ fontSize: 14 }} />}
            label={t('totalSnapshots', { count: snapshots.length })}
            size="small"
            sx={{ height: 28, fontSize: 12, fontWeight: 600 }}
          />
          <Chip
            icon={<i className="ri-computer-line" style={{ fontSize: 14 }} />}
            label={t('vmCount', { count: vmCount })}
            size="small"
            variant="outlined"
            sx={{ height: 28, fontSize: 12 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            size="small"
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <i className="ri-search-line" style={{ fontSize: 16, opacity: 0.5 }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: 200, '& .MuiInputBase-root': { height: 32, fontSize: 13 } }}
          />
          {!node && nodes.length > 1 && (
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <Select
                value={nodeFilter}
                onChange={(e) => setNodeFilter(e.target.value)}
                displayEmpty
                sx={{ height: 32, fontSize: 13 }}
              >
                <MenuItem value="">{t('allNodes')}</MenuItem>
                {nodes.map(n => (
                  <MenuItem key={n} value={n}>{n}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <IconButton size="small" onClick={fetchSnapshots} title={t('refresh')}>
            <i className="ri-refresh-line" style={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>

      {/* Snapshots Table */}
      <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>
                <TableSortLabel
                  active={sortField === 'vmid'}
                  direction={sortField === 'vmid' ? sortDir : 'asc'}
                  onClick={() => handleSort('vmid')}
                >
                  {t('vm')}
                </TableSortLabel>
              </TableCell>
              {!node && (
                <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>
                  <TableSortLabel
                    active={sortField === 'node'}
                    direction={sortField === 'node' ? sortDir : 'asc'}
                    onClick={() => handleSort('node')}
                  >
                    {t('node')}
                  </TableSortLabel>
                </TableCell>
              )}
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>
                <TableSortLabel
                  active={sortField === 'name'}
                  direction={sortField === 'name' ? sortDir : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  {t('snapshotName')}
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('description')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>
                <TableSortLabel
                  active={sortField === 'snaptime'}
                  direction={sortField === 'snaptime' ? sortDir : 'desc'}
                  onClick={() => handleSort('snaptime')}
                >
                  {t('date')}
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('ramState')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={node ? 5 : 6} sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                  {t('noSnapshots')}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((snap) => (
                <TableRow
                  key={`${snap.vmType}:${snap.vmid}:${snap.name}`}
                  sx={{
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:last-child td': { borderBottom: 'none' },
                  }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i
                        className={snap.vmType === 'qemu' ? 'ri-computer-line' : 'ri-instance-line'}
                        style={{ fontSize: 14, opacity: 0.6 }}
                      />
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                        {snap.vmid}
                      </Typography>
                      <Typography sx={{ fontSize: 12, opacity: 0.7 }}>
                        {snap.vmName}
                      </Typography>
                    </Box>
                  </TableCell>
                  {!node && (
                    <TableCell>
                      <Typography sx={{ fontSize: 12 }}>{snap.node}</Typography>
                    </TableCell>
                  )}
                  <TableCell>
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
                      {snap.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      sx={{
                        fontSize: 12,
                        opacity: snap.description ? 0.8 : 0.4,
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {snap.description || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {snap.snaptime ? new Date(snap.snaptime * 1000).toLocaleString() : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {snap.vmstate ? (
                      <Chip
                        label="RAM"
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: 10,
                          fontWeight: 700,
                          bgcolor: 'info.main',
                          color: 'info.contrastText',
                        }}
                      />
                    ) : (
                      <Typography sx={{ fontSize: 12, opacity: 0.4 }}>-</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
