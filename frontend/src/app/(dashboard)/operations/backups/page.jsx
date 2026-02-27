'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Breadcrumbs,
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
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material'

import { DataGrid } from '@mui/x-data-grid'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { formatBytes } from '@/utils/format'
import BackupJobsTabs from './BackupJobsTabs'
import EmptyState from '@/components/EmptyState'
import { TableSkeleton } from '@/components/skeletons'

/* -----------------------------
  Helpers
------------------------------ */

function useTimeAgo(t) {
  return (date) => {
    if (!date) return '-'
    const now = new Date()
    const diff = now - new Date(date)
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return t('time.justNow')
    if (minutes < 60) return t('time.minutesAgo', { count: minutes })
    if (hours < 24) return t('time.hoursAgo', { count: hours })
    if (days < 7) return t('time.daysAgo', { count: days })
    return new Date(date).toLocaleDateString()
  }
}

const TypeChip = ({ type }) => {
  if (type === 'vm') return <Chip size='small' color='primary' label='VM' />
  if (type === 'ct') return <Chip size='small' color='secondary' label='CT' />
  if (type === 'host') return <Chip size='small' color='default' label='Host' />
  
return <Chip size='small' label={type?.toUpperCase() || '?'} variant='outlined' />
}

const VerifyChip = ({ verified, t }) => {
  if (verified) return <Chip size='small' color='success' label={`✓ ${t('backups.verified')}`} variant='outlined' />

return <Chip size='small' color='default' label={t('backups.notVerified')} variant='outlined' sx={{ opacity: 0.5 }} />
}

// Icône selon le type de fichier
const FileIcon = ({ type, name }) => {
  if (type === 'directory') return <i className='ri-folder-fill' style={{ color: '#FFB74D', fontSize: 20 }} />
  if (type === 'symlink') return <i className='ri-link' style={{ color: '#90CAF9', fontSize: 20 }} />
  if (type === 'archive') return <i className='ri-archive-fill' style={{ color: '#A5D6A7', fontSize: 20 }} />
  
  // Détecter le type par extension
  const ext = name?.split('.').pop()?.toLowerCase()

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) 
    return <i className='ri-image-fill' style={{ color: '#CE93D8', fontSize: 20 }} />
  if (['mp4', 'mkv', 'avi', 'mov'].includes(ext)) 
    return <i className='ri-video-fill' style={{ color: '#F48FB1', fontSize: 20 }} />
  if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) 
    return <i className='ri-music-fill' style={{ color: '#80DEEA', fontSize: 20 }} />
  if (['pdf'].includes(ext)) 
    return <i className='ri-file-pdf-fill' style={{ color: '#EF5350', fontSize: 20 }} />
  if (['doc', 'docx'].includes(ext)) 
    return <i className='ri-file-word-fill' style={{ color: '#42A5F5', fontSize: 20 }} />
  if (['xls', 'xlsx'].includes(ext)) 
    return <i className='ri-file-excel-fill' style={{ color: '#66BB6A', fontSize: 20 }} />
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) 
    return <i className='ri-file-zip-fill' style={{ color: '#FFCA28', fontSize: 20 }} />
  if (['js', 'ts', 'py', 'sh', 'php', 'rb', 'go', 'rs'].includes(ext)) 
    return <i className='ri-code-s-slash-fill' style={{ color: '#4DD0E1', fontSize: 20 }} />
  if (['conf', 'cfg', 'ini', 'yaml', 'yml', 'json', 'xml'].includes(ext)) 
    return <i className='ri-settings-3-fill' style={{ color: '#B0BEC5', fontSize: 20 }} />
  if (['log', 'txt'].includes(ext)) 
    return <i className='ri-file-text-fill' style={{ color: '#90A4AE', fontSize: 20 }} />
  
  return <i className='ri-file-fill' style={{ color: '#B0BEC5', fontSize: 20 }} />
}

/* -----------------------------
  Page
------------------------------ */

