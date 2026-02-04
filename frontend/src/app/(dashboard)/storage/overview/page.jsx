'use client'

import { useEffect, useMemo, useState } from 'react'

import Link from 'next/link'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material'

import { DataGrid } from '@mui/x-data-grid'

import { usePageTitle } from '@/contexts/PageTitleContext'

/* -----------------------------
  Helpers
------------------------------ */

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Icône pour les types de storage
const StorageIcon = ({ type, size = 20 }) => {
  const iconMap = {
    'dir': 'ri-folder-line',
    'lvm': 'ri-stack-line',
    'lvmthin': 'ri-stack-line',
    'zfs': 'ri-database-2-line',
    'zfspool': 'ri-database-2-line',
    'nfs': 'ri-share-line',
    'cifs': 'ri-windows-line',
    'glusterfs': 'ri-share-line',
    'iscsi': 'ri-hard-drive-2-line',
    'iscsidirect': 'ri-hard-drive-2-line',
    'rbd': 'ri-cloud-line',
    'cephfs': 'ri-cloud-line',
    'pbs': 'ri-shield-check-line',
    'btrfs': 'ri-database-line',
  }

  
return <i className={iconMap[type] || 'ri-hard-drive-line'} style={{ fontSize: size }} />
}

// Couleurs pour les types
const getTypeColor = (type) => {
  const colorMap = {
    'dir': '#607d8b',
    'lvm': '#795548',
    'lvmthin': '#8d6e63',
    'zfs': '#2196f3',
    'zfspool': '#1976d2',
    'nfs': '#4caf50',
    'cifs': '#00bcd4',
    'glusterfs': '#9c27b0',
    'iscsi': '#ff9800',
    'iscsidirect': '#f57c00',
    'rbd': '#e91e63',
    'cephfs': '#e91e63',
    'pbs': '#673ab7',
    'btrfs': '#009688',
  }

  
return colorMap[type] || '#9e9e9e'
}

// Chip de type storage
const StorageTypeChip = ({ type }) => {
  const color = getTypeColor(type)

  const labels = {
    'dir': 'Directory',
    'lvm': 'LVM',
    'lvmthin': 'LVM-Thin',
    'zfs': 'ZFS',
    'zfspool': 'ZFS Pool',
    'nfs': 'NFS',
    'cifs': 'CIFS/SMB',
    'glusterfs': 'GlusterFS',
    'iscsi': 'iSCSI',
    'iscsidirect': 'iSCSI Direct',
    'rbd': 'Ceph RBD',
    'cephfs': 'CephFS',
    'pbs': 'PBS',
    'btrfs': 'Btrfs',
  }

  
return (
    <Chip 
      size='small' 
      label={labels[type] || type || 'Unknown'} 
      sx={{ 
        bgcolor: `${color}20`, 
        color: color,
        fontWeight: 700,
        fontSize: 11,
      }} 
    />
  )
}

// Chip partagé/local - Note: This component needs t() passed as prop since it's outside the main component
const ScopeChip = ({ shared, sharedLabel, localLabel }) => {
  if (shared) {
    return <Chip size='small' label={sharedLabel || 'Shared'} color='primary' variant='outlined' sx={{ fontSize: 11 }} />
  }

  
return <Chip size='small' label={localLabel || 'Local'} variant='outlined' sx={{ fontSize: 11 }} />
}

// Chip de contenu - needs t() passed as prop
const ContentChip = ({ content, t }) => {
  const labels = {
    'images': t ? t('storage.content.vmDisks') : 'VM Disks',
    'rootdir': t ? t('storage.content.containers') : 'Containers',
    'vztmpl': t ? t('storage.content.ctTemplates') : 'CT Templates',
    'iso': t ? t('storage.content.iso') : 'ISO',
    'backup': t ? t('storage.content.backups') : 'Backups',
    'snippets': t ? t('storage.content.snippets') : 'Snippets',
  }

  
return (
    <Chip 
      size='small' 
      label={labels[content] || content} 
      variant='outlined'
      sx={{ fontSize: 10, height: 20 }} 
    />
  )
}

