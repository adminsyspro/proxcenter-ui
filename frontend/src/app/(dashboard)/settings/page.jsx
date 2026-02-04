'use client'

import { useEffect, useMemo, useState } from 'react'

import dynamic from 'next/dynamic'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  LinearProgress,
  InputAdornment
} from '@mui/material'

import { DataGrid } from '@mui/x-data-grid'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useLicense, Features } from '@/contexts/LicenseContext'

// Import dynamique pour éviter les erreurs SSR
const NotificationsTab = dynamic(() => import('@/components/settings/NotificationsTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const AppearanceTab = dynamic(() => import('@/components/settings/AppearanceTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const LdapConfigTab = dynamic(() => import('@/components/settings/LdapConfigTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const ConnectionDialog = dynamic(() => import('@/components/settings/ConnectionDialog'), {
  ssr: false
})

/* ==================== Utility ==================== */

function MainTabPanel({ value, index, children }) {
  if (value !== index) return null
  return <Box>{children}</Box>
}

function SubTabPanel({ value, index, children }) {
  return value === index ? <Box sx={{ mt: 2 }}>{children}</Box> : null
}

async function fetchJson(url, init) {
  const r = await fetch(url, init)
  const text = await r.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {}

  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`)
  
return json
}

/* ==================== ConnectionStatus Component ==================== */

function ConnectionStatus({ connection, autoTest = false }) {
  const t = useTranslations()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  const testConnection = async () => {
    setStatus('loading')
    setError(null)

    try {
      const endpoint = connection.type === 'pbs'
        ? `/api/v1/pbs/${connection.id}/status`
        : `/api/v1/connections/${connection.id}/nodes`

      const res = await fetch(endpoint, { cache: 'no-store' })

      if (res.ok) {
        setStatus('ok')
      } else {
        const json = await res.json().catch(() => ({}))

        setStatus('error')
        setError(json?.error || `HTTP ${res.status}`)
      }
    } catch (e) {
      setStatus('error')
      setError(t('settings.connectionError'))
    }
  }

  useEffect(() => {
    if (autoTest && connection?.id) {
      testConnection()
    }
  }, [connection?.id, autoTest])

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
      {status === 'loading' && (
        <Chip size='small' label='Test...' color='default' variant='outlined' />
      )}
      {status === 'ok' && (
        <Chip size='small' label={`● ${t('common.online')}`} color='success' variant='outlined' />
      )}
      {status === 'error' && (
        <Tooltip title={error || t('common.error')}>
          <Chip size='small' label={`● ${t('common.error')}`} color='error' variant='outlined' />
        </Tooltip>
      )}
      {status === null && (
        <Chip size='small' label={`○ ${t('common.unknown')}`} color='default' variant='outlined' sx={{ opacity: 0.5 }} />
      )}
      <Tooltip title={t('common.refresh')}>
        <IconButton size='small' onClick={testConnection}>
          <i className='ri-refresh-line' style={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

/* ==================== ConnectionsTab Component ==================== */

function ConnectionsTab() {
  const t = useTranslations()
  const [connTab, setConnTab] = useState(0)

  // PVE Connections
  const [pveConnections, setPveConnections] = useState([])
  const [pveLoading, setPveLoading] = useState(true)
  const [pveError, setPveError] = useState(null)

  // PBS Connections
  const [pbsConnections, setPbsConnections] = useState([])
  const [pbsLoading, setPbsLoading] = useState(true)
  const [pbsError, setPbsError] = useState(null)

  // Dialog
  const [addConnOpen, setAddConnOpen] = useState(false)
  const [addConnType, setAddConnType] = useState('pve')
  const [editingConn, setEditingConn] = useState(null)

  const loadPveConnections = async () => {
    setPveLoading(true)
    setPveError(null)

    try {
      const json = await fetchJson('/api/v1/connections?type=pve', { cache: 'no-store' })

      setPveConnections(Array.isArray(json?.data) ? json.data : [])
    } catch (e) {
      setPveError(e?.message || String(e))
      setPveConnections([])
    } finally {
      setPveLoading(false)
    }
  }

  const loadPbsConnections = async () => {
    setPbsLoading(true)
    setPbsError(null)

    try {
      const json = await fetchJson('/api/v1/connections?type=pbs', { cache: 'no-store' })

      setPbsConnections(Array.isArray(json?.data) ? json.data : [])
    } catch (e) {
      setPbsError(e?.message || String(e))
      setPbsConnections([])
    } finally {
      setPbsLoading(false)
    }
  }

  const openAddDialog = (type) => {
    setAddConnType(type)
    setEditingConn(null)
    setAddConnOpen(true)
  }

  const openEditDialog = (connection) => {
    setAddConnType(connection.type)
    setEditingConn(connection)
    setAddConnOpen(true)
  }

  const handleSaveConnection = async (formData) => {
    const payload = {
      name: formData.name.trim(),
      type: addConnType,
      baseUrl: formData.baseUrl.trim(),
      uiUrl: formData.uiUrl.trim() || null,
      insecureTLS: !!formData.insecureTLS,
      hasCeph: addConnType === 'pve' ? !!formData.hasCeph : false,
      // Only include apiToken if provided
      ...(formData.apiToken.trim() && { apiToken: formData.apiToken.trim() }),
      // SSH fields
      sshEnabled: formData.sshEnabled,
      sshPort: formData.sshPort,
      sshUser: formData.sshUser,
      sshAuthMethod: formData.sshAuthMethod || null,
      ...(formData.sshKey.trim() && { sshKey: formData.sshKey.trim() }),
      ...(formData.sshPassphrase.trim() && { sshPassphrase: formData.sshPassphrase.trim() }),
      ...(formData.sshPassword.trim() && { sshPassword: formData.sshPassword.trim() }),
    }

    if (editingConn?.id) {
      // Update existing
      await fetchJson(`/api/v1/connections/${editingConn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    } else {
      // Create new
      if (!formData.apiToken.trim()) {
        throw new Error('API Token is required')
      }
      await fetchJson('/api/v1/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    }

    // Reload connections
    if (addConnType === 'pve') {
      loadPveConnections()
    } else {
      loadPbsConnections()
    }
  }

  const createConnection = async () => {
    const payload = {
      name: addConn.name.trim(),
      type: addConnType,
      baseUrl: addConn.baseUrl.trim(),
      uiUrl: addConn.uiUrl.trim() || null,
      insecureTLS: !!addConn.insecureTLS,
      hasCeph: addConnType === 'pve' ? !!addConn.hasCeph : false,
      apiToken: addConn.apiToken.trim()
    }

    await fetchJson('/api/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    setAddConnOpen(false)
    setAddConn({ name: '', baseUrl: '', uiUrl: '', insecureTLS: true, hasCeph: false, apiToken: '' })
    
    if (addConnType === 'pve') {
      await loadPveConnections()
    } else {
      await loadPbsConnections()
    }
  }

  const deleteConnection = async (id, type) => {
    const typeName = type === 'pbs' ? 'PBS' : 'PVE'
    const ok = window.confirm(t('settings.deleteConnectionConfirm', { type: typeName }))

    if (!ok) return
    await fetchJson(`/api/v1/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
    
    if (type === 'pve') {
      await loadPveConnections()
    } else {
      await loadPbsConnections()
    }
  }

  useEffect(() => {
    loadPveConnections()
    loadPbsConnections()
  }, [])

  // PVE Columns
  const pveColumns = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('common.name'),
        flex: 1,
        minWidth: 180,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
            <i className='ri-server-line' style={{ opacity: 0.6 }} />
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
          </Box>
        )
      },
      {
        field: 'baseUrl',
        headerName: 'URL API',
        flex: 1.2,
        minWidth: 240,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography variant='body2' sx={{ fontFamily: 'monospace', opacity: 0.8 }}>
              {params.value}
            </Typography>
          </Box>
        )
      },
      {
        field: 'status',
        headerName: t('common.status'),
        width: 160,
        renderCell: params => (
          <ConnectionStatus connection={params.row} autoTest={true} />
        )
      },
      {
        field: 'hasCeph',
        headerName: 'Ceph',
        width: 80,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            {params.value ? (
              <Chip size='small' label={t('common.yes')} color='info' variant='outlined' />
            ) : (
              <Typography variant='caption' sx={{ opacity: 0.4 }}>{t('common.no')}</Typography>
            )}
          </Box>
        )
      },
      {
        field: 'actions',
        headerName: '',
        width: 100,
        sortable: false,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: '100%' }}>
            <Tooltip title={t('common.edit')}>
              <IconButton size='small' onClick={() => openEditDialog(params.row)}>
                <i className='ri-pencil-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('common.delete')}>
              <IconButton size='small' color='error' onClick={() => deleteConnection(params.row.id, 'pve')}>
                <i className='ri-delete-bin-6-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )
      }
    ],
    [t]
  )

  // PBS Columns
  const pbsColumns = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('common.name'),
        flex: 1,
        minWidth: 180,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
            <i className='ri-hard-drive-2-line' style={{ opacity: 0.6 }} />
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
          </Box>
        )
      },
      {
        field: 'baseUrl',
        headerName: 'URL API',
        flex: 1.2,
        minWidth: 240,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography variant='body2' sx={{ fontFamily: 'monospace', opacity: 0.8 }}>
              {params.value}
            </Typography>
          </Box>
        )
      },
      {
        field: 'status',
        headerName: t('common.status'),
        width: 160,
        renderCell: params => (
          <ConnectionStatus connection={params.row} autoTest={true} />
        )
      },
      {
        field: 'actions',
        headerName: '',
        width: 100,
        sortable: false,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: '100%' }}>
            <Tooltip title={t('common.edit')}>
              <IconButton size='small' onClick={() => openEditDialog(params.row)}>
                <i className='ri-pencil-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('common.delete')}>
              <IconButton size='small' color='error' onClick={() => deleteConnection(params.row.id, 'pbs')}>
                <i className='ri-delete-bin-6-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )
      }
    ],
    [t]
  )

  return (
    <>
      {/* Sub-tabs PVE / PBS */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs 
          value={connTab} 
          onChange={(_, v) => setConnTab(v)}
          sx={{ '& .MuiTab-root': { minHeight: 48 } }}
        >
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-server-line' style={{ fontSize: 18 }} />
                <span>Proxmox VE</span>
                <Chip size='small' label={pveConnections.length} color='primary' sx={{ height: 18, fontSize: 10, ml: 0.5 }} />
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-hard-drive-2-line' style={{ fontSize: 18 }} />
                <span>Proxmox Backup Server</span>
                <Chip size='small' label={pbsConnections.length} color='secondary' sx={{ height: 18, fontSize: 10, ml: 0.5 }} />
              </Box>
            } 
          />
        </Tabs>
      </Box>

      {/* PVE Tab */}
      <SubTabPanel value={connTab} index={0}>
        {pveError && <Alert severity='error' sx={{ mb: 2 }}>{t('common.error')}: {pveError}</Alert>}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {t('settings.pveServers')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant='outlined' size='small' onClick={loadPveConnections} disabled={pveLoading} startIcon={<i className='ri-refresh-line' />}>
              {t('common.refresh')}
            </Button>
            <Button variant='contained' size='small' onClick={() => openAddDialog('pve')} startIcon={<i className='ri-add-line' />}>
              {t('common.add')} PVE
            </Button>
          </Box>
        </Box>

        <Box sx={{ height: 'calc(100vh - 380px)', minHeight: 300 }}>
          <DataGrid
            rows={pveConnections}
            columns={pveColumns}
            loading={pveLoading}
            getRowId={r => r.id}
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
            disableRowSelectionOnClick
            sx={{ '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
          />
        </Box>
      </SubTabPanel>

      {/* PBS Tab */}
      <SubTabPanel value={connTab} index={1}>
        {pbsError && <Alert severity='error' sx={{ mb: 2 }}>{t('common.error')}: {pbsError}</Alert>}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {t('settings.pbsServers')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant='outlined' size='small' onClick={loadPbsConnections} disabled={pbsLoading} startIcon={<i className='ri-refresh-line' />}>
              {t('common.refresh')}
            </Button>
            <Button variant='contained' size='small' color='secondary' onClick={() => openAddDialog('pbs')} startIcon={<i className='ri-add-line' />}>
              {t('common.add')} PBS
            </Button>
          </Box>
        </Box>

        {pbsConnections.length === 0 && !pbsLoading && (
          <Alert severity='info' sx={{ mb: 2 }}>
            {t('common.noData')}
          </Alert>
        )}

        <Box sx={{ height: 'calc(100vh - 380px)', minHeight: 300 }}>
          <DataGrid
            rows={pbsConnections}
            columns={pbsColumns}
            loading={pbsLoading}
            getRowId={r => r.id}
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
            disableRowSelectionOnClick
            sx={{ '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
          />
        </Box>
      </SubTabPanel>

      {/* Dialog Ajouter/Modifier Connexion */}
      <ConnectionDialog
        open={addConnOpen}
        onClose={() => {
          setAddConnOpen(false)
          setEditingConn(null)
        }}
        onSave={handleSaveConnection}
        type={addConnType}
        initialData={editingConn}
        mode={editingConn ? 'edit' : 'create'}
      />
    </>
  )
}

/* ==================== LicenseTab Component ==================== */

function LicenseTab() {
  const t = useTranslations()
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [licenseStatus, setLicenseStatus] = useState(null)
  const [features, setFeatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false)

  const loadLicenseStatus = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/license/status')
      if (res.ok) {
        const data = await res.json()
        setLicenseStatus(data)
      }
    } catch (e) {
      console.error('Failed to load license status', e)
    } finally {
      setLoading(false)
    }
  }

  const loadFeatures = async () => {
    try {
      const res = await fetch('/api/v1/license/features')
      if (res.ok) {
        const data = await res.json()
        setFeatures(data.features || [])
      }
    } catch (e) {
      console.error('Failed to load features', e)
    }
  }

  useEffect(() => {
    loadLicenseStatus()
    loadFeatures()
  }, [])

  const handleActivate = async () => {
    setActivating(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/v1/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license: licenseKey })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Activation failed')
      }
      setSuccess(t('settings.licenseActivated'))
      setLicenseKey('')
      await loadLicenseStatus()
      await loadFeatures()
    } catch (e) {
      setError(e?.message || 'Activation failed')
    } finally {
      setActivating(false)
    }
  }

  const handleDeactivate = async () => {
    setDeactivateDialogOpen(false)
    setActivating(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/license/deactivate', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Deactivation failed')
      }
      setSuccess(t('settings.licenseDeactivated'))
      await loadLicenseStatus()
      await loadFeatures()
    } catch (e) {
      setError(e?.message || 'Deactivation failed')
    } finally {
      setActivating(false)
    }
  }

  const isEnterprise = licenseStatus?.edition === 'enterprise'
  const isLicensed = licenseStatus?.licensed && !licenseStatus?.expired

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <LinearProgress sx={{ width: 200 }} />
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant='body2' sx={{ opacity: 0.7, mb: 3 }}>
        {t('settings.licenseManagement')}
      </Typography>

      {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity='success' sx={{ mb: 2 }}>{success}</Alert>}

      {/* Current License Status */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Box sx={{
              width: 48,
              height: 48,
              borderRadius: 2,
              bgcolor: isEnterprise ? 'primary.main' : 'warning.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <i className={isEnterprise ? 'ri-vip-crown-2-line' : 'ri-key-2-line'} style={{ fontSize: 24, color: 'white' }} />
            </Box>
            <Box>
              <Typography variant='h6' fontWeight={700}>
                {isEnterprise ? t('settings.enterpriseEdition') : t('settings.communityEdition')}
              </Typography>
              <Typography variant='body2' sx={{ opacity: 0.7 }}>
                {isLicensed ? (
                  <>{t('settings.licensedTo')}: {licenseStatus.customer?.name || 'Unknown'}</>
                ) : (
                  t('settings.communityLicenseDesc')
                )}
              </Typography>
            </Box>
            <Box sx={{ ml: 'auto', textAlign: 'right' }}>
              {isLicensed ? (
                <>
                  {licenseStatus.expired ? (
                    <Chip label={t('settings.expired')} color='error' size='small' />
                  ) : licenseStatus.expiration_warn ? (
                    <Chip label={`${licenseStatus.days_remaining} ${t('settings.daysLeft')}`} color='warning' size='small' />
                  ) : (
                    <Chip label={t('settings.activeLicense')} color='success' size='small' />
                  )}
                  {licenseStatus.expires_at && (
                    <Typography variant='caption' display='block' sx={{ opacity: 0.6, mt: 0.5 }}>
                      {t('settings.expiresOn')}: {new Date(licenseStatus.expires_at).toLocaleDateString()}
                    </Typography>
                  )}
                </>
              ) : (
                <Chip label={t('settings.activeLicense')} color='success' size='small' />
              )}
            </Box>
          </Box>

          {isLicensed && licenseStatus.license_id && (
            <Typography variant='caption' sx={{ display: 'block', mb: 2, opacity: 0.5, fontFamily: 'monospace' }}>
              License ID: {licenseStatus.license_id}
            </Typography>
          )}

          <Divider sx={{ my: 2 }} />

          <Typography variant='subtitle2' fontWeight={700} sx={{ mb: 1 }}>{t('settings.includedFeatures')}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {features.length > 0 ? (
              features.map(f => (
                <Chip
                  key={f.id}
                  size='small'
                  label={`${f.enabled ? '✓' : '✗'} ${f.name}`}
                  variant='outlined'
                  color={f.enabled ? 'success' : 'default'}
                  sx={{ opacity: f.enabled ? 1 : 0.5 }}
                />
              ))
            ) : (
              <>
                <Chip size='small' label={`✓ ${t('settings.features.dashboard')}`} variant='outlined' />
                <Chip size='small' label={`✓ ${t('settings.features.inventory')}`} variant='outlined' />
                <Chip size='small' label={`✓ ${t('settings.features.maxPveConnections')}`} variant='outlined' />
              </>
            )}
          </Box>

          {isLicensed && (
            <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Button
                variant='outlined'
                color='error'
                size='small'
                onClick={() => setDeactivateDialogOpen(true)}
                disabled={activating}
                startIcon={<i className='ri-delete-bin-line' />}
              >
                {t('settings.deactivateLicense')}
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Deactivate Confirmation Dialog */}
      <Dialog
        open={deactivateDialogOpen}
        onClose={() => setDeactivateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-error-warning-line' style={{ color: 'var(--mui-palette-error-main)', fontSize: 24 }} />
          {t('settings.deactivateLicense')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('settings.confirmDeactivateLicense')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDeactivateDialogOpen(false)}
            variant="outlined"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleDeactivate}
            variant="contained"
            color="error"
            startIcon={<i className='ri-delete-bin-line' />}
          >
            {t('settings.deactivateLicense')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Activate License (only show if not licensed) */}
      {!isLicensed && (
        <Card variant='outlined'>
          <CardContent>
            <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2 }}>
              <i className='ri-vip-crown-line' style={{ marginRight: 8, color: '#e57000' }} />
              {t('settings.activateProLicense')}
            </Typography>

            <TextField
              fullWidth
              multiline
              rows={4}
              label={t('settings.licenseKey')}
              placeholder={t('settings.licenseKeyPlaceholder')}
              value={licenseKey}
              onChange={e => setLicenseKey(e.target.value)}
              sx={{ mb: 2 }}
              InputProps={{
                sx: { fontFamily: 'monospace', fontSize: '0.85rem' }
              }}
            />

            <Button
              variant='contained'
              disabled={!licenseKey.trim() || activating}
              onClick={handleActivate}
              startIcon={activating ? <i className='ri-loader-4-line' /> : <i className='ri-check-line' />}
            >
              {activating ? t('settings.activating') : t('settings.activateLicense')}
            </Button>

            <Typography variant='caption' sx={{ display: 'block', mt: 2, opacity: 0.6 }}>
              {t('settings.needLicense')} <a href='https://proxcenter.io/pricing' target='_blank' rel='noopener noreferrer' style={{ color: '#e57000' }}>{t('settings.viewPricing')}</a>
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  )
}

/* ==================== AITab Component ==================== */

function AITab() {
  const t = useTranslations()

  const [settings, setSettings] = useState({
    enabled: false,
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'mistral:7b',
    openaiKey: '',
    openaiModel: 'gpt-4o-mini'
  })

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [availableModels, setAvailableModels] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)

  // Charger les paramètres au montage
  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/v1/settings/ai')

      if (res.ok) {
        const json = await res.json()

        if (json?.data) {
          setSettings(s => ({ ...s, ...json.data }))
        }
      }
    } catch (e) {
      console.error('Failed to load AI settings', e)
    }
  }

  const saveSettings = async () => {
    setSaving(true)

    try {
      await fetchJson('/api/v1/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      setTestResult({ type: 'success', message: t('settings.saved') })
    } catch (e) {
      setTestResult({ type: 'error', message: e?.message || t('common.error') })
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)

    try {
      const res = await fetch('/api/v1/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })

      const json = await res.json()

      if (res.ok) {
        setTestResult({ type: 'success', message: `${t('settings.connectionOk')} "${json.response?.substring(0, 100)}..."` })
      } else {
        setTestResult({ type: 'error', message: json?.error || t('settings.connectionError') })
      }
    } catch (e) {
      setTestResult({ type: 'error', message: e?.message || t('settings.connectionError') })
    } finally {
      setTesting(false)
    }
  }

  const loadOllamaModels = async () => {
    setLoadingModels(true)

    try {
      const res = await fetch(`${settings.ollamaUrl}/api/tags`)

      if (res.ok) {
        const json = await res.json()
        const models = json?.models?.map(m => m.name) || []

        setAvailableModels(models)
      }
    } catch (e) {
      console.error('Failed to load Ollama models', e)
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    if (settings.provider === 'ollama' && settings.ollamaUrl) {
      loadOllamaModels()
    }
  }, [settings.provider, settings.ollamaUrl])

  return (
    <Box>
      <Typography variant='body2' sx={{ opacity: 0.7, mb: 3 }}>
        {t('settings.aiConfigDescription')}
      </Typography>

      {/* Enable/Disable */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <FormControlLabel
            control={
              <Switch
                checked={settings.enabled}
                onChange={e => setSettings(s => ({ ...s, enabled: e.target.checked }))}
              />
            }
            label={
              <Box>
                <Typography fontWeight={600}>{t('settings.enableAiAssistant')}</Typography>
                <Typography variant='caption' sx={{ opacity: 0.7 }}>
                  {t('settings.enableAiAssistantDesc')}
                </Typography>
              </Box>
            }
          />
        </CardContent>
      </Card>

      {/* Provider Selection */}
      {settings.enabled && (
        <>
          <Card variant='outlined' sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2 }}>
                <i className='ri-brain-line' style={{ marginRight: 8 }} />
                {t('settings.llmProvider')}
              </Typography>

              <FormControl fullWidth sx={{ mb: 3 }}>
                <InputLabel>{t('settings.providerLabel')}</InputLabel>
                <Select
                  value={settings.provider}
                  label={t('settings.providerLabel')}
                  onChange={e => setSettings(s => ({ ...s, provider: e.target.value }))}
                >
                  <MenuItem value='ollama'>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className='ri-server-line' />
                      {t('settings.ollamaLocalOption')}
                    </Box>
                  </MenuItem>
                  <MenuItem value='openai'>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className='ri-openai-fill' />
                      {t('settings.openaiCloudOption')}
                    </Box>
                  </MenuItem>
                  <MenuItem value='anthropic'>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className='ri-sparkling-line' />
                      {t('settings.anthropicCloudOption')}
                    </Box>
                  </MenuItem>
                </Select>
              </FormControl>

              {/* Ollama Settings */}
              {settings.provider === 'ollama' && (
                <Box>
                  <Alert severity='info' sx={{ mb: 2 }}>
                    <Typography variant='body2' dangerouslySetInnerHTML={{ __html: t('settings.ollamaInfo') }} />
                  </Alert>

                  <TextField
                    fullWidth
                    label={t('settings.ollamaUrlLabel')}
                    value={settings.ollamaUrl}
                    onChange={e => setSettings(s => ({ ...s, ollamaUrl: e.target.value }))}
                    placeholder='http://localhost:11434'
                    sx={{ mb: 2 }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position='start'>
                          <i className='ri-link' style={{ opacity: 0.5 }} />
                        </InputAdornment>
                      )
                    }}
                  />

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>{t('settings.modelLabel')}</InputLabel>
                    <Select
                      value={settings.ollamaModel}
                      label={t('settings.modelLabel')}
                      onChange={e => setSettings(s => ({ ...s, ollamaModel: e.target.value }))}
                    >
                      {availableModels.length > 0 ? (
                        availableModels.map(m => (
                          <MenuItem key={m} value={m}>{m}</MenuItem>
                        ))
                      ) : (
                        <>
                          <MenuItem value='mistral:7b'>mistral:7b ({t('settings.recommended')})</MenuItem>
                          <MenuItem value='llama3.1:8b'>llama3.1:8b</MenuItem>
                          <MenuItem value='qwen2.5:7b'>qwen2.5:7b</MenuItem>
                          <MenuItem value='phi3:14b'>phi3:14b</MenuItem>
                        </>
                      )}
                    </Select>
                  </FormControl>

                  {loadingModels && <LinearProgress sx={{ mb: 2 }} />}

                  <Button
                    size='small'
                    onClick={loadOllamaModels}
                    disabled={loadingModels}
                    startIcon={<i className='ri-refresh-line' />}
                  >
                    {t('settings.refreshModels')}
                  </Button>
                </Box>
              )}

              {/* OpenAI Settings */}
              {settings.provider === 'openai' && (
                <Box>
                  <Alert severity='warning' sx={{ mb: 2 }}>
                    <Typography variant='body2'>
                      {t('settings.openAiWarning')}
                    </Typography>
                  </Alert>

                  <TextField
                    fullWidth
                    type='password'
                    label={t('settings.openAiApiKey')}
                    value={settings.openaiKey}
                    onChange={e => setSettings(s => ({ ...s, openaiKey: e.target.value }))}
                    placeholder='sk-...'
                    sx={{ mb: 2 }}
                  />

                  <FormControl fullWidth>
                    <InputLabel>{t('settings.modelLabel')}</InputLabel>
                    <Select
                      value={settings.openaiModel}
                      label={t('settings.modelLabel')}
                      onChange={e => setSettings(s => ({ ...s, openaiModel: e.target.value }))}
                    >
                      <MenuItem value='gpt-4o-mini'>{t('settings.openaiModels.gpt4oMini')}</MenuItem>
                      <MenuItem value='gpt-4o'>{t('settings.openaiModels.gpt4o')}</MenuItem>
                      <MenuItem value='gpt-4-turbo'>{t('settings.openaiModels.gpt4Turbo')}</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              )}

              {/* Anthropic Settings */}
              {settings.provider === 'anthropic' && (
                <Box>
                  <Alert severity='warning' sx={{ mb: 2 }}>
                    <Typography variant='body2'>
                      {t('settings.anthropicWarning')}
                    </Typography>
                  </Alert>

                  <TextField
                    fullWidth
                    type='password'
                    label={t('settings.anthropicApiKey')}
                    value={settings.anthropicKey || ''}
                    onChange={e => setSettings(s => ({ ...s, anthropicKey: e.target.value }))}
                    placeholder='sk-ant-...'
                    sx={{ mb: 2 }}
                  />

                  <FormControl fullWidth>
                    <InputLabel>{t('settings.modelLabel')}</InputLabel>
                    <Select
                      value={settings.anthropicModel || 'claude-3-haiku-20240307'}
                      label={t('settings.modelLabel')}
                      onChange={e => setSettings(s => ({ ...s, anthropicModel: e.target.value }))}
                    >
                      <MenuItem value='claude-3-haiku-20240307'>{t('settings.anthropicModels.haiku')}</MenuItem>
                      <MenuItem value='claude-3-sonnet-20240229'>{t('settings.anthropicModels.sonnet')}</MenuItem>
                      <MenuItem value='claude-3-opus-20240229'>{t('settings.anthropicModels.opus')}</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Test & Save */}
          <Card variant='outlined'>
            <CardContent>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant='outlined'
                  onClick={testConnection}
                  disabled={testing}
                  startIcon={testing ? <i className='ri-loader-4-line' /> : <i className='ri-play-line' />}
                >
                  {testing ? t('settings.testingConnection') : t('settings.testConnection')}
                </Button>

                <Button
                  variant='contained'
                  onClick={saveSettings}
                  disabled={saving}
                  startIcon={<i className='ri-save-line' />}
                >
                  {t('common.save')}
                </Button>
              </Box>

              {testResult && (
                <Alert severity={testResult.type} sx={{ mt: 2 }}>
                  {testResult.message}
                </Alert>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  )
}

/* ==================== GreenTab Component (RSE / Green IT) ==================== */

function GreenTab() {
  const t = useTranslations()

  const [settings, setSettings] = useState({
    pue: 1.4,
    electricityPrice: 0.18,
    currency: 'EUR',
    co2Country: 'france',
    co2Factor: 0.052,
    serverSpecs: {
      mode: 'auto',
      avgCoresPerServer: 64,
      avgRamPerServer: 256,
      tdpPerCore: 10,
      wattsPerGbRam: 0.375,
      wattsPerTbStorage: 6,
      storageType: 'mixed',
      overheadPerServer: 50,
    },
    display: {
      showCost: true,
      showCo2: true,
      showEquivalences: true,
      showScore: true,
    }
  })

  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)

  const co2FactorsByCountry = {
    france: { label: t('settings.co2Countries.france'), value: 0.052 },
    germany: { label: t('settings.co2Countries.germany'), value: 0.385 },
    usa: { label: t('settings.co2Countries.usa'), value: 0.417 },
    uk: { label: t('settings.co2Countries.uk'), value: 0.233 },
    spain: { label: t('settings.co2Countries.spain'), value: 0.210 },
    italy: { label: t('settings.co2Countries.italy'), value: 0.330 },
    poland: { label: t('settings.co2Countries.poland'), value: 0.650 },
    sweden: { label: t('settings.co2Countries.sweden'), value: 0.045 },
    norway: { label: t('settings.co2Countries.norway'), value: 0.020 },
    europe_avg: { label: t('settings.co2Countries.europe_avg'), value: 0.276 },
    world_avg: { label: t('settings.co2Countries.world_avg'), value: 0.475 },
    custom: { label: t('settings.co2Countries.custom'), value: settings.co2Factor },
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/settings/green')

      if (res.ok) {
        const json = await res.json()

        if (json?.data) {
          setSettings(s => ({ ...s, ...json.data }))
        }
      }
    } catch (e) {
      console.error('Failed to load green settings', e)
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/v1/settings/green', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })

      if (res.ok) {
        setMessage({ type: 'success', text: t('settings.savedSuccess') })
      } else {
        throw new Error(t('settings.saveError'))
      }
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || t('common.error') })
    } finally {
      setSaving(false)
    }
  }

  const handleCountryChange = (country) => {
    const factor = co2FactorsByCountry[country]?.value || 0.052

    setSettings(s => ({ 
      ...s, 
      co2Country: country,
      co2Factor: country === 'custom' ? s.co2Factor : factor
    }))
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <LinearProgress sx={{ width: 200 }} />
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant='body2' sx={{ opacity: 0.7, mb: 3 }}>
        {t('settings.greenConfigDescription')}
      </Typography>

      {/* Section PUE & Énergie */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-flashlight-line' style={{ color: '#f59e0b' }} />
            {t('settings.datacenterEnergy')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
            <Box>
              <TextField
                fullWidth
                type='number'
                label={t('settings.pueLabel')}
                value={settings.pue}
                onChange={e => setSettings(s => ({ ...s, pue: parseFloat(e.target.value) || 1.0 }))}
                inputProps={{ step: 0.1, min: 1.0, max: 3.0 }}
                helperText={t('settings.pueHelperTextFull')}
                sx={{ mb: 2 }}
              />

              <Alert severity='info' sx={{ fontSize: '0.8rem' }}>
                <span dangerouslySetInnerHTML={{ __html: t('settings.pueDescriptionFull') }} />
              </Alert>
            </Box>

            <Box>
              <TextField
                fullWidth
                type='number'
                label={t('settings.electricityPriceLabel')}
                value={settings.electricityPrice}
                onChange={e => setSettings(s => ({ ...s, electricityPrice: parseFloat(e.target.value) || 0 }))}
                inputProps={{ step: 0.01, min: 0 }}
                InputProps={{
                  endAdornment: <InputAdornment position='end'>€/kWh</InputAdornment>
                }}
                helperText={t('settings.electricityPriceHelper')}
              />
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Section Émissions CO₂ */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-leaf-line' style={{ color: '#22c55e' }} />
            {t('settings.co2Emissions')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
            <FormControl fullWidth>
              <InputLabel>{t('settings.countryEnergyMixLabel')}</InputLabel>
              <Select
                value={settings.co2Country}
                label={t('settings.countryEnergyMixLabel')}
                onChange={e => handleCountryChange(e.target.value)}
              >
                {Object.entries(co2FactorsByCountry).map(([key, { label, value }]) => (
                  <MenuItem key={key} value={key}>
                    {label} ({value} kg CO₂/kWh)
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {settings.co2Country === 'custom' && (
              <TextField
                fullWidth
                type='number'
                label={t('settings.customCo2FactorLabel')}
                value={settings.co2Factor}
                onChange={e => setSettings(s => ({ ...s, co2Factor: parseFloat(e.target.value) || 0 }))}
                inputProps={{ step: 0.001, min: 0 }}
                InputProps={{
                  endAdornment: <InputAdornment position='end'>kg CO₂/kWh</InputAdornment>
                }}
              />
            )}
          </Box>

          <Alert severity='success' sx={{ mt: 2, fontSize: '0.8rem' }}>
            {t('settings.co2FactorExplanationFull')}
          </Alert>
        </CardContent>
      </Card>

      {/* Section Spécifications Serveurs */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-server-line' style={{ color: '#8b5cf6' }} />
            {t('settings.serverSpecs')}
          </Typography>

          <Typography variant='body2' sx={{ opacity: 0.7, mb: 2 }}>
            {t('settings.serverSpecsDescriptionFull')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
            <TextField
              fullWidth
              type='number'
              label={t('settings.tdpPerCore')}
              value={settings.serverSpecs?.tdpPerCore || 10}
              onChange={e => setSettings(s => ({
                ...s,
                serverSpecs: { ...s.serverSpecs, tdpPerCore: parseFloat(e.target.value) || 10 }
              }))}
              inputProps={{ step: 1, min: 1 }}
              InputProps={{
                endAdornment: <InputAdornment position='end'>W</InputAdornment>
              }}
              helperText={t('settings.tdpPerCoreHelper')}
            />

            <TextField
              fullWidth
              type='number'
              label={t('settings.ramConsumptionPerGb')}
              value={settings.serverSpecs?.wattsPerGbRam || 0.375}
              onChange={e => setSettings(s => ({
                ...s,
                serverSpecs: { ...s.serverSpecs, wattsPerGbRam: parseFloat(e.target.value) || 0.375 }
              }))}
              inputProps={{ step: 0.1, min: 0 }}
              InputProps={{
                endAdornment: <InputAdornment position='end'>W/GB</InputAdornment>
              }}
              helperText={t('settings.ramConsumptionHelper')}
            />

            <TextField
              fullWidth
              type='number'
              label={t('settings.overheadPerServer')}
              value={settings.serverSpecs?.overheadPerServer || 50}
              onChange={e => setSettings(s => ({
                ...s,
                serverSpecs: { ...s.serverSpecs, overheadPerServer: parseFloat(e.target.value) || 50 }
              }))}
              inputProps={{ step: 10, min: 0 }}
              InputProps={{
                endAdornment: <InputAdornment position='end'>W</InputAdornment>
              }}
              helperText={t('settings.overheadHelper')}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField
              fullWidth
              type='number'
              label={t('settings.avgCoresPerServer')}
              value={settings.serverSpecs?.avgCoresPerServer || 64}
              onChange={e => setSettings(s => ({
                ...s,
                serverSpecs: { ...s.serverSpecs, avgCoresPerServer: parseInt(e.target.value) || 64 }
              }))}
              inputProps={{ step: 1, min: 1 }}
              helperText={t('settings.avgCoresHelper')}
            />

            <FormControl fullWidth>
              <InputLabel>{t('settings.storageTypeLabel')}</InputLabel>
              <Select
                value={settings.serverSpecs?.storageType || 'mixed'}
                label={t('settings.storageTypeLabel')}
                onChange={e => setSettings(s => ({
                  ...s,
                  serverSpecs: { ...s.serverSpecs, storageType: e.target.value }
                }))}
              >
                <MenuItem value='hdd'>{t('settings.storageTypes.hdd')}</MenuItem>
                <MenuItem value='ssd'>{t('settings.storageTypes.ssd')}</MenuItem>
                <MenuItem value='nvme'>{t('settings.storageTypes.nvme')}</MenuItem>
                <MenuItem value='mixed'>{t('settings.storageTypes.mixed')}</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </CardContent>
      </Card>

      {/* Section Affichage */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-eye-line' style={{ color: '#06b6d4' }} />
            {t('settings.displayOptions')}
          </Typography>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.display?.showCost !== false}
                  onChange={e => setSettings(s => ({
                    ...s,
                    display: { ...s.display, showCost: e.target.checked }
                  }))}
                />
              }
              label={t('settings.showCosts')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.display?.showCo2 !== false}
                  onChange={e => setSettings(s => ({
                    ...s,
                    display: { ...s.display, showCo2: e.target.checked }
                  }))}
                />
              }
              label={t('settings.showCo2Emissions')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.display?.showEquivalences !== false}
                  onChange={e => setSettings(s => ({
                    ...s,
                    display: { ...s.display, showEquivalences: e.target.checked }
                  }))}
                />
              }
              label={t('settings.showEquivalences')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.display?.showScore !== false}
                  onChange={e => setSettings(s => ({
                    ...s,
                    display: { ...s.display, showScore: e.target.checked }
                  }))}
                />
              }
              label={t('settings.showGreenScore')}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Bouton Sauvegarder */}
      <Card variant='outlined'>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant='contained'
              onClick={saveSettings}
              disabled={saving}
              startIcon={saving ? <i className='ri-loader-4-line' /> : <i className='ri-save-line' />}
            >
              {saving ? t('common.saving') : t('settings.saveChanges')}
            </Button>

            <Button
              variant='outlined'
              onClick={loadSettings}
              disabled={saving}
              startIcon={<i className='ri-refresh-line' />}
            >
              {t('common.reset')}
            </Button>
          </Box>

          {message && (
            <Alert severity={message.type} sx={{ mt: 2 }}>
              {message.text}
            </Alert>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}

/* ==================== GeneralTab Component ==================== */

function GeneralTab() {
  const t = useTranslations()


return (
    <Box>
      <Typography variant='body2' sx={{ opacity: 0.7, mb: 3 }}>
        {t('settings.appSettings')}
      </Typography>

      <Alert severity='info'>
        <Typography variant='body2'>
          {t('settings.generalTabInfo')}
        </Typography>
      </Alert>
    </Box>
  )
}

/* ==================== Main Settings Page ==================== */

export default function SettingsPage() {
  const t = useTranslations()
  const [mainTab, setMainTab] = useState(0)
  const { hasFeature, loading: licenseLoading } = useLicense()

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('settings.title'), t('settings.subtitle'), 'ri-settings-3-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // Check if a tab's required feature is available
  const isTabAvailable = (tab) => {
    if (licenseLoading) return true
    if (!tab.requiredFeature) return true
    return hasFeature(tab.requiredFeature)
  }

  const tabs = [
    { label: t('settings.connections'), icon: 'ri-link', component: ConnectionsTab },
    { label: t('settings.appearance'), icon: 'ri-palette-line', component: AppearanceTab },
    { label: t('settings.notifications'), icon: 'ri-notification-3-line', component: NotificationsTab },
    { label: 'LDAP / Active Directory', icon: 'ri-server-line', component: LdapConfigTab, requiredFeature: Features.LDAP },
    { label: t('settings.license'), icon: 'ri-key-2-line', component: LicenseTab },
    { label: t('settings.ai'), icon: 'ri-robot-line', component: AITab, requiredFeature: Features.AI_INSIGHTS },
    { label: 'RSE / Green IT', icon: 'ri-leaf-line', component: GreenTab, requiredFeature: Features.GREEN_METRICS },
    { label: t('common.configuration'), icon: 'ri-settings-3-line', component: GeneralTab },
  ]

  return (
    <Box sx={{ p: 0 }}>
      <Card variant='outlined' sx={{ height: 'calc(100vh - 145px)' }}>
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 0 }}>
          {/* Main Tabs */}
          <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, pt: 2 }}>
            <Tabs 
              value={mainTab} 
              onChange={(_, v) => setMainTab(v)}
              sx={{
                '& .MuiTab-root': { 
                  minHeight: 56,
                  textTransform: 'none',
                  fontSize: '0.95rem'
                }
              }}
            >
              {tabs.map((tab, idx) => {
                const available = isTabAvailable(tab)
                return (
                  <Tab
                    key={idx}
                    disabled={!available}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: available ? 1 : 0.4 }}>
                        <i className={tab.icon} style={{ fontSize: 18 }} />
                        <span>{tab.label}</span>
                        {!available && (
                          <Chip
                            size="small"
                            label="Enterprise"
                            sx={{
                              height: 18,
                              fontSize: '0.6rem',
                              fontWeight: 600,
                              bgcolor: 'primary.main',
                              color: 'primary.contrastText',
                              ml: 0.5,
                              '& .MuiChip-label': { px: 0.75 }
                            }}
                          />
                        )}
                      </Box>
                    }
                  />
                )
              })}
            </Tabs>
          </Box>

          {/* Tab Content */}
          <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
            {tabs.map((tab, idx) => {
              if (mainTab !== idx) return null
              const TabComponent = tab.component
              return (
                <Box key={idx}>
                  <TabComponent />
                </Box>
              )
            })}
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