export default function BackupsPage() {
  const t = useTranslations()
  const theme = useTheme()
  const { setPageInfo } = usePageTitle()
  const timeAgo = useTimeAgo(t)

  useEffect(() => {
    setPageInfo(t('backups.title'), t('backups.subtitle'), 'ri-file-copy-fill')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // PBS connections
  const [pbsConnections, setPbsConnections] = useState([])
  const [pbsLoading, setPbsLoading] = useState(true)
  const [selectedPbs, setSelectedPbs] = useState('')

  // PVE connections (pour les backup jobs)
  const [pveConnections, setPveConnections] = useState([])

  // PBS data
  const [pbsStatus, setPbsStatus] = useState(null)
  const [datastores, setDatastores] = useState([])
  const [backups, setBackups] = useState([])
  const [backupStats, setBackupStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])

  // Filters
  const [search, setSearch] = useState('')
  const [datastoreFilter, setDatastoreFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState(null)
  const [drawerTab, setDrawerTab] = useState(0) // 0 = Infos, 1 = Explorer

  // File explorer state
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [explorerError, setExplorerError] = useState(null)
  const [explorerFiles, setExplorerFiles] = useState([])
  const [explorerArchive, setExplorerArchive] = useState(null) // Archive sélectionnée
  const [explorerPath, setExplorerPath] = useState('/') // Chemin actuel
  const [explorerArchives, setExplorerArchives] = useState([]) // Liste des archives du backup

  // Charger le contenu d'un backup (liste des archives)
  const loadBackupContent = useCallback(async (backup) => {
    if (!backup || !selectedPbs) return

    setExplorerLoading(true)
    setExplorerError(null)
    setExplorerArchive(null)
    setExplorerPath('/')
    setExplorerFiles([])

    try {
      const backupId = encodeURIComponent(backup.id)
      const res = await fetch(`/api/v1/pbs/${encodeURIComponent(selectedPbs)}/backups/${backupId}/content`)
      const json = await res.json()

      if (json.error) {
        setExplorerError(json.error)
      } else {
        setExplorerArchives(json.data?.files || [])
      }
    } catch (e) {
      setExplorerError(e.message || t('errors.loadingError'))
    } finally {
      setExplorerLoading(false)
    }
  }, [selectedPbs, t])

  // Naviguer dans une archive
  const browseArchive = useCallback(async (archiveName, path = '/') => {
    if (!selectedBackup || !selectedPbs) return

    setExplorerLoading(true)
    setExplorerError(null)

    try {
      const backupId = encodeURIComponent(selectedBackup.id)

      const params = new URLSearchParams({
        archive: archiveName,
        filepath: path,
      })
      
      const res = await fetch(`/api/v1/pbs/${encodeURIComponent(selectedPbs)}/backups/${backupId}/content?${params}`)
      const json = await res.json()

      if (json.error && !json.data) {
        setExplorerError(json.error)
      } else {
        setExplorerFiles(json.data?.files || [])
        setExplorerArchive(archiveName)
        setExplorerPath(path)
        if (json.error) setExplorerError(json.error) // Afficher l'erreur mais garder les données
      }
    } catch (e) {
      setExplorerError(e.message || t('errors.loadingError'))
    } finally {
      setExplorerLoading(false)
    }
  }, [selectedBackup, selectedPbs, t])

  // Naviguer dans un dossier
  const navigateToFolder = useCallback((folderName) => {
    if (!explorerArchive) return
    const newPath = explorerPath === '/' ? `/${folderName}` : `${explorerPath}/${folderName}`

    browseArchive(explorerArchive, newPath)
  }, [explorerArchive, explorerPath, browseArchive])

  // Remonter d'un niveau
  const navigateUp = useCallback(() => {
    if (!explorerArchive || explorerPath === '/') return
    const parts = explorerPath.split('/').filter(Boolean)

    parts.pop()
    const newPath = parts.length ? '/' + parts.join('/') : '/'

    browseArchive(explorerArchive, newPath)
  }, [explorerArchive, explorerPath, browseArchive])

  // Naviguer vers un chemin du breadcrumb
  const navigateToBreadcrumb = useCallback((index) => {
    if (!explorerArchive) return
    const parts = explorerPath.split('/').filter(Boolean)
    const newPath = '/' + parts.slice(0, index + 1).join('/')

    browseArchive(explorerArchive, newPath)
  }, [explorerArchive, explorerPath, browseArchive])

  // Retourner à la liste des archives
  const backToArchives = useCallback(() => {
    setExplorerArchive(null)
    setExplorerPath('/')
    setExplorerFiles([])
  }, [])

  // Charger le contenu quand on change d'onglet vers Explorer
  useEffect(() => {
    if (drawerTab === 1 && selectedBackup && explorerArchives.length === 0) {
      loadBackupContent(selectedBackup)
    }
  }, [drawerTab, selectedBackup, explorerArchives.length, loadBackupContent])

  // Reset explorer quand on change de backup
  useEffect(() => {
    setExplorerArchives([])
    setExplorerArchive(null)
    setExplorerPath('/')
    setExplorerFiles([])
    setExplorerError(null)
    setDrawerTab(0)
  }, [selectedBackup?.id])

  // Charger les connexions PBS
  useEffect(() => {
    const loadPbsConnections = async () => {
      setPbsLoading(true)

      try {
        const res = await fetch('/api/v1/connections?type=pbs')
        const json = await res.json()
        const list = Array.isArray(json?.data) ? json.data : []

        setPbsConnections(list)


        // Sélectionner le premier PBS par défaut
        if (list.length > 0 && !selectedPbs) {
          setSelectedPbs(list[0].id)
        }
      } catch (e) {
        console.error('Failed to load PBS connections:', e)
      } finally {
        setPbsLoading(false)
      }
    }

    loadPbsConnections()
  }, [])

  // Charger les connexions PVE (pour les backup jobs)
  useEffect(() => {
    const loadPveConnections = async () => {
      try {
        const res = await fetch('/api/v1/connections?type=pve')
        const json = await res.json()
        const list = Array.isArray(json?.data) ? json.data : []

        setPveConnections(list)
      } catch (e) {
        console.error('Failed to load PVE connections:', e)
      }
    }

    loadPveConnections()
  }, [])

  // Pagination
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 })
  const [totalRows, setTotalRows] = useState(0)

  // Charger status et datastores (une seule fois)
  useEffect(() => {
    if (!selectedPbs) return

    const loadPbsMetadata = async () => {
      try {
        const [statusRes, datastoresRes] = await Promise.all([
          fetch(`/api/v1/pbs/${encodeURIComponent(selectedPbs)}/status`),
          fetch(`/api/v1/pbs/${encodeURIComponent(selectedPbs)}/datastores`),
        ])

        if (statusRes.ok) {
          const statusJson = await statusRes.json()

          setPbsStatus(statusJson?.data || null)
        }

        if (datastoresRes.ok) {
          const dsJson = await datastoresRes.json()

          setDatastores(Array.isArray(dsJson?.data) ? dsJson.data : [])
        }
      } catch (e) {
        console.error('Failed to load PBS metadata:', e)
      }
    }

    loadPbsMetadata()
  }, [selectedPbs])

  // Charger les backups avec pagination côté serveur
  useEffect(() => {
    if (!selectedPbs) return

    const loadBackups = async () => {
      setLoading(true)
      setError(null)
      setWarnings([])

      try {
        const params = new URLSearchParams({
          page: String(paginationModel.page + 1), // API commence à 1
          pageSize: String(paginationModel.pageSize),
        })

        if (datastoreFilter !== 'all') params.set('datastore', datastoreFilter)
        if (typeFilter !== 'all') params.set('type', typeFilter)
        if (search.trim()) params.set('search', search.trim())

        const res = await fetch(
          `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/backups?${params}`
        )

        if (res.ok) {
          const json = await res.json()

          setBackups(json?.data?.backups || [])
          setBackupStats(json?.data?.stats || null)
          setTotalRows(json?.data?.pagination?.totalItems || 0)
          setWarnings(json?.data?.warnings || [])
        } else {
          const errJson = await res.json().catch(() => ({}))

          setError(errJson?.error || t('ceph.errorStatus', { status: res.status }))
        }
      } catch (e) {
        setError(e?.message || t('errors.connectionError'))
      } finally {
        setLoading(false)
      }
    }

    loadBackups()
  }, [selectedPbs, paginationModel, datastoreFilter, typeFilter, search])

  // Debounce search pour éviter trop de requêtes
  const [searchInput, setSearchInput] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPaginationModel(prev => ({ ...prev, page: 0 })) // Reset page on search
    }, 300)

    
