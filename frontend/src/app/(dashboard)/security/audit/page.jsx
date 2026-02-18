'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'

import { getDateLocale } from '@/lib/i18n/date'
import { usePageTitle } from '@/contexts/PageTitleContext'

/* --------------------------------
   Constants
-------------------------------- */

const CATEGORIES = {
  auth: { label: 'Authentification', icon: 'ri-lock-line', color: 'primary' },
  users: { label: 'Utilisateurs', icon: 'ri-user-line', color: 'secondary' },
  connections: { label: 'Connexions', icon: 'ri-server-line', color: 'info' },
  vms: { label: 'VMs', icon: 'ri-computer-line', color: 'success' },
  containers: { label: 'Containers', icon: 'ri-instance-line', color: 'warning' },
  nodes: { label: 'Nodes', icon: 'ri-database-2-line', color: 'error' },
  storage: { label: 'Stockage', icon: 'ri-hard-drive-2-line', color: 'default' },
  backups: { label: 'Backups', icon: 'ri-shield-check-line', color: 'success' },
  settings: { label: 'Paramètres', icon: 'ri-settings-3-line', color: 'default' },
  system: { label: 'Système', icon: 'ri-terminal-box-line', color: 'error' },
}

const ACTIONS = {
  // Auth
  login: 'Connexion',
  logout: 'Déconnexion',
  login_failed: 'Échec connexion',
  password_changed: 'Changement MDP',

  // CRUD
  create: 'Création',
  read: 'Lecture',
  update: 'Modification',
  delete: 'Suppression',

  // VM actions
  start: 'Démarrage',
  stop: 'Arrêt',
  restart: 'Redémarrage',
  suspend: 'Suspension',
  resume: 'Reprise',
  migrate: 'Migration',
  clone: 'Clonage',
  snapshot: 'Snapshot',
  backup: 'Backup',
  restore: 'Restauration',

  // Other
  export: 'Export',
  import: 'Import',
  test: 'Test',
  enable: 'Activation',
  disable: 'Désactivation',
}

/* --------------------------------
   Helpers
-------------------------------- */

function formatDate(dateStr, locale) {
  if (!dateStr) return '—'
  const date = new Date(dateStr)


return date.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function timeAgo(dateStr, t, locale) {
  if (!dateStr) return '—'
  const now = new Date()
  const date = new Date(dateStr)
  const diff = Math.floor((now - date) / 1000)

  if (diff < 60) return t ? t('time.secondsAgo') : 'il y a quelques secondes'
  if (diff < 3600) return t ? t('time.minutesAgo', { count: Math.floor(diff / 60) }) : `il y a ${Math.floor(diff / 60)} min`
  if (diff < 86400) return t ? t('time.hoursAgo', { count: Math.floor(diff / 3600) }) : `il y a ${Math.floor(diff / 3600)} h`
  if (diff < 604800) return t ? t('time.daysAgo', { count: Math.floor(diff / 86400) }) : `il y a ${Math.floor(diff / 86400)} j`

return formatDate(dateStr, locale)
}

/* --------------------------------
   Components
-------------------------------- */

function CategoryChip({ category }) {
  const cfg = CATEGORIES[category] || { label: category, icon: 'ri-question-line', color: 'default' }

  
return (
    <Chip
      size='small'
      label={cfg.label}
      color={cfg.color}
      variant='outlined'
      icon={<i className={cfg.icon} style={{ fontSize: 14 }} />}
    />
  )
}

function StatusChip({ status, t }) {
  const config = {
    success: { label: t ? t('common.success') : 'Succès', color: 'success' },
    failure: { label: t ? t('common.error') : 'Échec', color: 'error' },
    warning: { label: t ? t('common.warning') : 'Attention', color: 'warning' },
  }

  const cfg = config[status] || { label: status, color: 'default' }


return <Chip size='small' label={cfg.label} color={cfg.color} />
}

function DetailsCell({ details, errorMessage }) {
  if (errorMessage) {
    return (
      <Tooltip title={errorMessage}>
        <Typography variant='body2' sx={{ color: 'error.main', cursor: 'help' }}>
          {errorMessage.substring(0, 50)}{errorMessage.length > 50 ? '...' : ''}
        </Typography>
      </Tooltip>
    )
  }
  
  if (!details) return <Typography variant='body2' sx={{ opacity: 0.5 }}>—</Typography>
  
  try {
    const parsed = typeof details === 'string' ? JSON.parse(details) : details

    const preview = Object.entries(parsed)
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
    
    return (
      <Tooltip title={<pre style={{ margin: 0 }}>{JSON.stringify(parsed, null, 2)}</pre>}>
        <Typography variant='body2' sx={{ opacity: 0.7, cursor: 'help' }}>
          {preview.substring(0, 40)}{preview.length > 40 ? '...' : ''}
        </Typography>
      </Tooltip>
    )
  } catch {
    return <Typography variant='body2' sx={{ opacity: 0.5 }}>{String(details).substring(0, 40)}</Typography>
  }
}

/* --------------------------------
   Stats Cards
-------------------------------- */

function StatsCards({ logs, t }) {
  const stats = useMemo(() => {
    const today = new Date()

    today.setHours(0, 0, 0, 0)

    const logsToday = logs.filter(l => new Date(l.timestamp) >= today)
    const failures = logs.filter(l => l.status === 'failure')
    const authLogs = logs.filter(l => l.category === 'auth')

    return {
      total: logs.length,
      today: logsToday.length,
      failures: failures.length,
      auth: authLogs.length,
    }
  }, [logs])

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
      <Card variant='outlined'>
        <CardContent sx={{ py: 1.5, px: 2 }}>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>{t ? t('common.total') : 'Total événements'}</Typography>
          <Typography variant='h5' sx={{ fontWeight: 700 }}>{stats.total}</Typography>
        </CardContent>
      </Card>
      <Card variant='outlined'>
        <CardContent sx={{ py: 1.5, px: 2 }}>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>Aujourd'hui</Typography>
          <Typography variant='h5' sx={{ fontWeight: 700, color: 'info.main' }}>{stats.today}</Typography>
        </CardContent>
      </Card>
      <Card variant='outlined'>
        <CardContent sx={{ py: 1.5, px: 2 }}>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>{t ? t('common.error') : 'Échecs'}</Typography>
          <Typography variant='h5' sx={{ fontWeight: 700, color: 'error.main' }}>{stats.failures}</Typography>
        </CardContent>
      </Card>
      <Card variant='outlined'>
        <CardContent sx={{ py: 1.5, px: 2 }}>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>{t ? t('audit.categories.authentication') : 'Authentification'}</Typography>
          <Typography variant='h5' sx={{ fontWeight: 700 }}>{stats.auth}</Typography>
        </CardContent>
      </Card>
    </Box>
  )
}

