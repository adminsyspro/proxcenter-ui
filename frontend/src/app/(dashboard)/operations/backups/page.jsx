'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'

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
  ListSubheader,
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
import { formatDateTime } from '@/lib/i18n/date'
import BackupJobsTabs from './BackupJobsTabs'
import BackupTrendsChart from './BackupTrendsChart'
import EmptyState from '@/components/EmptyState'
import { TableSkeleton } from '@/components/skeletons'
import RestoreVmDialog from '@/components/backup/RestoreVmDialog'
import { useTenant } from '@/contexts/TenantContext'
import { useToast } from '@/contexts/ToastContext'

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

// Compact state icon for the table column. Three distinct states:
//   - ok      : row.verified true (= verification.state === 'ok' on PBS)
//   - failed  : verification record exists but state !== 'ok'
//   - none    : no verification record at all → never verified
//
// We anchor on `row.verified` (computed by the backend) for the OK case
// rather than re-deriving from row.verification.state — the cache layer
// can lose nested fields if PBS's payload shape evolves, but the boolean
// is precomputed and matches the verifiedCount stat shown in the KPIs.
const VerifyStateIcon = ({ row, t, locale }) => {
  // Format the verification time client-side (browser timezone) from the raw
  // `last-run` epoch — the same UTC->local fix as the backup date. Fall back to
  // the server-formatted string if the cache dropped the nested field.
  const lastRun = row.verification?.['last-run']
  const verifiedAtLocal = lastRun ? formatDateTime(lastRun * 1000, locale) : row.verifiedAt
  if (row.verified) {
    const tooltip = verifiedAtLocal
      ? t('backups.verifiedOn', { date: verifiedAtLocal })
      : t('backups.verified')
    return (
      <Tooltip title={tooltip} arrow>
        <i className='ri-checkbox-circle-fill' style={{ fontSize: 18, color: '#4caf50' }} />
      </Tooltip>
    )
  }
  // verification.state set but not 'ok' → failure path. The state can
  // legitimately be 'failed', 'none', or other PBS-internal markers.
  const failState = row.verification?.state
  if (failState && failState !== 'ok') {
    const tooltip = verifiedAtLocal
      ? t('backups.verifyFailedOn', { date: verifiedAtLocal })
      : t('backups.verifyFailed')
    return (
      <Tooltip title={tooltip} arrow>
        <i className='ri-error-warning-fill' style={{ fontSize: 18, color: '#f44336' }} />
      </Tooltip>
    )
  }
  return (
    <Tooltip title={t('backups.notVerified')} arrow>
      <i className='ri-subtract-line' style={{ fontSize: 18, opacity: 0.35 }} />
    </Tooltip>
  )
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
  const locale = useLocale()
  const theme = useTheme()
  const { setPageInfo } = usePageTitle()
  const timeAgo = useTimeAgo(t)
  // Tenant-vDC users get a simpler drawer: the Explorer tab exposes raw
  // PBS internals (catalog browse, .blob downloads of the qm config, etc.)
  // that don't map onto the abstraction we sell to tenants. Provider /
  // 'default' tenant keeps both tabs.
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isVdcTenant = !tenantLoading && !!currentTenant && currentTenant.id !== 'default'

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

  // Available namespaces (from API response)
  const [availableNamespaces, setAvailableNamespaces] = useState([])

  // (datastore, namespace) -> vDC bindings, used to group namespaces by vDC.
  // Populated from /api/v1/pbs/[id]/backups response. Tenant callers see only
  // their own vDCs; super-admins see bindings across every tenant.
  const [bindings, setBindings] = useState([])

  // Filters
  const [search, setSearch] = useState('')
  const [datastoreFilter, setDatastoreFilter] = useState('all')
  const [namespaceFilter, setNamespaceFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState(null)
  const [drawerTab, setDrawerTab] = useState(0) // 0 = Infos, 1 = Explorer

  // Restore dialog (cross-PVE — user picks target cluster + node).
  const [restoreOpen, setRestoreOpen] = useState(false)

  // Verify (single snapshot re-check) + Delete (with double-click guard
  // to prevent accidental destruction of a backup).
  const toast = useToast()
  const [verifying, setVerifying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteAwaitingConfirm, setDeleteAwaitingConfirm] = useState(false)

  // Reset the destructive-confirm guard whenever the user opens a
  // different backup so the "Confirm delete" state can't leak across
  // snapshots.
  useEffect(() => { setDeleteAwaitingConfirm(false) }, [selectedBackup?.id])

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
      const nsParam = backup.namespace ? `?ns=${encodeURIComponent(backup.namespace)}` : ''
      const res = await fetch(`/api/v1/pbs/${encodeURIComponent(selectedPbs)}/backups/${backupId}/content${nsParam}`)
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

      if (selectedBackup.namespace) params.set('ns', selectedBackup.namespace)

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

  // Tenant guard: if the user was on the Explorer tab when their tenant
  // role flipped (rare but cheap to defend against), bounce them back to
  // the Information tab so they don't see an empty panel.
  useEffect(() => {
    if (isVdcTenant && drawerTab !== 0) setDrawerTab(0)
  }, [isVdcTenant, drawerTab])

  // Force refresh — increment to bypass server cache on next fetch only.
  // Declared before the verify/delete handlers so they can call it
  // without tripping the JS TDZ at component instantiation time.
  const [refreshToken, setRefreshToken] = useState(0)
  const noCacheRef = useRef(false)

  const handleRefresh = useCallback(() => {
    noCacheRef.current = true
    setRefreshToken(n => n + 1)
  }, [])

  // Verify: trigger a re-verification on PBS. Returns a UPID; we don't
  // wire a live progress drawer here, just toast and let the user reload.
  // The verify status chip will update on the next list refresh.
  const handleVerify = useCallback(async () => {
    if (!selectedBackup || !selectedPbs) return
    setVerifying(true)
    try {
      const params = new URLSearchParams()
      if (selectedBackup.namespace) params.set('ns', selectedBackup.namespace)
      const res = await fetch(
        `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/backups/${encodeURIComponent(selectedBackup.id)}/verify?${params}`,
        { method: 'POST' }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error || `HTTP ${res.status}`)
      } else {
        toast.success(t('backups.verifyStarted'))
      }
    } catch (e) {
      toast.error(e?.message || 'Verify failed')
    } finally {
      setVerifying(false)
    }
  }, [selectedBackup, selectedPbs, toast, t])

  // Delete: two-click guard. First click flips the button into a
  // warning-coloured "Confirm delete"; second click actually deletes.
  const handleDelete = useCallback(async () => {
    if (!selectedBackup || !selectedPbs) return
    if (!deleteAwaitingConfirm) {
      setDeleteAwaitingConfirm(true)
      return
    }
    setDeleting(true)
    try {
      const params = new URLSearchParams()
      if (selectedBackup.namespace) params.set('ns', selectedBackup.namespace)
      const res = await fetch(
        `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/backups/${encodeURIComponent(selectedBackup.id)}?${params}`,
        { method: 'DELETE' }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error || `HTTP ${res.status}`)
        setDeleteAwaitingConfirm(false)
      } else {
        toast.success(t('backups.deleteSuccess'))
        setDrawerOpen(false)
        setSelectedBackup(null)
        handleRefresh()
      }
    } catch (e) {
      toast.error(e?.message || 'Delete failed')
      setDeleteAwaitingConfirm(false)
    } finally {
      setDeleting(false)
    }
  }, [selectedBackup, selectedPbs, deleteAwaitingConfirm, toast, t, handleRefresh])

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

    const useNoCache = noCacheRef.current
    noCacheRef.current = false // Reset immediately so filter/page changes don't bypass cache

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
        if (namespaceFilter !== 'all') params.set('namespace', namespaceFilter)
        if (typeFilter !== 'all') params.set('type', typeFilter)
        if (search.trim()) params.set('search', search.trim())
        if (useNoCache) params.set('noCache', '1')

        const res = await fetch(
          `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/backups?${params}`
        )

        if (res.ok) {
          const json = await res.json()

          setBackups(json?.data?.backups || [])
          setBackupStats(json?.data?.stats || null)
          setTotalRows(json?.data?.pagination?.totalItems || 0)
          setWarnings(json?.data?.warnings || [])
          setAvailableNamespaces(json?.data?.namespaces || [])
          setBindings(json?.data?.bindings || [])
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
  }, [selectedPbs, paginationModel, datastoreFilter, namespaceFilter, typeFilter, search, refreshToken])

  // Debounce search pour éviter trop de requêtes
  const [searchInput, setSearchInput] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPaginationModel(prev => ({ ...prev, page: 0 })) // Reset page on search
    }, 300)