return () => clearTimeout(timer)
  }, [searchInput])

  // Colonnes du DataGrid
  const columns = useMemo(() => [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    {
      field: 'backupId',
      headerName: 'ID',
      width: 80,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
        </Box>
      )
    },
    {
      field: 'vmName',
      headerName: t('common.name'),
      flex: 1,
      minWidth: 150,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2' sx={{ opacity: params.value ? 1 : 0.4 }}>
            {params.value || '-'}
          </Typography>
        </Box>
      )
    },
    {
      field: 'backupType',
      headerName: t('common.type'),
      width: 80,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <TypeChip type={params.value} />
        </Box>
      )
    },
    {
      field: 'datastore',
      headerName: t('backups.datastoreHeader'),
      flex: 1,
      minWidth: 120,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2'>{params.value}</Typography>
        </Box>
      )
    },
    {
      field: 'backupTimeFormatted',
      headerName: t('common.date'),
      flex: 1,
      minWidth: 150,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Tooltip title={params.row.backupTimeIso}>
            <Typography variant='body2'>{params.value}</Typography>
          </Tooltip>
        </Box>
      )
    },
    {
      field: 'sizeFormatted',
      headerName: t('common.size'),
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2'>{params.value}</Typography>
        </Box>
      )
    },
    {
      field: 'verified',
      headerName: t('backups.verified'),
      width: 120,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <VerifyChip verified={params.value} t={t} />
        </Box>
      )
    },
    {
      field: 'protected',
      headerName: t('backups.protected'),
      width: 90,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {params.value ? (
            <Chip size='small' color='warning' label='🔒' />
          ) : (
            <Typography variant='body2' sx={{ opacity: 0.3 }}>-</Typography>
          )}
        </Box>
      )
    },
    {
      field: 'actions',
      headerName: '',
      width: 80,
      sortable: false,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Tooltip title={t('common.details')}>
            <IconButton size='small' onClick={() => {
              setSelectedBackup(params.row)
              setDrawerOpen(true)
            }}>
              <i className='ri-eye-line' style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )
    }
  ], [t])

  // KPI values
  const currentPbs = pbsConnections.find(p => p.id === selectedPbs)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Alerte si pas de PBS configuré */}
      {!pbsLoading && pbsConnections.length === 0 && (
        <Alert severity='warning'>
          {t('backups.noPbsConfiguredLong')}
          <Button size='small' href='/settings' sx={{ ml: 1 }}>{t('common.add')}</Button>
        </Alert>
      )}

      {/* KPIs */}
      {selectedPbs && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(6, 1fr)' }, gap: 2 }}>
          <Card variant='outlined'>
            <CardContent sx={{ py: 2, textAlign: 'center' }}>
              <Typography variant='h4' sx={{ fontWeight: 800, color: 'primary.main' }}>
                {loading ? '-' : (backupStats?.total || 0)}
              </Typography>
              <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('backups.title')}</Typography>
            </CardContent>
          </Card>

          <Card variant='outlined'>
            <CardContent sx={{ py: 2, textAlign: 'center' }}>
              <Typography variant='h4' sx={{ fontWeight: 800, color: 'info.main' }}>
                {loading ? '-' : datastores.length}
              </Typography>
              <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('backups.datastoresKpi')}</Typography>
            </CardContent>
          </Card>

          <Card variant='outlined'>
            <CardContent sx={{ py: 2, textAlign: 'center' }}>
              <Typography variant='h4' sx={{ fontWeight: 800 }}>
                {loading ? '-' : formatBytes(pbsStatus?.totalSize || 0)}
              </Typography>
              <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('storage.capacity')}</Typography>
            </CardContent>
          </Card>

          <Card variant='outlined'>
            <CardContent sx={{ py: 2, textAlign: 'center' }}>
              <Typography variant='h4' sx={{ fontWeight: 800, color: 'success.main' }}>
                {loading ? '-' : (backupStats?.verifiedCount || 0)}
              </Typography>
              <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('backups.verified')}</Typography>
            </CardContent>
          </Card>

          <Card variant='outlined'>
            <CardContent sx={{ py: 2, textAlign: 'center' }}>
              <Typography variant='h4' sx={{ fontWeight: 800, color: 'warning.main' }}>
                {loading ? '-' : (backupStats?.protectedCount || 0)}
              </Typography>
              <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('backups.protected')}</Typography>
            </CardContent>
          </Card>

          <Card variant='outlined'>
            <CardContent sx={{ py: 2, textAlign: 'center' }}>
              <Typography variant='h4' sx={{ fontWeight: 800 }}>
                {loading ? '-' : `${pbsStatus?.usagePercent || 0}%`}
              </Typography>
              <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('storage.usage')}</Typography>
              {!loading && pbsStatus?.usagePercent > 0 && (
                <LinearProgress
                  variant='determinate'
                  value={pbsStatus?.usagePercent || 0}
                  sx={{ mt: 1 }}
                  color={pbsStatus?.usagePercent > 90 ? 'error' : pbsStatus?.usagePercent > 75 ? 'warning' : 'primary'}
                />
              )}
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Jobs de sauvegarde PVE et PBS avec onglets */}
      {(pveConnections.length > 0 || pbsConnections.length > 0) && (
        <BackupJobsTabs pveConnections={pveConnections} pbsConnections={pbsConnections} />
      )}

      {/* Filtres et liste des backups */}
      {selectedPbs && (
        <Card variant='outlined'>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-archive-line' style={{ fontSize: 22, color: theme.palette.primary.main }} />
                <Typography variant='h6'>{t('backups.backupsCount', { count: totalRows })}</Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FormControl size='small' sx={{ minWidth: 200 }}>
                  <InputLabel>{t('backups.pbsServer')}</InputLabel>
                  <Select
                    value={selectedPbs}
                    onChange={e => setSelectedPbs(e.target.value)}
                    label={t('backups.pbsServer')}
                    disabled={pbsLoading || pbsConnections.length === 0}
                  >
                    {pbsConnections.map(pbs => (
                      <MenuItem key={pbs.id} value={pbs.id}>{pbs.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <IconButton
                  size='small'
                  onClick={() => setSelectedPbs(prev => prev)}
                  disabled={loading || !selectedPbs}
                >
                  {loading ? <CircularProgress size={18} /> : <i className='ri-refresh-line' />}
                </IconButton>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  size='small'
                  placeholder={t('common.search')}
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position='start'>
                        <i className='ri-search-line' />
                      </InputAdornment>
                    )
                  }}
                  sx={{ width: 200 }}
                />

                <Select
                  size='small'
                  value={datastoreFilter}
                  onChange={e => {
                    setDatastoreFilter(e.target.value)
                    setPaginationModel(prev => ({ ...prev, page: 0 }))
                  }}
                  sx={{ minWidth: 140 }}
                >
                  <MenuItem value='all'>{t('backups.allDatastores')}</MenuItem>
                  {datastores.map(ds => (
                    <MenuItem key={ds.name} value={ds.name}>{ds.name}</MenuItem>
                  ))}
                </Select>

                <Select
                  size='small'
                  value={typeFilter}
                  onChange={e => {
                    setTypeFilter(e.target.value)
                    setPaginationModel(prev => ({ ...prev, page: 0 }))
                  }}
                  sx={{ minWidth: 100 }}
                >
                  <MenuItem value='all'>{t('backups.allTypesFilter')}</MenuItem>
                  <MenuItem value='vm'>VM</MenuItem>
                  <MenuItem value='ct'>CT</MenuItem>
                  <MenuItem value='host'>Host</MenuItem>
                </Select>

                <Button
                  size='small'
                  variant='outlined'
                  onClick={() => {
                    setSearchInput('')
                    setSearch('')
                    setDatastoreFilter('all')
                    setTypeFilter('all')
                    setPaginationModel({ page: 0, pageSize: 25 })
                  }}
                >
                  {t('common.reset')}
                </Button>
              </Box>
            </Box>

            {error && (
              <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>
            )}

            {warnings.length > 0 && (
              <Alert severity='warning' sx={{ mb: 2 }}>
                {warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </Alert>
            )}

            <Box sx={{ height: 'calc(100vh - 340px)', minHeight: 400 }}>
              {!loading && backups.length === 0 && !error ? (
                <EmptyState
                  icon="ri-file-copy-line"
                  title={t('emptyState.noBackups')}
                  description={t('emptyState.noBackupsDesc')}
                  size="large"
                />
              ) : (
              <DataGrid
                rows={backups}
                columns={columns}
                loading={loading}
                getRowId={r => r.id}
                density='compact'

                // Pagination côté serveur
                paginationMode='server'
                rowCount={totalRows}
                paginationModel={paginationModel}
                onPaginationModelChange={setPaginationModel}
                pageSizeOptions={[25, 50, 100]}
                disableRowSelectionOnClick
                sx={{
                  '& .MuiDataGrid-row': {
                    minHeight: '36px !important',
                    maxHeight: '36px !important',
                  },
                  '& .MuiDataGrid-cell': {
                    py: 0.5,
                  },
                  '& .MuiDataGrid-row:hover': {
                    backgroundColor: 'action.hover',
                    cursor: 'pointer'
                  }
                }}
                onRowClick={params => {
                  setSelectedBackup(params.row)
                  setDrawerOpen(true)
                }}
              />
              )}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Drawer détail backup */}
      <Drawer
        anchor='right'
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 560 } } }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {selectedBackup ? (
            <>
              {/* Header */}
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Typography variant='h6' sx={{ fontWeight: 800 }}>
                      {selectedBackup.vmName || selectedBackup.backupId}
                    </Typography>
                    <Typography variant='body2' sx={{ opacity: 0.7 }}>
                      {selectedBackup.datastore} • {selectedBackup.backupTimeFormatted}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TypeChip type={selectedBackup.backupType} />
                    <IconButton size='small' onClick={() => setDrawerOpen(false)}>
                      <i className='ri-close-line' />
                    </IconButton>
                  </Box>
                </Box>

                {/* Tabs */}
                <Tabs value={drawerTab} onChange={(e, v) => setDrawerTab(v)} sx={{ mt: 1 }}>
                  <Tab label={t('backups.informations')} icon={<i className='ri-information-line' />} iconPosition='start' />
                  <Tab label={t('backups.explorer')} icon={<i className='ri-folder-open-line' />} iconPosition='start' />
                </Tabs>
              </Box>

              {/* Tab Content */}
              <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                {/* Onglet Informations */}
                {drawerTab === 0 && (
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant='overline' sx={{ opacity: 0.7 }}>{t('backups.informations')}</Typography>
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant='body2' sx={{ opacity: 0.7 }}>ID</Typography>
                          <Typography variant='body2' sx={{ fontWeight: 600 }}>{selectedBackup.backupId}</Typography>
                        </Box>
                        {selectedBackup.vmName && (
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('common.name')}</Typography>
                            <Typography variant='body2' sx={{ fontWeight: 600 }}>{selectedBackup.vmName}</Typography>
                          </Box>
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('common.size')}</Typography>
                          <Typography variant='body2' sx={{ fontWeight: 600 }}>{selectedBackup.sizeFormatted}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('backups.owner')}</Typography>
                          <Typography variant='body2' sx={{ fontWeight: 600 }}>{selectedBackup.owner || '-'}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('backups.protected')}</Typography>
                          <Typography variant='body2' sx={{ fontWeight: 600 }}>{selectedBackup.protected ? t('backups.protectedYes') + ' 🔒' : t('backups.protectedNo')}</Typography>
                        </Box>
                      </Stack>
                    </Box>

                    <Divider />

                    <Box>
                      <Typography variant='overline' sx={{ opacity: 0.7 }}>{t('backups.verified')}</Typography>
                      <Box sx={{ mt: 1 }}>
                        <VerifyChip verified={selectedBackup.verified} t={t} />
                        {selectedBackup.verifiedAt && (
                          <Typography variant='caption' sx={{ ml: 1, opacity: 0.7 }}>
                            {selectedBackup.verifiedAt}
                          </Typography>
                        )}
                      </Box>
                    </Box>

                    {selectedBackup.comment && (
                      <>
                        <Divider />
                        <Box>
                          <Typography variant='overline' sx={{ opacity: 0.7 }}>{t('network.comment')}</Typography>
                          <Typography variant='body2' sx={{ mt: 1 }}>{selectedBackup.comment}</Typography>
                        </Box>
                      </>
                    )}

                    <Divider />

                    <Box>
                      <Typography variant='overline' sx={{ opacity: 0.7 }}>{t('common.actions')}</Typography>
                      <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                        <Button size='small' variant='contained' disabled>
                          {t('audit.actions.restore')}
                        </Button>
                        <Button size='small' variant='outlined' disabled>
                          {t('backups.verified')}
                        </Button>
                        <Button size='small' variant='outlined' disabled>
                          {t('common.download')}
                        </Button>
                        <Button size='small' variant='outlined' color='error' disabled>
                          {t('common.delete')}
                        </Button>
                      </Box>
                      <Typography variant='caption' sx={{ opacity: 0.5, display: 'block', mt: 1 }}>
                        {t('backups.actionsAvailableSoon')}
                      </Typography>
                    </Box>
                  </Stack>
                )}

                {/* Onglet Explorer */}
                {drawerTab === 1 && (
                  <Box>
                    {explorerLoading && (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={32} />
                      </Box>
                    )}

                    {explorerError && (
                      <Alert severity='warning' sx={{ mb: 2 }}>{explorerError}</Alert>
                    )}

                    {/* Liste des archives (niveau racine) */}
                    {!explorerArchive && !explorerLoading && (
                      <>
                        <Typography variant='subtitle2' sx={{ mb: 1, opacity: 0.7 }}>
                          {t('backups.backupArchives')}
                        </Typography>
                        <List dense>
                          {explorerArchives.map((file, idx) => (
                            <ListItem key={idx} disablePadding>
                              <ListItemButton
                                onClick={() => file.browsable && browseArchive(file.name, '/')}
                                disabled={!file.browsable}
                              >
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                  <FileIcon type={file.type} name={file.name} />
                                </ListItemIcon>
                                <ListItemText
                                  primary={file.name}
                                  secondary={file.browsable ? t('backups.clickToExplore') : t('backups.notExplorable')}
                                  primaryTypographyProps={{ variant: 'body2' }}
                                  secondaryTypographyProps={{ variant: 'caption' }}
                                />
                                {file.browsable && (
                                  <i className='ri-arrow-right-s-line' style={{ opacity: 0.5 }} />
                                )}
                              </ListItemButton>
                            </ListItem>
                          ))}
                          {explorerArchives.length === 0 && !explorerLoading && (
                            <Typography variant='body2' sx={{ opacity: 0.5, py: 2, textAlign: 'center' }}>
                              {t('backups.noArchiveFound')}
                            </Typography>
                          )}
                        </List>
                      </>
                    )}

                    {/* Navigation dans une archive */}
                    {explorerArchive && !explorerLoading && (
                      <>
                        {/* Breadcrumb */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                          <IconButton size='small' onClick={backToArchives}>
                            <i className='ri-arrow-left-line' />
                          </IconButton>
                          <Breadcrumbs separator='›' sx={{ flex: 1 }}>
                            <Typography
                              variant='body2'
                              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                              onClick={backToArchives}
                            >
                              {explorerArchive.replace('.pxar.didx', '')}
                            </Typography>
                            {explorerPath !== '/' && explorerPath.split('/').filter(Boolean).map((part, idx) => (
                              <Typography
                                key={idx}
                                variant='body2'
                                sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                onClick={() => navigateToBreadcrumb(idx)}
                              >
                                {part}
                              </Typography>
                            ))}
                          </Breadcrumbs>
                        </Box>

                        {/* Bouton remonter */}
                        {explorerPath !== '/' && (
                          <ListItemButton onClick={navigateUp} sx={{ mb: 1, borderRadius: 1 }}>
                            <ListItemIcon sx={{ minWidth: 36 }}>
                              <i className='ri-arrow-up-line' style={{ fontSize: 20 }} />
                            </ListItemIcon>
                            <ListItemText primary='..' primaryTypographyProps={{ variant: 'body2' }} />
                          </ListItemButton>
                        )}

                        {/* Liste des fichiers */}
                        <List dense sx={{ maxHeight: 'calc(100vh - 350px)', overflow: 'auto' }}>
                          {explorerFiles.map((file, idx) => (
                            <ListItem key={idx} disablePadding>
                              <ListItemButton
                                onClick={() => file.type === 'directory' && navigateToFolder(file.name)}
                                sx={{ borderRadius: 1 }}
                              >
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                  <FileIcon type={file.type} name={file.name} />
                                </ListItemIcon>
                                <ListItemText
                                  primary={file.name}
                                  secondary={file.type === 'directory' ? null : file.sizeFormatted}
                                  primaryTypographyProps={{ variant: 'body2' }}
                                  secondaryTypographyProps={{ variant: 'caption' }}
                                />
                                {file.type === 'directory' && (
                                  <i className='ri-arrow-right-s-line' style={{ opacity: 0.5 }} />
                                )}
                              </ListItemButton>
                            </ListItem>
                          ))}
                          {explorerFiles.length === 0 && (
                            <Typography variant='body2' sx={{ opacity: 0.5, py: 2, textAlign: 'center' }}>
                              {t('backups.emptyFolder')}
                            </Typography>
                          )}
                        </List>
                      </>
                    )}
                  </Box>
                )}
              </Box>
            </>
          ) : (
            <Box sx={{ p: 3 }}>
              <Alert severity='info'>{t('common.select')}</Alert>
            </Box>
          )}
        </Box>
      </Drawer>
    </Box>
  )
}