/* --------------------------------
   Main Page
-------------------------------- */

export default function AuditPage() {
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('audit.title'), t('navigation.auditLogs'), 'ri-file-search-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // Filters
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 })

  const loadLogs = async () => {
    try {
      setLoading(true)
      
      const params = new URLSearchParams({
        limit: String(paginationModel.pageSize),
        offset: String(paginationModel.page * paginationModel.pageSize),
      })
      
      if (search) params.set('search', search)
      if (category !== 'all') params.set('category', category)
      if (status !== 'all') params.set('status', status)

      const res = await fetch(`/api/v1/audit?${params}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || t('common.error'))

return
      }

      setLogs(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch (e) {
      setError(t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()
  }, [paginationModel, category, status])

  // Recherche avec debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (paginationModel.page === 0) {
        loadLogs()
      } else {
        setPaginationModel(prev => ({ ...prev, page: 0 }))
      }
    }, 300)

    
return () => clearTimeout(timer)
  }, [search])

  const handleReset = () => {
    setSearch('')
    setCategory('all')
    setStatus('all')
    setPaginationModel({ page: 0, pageSize: 25 })
  }

  const handleExport = () => {
    // Export CSV basique
    const headers = ['Date', 'Utilisateur', 'Action', 'Catégorie', 'Ressource', 'Statut', 'IP']

    const rows = logs.map(l => [
      formatDate(l.timestamp, dateLocale),
      l.user_email || '—',
      ACTIONS[l.action] || l.action,
      CATEGORIES[l.category]?.label || l.category,
      l.resource_name || l.resource_id || '—',
      l.status,
      l.ip_address || '—',
    ])
    
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')

    a.href = url
    a.download = `audit-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const columns = useMemo(
    () => [
      {
        field: 'timestamp',
        headerName: t('common.date'),
        width: 160,
        renderCell: params => (
          <Tooltip title={formatDate(params.row.timestamp, dateLocale)}>
            <Typography variant='body2' sx={{ cursor: 'help' }}>
              {timeAgo(params.row.timestamp, t, dateLocale)}
            </Typography>
          </Tooltip>
        ),
      },
      {
        field: 'user_email',
        headerName: t('navigation.users'),
        width: 250,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: params.row.user_email ? 1 : 0.5 }}>
            {params.row.user_email || t('audit.categories.system')}
          </Typography>
        ),
      },
      {
        field: 'action',
        headerName: t('common.actions'),
        width: 140,
        renderCell: params => (
          <Typography variant='body2' sx={{ fontWeight: 500 }}>
            {ACTIONS[params.row.action] || params.row.action}
          </Typography>
        ),
      },
      {
        field: 'category',
        headerName: 'Catégorie',
        width: 150,
        renderCell: params => <CategoryChip category={params.row.category} />,
      },
      {
        field: 'resource',
        headerName: t('navigation.resources'),
        flex: 1,
        minWidth: 180,
        renderCell: params => {
          const resourceType = params.row.resource_type
          const resourceName = params.row.resource_name
          const resourceId = params.row.resource_id

          if (!resourceType && !resourceName && !resourceId) {
            return <Typography variant='body2' sx={{ opacity: 0.5 }}>—</Typography>
          }

          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <Typography variant='body2' sx={{ lineHeight: 1.2 }}>
                {resourceName || resourceId || '—'}
              </Typography>
              {resourceType && (
                <Typography variant='caption' sx={{ opacity: 0.5, lineHeight: 1.2 }}>
                  {resourceType}
                </Typography>
              )}
            </Box>
          )
        },
      },
      {
        field: 'status',
        headerName: t('common.status'),
        width: 100,
        renderCell: params => <StatusChip status={params.row.status} t={t} />,
      },
      {
        field: 'details',
        headerName: t('common.details'),
        width: 180,
        renderCell: params => (
          <DetailsCell details={params.row.details} errorMessage={params.row.error_message} />
        ),
      },
      {
        field: 'ip_address',
        headerName: 'IP',
        width: 130,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.6, fontFamily: 'monospace', fontSize: 12 }}>
            {params.row.ip_address || '—'}
          </Typography>
        ),
      },
    ],
    [t, dateLocale]
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      {/* Header Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button
          variant='outlined'
          size='small'
          startIcon={<i className='ri-refresh-line' />}
          onClick={loadLogs}
        >
          {t('common.refresh')}
        </Button>
        <Button
          variant='outlined'
          size='small'
          startIcon={<i className='ri-download-line' />}
          onClick={handleExport}
          disabled={logs.length === 0}
        >
          {t('common.export')} CSV
        </Button>
      </Box>

      {/* Stats */}
      <StatsCards logs={logs} t={t} />

      {/* Filters + Table */}
      <Card variant='outlined' sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <CardContent sx={{ pb: 0 }}>
          <Stack direction='row' spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <TextField
              size='small'
              placeholder={t('common.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 220 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position='start'>
                    <i className='ri-search-line' />
                  </InputAdornment>
                ),
              }}
            />

            <FormControl size='small' sx={{ minWidth: 150 }}>
              <InputLabel>Catégorie</InputLabel>
              <Select
                value={category}
                label='Catégorie'
                onChange={e => setCategory(e.target.value)}
              >
                <MenuItem value='all'>{t('common.all')}</MenuItem>
                {Object.entries(CATEGORIES).map(([key, cfg]) => (
                  <MenuItem key={key} value={key}>{cfg.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size='small' sx={{ minWidth: 120 }}>
              <InputLabel>{t('common.status')}</InputLabel>
              <Select
                value={status}
                label={t('common.status')}
                onChange={e => setStatus(e.target.value)}
              >
                <MenuItem value='all'>{t('common.all')}</MenuItem>
                <MenuItem value='success'>{t('common.success')}</MenuItem>
                <MenuItem value='failure'>{t('common.error')}</MenuItem>
                <MenuItem value='warning'>{t('common.warning')}</MenuItem>
              </Select>
            </FormControl>

            <Button variant='outlined' size='small' onClick={handleReset}>
              {t('common.reset')}
            </Button>

            <Typography variant='body2' sx={{ ml: 'auto', opacity: 0.6 }}>
              {total} {t('navigation.events').toLowerCase()}
            </Typography>
          </Stack>
        </CardContent>

        {error && (
          <Alert severity='error' sx={{ mx: 2, mb: 2 }}>{error}</Alert>
        )}

        <Box sx={{ flex: 1, minHeight: 500 }}>
          <DataGrid
            rows={logs}
            columns={columns}
            loading={loading}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[25, 50, 100]}
            paginationMode='server'
            rowCount={total}
            disableRowSelectionOnClick
            density='compact'
            sx={{
              border: 'none',
              '& .MuiDataGrid-row': {
                minHeight: '36px !important',
                maxHeight: '36px !important',
              },
              '& .MuiDataGrid-cell': {
                display: 'flex',
                alignItems: 'center',
                py: 0.5,
              },
              '& .MuiDataGrid-columnHeaders': {
                borderBottom: '1px solid',
                borderColor: 'divider',
              },
            }}
          />
        </Box>
      </Card>
    </Box>
  )
}