return () => clearTimeout(timer)
  }, [searchInput])

  // Exact (datastore, namespace) → vDC mapping for the table column.
  const vdcByPair = useMemo(() => {
    const m = new Map()
    for (const b of bindings) {
      m.set(`${b.datastore}|${b.namespace}`, { vdcName: b.vdcName, vdcId: b.vdcId, tenantName: b.tenantName })
    }
    return m
  }, [bindings])

  // Group available namespaces by vDC for the filter dropdown. A namespace can
  // appear in several vDCs if bound on multiple datastores; in that case it
  // shows under each vDC group. Namespaces with no binding fall into "Unassigned".
  const dropdownGroups = useMemo(() => {
    const groups = new Map() // vdcName -> Set<namespace>
    const orphans = new Set()
    for (const ns of availableNamespaces) {
      const matches = bindings.filter(b => b.namespace === ns)
      if (matches.length === 0) {
        orphans.add(ns)
        continue
      }
      const vdcNames = new Set(matches.map(m => m.vdcName))
      for (const vdcName of vdcNames) {
        const list = groups.get(vdcName) || new Set()
        list.add(ns)
        groups.set(vdcName, list)
      }
    }
    return {
      groups: Array.from(groups.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([vdcName, nss]) => ({
          vdcName,
          namespaces: Array.from(nss).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))),
        })),
      orphans: Array.from(orphans).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))),
    }
  }, [availableNamespaces, bindings])

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
      field: 'vdc',
      headerName: t('backups.vdc'),
      width: 150,
      sortable: true,
      valueGetter: (_, row) => vdcByPair.get(`${row.datastore}|${row.namespace}`)?.vdcName || '',
      renderCell: params => {
        const info = vdcByPair.get(`${params.row.datastore}|${params.row.namespace}`)
        if (!info) {
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <Typography variant='body2' sx={{ opacity: 0.4 }}>--</Typography>
            </Box>
          )
        }
        const tooltip = info.tenantName ? `${info.vdcName} • ${info.tenantName}` : info.vdcName
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Tooltip title={tooltip} arrow>
              <Chip
                size='small'
                label={info.vdcName}
                color='primary'
                variant='outlined'
                icon={<Box component='i' className='ri-cloud-line' sx={{ fontSize: 13, ml: '6px !important' }} />}
                sx={{ height: 22, cursor: 'default' }}
              />
            </Tooltip>
          </Box>
        )
      },
    },
    {
      field: 'namespace',
      headerName: 'Namespace',
      width: 130,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {params.value ? (
            <Chip size='small' label={params.value} variant='outlined' />
          ) : (
            <Typography variant='body2' sx={{ opacity: 0.3 }}>--</Typography>
          )}
        </Box>
      )
    },
    {
      field: 'backupTime',
      headerName: t('common.date'),
      flex: 1,
      minWidth: 150,
      // Render in the viewer's timezone from the raw epoch (real local time),
      // like native PVE — not the server container's UTC clock (discussion #379).
      // The tooltip keeps the UTC snapshot id as a reference.
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Tooltip title={params.row.backupTimeIso}>
            <Typography variant='body2'>
              {params.row.backupTime ? formatDateTime(params.row.backupTime * 1000, locale) : '-'}
            </Typography>
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
      width: 80,
      align: 'center',
      headerAlign: 'center',
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <VerifyStateIcon row={params.row} t={t} locale={locale} />
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
      width: 110,
      sortable: false,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0.25 }}>
          <Tooltip title={t('common.details')}>
            <IconButton size='small' onClick={() => {
              setSelectedBackup(params.row)
              setDrawerOpen(true)
            }}>
              <i className='ri-eye-line' style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          {params.row.backupType !== 'host' && (
            <Tooltip title={t('audit.actions.restore')}>
              <IconButton
                size='small'
                onClick={(ev) => {
                  ev.stopPropagation()
                  setSelectedBackup(params.row)
                  setRestoreOpen(true)
                }}
              >
                <i className='ri-history-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )
    }
  ], [t, vdcByPair])

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

      {/* Graphiques de tendances */}
      {selectedPbs && <BackupTrendsChart pbsId={selectedPbs} />}

      {/* Jobs de sauvegarde PVE et PBS avec onglets.
          Masqué en mode vDC tenant : la politique de sauvegarde est gérée
          par le super admin (offre managée). Les tenants gardent les
          backups ponctuels par VM dans /infrastructure/inventory et le
          quota maxBackups s'applique sur ces backups ad-hoc. */}
      {!isVdcTenant && (pveConnections.length > 0 || pbsConnections.length > 0) && (
        <BackupJobsTabs pveConnections={pveConnections} pbsConnections={pbsConnections} />
      )}

      {/* Filtres et liste des backups */}
      {selectedPbs && (
        <Card variant='outlined'>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <i className='ri-archive-line' style={{ fontSize: 22, color: theme.palette.primary.main }} />
              <Typography variant='h6'>{t('backups.backupsCount', { count: totalRows })}</Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              {/* PBS picker is hidden in tenant (vDC) mode — a tenant
                  always sees a single PBS connection (the one their vDC
                  is bound to), so a 1-option dropdown is just noise.
                  Provider keeps the picker for cross-PBS browsing. */}
              {!isVdcTenant && (
                <FormControl size='small' sx={{ minWidth: 200 }}>
                  <InputLabel>{t('backups.pbsServer')}</InputLabel>
                  <Select
                    value={selectedPbs}
                    onChange={e => {
                      setSelectedPbs(e.target.value)
                      setNamespaceFilter('all')
                      setAvailableNamespaces([])
                    }}
                    label={t('backups.pbsServer')}
                    disabled={pbsLoading || pbsConnections.length === 0}
                  >
                    {pbsConnections.map(pbs => (
                      <MenuItem key={pbs.id} value={pbs.id}>{pbs.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {availableNamespaces.length > 1 && (
                <FormControl size='small' sx={{ minWidth: 200 }}>
                  <InputLabel>Namespace</InputLabel>
                  <Select
                    value={namespaceFilter}
                    onChange={e => {
                      setNamespaceFilter(e.target.value)
                      setPaginationModel(prev => ({ ...prev, page: 0 }))
                    }}
                    label='Namespace'
                  >
                    <MenuItem value='all'>{t('backups.allNamespaces')}</MenuItem>
                    {bindings.length === 0
                      ? availableNamespaces.map(ns => (
                          <MenuItem key={ns} value={ns}>
                            {ns || t('backups.rootNamespace')}
                          </MenuItem>
                        ))
                      : [
                          ...dropdownGroups.groups.flatMap(g => [
                            <ListSubheader
                              key={`hdr-${g.vdcName}`}
                              disableSticky
                              sx={{ lineHeight: '28px', bgcolor: 'transparent', display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, fontWeight: 700, opacity: 0.65, textTransform: 'uppercase' }}
                            >
                              <Box component='i' className='ri-cloud-line' sx={{ fontSize: 13 }} />
                              {t('backups.vdc')}: {g.vdcName}
                            </ListSubheader>,
                            ...g.namespaces.map(ns => (
                              <MenuItem key={`${g.vdcName}-${ns}`} value={ns} sx={{ pl: 3 }}>
                                {ns || t('backups.rootNamespace')}
                              </MenuItem>
                            )),
                          ]),
                          ...(dropdownGroups.orphans.length > 0
                            ? [
                                <ListSubheader
                                  key='hdr-unassigned'
                                  disableSticky
                                  sx={{ lineHeight: '28px', bgcolor: 'transparent', display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, fontWeight: 700, opacity: 0.65, textTransform: 'uppercase' }}
                                >
                                  <Box component='i' className='ri-question-line' sx={{ fontSize: 13 }} />
                                  {t('backups.unassigned')}
                                </ListSubheader>,
                                ...dropdownGroups.orphans.map(ns => (
                                  <MenuItem key={`orphan-${ns}`} value={ns} sx={{ pl: 3 }}>
                                    {ns || t('backups.rootNamespace')}
                                  </MenuItem>
                                )),
                              ]
                            : []),
                        ]}
                  </Select>
                </FormControl>
              )}
              <Tooltip title={t('common.refresh')}>
                <IconButton
                  size='small'
                  onClick={handleRefresh}
                  disabled={loading || !selectedPbs}
                >
                  {loading ? <CircularProgress size={18} /> : <i className='ri-refresh-line' />}
                </IconButton>
              </Tooltip>

              <Box sx={{ flex: 1 }} />

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
                    setNamespaceFilter('all')
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
                      {selectedBackup.datastore}{selectedBackup.namespace ? ` / ${selectedBackup.namespace}` : ''} • {selectedBackup.backupTime ? formatDateTime(selectedBackup.backupTime * 1000, locale) : selectedBackup.backupTimeFormatted}
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
                  {!isVdcTenant && (
                    <Tab label={t('backups.explorer')} icon={<i className='ri-folder-open-line' />} iconPosition='start' />
                  )}
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
                        {(selectedBackup.verification?.['last-run'] || selectedBackup.verifiedAt) && (
                          <Typography variant='caption' sx={{ ml: 1, opacity: 0.7 }}>
                            {selectedBackup.verification?.['last-run']
                              ? formatDateTime(selectedBackup.verification['last-run'] * 1000, locale)
                              : selectedBackup.verifiedAt}
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
                        <Button
                          size='small'
                          variant='contained'
                          disabled={selectedBackup.backupType === 'host'}
                          onClick={() => setRestoreOpen(true)}
                          startIcon={<i className='ri-history-line' />}
                        >
                          {t('audit.actions.restore')}
                        </Button>
                        <Button
                          size='small'
                          variant='outlined'
                          onClick={handleVerify}
                          disabled={verifying}
                          startIcon={verifying
                            ? <CircularProgress size={14} />
                            : <i className='ri-shield-check-line' />}
                        >
                          {t('backups.verifyAction')}
                        </Button>
                        <Button
                          size='small'
                          variant='outlined'
                          color={deleteAwaitingConfirm ? 'warning' : 'error'}
                          onClick={handleDelete}
                          disabled={deleting || selectedBackup.protected}
                          startIcon={deleting
                            ? <CircularProgress size={14} />
                            : <i className={deleteAwaitingConfirm ? 'ri-alert-line' : 'ri-delete-bin-line'} />}
                        >
                          {deleteAwaitingConfirm
                            ? t('backups.deleteConfirmButton')
                            : t('common.delete')}
                        </Button>
                      </Box>
                      {selectedBackup.protected && (
                        <Typography variant='caption' sx={{ display: 'block', mt: 1, opacity: 0.7 }}>
                          {t('backups.deleteProtectedHint')}
                        </Typography>
                      )}
                      {deleteAwaitingConfirm && !deleting && (
                        <Alert severity='warning' sx={{ mt: 1 }} icon={<i className='ri-alert-line' style={{ fontSize: 18 }} />}>
                          {t('backups.deleteConfirm', {
                            name: selectedBackup.vmName || selectedBackup.backupId,
                            id: selectedBackup.backupId,
                            date: selectedBackup.backupTime ? formatDateTime(selectedBackup.backupTime * 1000, locale) : selectedBackup.backupTimeFormatted,
                          })}
                        </Alert>
                      )}
                    </Box>
                  </Stack>
                )}

                {/* Onglet Explorer */}
                {drawerTab === 1 && !isVdcTenant && (
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
                          {explorerArchives.map((file, idx) => {
                            // .blob → direct download via /file-download
                            // .pxar.didx → browsable
                            // .img.fidx → "Use file restore" hint (no inline download — the index alone is useless)
                            const isBlob = typeof file.name === 'string' && file.name.endsWith('.blob')
                            const isImgIdx = typeof file.name === 'string' && file.name.endsWith('.img.fidx')
                            const handleClick = () => {
                              if (file.browsable) {
                                browseArchive(file.name, '/')
                              } else if (isBlob) {
                                // Trigger the browser download. The route streams
                                // the bytes with Content-Disposition: attachment.
                                const params = new URLSearchParams({ file: file.name })
                                if (selectedBackup?.namespace) params.set('ns', selectedBackup.namespace)
                                const href = `/api/v1/pbs/${encodeURIComponent(selectedPbs)}/backups/${encodeURIComponent(selectedBackup.id)}/download?${params}`
                                window.open(href, '_blank', 'noopener')
                              }
                            }
                            const secondary = file.browsable
                              ? t('backups.clickToExplore')
                              : isBlob
                                ? t('backups.clickToDownload')
                                : isImgIdx
                                  ? t('backups.useFileRestore')
                                  : t('backups.notExplorable')
                            const trailingIcon = file.browsable
                              ? 'ri-arrow-right-s-line'
                              : isBlob
                                ? 'ri-download-2-line'
                                : null
                            return (
                            <ListItem key={idx} disablePadding>
                              <ListItemButton
                                onClick={handleClick}
                                disabled={!file.browsable && !isBlob}
                              >
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                  <FileIcon type={file.type} name={file.name} />
                                </ListItemIcon>
                                <ListItemText
                                  primary={file.name}
                                  secondary={secondary}
                                  primaryTypographyProps={{ variant: 'body2' }}
                                  secondaryTypographyProps={{ variant: 'caption' }}
                                />
                                {file.sizeFormatted && file.sizeFormatted !== '-' && (
                                  <Typography
                                    variant='caption'
                                    sx={{ opacity: 0.6, fontFamily: 'monospace', mr: 1, whiteSpace: 'nowrap' }}
                                  >
                                    {file.sizeFormatted}
                                  </Typography>
                                )}
                                {trailingIcon && (
                                  <i className={trailingIcon} style={{ opacity: 0.5 }} />
                                )}
                              </ListItemButton>
                            </ListItem>
                            )
                          })}
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
                              {explorerArchive.replaceAll('.pxar.didx', '')}
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

      {restoreOpen && selectedBackup && (() => {
        // Compose backupPath from the row fields. The /api/v1/pbs/[id]/backups
        // payload doesn't include it directly (unlike /guests/...) so we
        // build it client-side: backup/<type>/<id>/<isoTime>.
        const backupPath = `backup/${selectedBackup.backupType}/${selectedBackup.backupId}/${selectedBackup.backupTimeIso}`
        const restoreType = selectedBackup.backupType === 'ct' ? 'lxc' : 'qemu'
        return (
          <RestoreVmDialog
            open
            onClose={() => setRestoreOpen(false)}
            type={restoreType}
            sourceVmid={Number(selectedBackup.backupId) || 0}
            backup={{
              pbsId: selectedPbs,
              datastore: selectedBackup.datastore,
              namespace: selectedBackup.namespace || '',
              backupPath,
              backupTime: selectedBackup.backupTime,
              backupTimeFormatted: selectedBackup.backupTimeFormatted,
              vmName: selectedBackup.vmName,
            }}
          />
        )
      })()}
    </Box>
  )
}