// Barre de capacité
const CapacityBar = ({ usedPct, size = 'medium' }) => {
  const getColor = (pct) => {
    if (pct >= 90) return '#f44336'
    if (pct >= 75) return '#ff9800'
    
return '#4caf50'
  }
  
  return (
    <LinearProgress 
      variant='determinate' 
      value={Math.min(100, usedPct || 0)} 
      sx={{ 
        height: size === 'small' ? 6 : 8, 
        borderRadius: 1,
        bgcolor: 'action.hover',
        '& .MuiLinearProgress-bar': {
          borderRadius: 1,
          bgcolor: getColor(usedPct)
        }
      }} 
    />
  )
}

/* -----------------------------
  KPI Card
------------------------------ */

function KpiCard({ title, value, subtitle, icon, color }) {
  return (
    <Card variant='outlined'>
      <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ 
            width: 48, height: 48, borderRadius: 2, 
            bgcolor: color ? `${color}18` : 'action.hover',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className={icon} style={{ fontSize: 24, color: color || 'inherit' }} />
          </Box>
          <Box>
            <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase' }}>
              {title}
            </Typography>
            <Typography variant='h5' sx={{ fontWeight: 800, color: color || 'text.primary' }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant='caption' sx={{ opacity: 0.5 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

/* -----------------------------
  Page
------------------------------ */

export default function StorageOverviewPage() {
  const t = useTranslations()
  const theme = useTheme()

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('navigation.storage'), t('storage.overview'), 'ri-database-2-fill')
    
return () => setPageInfo('', '', '')
  }, [setPageInfo, t])
  const primaryColor = theme.palette.primary.main

  // State
  const [connections, setConnections] = useState([])
  const [connId, setConnId] = useState('*')

  const [storages, setStorages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all') // Afficher tous par défaut

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  // Charger tous les storages en une seule requête
  const loadStorages = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/storage', { cache: 'no-store' })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      
      setStorages(Array.isArray(json?.data) ? json.data : [])
      setConnections(Array.isArray(json?.connections) ? json.connections : [])
    } catch (e) {
      setError(e?.message || String(e))
      setStorages([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStorages()
  }, [])

  // Filtrage
  const filtered = useMemo(() => {
    let result = storages
    
    // Filtre par connexion
    if (connId !== '*') {
      result = result.filter(s => s.connections?.some(c => c.id === connId) || s.connId === connId)
    }
    
    const qq = q.trim().toLowerCase()

    
return result.filter(s => {
      const matchQ = !qq || 
        s.storage?.toLowerCase().includes(qq) || 
        s.node?.toLowerCase().includes(qq) ||
        s.type?.toLowerCase().includes(qq) ||
        s.connectionName?.toLowerCase().includes(qq)

      const matchType = typeFilter === 'all' || s.type === typeFilter

      const matchScope = scopeFilter === 'all' || 
        (scopeFilter === 'shared' && s.shared) || 
        (scopeFilter === 'local' && !s.shared)

      
return matchQ && matchType && matchScope
    })
  }, [storages, q, typeFilter, scopeFilter, connId])

  // Types uniques pour le filtre
  const uniqueTypes = useMemo(() => {
    const types = new Set(storages.map(s => s.type).filter(Boolean))

    
return Array.from(types).sort()
  }, [storages])

  // Agrégation pour les KPIs (sur les données filtrées)
  const stats = useMemo(() => {
    // Stats sur tous les storages (pour info)
    const allShared = storages.filter(s => s.shared)
    const allLocal = storages.filter(s => !s.shared)
    
    // Stats sur les filtrés
    const totalUsed = filtered.reduce((acc, s) => acc + (s.used || 0), 0)
    const totalCapacity = filtered.reduce((acc, s) => acc + (s.total || 0), 0)

    const avgUsedPct = filtered.length > 0 
      ? Math.round(filtered.reduce((acc, s) => acc + (s.usedPct || 0), 0) / filtered.length)
      : 0

    const critical = filtered.filter(s => s.usedPct >= 90).length
    const warning = filtered.filter(s => s.usedPct >= 75 && s.usedPct < 90).length

    return {
      total: filtered.length,
      totalAll: storages.length,
      shared: allShared.length,
      local: allLocal.length,
      totalUsed,
      totalCapacity,
      totalUsedFormatted: formatBytes(totalUsed),
      totalCapacityFormatted: formatBytes(totalCapacity),
      avgUsedPct,
      critical,
      warning,
    }
  }, [filtered, storages])

  // Selection
  const selected = useMemo(() => {
    return filtered.find(s => s.id === selectedId) || null
  }, [filtered, selectedId])

  const openStorage = (id) => {
    setSelectedId(id)
    setDrawerOpen(true)
  }

  // Colonnes DataGrid
  const columns = useMemo(() => [
    {
      field: 'storage',
      headerName: t('storage.title'),
      flex: 1,
      minWidth: 180,
      renderCell: params => {
        const nodeCount = params.row.allNodes?.length || params.row.nodes?.length || 1

        
return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, height: '100%' }}>
            <Box sx={{ 
              width: 36, height: 36, borderRadius: 1.5, 
              bgcolor: `${getTypeColor(params.row.type)}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: getTypeColor(params.row.type),
              flexShrink: 0
            }}>
              <StorageIcon type={params.row.type} size={20} />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
              <Typography variant='body2' sx={{ fontWeight: 700, lineHeight: 1.3 }}>{params.row.storage}</Typography>
              <Typography variant='caption' sx={{ opacity: 0.6, lineHeight: 1.2 }}>
                {nodeCount} node{nodeCount > 1 ? 's' : ''}
              </Typography>
            </Box>
          </Box>
        )
      }
    },
    {
      field: 'type',
      headerName: t('common.type'),
      width: 120,
      renderCell: params => <StorageTypeChip type={params.row.type} />
    },
    {
      field: 'shared',
      headerName: t('storageOverview.scope'),
      width: 100,
      renderCell: params => <ScopeChip shared={params.row.shared} sharedLabel={t('storage.shared')} localLabel={t('storage.local')} />
    },
    {
      field: 'connectionName',
      headerName: t('storage.connection'),
      width: 160,
      renderCell: params => {
        const conns = params.row.connections || []

        if (conns.length === 1) {
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <Typography variant='body2' sx={{ opacity: 0.8 }}>{conns[0].name}</Typography>
            </Box>
          )
        }

        
return (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Tooltip title={conns.map(c => c.name).join(', ')}>
              <Chip
                size='small'
                label={t('storage.connectionCount', { count: conns.length })}
                variant='outlined'
                sx={{ fontSize: 11 }}
              />
            </Tooltip>
          </Box>
        )
      }
    },
    {
      field: 'content',
      headerName: t('common.type'),
      flex: 0.8,
      minWidth: 150,
      renderCell: params => (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center', height: '100%' }}>
          {(params.row.content || []).slice(0, 3).map(c => (
            <ContentChip key={c} content={c} t={t} />
          ))}
          {(params.row.content || []).length > 3 && (
            <Chip size='small' label={`+${params.row.content.length - 3}`} sx={{ fontSize: 10, height: 20 }} />
          )}
        </Box>
      )
    },
    {
      field: 'usedPct',
      headerName: t('storage.usage'),
      width: 180,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', height: '100%' }}>
          <Box sx={{ flex: 1 }}>
            <CapacityBar usedPct={params.row.usedPct} size='small' />
          </Box>
          <Typography variant='body2' sx={{ fontWeight: 700, minWidth: 45, textAlign: 'right' }}>
            {params.row.usedPct || 0}%
          </Typography>
        </Box>
      )
    },
    {
      field: 'totalFormatted',
      headerName: t('storage.capacity'),
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.row.totalFormatted}</Typography>
        </Box>
      )
    },
    {
      field: 'actions',
      headerName: '',
      width: 60,
      sortable: false,
      renderCell: params => (
        <Tooltip title={t('common.details')}>
          <IconButton size='small' onClick={() => openStorage(params.row.id)}>
            <i className='ri-arrow-right-s-line' />
          </IconButton>
        </Tooltip>
      )
    }
  ], [t])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header - Actions only */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Tooltip title={t('common.refresh')}>
          <IconButton onClick={loadStorages} disabled={loading}>
            <i className='ri-refresh-line' />
          </IconButton>
        </Tooltip>
        <Button variant='outlined' size='small' component={Link} href='/storage/ceph'>
          {t('storage.ceph')}
        </Button>
      </Box>

      {/* KPIs */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
        <KpiCard
          title={t('storage.storages')}
          value={stats.total}
          subtitle={`${stats.shared} ${t('storage.shared')} • ${stats.local} ${t('storage.local')}`}
          icon='ri-hard-drive-2-line'
          color={primaryColor}
        />
        <KpiCard
          title={t('storage.capacity')}
          value={stats.totalCapacityFormatted}
          subtitle={`${stats.totalUsedFormatted} ${t('common.used')}`}
          icon='ri-database-2-line'
          color='#2196f3'
        />
        <KpiCard
          title={t('storage.usage')}
          value={`${stats.avgUsedPct}%`}
          subtitle={stats.avgUsedPct >= 75 ? t('common.warning') : 'OK'}
          icon='ri-pie-chart-line'
          color={stats.avgUsedPct >= 90 ? '#f44336' : stats.avgUsedPct >= 75 ? '#ff9800' : '#4caf50'}
        />
        <KpiCard
          title={t('alerts.title')}
          value={stats.critical + stats.warning}
          subtitle={`${stats.critical} ${t('alerts.criticals')} • ${stats.warning} ${t('alerts.warnings')}`}
          icon='ri-alarm-warning-line'
          color={stats.critical > 0 ? '#f44336' : stats.warning > 0 ? '#ff9800' : '#4caf50'}
        />
      </Box>

      {/* Filtres */}
      <Card variant='outlined'>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Connexion */}
            <FormControl size='small' sx={{ minWidth: 180 }}>
              <Select
                value={connId}
                onChange={e => setConnId(e.target.value)}
                displayEmpty
              >
                <MenuItem value='*'>{t('storage.scannedConnections')}</MenuItem>
                {connections.map(c => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Recherche */}
            <TextField
              size='small'
              placeholder={t('common.search') + '...'}
              value={q}
              onChange={e => setQ(e.target.value)}
              sx={{ minWidth: 200 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position='start'>
                    <i className='ri-search-line' style={{ opacity: 0.5 }} />
                  </InputAdornment>
                )
              }}
            />

            {/* Type */}
            <FormControl size='small' sx={{ minWidth: 140 }}>
              <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <MenuItem value='all'>{t('storage.allTypes')}</MenuItem>
                {uniqueTypes.map(t => (
                  <MenuItem key={t} value={t}>{t.toUpperCase()}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Scope */}
            <FormControl size='small' sx={{ minWidth: 160 }}>
              <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
                <MenuItem value='all'>{t('common.all')}</MenuItem>
                <MenuItem value='shared'>{t('storage.shared')}</MenuItem>
                <MenuItem value='local'>{t('storage.local')}</MenuItem>
              </Select>
            </FormControl>

            <Box sx={{ flex: 1 }} />

            <Typography variant='body2' sx={{ opacity: 0.6 }}>
              {t('storage.storageCountPlural', { count: filtered.length })}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* DataGrid */}
      <Card variant='outlined'>
        <Box sx={{ height: 600 }}>
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Box sx={{ p: 3 }}>
              <Alert severity='error'>{error}</Alert>
            </Box>
          ) : (
            <DataGrid
              rows={filtered}
              columns={columns}
              pageSizeOptions={[10, 25, 50]}
              initialState={{
                pagination: { paginationModel: { pageSize: 25 } },
                sorting: { sortModel: [{ field: 'usedPct', sort: 'desc' }] }
              }}
              disableRowSelectionOnClick
              onRowClick={(params) => openStorage(params.row.id)}
              sx={{
                border: 'none',
                '& .MuiDataGrid-row': { cursor: 'pointer' },
                '& .MuiDataGrid-cell:focus': { outline: 'none' },
              }}
            />
          )}
        </Box>
      </Card>

      {/* Drawer */}
      <Drawer
        anchor='right'
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 450 } } }}
      >
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, height: '100%', overflow: 'auto' }}>
          {!selected ? (
            <Alert severity='info'>{t('common.select')} {t('storage.title').toLowerCase()}</Alert>
          ) : (
            <>
              {/* Header */}
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ 
                  width: 56, height: 56, borderRadius: 2, 
                  bgcolor: `${getTypeColor(selected.type)}18`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: getTypeColor(selected.type)
                }}>
                  <StorageIcon type={selected.type} size={28} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant='h6' sx={{ fontWeight: 900 }}>{selected.storage}</Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                    <StorageTypeChip type={selected.type} />
                    <ScopeChip shared={selected.shared} sharedLabel={t('storage.shared')} localLabel={t('storage.local')} />
                  </Box>
                </Box>
                <IconButton onClick={() => setDrawerOpen(false)}>
                  <i className='ri-close-line' />
                </IconButton>
              </Box>

              <Divider />

              {/* Capacité */}
              <Box>
                <Typography variant='overline' sx={{ opacity: 0.6 }}>{t('storage.capacity')}</Typography>
                <Box sx={{ mt: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant='body2'>{t('common.used')}</Typography>
                    <Typography variant='body2' sx={{ fontWeight: 700 }}>
                      {selected.usedFormatted} / {selected.totalFormatted}
                    </Typography>
                  </Box>
                  <CapacityBar usedPct={selected.usedPct} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                    <Typography variant='caption' sx={{ opacity: 0.6 }}>
                      {t('storage.usedPercent', { percent: selected.usedPct })}
                    </Typography>
                    <Typography variant='caption' sx={{ opacity: 0.6 }}>
                      {selected.freeFormatted} {t('common.free')}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              <Divider />

              {/* Informations */}
              <Box>
                <Typography variant='overline' sx={{ opacity: 0.6 }}>{t('common.info')}</Typography>
                <Stack spacing={1.5} sx={{ mt: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant='body2' sx={{ opacity: 0.75 }}>{t('storage.connection')}</Typography>
                    <Box sx={{ textAlign: 'right' }}>
                      {(selected.connections || []).length <= 2 ? (
                        <Typography variant='body2' sx={{ fontWeight: 700 }}>
                          {(selected.connections || []).map(c => c.name).join(', ')}
                        </Typography>
                      ) : (
                        <Tooltip title={(selected.connections || []).map(c => c.name).join(', ')}>
                          <Typography variant='body2' sx={{ fontWeight: 700 }}>
                            {t('storage.connectionCount', { count: selected.connections.length })}
                          </Typography>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant='body2' sx={{ opacity: 0.75 }}>{t('storageOverview.nodes')}</Typography>
                    <Box sx={{ textAlign: 'right' }}>
                      {(selected.allNodes || selected.nodes || []).length <= 3 ? (
                        <Typography variant='body2' sx={{ fontWeight: 700 }}>
                          {(selected.allNodes || selected.nodes || [selected.node]).join(', ')}
                        </Typography>
                      ) : (
                        <Tooltip title={(selected.allNodes || selected.nodes || []).join(', ')}>
                          <Typography variant='body2' sx={{ fontWeight: 700 }}>
                            {(selected.allNodes || selected.nodes || []).length} nodes
                          </Typography>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant='body2' sx={{ opacity: 0.75 }}>{t('common.type')}</Typography>
                    <Typography variant='body2' sx={{ fontWeight: 700 }}>{selected.type?.toUpperCase()}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant='body2' sx={{ opacity: 0.75 }}>{t('common.status')}</Typography>
                    <Chip
                      size='small'
                      label={selected.enabled ? t('common.enabled') : t('common.disabled')}
                      color={selected.enabled ? 'success' : 'default'}
                      sx={{ height: 22 }}
                    />
                  </Box>
                  {selected.path && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant='body2' sx={{ opacity: 0.75 }}>{t('storage.path')}</Typography>
                      <Typography variant='body2' sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>
                        {selected.path}
                      </Typography>
                    </Box>
                  )}
                  {selected.server && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant='body2' sx={{ opacity: 0.75 }}>{t('storage.server')}</Typography>
                      <Typography variant='body2' sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>
                        {selected.server}
                      </Typography>
                    </Box>
                  )}
                  {selected.export && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant='body2' sx={{ opacity: 0.75 }}>Export</Typography>
                      <Typography variant='body2' sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>
                        {selected.export}
                      </Typography>
                    </Box>
                  )}
                  {selected.pool && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant='body2' sx={{ opacity: 0.75 }}>Pool</Typography>
                      <Typography variant='body2' sx={{ fontWeight: 700 }}>{selected.pool}</Typography>
                    </Box>
                  )}
                  {selected.monhost && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant='body2' sx={{ opacity: 0.75 }}>Mon Host</Typography>
                      <Typography variant='body2' sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>
                        {selected.monhost}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </Box>

              <Divider />

              {/* Contenu supporté */}
              <Box>
                <Typography variant='overline' sx={{ opacity: 0.6 }}>{t('common.type')}</Typography>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
                  {(selected.content || []).length === 0 ? (
                    <Typography variant='body2' sx={{ opacity: 0.5 }}>{t('common.noData')}</Typography>
                  ) : (
                    selected.content.map(c => <ContentChip key={c} content={c} t={t} />)
                  )}
                </Box>
              </Box>

              {/* Détails par connexion - affiché si plusieurs connexions */}
              {(selected.connectionDetails || []).length > 1 && (
                <>
                  <Divider />
                  <Box>
                    <Typography variant='overline' sx={{ opacity: 0.6 }}>
                      {t('storage.detailsByConnection')} ({selected.connectionDetails.length})
                    </Typography>
                    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                      {selected.connectionDetails
                        .sort((a, b) => (b.usedPct || 0) - (a.usedPct || 0))
                        .map((conn, idx) => (
                        <Box 
                          key={conn.id || idx} 
                          sx={{ 
                            p: 1.5, 
                            borderRadius: 1.5, 
                            bgcolor: 'action.hover',
                            border: '1px solid',
                            borderColor: 'divider'
                          }}
                        >
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Box>
                              <Typography variant='body2' sx={{ fontWeight: 700 }}>{conn.name}</Typography>
                              <Typography variant='caption' sx={{ opacity: 0.6 }}>
                                {conn.nodes?.length || 1} node{(conn.nodes?.length || 1) > 1 ? 's' : ''}
                              </Typography>
                            </Box>
                            <Typography variant='body2' sx={{ fontWeight: 700 }}>
                              {conn.usedPct || 0}%
                            </Typography>
                          </Box>
                          <CapacityBar usedPct={conn.usedPct} size='small' />
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                            <Typography variant='caption' sx={{ opacity: 0.6 }}>
                              {conn.usedFormatted}
                            </Typography>
                            <Typography variant='caption' sx={{ opacity: 0.6 }}>
                              {conn.totalFormatted}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                </>
              )}

              <Box sx={{ flex: 1 }} />

              {/* Actions */}
              <Box>
                <Typography variant='overline' sx={{ opacity: 0.6 }}>{t('common.actions')}</Typography>
                <Stack direction='row' spacing={1} sx={{ mt: 1 }}>
                  <Button
                    size='small'
                    variant='outlined'
                    startIcon={<i className='ri-external-link-line' />}
                    component={Link}
                    href={`/infrastructure/resources?storage=${selected.storage}`}
                  >
                    {t('common.view')}
                  </Button>
                </Stack>
              </Box>
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  )
}
