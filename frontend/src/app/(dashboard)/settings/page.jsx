'use client'

import { useEffect, useMemo, useState } from 'react'

import dynamic from 'next/dynamic'
import { useSearchParams, useRouter } from 'next/navigation'

import { useSession } from 'next-auth/react'

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
  InputAdornment,
  Checkbox,
  useTheme
} from '@mui/material'

import { DataGrid } from '@mui/x-data-grid'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { useRBAC } from '@/contexts/RBACContext'
import EmptyState from '@/components/EmptyState'
import { CountryFlag } from '@/components/ui/CountryFlag'
import { findCountry } from '@/lib/utils/countries'

import { isMultiLicenseEnabled } from '@/lib/features'
import { buildLicenseTableRows, computePerTenantRollup } from '@/lib/license/view'

import { useConnectionsManagement } from '@/hooks/useConnectionsManagement'
import { useLicenseManagement } from '@/hooks/useLicenseManagement'
import { useAISettings } from '@/hooks/useAISettings'
import { useGreenSettings } from '@/hooks/useGreenSettings'

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

const OidcConfigTab = dynamic(() => import('@/components/settings/OidcConfigTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const ConnectionDialog = dynamic(() => import('@/components/settings/ConnectionDialog'), {
  ssr: false
})

const DiagnosticModal = dynamic(() => import('@/components/settings/DiagnosticModal'), {
  ssr: false
})

const WhiteLabelTab = dynamic(() => import('@/components/settings/WhiteLabelTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const VdcTab = dynamic(() => import('@/components/settings/VdcTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const TenantsTab = dynamic(() => import('@/components/settings/TenantsTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const AlertThresholdsTab = dynamic(() => import('@/components/settings/AlertThresholdsTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const SshCommandsTab = dynamic(() => import('@/components/settings/SshCommandsTab'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><LinearProgress /></Box>
})

const DatacentersSection = dynamic(() => import('@/components/settings/green/DatacentersSection'), {
  ssr: false,
  loading: () => <Box sx={{ p: 2, textAlign: 'center' }}><LinearProgress /></Box>
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
  } catch {
    // Response is not JSON — use raw text as error message
  }

  if (!r.ok) {
    // Build a useful error message from Zod validation details if present
    let msg = json?.error || text || `HTTP ${r.status}`
    if (json?.details?.fieldErrors) {
      const fields = Object.entries(json.details.fieldErrors)
        .filter(([, v]) => v?.length)
        .map(([k, v]) => `${k}: ${v.join(', ')}`)
      if (fields.length) msg += ' — ' + fields.join('; ')
    }
    throw new Error(msg)
  }

  return json
}

/* ==================== ConnectionStatus Component ==================== */

function ConnectionStatus({ connection, autoTest = false, onNodesLoaded }) {
  const t = useTranslations()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  const testConnection = async () => {
    setStatus('loading')
    setError(null)

    try {
      const endpoint = connection.type === 'pbs'
        ? `/api/v1/pbs/${connection.id}/status`
        : connection.type === 'vmware'
        ? `/api/v1/vmware/${connection.id}/status`
        : connection.type === 'xcpng'
        ? `/api/v1/xcpng/${connection.id}/status`
        : connection.type === 'nutanix'
        ? `/api/v1/nutanix/${connection.id}/status`
        : connection.type === 'hyperv'
        ? `/api/v1/hyperv/${connection.id}/status`
        : `/api/v1/connections/${connection.id}/nodes`

      const res = await fetch(endpoint)

      if (res.ok) {
        setStatus('ok')
        if (onNodesLoaded) onNodesLoaded()
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

/* ==================== ConnectionVersion ==================== */

function ConnectionVersion({ connection }) {
  const [version, setVersion] = useState(null)

  useEffect(() => {
    if (!connection?.id) return
    const endpoint = connection.type === 'pbs'
      ? `/api/v1/pbs/${connection.id}/status`
      : `/api/v1/connections/${connection.id}/version`

    fetch(endpoint)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json) return
        const data = json.data || json
        const ver = data.version || ''
        const rel = data.release ? `-${data.release}` : ''
        if (ver) setVersion(`${ver}${rel}`)
      })
      .catch(() => {})
  }, [connection?.id, connection?.type])

  if (!version) {
    return <Typography variant='caption' sx={{ opacity: 0.3 }}>—</Typography>
  }

  return (
    <Chip
      size='small'
      label={version}
      variant='outlined'
      sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem' }}
    />
  )
}

/* ==================== BridgeTypes Component ==================== */

function BridgeTypes({ connection }) {
  const t = useTranslations()
  const [bridgeInfo, setBridgeInfo] = useState(null)

  useEffect(() => {
    if (!connection?.id || connection.type !== 'pve') return

    fetch(`/api/v1/connections/${connection.id}/nodes`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json?.data) return
        let hasNative = false
        let hasOvs = false

        for (const node of json.data) {
          if (node.bridges?.native?.length > 0) hasNative = true
          if (node.bridges?.ovs?.length > 0) hasOvs = true
        }

        setBridgeInfo({ hasNative, hasOvs })
      })
      .catch(() => {})
  }, [connection?.id, connection?.type])

  if (!bridgeInfo) {
    return <Typography variant='caption' sx={{ opacity: 0.3 }}>—</Typography>
  }

  const { hasNative, hasOvs } = bridgeInfo

  if (!hasNative && !hasOvs) {
    return <Typography variant='caption' sx={{ opacity: 0.3 }}>—</Typography>
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
      {hasNative && (
        <Chip size='small' label={t('network.bridgeNative')} variant='outlined' sx={{ fontSize: '0.7rem', height: 22 }} />
      )}
      {hasOvs && (
        <Chip size='small' label='OVS' color='info' variant='outlined' sx={{ fontSize: '0.7rem', height: 22 }} />
      )}
    </Box>
  )
}

/* ==================== ConnectionsTab Component ==================== */

function ConnectionsTab() {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isOnboarding = searchParams.get('onboarding') === 'true'
  const { hasFeature } = useLicense()
  const migrationAvailable = hasFeature(Features.VMWARE_MIGRATION)
  const [connTab, setConnTab] = useState(0)

  // Hook for data fetching
  const {
    pveConnections,
    pbsConnections,
    vmwareConnections,
    xcpngConnections,
    nutanixConnections,
    hypervConnections,
    pveLoading,
    pbsLoading,
    vmwareLoading,
    xcpngLoading,
    nutanixLoading,
    hypervLoading,
    pveError,
    pbsError,
    vmwareError,
    xcpngError,
    nutanixError,
    hypervError,
    loadPveConnections,
    loadPbsConnections,
    loadVmwareConnections,
    loadXcpngConnections,
    loadNutanixConnections,
    loadHypervConnections,
  } = useConnectionsManagement()

  // Tenant name map for ownership badges: id -> name
  const [tenantNameMap, setTenantNameMap] = useState({})
  useEffect(() => {
    fetch('/api/v1/tenants')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!Array.isArray(json?.data)) return
        const map = {}
        for (const tenant of json.data) map[tenant.id] = tenant.name
        setTenantNameMap(map)
      })
      .catch(() => {})
  }, [])

  // vDC map: connectionId -> Array<{ vdcName, tenantId }> (provider-only; silently ignore non-OK)
  const [vdcsByConnection, setVdcsByConnection] = useState({})
  useEffect(() => {
    fetch('/api/v1/admin/vdcs')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        const rows = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : null)
        if (!rows) return
        const map = {}
        for (const vdc of rows) {
          if (!vdc.connectionId) continue
          if (!map[vdc.connectionId]) map[vdc.connectionId] = []
          map[vdc.connectionId].push({ vdcName: vdc.name, tenantId: vdc.tenantId })
        }
        setVdcsByConnection(map)
      })
      .catch(() => {})
  }, [])

  // Dialog
  const [addConnOpen, setAddConnOpen] = useState(false)
  const [addConnType, setAddConnType] = useState('pve')
  const [editingConn, setEditingConn] = useState(null)
  const [detectingCephId, setDetectingCephId] = useState(null)

  // Diagnostic modal state
  const [diagOpen, setDiagOpen] = useState(false)
  const [diagConnectionId, setDiagConnectionId] = useState(null)
  const [diagConnectionName, setDiagConnectionName] = useState('')

  const openDiagnostic = (id, name) => {
    setDiagConnectionId(id)
    setDiagConnectionName(name)
    setDiagOpen(true)
  }

  const handleDetectCeph = async (connId) => {
    setDetectingCephId(connId)
    try {
      await fetch(`/api/v1/connections/${connId}/detect-ceph`, { method: 'POST' })
      await loadPveConnections()
    } catch { /* ignore */ }
    setDetectingCephId(null)
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
    const isExtHypervisor = addConnType === 'vmware' || addConnType === 'xcpng' || addConnType === 'nutanix' || addConnType === 'hyperv'
    const payload = {
      name: formData.name.trim(),
      type: addConnType,
      baseUrl: formData.baseUrl.trim(),
      behindProxy: isExtHypervisor ? false : !!formData.behindProxy,
      insecureTLS: !!formData.insecureTLS,
      // Location fields
      latitude: formData.latitude !== '' && !Number.isNaN(Number.parseFloat(formData.latitude)) ? Number.parseFloat(formData.latitude) : null,
      longitude: formData.longitude !== '' && !Number.isNaN(Number.parseFloat(formData.longitude)) ? Number.parseFloat(formData.longitude) : null,
      locationLabel: formData.locationLabel?.trim() || null,
      country: formData.country?.trim().toUpperCase() || null,
      // PVE/PBS: API token
      ...(!isExtHypervisor && formData.apiToken.trim() && { apiToken: formData.apiToken.trim() }),
      // VMware/XCP-ng: username + password
      ...(isExtHypervisor && { vmwareUser: formData.vmwareUser?.trim() || (addConnType === 'xcpng' ? 'admin@admin.net' : addConnType === 'hyperv' ? 'Administrator' : addConnType === 'nutanix' ? 'admin' : 'root') }),
      ...(isExtHypervisor && formData.vmwarePassword && { vmwarePassword: formData.vmwarePassword }),
      // VMware sub-type and datacenter
      ...(addConnType === 'vmware' && { subType: formData.subType || 'esxi' }),
      ...(addConnType === 'vmware' && formData.vmwareDatacenter?.trim() && { vmwareDatacenter: formData.vmwareDatacenter.trim() }),
      // Hyper-V SMB share name
      ...(addConnType === 'hyperv' && { hypervShareName: formData.hypervShareName?.trim() || 'VMs' }),
      // SSH fields (PVE + VMware — not XCP-ng)
      ...(addConnType !== 'xcpng' && addConnType !== 'hyperv' && addConnType !== 'nutanix' && {
        sshEnabled: formData.sshEnabled,
        sshPort: formData.sshPort,
        sshUser: formData.sshUser,
        sshAuthMethod: formData.sshAuthMethod || null,
        sshUseSudo: !!formData.sshUseSudo,
        ...(formData.sshKey.trim() && { sshKey: formData.sshKey.trim() }),
        ...(formData.sshPassphrase.trim() && { sshPassphrase: formData.sshPassphrase.trim() }),
        ...(formData.sshPassword.trim() && { sshPassword: formData.sshPassword.trim() }),
      }),
      // Provider-only create-with-owner: own the connection by an MSP tenant
      ...(!editingConn?.id && formData.ownerTenantId && { ownerTenantId: formData.ownerTenantId }),
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
      if (!isExtHypervisor && !formData.apiToken.trim()) {
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
    } else if (addConnType === 'pbs') {
      loadPbsConnections()
    } else if (addConnType === 'vmware') {
      loadVmwareConnections()
    } else if (addConnType === 'xcpng') {
      loadXcpngConnections()
    } else if (addConnType === 'nutanix') {
      loadNutanixConnections()
    } else if (addConnType === 'hyperv') {
      loadHypervConnections()
    }

    // En mode onboarding, rediriger vers la page d'accueil après création
    if (isOnboarding && !editingConn?.id) {
      // Supprimer le cookie app_status pour forcer un refresh
      document.cookie = 'app_status=; path=/; max-age=0'
      router.push('/home')
    }
  }

  const createConnection = async () => {
    const payload = {
      name: addConn.name.trim(),
      type: addConnType,
      baseUrl: addConn.baseUrl.trim(),
      behindProxy: !!addConn.behindProxy,
      insecureTLS: !!addConn.insecureTLS,
      apiToken: addConn.apiToken.trim()
    }

    await fetchJson('/api/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    setAddConnOpen(false)
    setAddConn({ name: '', baseUrl: '', behindProxy: false, insecureTLS: true, apiToken: '' })

    if (addConnType === 'pve') {
      await loadPveConnections()
    } else {
      await loadPbsConnections()
    }
  }

  // Connection delete confirmation. Native window.confirm() was leaking
  // through here — see feedback_modals_mui rule. State holds the pending
  // deletion target until the user clicks Delete or Cancel in the MUI
  // dialog rendered below.
  const [deleteConnectionDialog, setDeleteConnectionDialog] = useState(null)
  const [deletingConnection, setDeletingConnection] = useState(false)

  const deleteConnection = (id, type) => {
    const typeName = type === 'pbs' ? 'PBS' : type === 'vmware' ? 'VMware ESXi' : type === 'xcpng' ? 'XCP-ng' : type === 'nutanix' ? 'Nutanix' : type === 'hyperv' ? 'Hyper-V' : 'PVE'
    setDeleteConnectionDialog({ id, type, typeName })
  }

  const confirmDeleteConnection = async () => {
    if (!deleteConnectionDialog) return
    const { id, type } = deleteConnectionDialog
    setDeletingConnection(true)
    try {
      await fetchJson(`/api/v1/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })

      if (type === 'pve') {
        await loadPveConnections()
      } else if (type === 'pbs') {
        await loadPbsConnections()
      } else if (type === 'vmware') {
        await loadVmwareConnections()
      } else if (type === 'xcpng') {
        await loadXcpngConnections()
      } else if (type === 'nutanix') {
        await loadNutanixConnections()
      } else if (type === 'hyperv') {
        await loadHypervConnections()
      }
      setDeleteConnectionDialog(null)
    } finally {
      setDeletingConnection(false)
    }
  }

  // Shared "Tenant / vDC" column definition factory
  const makeTenantVdcColumn = (tenantMap, vdcMap) => ({
    field: 'tenantVdc',
    headerName: t('settings.connTenantVdcHeader'),
    width: 200,
    sortable: false,
    renderCell: params => {
      const row = params.row
      const tid = row.tenantId
      const isMspOwned = tid && tid !== 'default'

      if (isMspOwned) {
        const name = tenantMap[tid] || tid
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: '100%', flexWrap: 'wrap' }}>
            <Chip size='small' label={t('settings.connectionOwnedBy', { name })} color='secondary' variant='outlined' sx={{ fontSize: '0.7rem', height: 20 }} />
          </Box>
        )
      }

      const vdcs = vdcMap[row.id]
      if (vdcs && vdcs.length > 0) {
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: '100%', flexWrap: 'wrap' }}>
            {vdcs.map((v, i) => {
              const tName = tenantMap[v.tenantId] || v.tenantId
              return (
                <Chip
                  key={i}
                  size='small'
                  label={`${tName} / ${v.vdcName}`}
                  color='info'
                  variant='outlined'
                  sx={{ fontSize: '0.7rem', height: 20 }}
                />
              )
            })}
          </Box>
        )
      }

      return (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='caption' sx={{ opacity: 0.4 }}>{t('settings.connPoolLabel')}</Typography>
        </Box>
      )
    }
  })

  // Diagnostic column (shared across all 6 grids)
  const makeDiagnosticColumn = () => ({
    field: 'diagnostic',
    headerName: '',
    width: 46,
    sortable: false,
    renderCell: params => (
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <Tooltip
          title={t('settings.diagnostics.runDiagnostics')}
          slotProps={{
            tooltip: {
              sx: {
                bgcolor: 'background.paper',
                color: 'text.primary',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                boxShadow: 3,
              }
            }
          }}
        >
          <IconButton
            size='small'
            onClick={(e) => { e.stopPropagation(); openDiagnostic(params.row.id, params.row.name) }}
            sx={{ width: 28, height: 28 }}
          >
            <i className='ri-heart-pulse-line' style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    )
  })

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
            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={18} height={18} style={{ opacity: 0.8 }} />
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
          </Box>
        )
      },
      makeTenantVdcColumn(tenantNameMap, vdcsByConnection),
      {
        field: 'baseUrl',
        headerName: t('settings.urlApi'),
        flex: 1.2,
        minWidth: 240,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography variant='body2' sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', opacity: 0.8 }}>
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
          <ConnectionStatus connection={params.row} autoTest={true} onNodesLoaded={loadPveConnections} />
        )
      },
      {
        field: 'version',
        headerName: t('common.version'),
        width: 120,
        sortable: false,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <ConnectionVersion connection={params.row} />
          </Box>
        )
      },
      {
        field: 'clusterType',
        headerName: t('common.type'),
        width: 120,
        sortable: false,
        valueGetter: (value, row) => {
          const hosts = row.hosts
          return hosts && hosts.length > 1 ? 'cluster' : 'standalone'
        },
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            {params.value === 'cluster' ? (
              <Chip size='small' label='Cluster' color='primary' variant='outlined' icon={<i className='ri-server-line' style={{ fontSize: 14 }} />} />
            ) : (
              <Chip size='small' label='Standalone' variant='outlined' icon={<i className='ri-computer-line' style={{ fontSize: 14 }} />} />
            )}
          </Box>
        )
      },
      {
        field: 'hosts',
        headerName: t('settings.nodesHeader'),
        width: 200,
        sortable: false,
        renderCell: params => {
          const hosts = params.value
          if (!hosts || hosts.length === 0) {
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                <Typography variant='caption' sx={{ opacity: 0.4 }}>--</Typography>
              </Box>
            )
          }
          const firstHost = hosts[0]
          const extraCount = hosts.length - 1
          // Full node list shown on hover so the row stays a single line even
          // for large clusters. One node per line: name, IP, and disabled flag.
          const nodeList = hosts
            .map(h => `${h.node}${h.ip ? ` - ${h.ip}` : ''}${h.enabled ? '' : ` (${t('common.disabled')})`}`)
            .join('\n')
          return (
            <Tooltip
              title={<span style={{ whiteSpace: 'pre-line' }}>{nodeList}</span>}
              arrow
              slotProps={{
                tooltip: { sx: { bgcolor: 'background.paper', color: 'text.primary', border: '1px solid', borderColor: 'divider', boxShadow: 3, maxWidth: 360 } },
                arrow: { sx: { color: 'background.paper', '&::before': { border: '1px solid', borderColor: 'divider' } } },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: '100%', minWidth: 0 }}>
                <Chip
                  size='small'
                  label={firstHost.node}
                  icon={<i className='ri-server-line' style={{ fontSize: 14 }} />}
                  variant='outlined'
                  color={firstHost.enabled ? 'default' : 'warning'}
                  sx={{ fontSize: '0.75rem', maxWidth: 130, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                />
                {extraCount > 0 && (
                  <Chip size='small' label={`+${extraCount}`} variant='outlined' sx={{ fontSize: '0.75rem' }} />
                )}
              </Box>
            </Tooltip>
          )
        }
      },
      {
        field: 'hasCeph',
        headerName: t('settings.cephHeader'),
        width: 110,
        renderCell: params => {
          const isDetecting = detectingCephId === params.row.id
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: '100%' }}>
              {params.value ? (
                <Chip size='small' label={t('common.yes')} color='info' variant='outlined' />
              ) : (
                <Typography variant='caption' sx={{ opacity: 0.4 }}>{t('common.no')}</Typography>
              )}
              {params.row.type === 'pve' && (
                <Tooltip title={t('settings.detectCeph')}>
                  <IconButton
                    size='small'
                    disabled={isDetecting}
                    onClick={(e) => { e.stopPropagation(); handleDetectCeph(params.row.id) }}
                    sx={{ width: 24, height: 24 }}
                  >
                    <i className={isDetecting ? 'ri-loader-4-line' : 'ri-refresh-line'} style={{ fontSize: 14, animation: isDetecting ? 'spin 1s linear infinite' : 'none' }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
      },
      {
        field: 'sshEnabled',
        headerName: t('settings.sshHeader'),
        width: 80,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            {params.value ? (
              <Chip size='small' label={t('common.yes')} color='success' variant='outlined' icon={<i className='ri-terminal-line' style={{ fontSize: 14 }} />} />
            ) : (
              <Typography variant='caption' sx={{ opacity: 0.4 }}>{t('common.no')}</Typography>
            )}
          </Box>
        )
      },
      {
        field: 'bridgeType',
        headerName: t('network.bridgeType'),
        width: 140,
        sortable: false,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <BridgeTypes connection={params.row} />
          </Box>
        )
      },
      {
        field: 'locationLabel',
        headerName: t('settings.location'),
        width: 180,
        renderCell: params => {
          const country = params.row.country
          const country3 = findCountry(country)?.code
          if (!params.value && !country3) {
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                <Typography variant='caption' sx={{ opacity: 0.3 }}>—</Typography>
              </Box>
            )
          }
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%', overflow: 'hidden' }}>
              {country3 && <CountryFlag code={country3} size={18} />}
              {params.value ? (
                <>
                  <i className='ri-map-pin-2-line' style={{ fontSize: 14, opacity: 0.6 }} />
                  <Typography variant='body2' noWrap>{params.value}</Typography>
                </>
              ) : country3 ? (
                <Typography variant='body2' sx={{ opacity: 0.7 }}>{country3}</Typography>
              ) : null}
            </Box>
          )
        },
      },
      makeDiagnosticColumn(),
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
    [t, loadPveConnections, theme, tenantNameMap, vdcsByConnection]
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
            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={18} height={18} style={{ opacity: 0.8 }} />
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
          </Box>
        )
      },
      makeTenantVdcColumn(tenantNameMap, vdcsByConnection),
      {
        field: 'baseUrl',
        headerName: t('settings.urlApi'),
        flex: 1.2,
        minWidth: 240,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography variant='body2' sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', opacity: 0.8 }}>
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
        field: 'version',
        headerName: t('common.version'),
        width: 120,
        sortable: false,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <ConnectionVersion connection={{ ...params.row, type: 'pbs' }} />
          </Box>
        )
      },
      {
        field: 'locationLabel',
        headerName: t('settings.location'),
        width: 180,
        renderCell: params => {
          const country = params.row.country
          const country3 = findCountry(country)?.code
          if (!params.value && !country3) {
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                <Typography variant='caption' sx={{ opacity: 0.3 }}>—</Typography>
              </Box>
            )
          }
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%', overflow: 'hidden' }}>
              {country3 && <CountryFlag code={country3} size={18} />}
              {params.value ? (
                <>
                  <i className='ri-map-pin-2-line' style={{ fontSize: 14, opacity: 0.6 }} />
                  <Typography variant='body2' noWrap>{params.value}</Typography>
                </>
              ) : country3 ? (
                <Typography variant='body2' sx={{ opacity: 0.7 }}>{country3}</Typography>
              ) : null}
            </Box>
          )
        },
      },
      makeDiagnosticColumn(),
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
    [t, theme, tenantNameMap, vdcsByConnection]
  )

  // VMware columns
  const vmwareColumns = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('common.name'),
        flex: 1,
        minWidth: 180,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
            <img src='/images/esxi-logo.svg' alt='' width={18} height={18} style={{ opacity: 0.8 }} />
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
          </Box>
        )
      },
      makeTenantVdcColumn(tenantNameMap, vdcsByConnection),
      {
        field: 'baseUrl',
        headerName: t('settings.esxiHost'),
        flex: 1.2,
        minWidth: 200,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography variant='body2' sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', opacity: 0.8 }}>
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
        field: 'sshEnabled',
        headerName: t('settings.sshHeader'),
        width: 80,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            {params.value ? (
              <Chip size='small' label={t('common.yes')} color='success' variant='outlined' icon={<i className='ri-terminal-line' style={{ fontSize: 14 }} />} />
            ) : (
              <Typography variant='caption' sx={{ opacity: 0.4 }}>{t('common.no')}</Typography>
            )}
          </Box>
        )
      },
      makeDiagnosticColumn(),
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
              <IconButton size='small' color='error' onClick={() => deleteConnection(params.row.id, 'vmware')}>
                <i className='ri-delete-bin-6-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )
      }
    ],
    [t, tenantNameMap, vdcsByConnection]
  )

  // XCP-ng columns
  const xcpngColumns = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('common.name'),
        flex: 1,
        minWidth: 180,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
            <img src='/images/xcpng-logo.svg' alt='' width={18} height={18} style={{ opacity: 0.8 }} />
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
          </Box>
        )
      },
      makeTenantVdcColumn(tenantNameMap, vdcsByConnection),
      {
        field: 'baseUrl',
        headerName: t('settings.xcpngHost'),
        flex: 1.2,
        minWidth: 200,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography variant='body2' sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', opacity: 0.8 }}>
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
        field: 'locationLabel',
        headerName: t('settings.location'),
        width: 180,
        renderCell: params => {
          const country = params.row.country
          const country3 = findCountry(country)?.code
          if (!params.value && !country3) {
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                <Typography variant='caption' sx={{ opacity: 0.3 }}>—</Typography>
              </Box>
            )
          }
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%', overflow: 'hidden' }}>
              {country3 && <CountryFlag code={country3} size={18} />}
              {params.value ? (
                <>
                  <i className='ri-map-pin-2-line' style={{ fontSize: 14, opacity: 0.6 }} />
                  <Typography variant='body2' noWrap>{params.value}</Typography>
                </>
              ) : country3 ? (
                <Typography variant='body2' sx={{ opacity: 0.7 }}>{country3}</Typography>
              ) : null}
            </Box>
          )
        },
      },
      makeDiagnosticColumn(),
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
              <IconButton size='small' color='error' onClick={() => deleteConnection(params.row.id, 'xcpng')}>
                <i className='ri-delete-bin-6-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )
      }
    ],
    [t, tenantNameMap, vdcsByConnection]
  )

  // Nutanix columns
  const nutanixColumns = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('common.name'),
        flex: 1,
        minWidth: 180,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
            <img src='/images/nutanix-logo.svg' alt='' width={18} height={18} style={{ opacity: 0.8 }} />
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
          </Box>
        )
      },
      makeTenantVdcColumn(tenantNameMap, vdcsByConnection),
      {
        field: 'baseUrl',
        headerName: 'Prism Central',
        flex: 1.2,
        minWidth: 200,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography variant='body2' sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', opacity: 0.8 }}>
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
      makeDiagnosticColumn(),
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
              <IconButton size='small' color='error' onClick={() => deleteConnection(params.row.id, 'nutanix')}>
                <i className='ri-delete-bin-6-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )
      }
    ],
    [t, tenantNameMap, vdcsByConnection]
  )

  // Hyper-V columns
  const hypervColumns = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('common.name'),
        flex: 1,
        minWidth: 180,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
            <i className='ri-microsoft-line' style={{ fontSize: 18, color: '#0078d4', opacity: 0.8 }} />
            <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.value}</Typography>
          </Box>
        )
      },
      makeTenantVdcColumn(tenantNameMap, vdcsByConnection),
      {
        field: 'baseUrl',
        headerName: 'Hyper-V Host',
        flex: 1.2,
        minWidth: 200,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography variant='body2' sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', opacity: 0.8 }}>
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
      makeDiagnosticColumn(),
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
              <IconButton size='small' color='error' onClick={() => deleteConnection(params.row.id, 'hyperv')}>
                <i className='ri-delete-bin-6-line' style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )
      }
    ],
    [t, tenantNameMap, vdcsByConnection]
  )

  return (
    <>
      {/* Sub-tabs PVE / PBS / VMware */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={connTab}
          onChange={(_, v) => setConnTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ '& .MuiTab-root': { minHeight: 48 } }}
        >
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={18} height={18} />
                <span>{t('settings.proxmoxVe')}</span>
                <Chip size='small' label={pveConnections.length} color='primary' sx={{ height: 18, fontSize: 10, ml: 0.5 }} />
              </Box>
            }
          />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={18} height={18} />
                <span>{t('settings.proxmoxBackupServer')}</span>
                <Chip size='small' label={pbsConnections.length} color='secondary' sx={{ height: 18, fontSize: 10, ml: 0.5 }} />
              </Box>
            }
          />
          <Tab
            disabled={!migrationAvailable}
            label={
              <Tooltip title={!migrationAvailable ? 'Enterprise' : ''} placement='top'>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: migrationAvailable ? 1 : 0.4 }}>
                  <img src='/images/esxi-logo.svg' alt='' width={18} height={18} />
                  <span>VMware ESXi</span>
                  {migrationAvailable ? (
                    <Chip size='small' label={vmwareConnections.length} sx={{ height: 18, fontSize: 10, ml: 0.5, bgcolor: '#638C1C', color: '#fff' }} />
                  ) : (
                    <i className='ri-lock-line' style={{ fontSize: 14, opacity: 0.5 }} />
                  )}
                </Box>
              </Tooltip>
            }
          />
          <Tab
            disabled={!migrationAvailable}
            label={
              <Tooltip title={!migrationAvailable ? 'Enterprise' : ''} placement='top'>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: migrationAvailable ? 1 : 0.4 }}>
                  <img src='/images/xcpng-logo.svg' alt='' width={18} height={18} />
                  <span>XCP-ng</span>
                  {migrationAvailable ? (
                    <Chip size='small' label={xcpngConnections.length} sx={{ height: 18, fontSize: 10, ml: 0.5, bgcolor: '#00ADB5', color: '#fff' }} />
                  ) : (
                    <i className='ri-lock-line' style={{ fontSize: 14, opacity: 0.5 }} />
                  )}
                </Box>
              </Tooltip>
            }
          />
          <Tab
            disabled={!migrationAvailable}
            label={
              <Tooltip title={!migrationAvailable ? 'Enterprise' : ''} placement='top'>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: migrationAvailable ? 1 : 0.4 }}>
                  <img src='/images/nutanix-logo.svg' alt='' width={18} height={18} />
                  <span>Nutanix</span>
                  {migrationAvailable ? (
                    <Chip size='small' label={nutanixConnections.length} sx={{ height: 18, fontSize: 10, ml: 0.5, bgcolor: '#24B47E', color: '#fff' }} />
                  ) : (
                    <i className='ri-lock-line' style={{ fontSize: 14, opacity: 0.5 }} />
                  )}
                </Box>
              </Tooltip>
            }
          />
          <Tab
            disabled={!migrationAvailable}
            label={
              <Tooltip title={!migrationAvailable ? 'Enterprise' : ''} placement='top'>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: migrationAvailable ? 1 : 0.4 }}>
                  <img src='/images/hyperv-logo.svg' alt='' width={18} height={18} />
                  <span>Hyper-V</span>
                  {migrationAvailable ? (
                    <Chip size='small' label={hypervConnections.length} sx={{ height: 18, fontSize: 10, ml: 0.5, bgcolor: '#0078d4', color: '#fff' }} />
                  ) : (
                    <i className='ri-lock-line' style={{ fontSize: 14, opacity: 0.5 }} />
                  )}
                </Box>
              </Tooltip>
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
          {!pveLoading && pveConnections.length === 0 ? (
            <EmptyState
              icon="ri-server-line"
              title={t('emptyState.noConnections')}
              description={t('emptyState.noConnectionsDesc')}
              action={{ label: `${t('common.add')} PVE`, onClick: () => openAddDialog('pve'), icon: 'ri-add-line' }}
              size="large"
            />
          ) : (
            <DataGrid
              rows={pveConnections}
              columns={pveColumns}
              loading={pveLoading}
              getRowId={r => r.id}
              getRowHeight={() => 'auto'}
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              disableRowSelectionOnClick
              sx={{
                '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' },
                '& .MuiDataGrid-cell': { py: 1 },
              }}
            />
          )}
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

        <Box sx={{ height: 'calc(100vh - 380px)', minHeight: 300 }}>
          {!pbsLoading && pbsConnections.length === 0 ? (
            <EmptyState
              icon="ri-hard-drive-2-line"
              title={t('emptyState.noConnections')}
              description={t('emptyState.noConnectionsDesc')}
              action={{ label: `${t('common.add')} PBS`, onClick: () => openAddDialog('pbs'), icon: 'ri-add-line' }}
              size="large"
            />
          ) : (
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
          )}
        </Box>
      </SubTabPanel>

      {/* VMware ESXi Tab */}
      <SubTabPanel value={connTab} index={2}>
        {vmwareError && <Alert severity='error' sx={{ mb: 2 }}>{t('common.error')}: {vmwareError}</Alert>}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {t('settings.vmwareServers')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant='outlined' size='small' onClick={loadVmwareConnections} disabled={vmwareLoading} startIcon={<i className='ri-refresh-line' />}>
              {t('common.refresh')}
            </Button>
            <Button variant='contained' size='small' sx={{ bgcolor: '#638C1C', '&:hover': { bgcolor: '#4a6915' } }} onClick={() => openAddDialog('vmware')} startIcon={<i className='ri-add-line' />}>
              {t('common.add')} ESXi
            </Button>
          </Box>
        </Box>

        <Box sx={{ height: 'calc(100vh - 380px)', minHeight: 300 }}>
          {!vmwareLoading && vmwareConnections.length === 0 ? (
            <EmptyState
              icon="ri-cloud-line"
              title={t('settings.noVmwareConnections')}
              description={t('settings.noVmwareConnectionsDesc')}
              action={{ label: `${t('common.add')} ESXi`, onClick: () => openAddDialog('vmware'), icon: 'ri-add-line' }}
              size="large"
            />
          ) : (
            <DataGrid
              rows={vmwareConnections}
              columns={vmwareColumns}
              loading={vmwareLoading}
              getRowId={r => r.id}
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              disableRowSelectionOnClick
              sx={{ '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
            />
          )}
        </Box>
      </SubTabPanel>

      {/* XCP-ng Tab */}
      <SubTabPanel value={connTab} index={3}>
        {xcpngError && <Alert severity='error' sx={{ mb: 2 }}>{t('common.error')}: {xcpngError}</Alert>}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {t('settings.xcpngServers')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant='outlined' size='small' onClick={loadXcpngConnections} disabled={xcpngLoading} startIcon={<i className='ri-refresh-line' />}>
              {t('common.refresh')}
            </Button>
            <Button variant='contained' size='small' sx={{ bgcolor: '#00ADB5', '&:hover': { bgcolor: '#008B92' } }} onClick={() => openAddDialog('xcpng')} startIcon={<i className='ri-add-line' />}>
              {t('common.add')} XCP-ng
            </Button>
          </Box>
        </Box>

        <Box sx={{ height: 'calc(100vh - 380px)', minHeight: 300 }}>
          {!xcpngLoading && xcpngConnections.length === 0 ? (
            <EmptyState
              icon="ri-server-line"
              title={t('settings.noXcpngConnections')}
              description={t('settings.noXcpngConnectionsDesc')}
              action={{ label: `${t('common.add')} XCP-ng`, onClick: () => openAddDialog('xcpng'), icon: 'ri-add-line' }}
              size="large"
            />
          ) : (
            <DataGrid
              rows={xcpngConnections}
              columns={xcpngColumns}
              loading={xcpngLoading}
              getRowId={r => r.id}
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              disableRowSelectionOnClick
              sx={{ '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
            />
          )}
        </Box>
      </SubTabPanel>

      {/* Nutanix Tab */}
      <SubTabPanel value={connTab} index={4}>
        {nutanixError && <Alert severity='error' sx={{ mb: 2 }}>{t('common.error')}: {nutanixError}</Alert>}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            Nutanix Prism Central Connections
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant='outlined' size='small' onClick={loadNutanixConnections} disabled={nutanixLoading} startIcon={<i className='ri-refresh-line' />}>
              {t('common.refresh')}
            </Button>
            <Button variant='contained' size='small' sx={{ bgcolor: '#24B47E', '&:hover': { bgcolor: '#1a8f63' } }} onClick={() => openAddDialog('nutanix')} startIcon={<i className='ri-add-line' />}>
              {t('common.add')} Nutanix
            </Button>
          </Box>
        </Box>

        <Box sx={{ height: 'calc(100vh - 380px)', minHeight: 300 }}>
          {!nutanixLoading && nutanixConnections.length === 0 ? (
            <EmptyState
              icon="ri-database-2-line"
              title="No Nutanix connections"
              description="Add a Nutanix Prism Central connection to migrate VMs to Proxmox VE."
              action={{ label: `${t('common.add')} Nutanix`, onClick: () => openAddDialog('nutanix'), icon: 'ri-add-line' }}
              size="large"
            />
          ) : (
            <DataGrid
              rows={nutanixConnections}
              columns={nutanixColumns}
              loading={nutanixLoading}
              getRowId={r => r.id}
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              disableRowSelectionOnClick
              sx={{ '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
            />
          )}
        </Box>
      </SubTabPanel>

      {/* Hyper-V Tab */}
      <SubTabPanel value={connTab} index={5}>
        {hypervError && <Alert severity='error' sx={{ mb: 2 }}>{t('common.error')}: {hypervError}</Alert>}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            Hyper-V Servers
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant='outlined' size='small' onClick={loadHypervConnections} disabled={hypervLoading} startIcon={<i className='ri-refresh-line' />}>
              {t('common.refresh')}
            </Button>
            <Button variant='contained' size='small' sx={{ bgcolor: '#0078d4', '&:hover': { bgcolor: '#005a9e' } }} onClick={() => openAddDialog('hyperv')} startIcon={<i className='ri-add-line' />}>
              {t('common.add')} Hyper-V
            </Button>
          </Box>
        </Box>

        <Box sx={{ height: 'calc(100vh - 380px)', minHeight: 300 }}>
          {!hypervLoading && hypervConnections.length === 0 ? (
            <EmptyState
              icon="ri-microsoft-line"
              title="No Hyper-V connections"
              description="Add a Hyper-V server to start migrating VMs to Proxmox."
              action={{ label: `${t('common.add')} Hyper-V`, onClick: () => openAddDialog('hyperv'), icon: 'ri-add-line' }}
              size="large"
            />
          ) : (
            <DataGrid
              rows={hypervConnections}
              columns={hypervColumns}
              loading={hypervLoading}
              getRowId={r => r.id}
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              disableRowSelectionOnClick
              sx={{ '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
            />
          )}
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

      {/* Diagnostic modal */}
      <DiagnosticModal
        open={diagOpen}
        connectionId={diagConnectionId}
        connectionName={diagConnectionName}
        onClose={() => setDiagOpen(false)}
      />

      {/* Dialog confirmation suppression connexion — remplace l'ancien
          window.confirm. Le titre i18n existant t('settings.deleteConnectionConfirm')
          est interpolé avec le typeName (PVE / PBS / VMware / …). */}
      <Dialog
        open={!!deleteConnectionDialog}
        onClose={() => !deletingConnection && setDeleteConnectionDialog(null)}
        maxWidth='xs'
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <i className='ri-delete-bin-line' style={{ fontSize: 20 }} />
          {t('settings.deleteConnectionConfirm', { type: deleteConnectionDialog?.typeName || '' })}
        </DialogTitle>
        <DialogContent>
          <Alert severity='warning' sx={{ mt: 1 }}>
            {t('common.deleteConfirmation')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConnectionDialog(null)} disabled={deletingConnection}>
            {t('common.cancel')}
          </Button>
          <Button
            variant='contained'
            color='error'
            onClick={confirmDeleteConnection}
            disabled={deletingConnection}
          >
            {deletingConnection ? t('common.loading') : t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

/* ==================== LicenseTab Component ==================== */

// Feature categories for organized display
const FEATURE_CATEGORIES = [
  {
    key: 'infrastructure',
    icon: 'ri-server-line',
    features: ['dashboard', 'inventory', 'backups', 'storage'],
  },
  {
    key: 'automation',
    icon: 'ri-robot-line',
    features: ['drs', 'rolling_updates', 'cross_cluster_migration', 'jobs'],
  },
  {
    key: 'security',
    icon: 'ri-shield-check-line',
    features: ['firewall', 'microsegmentation', 'cve_scanner', 'rbac', 'ldap'],
  },
  {
    key: 'monitoring',
    icon: 'ri-line-chart-line',
    features: ['ai_insights', 'predictive_alerts', 'alerts', 'notifications', 'reports', 'green_metrics'],
  },
  {
    key: 'disaster_recovery',
    icon: 'ri-shield-star-line',
    features: ['ceph_replication'],
  },
]

// FEATURE_LABELS and CATEGORY_LABELS are now resolved via t() inside the component
const FEATURE_LABEL_KEYS = {
  dashboard: 'settings.featureLabels.dashboard',
  inventory: 'settings.featureLabels.inventory',
  backups: 'settings.featureLabels.backups',
  storage: 'settings.featureLabels.storage',
  drs: 'settings.featureLabels.drs',
  rolling_updates: 'settings.featureLabels.rolling_updates',
  cross_cluster_migration: 'settings.featureLabels.cross_cluster_migration',
  jobs: 'settings.featureLabels.jobs',
  firewall: 'settings.featureLabels.firewall',
  microsegmentation: 'settings.featureLabels.microsegmentation',
  cve_scanner: 'settings.featureLabels.cve_scanner',
  rbac: 'settings.featureLabels.rbac',
  ldap: 'settings.featureLabels.ldap',
  ai_insights: 'settings.featureLabels.ai_insights',
  predictive_alerts: 'settings.featureLabels.predictive_alerts',
  alerts: 'settings.featureLabels.alerts',
  notifications: 'settings.featureLabels.notifications',
  reports: 'settings.featureLabels.reports',
  green_metrics: 'settings.featureLabels.green_metrics',
  ceph_replication: 'settings.featureLabels.ceph_replication',
}

const CATEGORY_LABEL_KEYS = {
  infrastructure: 'settings.categoryLabels.infrastructure',
  automation: 'settings.categoryLabels.automation',
  security: 'settings.categoryLabels.security',
  monitoring: 'settings.categoryLabels.monitoring',
  disaster_recovery: 'settings.categoryLabels.disaster_recovery',
}

function LicenseTab() {
  const t = useTranslations()
  const theme = useTheme()
  const [licenseKey, setLicenseKey] = useState('')
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false)

  const {
    licenseStatus,
    features,
    loading,
    error,
    success,
    activating,
    setError,
    setSuccess,
    handleActivate: hookActivate,
    handleDeactivate: hookDeactivate,
    loadLicenseStatus,
  } = useLicenseManagement()

  const handleActivate = async () => {
    const result = await hookActivate(licenseKey)

    if (result.success) {
      setSuccess(t('settings.licenseActivated'))
      setLicenseKey('')
    } else {
      setError(result.error || t('settings.activationFailed'))
    }
  }

  const handleDeactivate = async () => {
    setDeactivateDialogOpen(false)
    const result = await hookDeactivate()

    if (result.success) {
      setSuccess(t('settings.licenseDeactivated'))
    } else {
      setError(result.error || t('settings.deactivationFailed'))
    }
  }

  const isEnterprise = licenseStatus?.edition === 'enterprise' || licenseStatus?.edition === 'enterprise_plus'
  const isLicensed = licenseStatus?.licensed && !licenseStatus?.expired

  // Build feature lookup from features array
  const featureMap = useMemo(() => {
    const map = {}
    for (const f of features) map[f.id] = f
    return map
  }, [features])

  const enabledCount = features.filter(f => f.enabled).length
  const totalCount = features.length || Object.keys(FEATURE_LABEL_KEYS).length

  // Node usage
  const nodeStatus = licenseStatus?.node_status
  const maxNodes = licenseStatus?.limits?.max_nodes || 0
  const currentNodes = nodeStatus?.current_nodes || 0
  const nodeUsagePct = maxNodes > 0 ? Math.min(100, Math.round((currentNodes / maxNodes) * 100)) : 0

  // ── Multi-license (Pillar C) ──
  const [mlEnabled, setMlEnabled] = useState(false)
  const [imports, setImports] = useState([])
  const [pveConns, setPveConns] = useState([])      // for the import modal's cluster picker + rollup
  const [tenantNames, setTenantNames] = useState({})
  const [importOpen, setImportOpen] = useState(false)
  const [importBlob, setImportBlob] = useState('')
  const [importConnId, setImportConnId] = useState('')
  const [importing, setImporting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null) // {rowId, licenseId} | null
  const [editMapTarget, setEditMapTarget] = useState(null) // {rowId, licenseId} | null
  const [editMapSelected, setEditMapSelected] = useState([])
  const [savingMap, setSavingMap] = useState(false)

  const loadImports = async () => {
    try {
      const res = await fetch('/api/v1/license/imports')
      if (isMultiLicenseEnabled(res.status)) {
        const data = await res.json().catch(() => ({}))
        setMlEnabled(true)
        setImports(Array.isArray(data?.imports) ? data.imports : [])
      } else {
        setMlEnabled(false)
        setImports([])
      }
    } catch {
      setMlEnabled(false)
    }
  }

  useEffect(() => { loadImports() }, [])
  useEffect(() => {
    if (!mlEnabled) return
    fetch('/api/v1/connections')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setPveConns((j?.data || []).filter(c => c.type === 'pve')))
      .catch(() => {})
    fetch('/api/v1/tenants')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const m = {}
        for (const tt of (j?.data || [])) m[tt.id] = tt.name
        setTenantNames(m)
      })
      .catch(() => {})
  }, [mlEnabled])

  const licenseRows = useMemo(() => buildLicenseTableRows(licenseStatus || {}, imports), [licenseStatus, imports])
  const connName = useMemo(() => {
    const m = {}
    for (const c of pveConns) m[c.id] = c.name
    return m
  }, [pveConns])

  // connectionId -> import rowId (import rows only; connections under the primary stay freely mappable)
  const connToImport = useMemo(() => {
    const m = {}
    for (const r of licenseRows) {
      if (r.role !== 'import') continue
      for (const cid of r.connectionIds || []) m[cid] = r.rowId
    }
    return m
  }, [licenseRows])

  const perTenant = useMemo(() => {
    const perLicense = licenseStatus?.node_status?.per_license || []
    const connToTenant = {}
    for (const c of pveConns) connToTenant[c.id] = c.tenantId
    return computePerTenantRollup(perLicense, connToTenant, tenantNames)
  }, [licenseStatus, pveConns, tenantNames])

  const submitImport = async () => {
    setImporting(true); setError(null); setSuccess(null)
    try {
      const cleaned = importBlob.split('\n').map(l => l.trimEnd()).join('\n').trim()
      const res = await fetch('/api/v1/license/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license: cleaned, connection_id: importConnId || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || t('settings.licenseImportFailed'))
      setImportOpen(false); setImportBlob(''); setImportConnId('')
      setSuccess(t('settings.licenseImportSuccess'))
      await loadImports(); await loadLicenseStatus()
    } catch (e) {
      setError(e?.message || t('settings.licenseImportFailed'))
    } finally { setImporting(false) }
  }

  const confirmRemove = async () => {
    const target = removeTarget
    setRemoveTarget(null)
    if (!target) return
    try {
      const res = await fetch(`/api/v1/license/import/${encodeURIComponent(target.rowId)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || t('settings.licenseRemoveFailed'))
      setSuccess(t('settings.licenseRemoveSuccess'))
      await loadImports(); await loadLicenseStatus()
    } catch (e) {
      setError(e?.message || t('settings.licenseRemoveFailed'))
    }
  }

  const openEditMapping = (row) => {
    setEditMapTarget({ rowId: row.rowId, licenseId: row.licenseId })
    setEditMapSelected(row.connectionIds || [])
  }
  const toggleMapConn = (cid) => {
    setEditMapSelected(prev => (prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]))
  }
  const submitEditMapping = async () => {
    if (!editMapTarget) return
    setSavingMap(true); setError(null); setSuccess(null)
    try {
      const res = await fetch(`/api/v1/license/import/${encodeURIComponent(editMapTarget.rowId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_ids: editMapSelected }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || t('settings.licenseMappingFailed'))
      setEditMapTarget(null)
      setSuccess(t('settings.licenseMappingSuccess'))
      await loadImports(); await loadLicenseStatus()
    } catch (e) {
      setError(e?.message || t('settings.licenseMappingFailed'))
    } finally { setSavingMap(false) }
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
      {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity='success' sx={{ mb: 2 }}>{success}</Alert>}

      {/* ── License Header Card (fallback when multi-license data is unavailable, e.g. Community / no orchestrator) ── */}
      {!mlEnabled && (
      <Card variant='outlined' sx={{ mb: 3, overflow: 'visible' }}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5, flexWrap: 'wrap' }}>
            <Box sx={{
              width: 52, height: 52, borderRadius: 2,
              background: isEnterprise
                ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                : 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: isEnterprise ? '0 4px 14px rgba(99,102,241,0.3)' : '0 4px 14px rgba(245,158,11,0.3)',
            }}>
              <i className={isEnterprise ? 'ri-vip-crown-2-fill' : 'ri-key-2-line'} style={{ fontSize: 26, color: 'white' }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant='h6' fontWeight={700}>
                {isEnterprise ? t('settings.enterpriseEdition') : t('settings.communityEdition')}
              </Typography>
              <Typography variant='body2' sx={{ opacity: 0.7 }}>
                {isLicensed ? (
                  <>{t('settings.licensedTo')}: <strong>{licenseStatus.customer?.name || 'Unknown'}</strong></>
                ) : (
                  t('settings.communityLicenseDesc')
                )}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              {isLicensed ? (
                <>
                  {licenseStatus.expired ? (
                    <Chip label={t('settings.expired')} color='error' size='small' icon={<i className='ri-close-circle-line' />} />
                  ) : licenseStatus.expiration_warn ? (
                    <Chip label={`${licenseStatus.days_remaining} ${t('settings.daysLeft')}`} color='warning' size='small' icon={<i className='ri-timer-line' />} />
                  ) : (
                    <Chip label={t('settings.activeLicense')} color='success' size='small' icon={<i className='ri-checkbox-circle-line' />} />
                  )}
                  {licenseStatus.expires_at && (
                    <Typography variant='caption' display='block' sx={{ opacity: 0.6, mt: 0.5 }}>
                      {t('settings.expiresOn')}: {new Date(licenseStatus.expires_at).toLocaleDateString()}
                    </Typography>
                  )}
                </>
              ) : (
                <Chip label={t('settings.community')} color='default' size='small' variant='outlined' />
              )}
            </Box>
          </Box>

          {licenseStatus?.is_nfr && (
            <Chip
              size='small'
              color='warning'
              label='NFR / Not For Resale'
              sx={{ mb: 2, fontWeight: 600 }}
            />
          )}

          {isLicensed && licenseStatus.license_id && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: 'action.hover' }}>
              <i className='ri-fingerprint-line' style={{ fontSize: 16, opacity: 0.5 }} />
              <Typography variant='caption' sx={{ opacity: 0.5, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.5 }}>
                {licenseStatus.license_id}
              </Typography>
            </Box>
          )}

          {/* ── KPI Row ── */}
          {isLicensed && (
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {/* Node Quota Card */}
              <Box sx={{
                flex: 1, minWidth: 200, p: 2, borderRadius: 2,
                border: 1, borderColor: nodeStatus?.exceeded ? 'error.main' : 'divider',
                bgcolor: nodeStatus?.exceeded ? 'error.50' : 'transparent',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <i className='ri-server-line' style={{ fontSize: 18, opacity: 0.6 }} />
                  <Typography variant='caption' fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>
                    {t('settings.nodeQuota')}
                  </Typography>
                </Box>
                {maxNodes > 0 ? (
                  <>
                    <Typography variant='h5' fontWeight={700} sx={{ mb: 0.5 }}>
                      {currentNodes} <Typography component='span' variant='body2' sx={{ opacity: 0.5, fontWeight: 400 }}>/ {maxNodes}</Typography>
                    </Typography>
                    <LinearProgress
                      variant='determinate'
                      value={nodeUsagePct}
                      sx={{
                        height: 6, borderRadius: 3, mb: 0.5,
                        bgcolor: 'action.hover',
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 3,
                          bgcolor: nodeUsagePct >= 90 ? 'error.main' : nodeUsagePct >= 70 ? 'warning.main' : 'primary.main',
                        },
                      }}
                    />
                    <Typography variant='caption' sx={{ opacity: 0.5 }}>
                      {t('settings.percentUsed', { percent: nodeUsagePct })}
                    </Typography>
                  </>
                ) : (
                  <Typography variant='h5' fontWeight={700}>
                    <i className='ri-infinity-line' style={{ fontSize: 20, marginRight: 6 }} />
                    {t('settings.unlimitedNodes')}
                  </Typography>
                )}
              </Box>

              {/* Days Remaining */}
              {licenseStatus.expires_at && (() => {
                const expiresAt = new Date(licenseStatus.expires_at)
                const now = new Date()
                const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)))
                const startDate = licenseStatus.activated_at ? new Date(licenseStatus.activated_at) : new Date(expiresAt.getTime() - 365 * 24 * 60 * 60 * 1000)
                const totalDays = Math.max(1, Math.ceil((expiresAt - startDate) / (1000 * 60 * 60 * 24)))
                const remainPct = Math.max(0, Math.min(100, Math.round((daysRemaining / totalDays) * 100)))
                return (
                  <Box sx={{ flex: 1, minWidth: 200, p: 2, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <i className='ri-calendar-check-line' style={{ fontSize: 18, opacity: 0.6 }} />
                      <Typography variant='caption' fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>
                        {t('settings.licenseValidity')}
                      </Typography>
                    </Box>
                    <Typography variant='h5' fontWeight={700} sx={{ mb: 0.5 }} color={
                      licenseStatus.expired ? 'error.main' : licenseStatus.expiration_warn ? 'warning.main' : 'text.primary'
                    }>
                      {licenseStatus.expired ? t('settings.licenseExpired') : t('settings.licenseDays', { count: daysRemaining })}
                    </Typography>
                    <LinearProgress
                      variant='determinate'
                      value={remainPct}
                      sx={{
                        height: 6, borderRadius: 3, mb: 0.5,
                        bgcolor: 'action.hover',
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 3,
                          bgcolor: remainPct <= 10 ? 'error.main' : remainPct <= 25 ? 'warning.main' : 'success.main',
                        },
                      }}
                    />
                    <Typography variant='caption' sx={{ opacity: 0.5 }}>
                      {licenseStatus.expired ? t('settings.pleaseRenewLicense') : t('settings.untilDate', { date: new Date(licenseStatus.expires_at).toLocaleDateString() })}
                    </Typography>
                  </Box>
                )
              })()}
            </Box>
          )}

          {/* Node upgrade CTA */}
          {isLicensed && maxNodes > 0 && nodeStatus?.exceeded && (
            <Alert severity='warning' sx={{ mt: 2 }}
              action={
                <Button size='small' color='warning' href='https://proxcenter.io/account/subscribe' target='_blank' startIcon={<i className='ri-shopping-cart-line' />}>
                  {t('settings.upgradeNodes')}
                </Button>
              }
            >
              {t('settings.nodeQuotaExceeded', { current: currentNodes, max: maxNodes })}
            </Alert>
          )}
        </CardContent>
      </Card>
      )}

      {/* ── Multi-license: fleet capacity + all licenses ── */}
      {isLicensed && mlEnabled && (
        <Card variant='outlined' sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            {/* Read-only warning, only when the fleet quota is actually exceeded */}
            {nodeStatus?.exceeded && (nodeStatus?.max_nodes || 0) > 0 && (
              <Alert severity='warning' sx={{ mb: 2 }}>
                {t('settings.licenseFleetExceeded')} ({nodeStatus.current_nodes} / {nodeStatus.max_nodes})
              </Alert>
            )}

            {/* All-licenses table */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
              <Typography variant='subtitle1' fontWeight={700} sx={{ flex: 1 }}>{t('settings.licensesTableTitle')}</Typography>
              <Button size='small' variant='contained' startIcon={<i className='ri-add-line' />} onClick={() => { setImportBlob(''); setImportConnId(''); setImportOpen(true) }}>
                {t('settings.licenseImportBtn')}
              </Button>
            </Box>
            <DataGrid
              autoHeight
              rows={licenseRows}
              getRowId={r => r.rowId}
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              columns={[
                { field: 'role', headerName: t('settings.licenseColRole'), width: 110,
                  renderCell: p => <Chip size='small' variant='outlined' color={p.row.role === 'primary' ? 'primary' : 'default'}
                    label={p.row.role === 'primary' ? t('settings.licenseRolePrimary') : t('settings.licenseRoleImport')} /> },
                { field: 'licenseId', headerName: t('settings.licenseColId'), flex: 1, minWidth: 160 },
                { field: 'licensedTo', headerName: t('settings.licenseColLicensedTo'), flex: 1, minWidth: 140, sortable: false,
                  renderCell: p => p.row.licensedTo || '—' },
                { field: 'nodes', headerName: t('settings.licenseColNodes'), width: 150, sortable: false,
                  renderCell: p => p.row.unlimited ? <span><i className='ri-infinity-line' /></span> : <span>{p.row.usedNodes} / {p.row.maxNodes}</span> },
                { field: 'mapped', headerName: t('settings.licenseColMapped'), flex: 1, minWidth: 160, sortable: false,
                  renderCell: p => {
                    const ids = p.row.connectionIds || []
                    if (ids.length === 0) return <Typography variant='caption' sx={{ opacity: 0.5 }}>{t('settings.licenseUnmappedFloating')}</Typography>
                    return <Typography variant='caption'>{ids.map(id => connName[id] || id).join(', ')}</Typography>
                  } },
                { field: 'expiresAt', headerName: t('settings.licenseColExpires'), width: 120, sortable: false,
                  renderCell: p => p.row.expiresAt ? new Date(p.row.expiresAt).toLocaleDateString() : '—' },
                { field: 'state', headerName: t('settings.licenseColStatus'), width: 110, sortable: false,
                  renderCell: p => <Chip size='small' color={p.row.state === 'active' ? 'success' : 'default'} label={p.row.state} /> },
                { field: 'actions', headerName: '', width: 110, sortable: false,
                  renderCell: p => p.row.role === 'import' ? (
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title={t('settings.licenseEditMapping')}>
                        <IconButton size='small' onClick={() => openEditMapping(p.row)}><i className='ri-links-line' /></IconButton>
                      </Tooltip>
                      <Tooltip title={t('settings.licenseRemoveImport')}>
                        <IconButton size='small' color='error' onClick={() => setRemoveTarget({ rowId: p.row.rowId, licenseId: p.row.licenseId })}><i className='ri-delete-bin-line' /></IconButton>
                      </Tooltip>
                    </Box>
                  ) : (
                    <Tooltip title={t('settings.deactivateLicense')}>
                      <IconButton size='small' color='error' onClick={() => setDeactivateDialogOpen(true)}><i className='ri-delete-bin-line' /></IconButton>
                    </Tooltip>
                  ) },
              ]}
              sx={{ '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
            />

            {perTenant.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <i className='ri-group-line' style={{ fontSize: 18, opacity: 0.6 }} />
                  <Typography variant='subtitle1' fontWeight={700}>{t('settings.licensePerTenantTitle')}</Typography>
                </Box>
                <Typography variant='caption' sx={{ opacity: 0.6, display: 'block', mb: 1 }}>{t('settings.licensePerTenantHint')}</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {perTenant.map(row => (
                    <Box key={row.tenantId} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, borderRadius: 1, border: 1, borderColor: 'divider' }}>
                      <Chip size='small' color='secondary' variant='outlined' label={row.tenantName} />
                      <Typography variant='body2' fontWeight={600}>
                        {row.unlimited ? <i className='ri-infinity-line' /> : `${row.usedNodes} / ${row.maxNodes}`}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography variant='caption' sx={{ opacity: 0.6 }}>
                        {t('settings.licensePerTenantCoveredBy', { ids: row.licenseIds.join(', ') })}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── License Actions (fallback: only when the multi-license view is not active) ── */}
      {isLicensed && !mlEnabled && (
        <Card variant='outlined' sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2 }}>
              <i className='ri-settings-3-line' style={{ marginRight: 8, opacity: 0.6 }} />
              {t('settings.licenseManagementTitle')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                variant='outlined'
                size='small'
                href='https://proxcenter.io/account/subscribe'
                target='_blank'
                startIcon={<i className='ri-shopping-cart-line' />}
              >
                {t('settings.manageSubscription')}
              </Button>
              <Box sx={{ flex: 1 }} />
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
          </CardContent>
        </Card>
      )}

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

      {/* Import additional license */}
      <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-add-circle-line' style={{ fontSize: 22 }} />
          {t('settings.licenseImportDialogTitle')}
        </DialogTitle>
        <DialogContent>
          <TextField fullWidth multiline rows={4} sx={{ mt: 1, mb: 2 }}
            label={t('settings.licenseImportBlobLabel')}
            placeholder={t('settings.licenseImportBlobPlaceholder')}
            value={importBlob}
            onChange={e => setImportBlob(e.target.value)}
          />
          <FormControl fullWidth size='small'>
            <InputLabel>{t('settings.licenseImportConnLabel')}</InputLabel>
            <Select label={t('settings.licenseImportConnLabel')} value={importConnId} onChange={e => setImportConnId(e.target.value)}>
              <MenuItem value=''>{t('settings.licenseImportConnNone')}</MenuItem>
              {pveConns.map(c => {
                const isCluster = (c.hosts?.length || 0) > 1
                return (
                  <MenuItem key={c.id} value={c.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {isCluster
                        ? <i className='ri-server-line' style={{ fontSize: 16, opacity: 0.7 }} />
                        : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={16} height={16} />}
                      {c.name}
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setImportOpen(false)} variant='outlined'>{t('common.cancel')}</Button>
          <Button onClick={submitImport} variant='contained' disabled={!importBlob.trim() || importing}
            startIcon={importing ? <i className='ri-loader-4-line' /> : <i className='ri-check-line' />}>
            {t('settings.licenseImportSubmit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remove import confirmation */}
      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)} maxWidth='xs' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-error-warning-line' style={{ color: 'var(--mui-palette-error-main)', fontSize: 22 }} />
          {t('settings.licenseRemoveImport')}
        </DialogTitle>
        <DialogContent><Typography>{t('settings.licenseRemoveConfirm')}</Typography></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemoveTarget(null)} variant='outlined'>{t('common.cancel')}</Button>
          <Button onClick={confirmRemove} variant='contained' color='error' startIcon={<i className='ri-delete-bin-line' />}>
            {t('settings.licenseRemoveImport')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit license mapping */}
      <Dialog open={!!editMapTarget} onClose={() => setEditMapTarget(null)} maxWidth='sm' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-links-line' style={{ fontSize: 22 }} />
          {t('settings.licenseEditMappingTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant='caption' sx={{ opacity: 0.7, display: 'block', mb: 1.5 }}>{t('settings.licenseEditMappingHint')}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {pveConns.map(c => {
              const takenByOther = !!(editMapTarget && connToImport[c.id] && connToImport[c.id] !== editMapTarget.rowId)
              return (
                <FormControlLabel key={c.id}
                  control={<Checkbox size='small' checked={editMapSelected.includes(c.id)} disabled={takenByOther} onChange={() => toggleMapConn(c.id)} />}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {(c.hosts?.length || 0) > 1
                        ? <i className='ri-server-line' style={{ fontSize: 16, opacity: 0.7 }} />
                        : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={16} height={16} />}
                      <span>{takenByOther ? `${c.name} (${t('settings.licenseConnCoveredByOther')})` : c.name}</span>
                    </Box>
                  } />
              )
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditMapTarget(null)} variant='outlined'>{t('common.cancel')}</Button>
          <Button onClick={submitEditMapping} variant='contained' disabled={savingMap}
            startIcon={savingMap ? <i className='ri-loader-4-line' /> : <i className='ri-check-line' />}>
            {t('settings.licenseMappingSave')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Activate License (only show if not licensed) */}
      {!isLicensed && (
        <Card variant='outlined'>
          <CardContent sx={{ p: 3 }}>
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
                sx: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem' }
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
              {t('settings.needLicense')} <a href='https://www.proxcenter.io/' target='_blank' rel='noopener noreferrer' style={{ color: '#e57000' }}>{t('settings.viewPricing')}</a>
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

  const {
    settings,
    setSettings,
    testing,
    testResult,
    setTestResult,
    saving,
    availableModels,
    loadingModels,
    saveSettings: hookSaveSettings,
    testConnection: hookTestConnection,
    loadModels,
  } = useAISettings()

  const saveSettings = async () => {
    const result = await hookSaveSettings()

    if (result.success) {
      setTestResult({ type: 'success', message: t('settings.saved') })
    } else {
      setTestResult({ type: 'error', message: result.error || t('common.error') })
    }
  }

  const testConnection = async () => {
    const result = await hookTestConnection()

    if (result.success) {
      setTestResult({ type: 'success', message: `${t('settings.connectionOk')} "${result.response?.substring(0, 100)}..."` })
    } else {
      setTestResult({ type: 'error', message: result.error || t('settings.connectionError') })
    }
  }

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

      {/* Data Disclosure Notice */}
      {settings.enabled && (
        <Alert
          severity={settings.provider === 'ollama' ? 'success' : 'warning'}
          icon={<i className={settings.provider === 'ollama' ? 'ri-shield-check-line' : 'ri-error-warning-line'} />}
          sx={{ mb: 3 }}
        >
          <Typography variant='subtitle2' fontWeight={700} sx={{ mb: 0.5 }}>
            {t('settings.aiDataDisclosureTitle')}
          </Typography>
          {settings.provider === 'ollama' ? (
            <Typography variant='body2'>
              {t('settings.aiDataDisclosureLocal')}
            </Typography>
          ) : (
            <>
              <Typography variant='body2' sx={{ mb: 1 }}>
                {t('settings.aiDataDisclosureCloud')}
              </Typography>
              <Box component='ul' sx={{ m: 0, pl: 2 }}>
                {t('settings.aiDataDisclosureItems').split(';').map((item, i) => (
                  <li key={i}><Typography variant='body2'>{item}</Typography></li>
                ))}
              </Box>
              <Typography variant='body2' sx={{ mt: 1, fontStyle: 'italic' }}>
                {t('settings.aiDataDisclosureRecommendation')}
              </Typography>
            </>
          )}
        </Alert>
      )}

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
                    <Typography variant='body2'>
                      {t.rich('settings.ollamaInfo', { b: chunks => <b>{chunks}</b> })}
                    </Typography>
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
                      {availableModels.length > 0
                        ? availableModels.map(m => (
                          <MenuItem key={m} value={m}>{m}</MenuItem>
                        ))
                        : [
                          <MenuItem key='mistral:7b' value='mistral:7b'>mistral:7b ({t('settings.recommended')})</MenuItem>,
                          <MenuItem key='llama3.1:8b' value='llama3.1:8b'>llama3.1:8b</MenuItem>,
                          <MenuItem key='qwen2.5:7b' value='qwen2.5:7b'>qwen2.5:7b</MenuItem>,
                          <MenuItem key='phi3:14b' value='phi3:14b'>phi3:14b</MenuItem>,
                        ]}
                    </Select>
                  </FormControl>

                  {loadingModels && <LinearProgress sx={{ mb: 2 }} />}

                  <Button
                    size='small'
                    onClick={loadModels}
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

                  <TextField
                    fullWidth
                    label={t('settings.openAiBaseUrl')}
                    value={settings.openaiBaseUrl || ''}
                    onChange={e => setSettings(s => ({ ...s, openaiBaseUrl: e.target.value }))}
                    placeholder='https://api.openai.com/v1'
                    helperText={t('settings.openAiBaseUrlHelp')}
                    sx={{ mb: 2 }}
                  />

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>{t('settings.modelLabel')}</InputLabel>
                    <Select
                      value={settings.openaiModel}
                      label={t('settings.modelLabel')}
                      onChange={e => setSettings(s => ({ ...s, openaiModel: e.target.value }))}
                    >
                      {availableModels.length > 0 ? (
                        availableModels.map(m => (
                          <MenuItem key={m} value={m}>{m}</MenuItem>
                        ))
                      ) : (
                        <>
                          <MenuItem value='gpt-4.1-nano'>{t('settings.openaiModels.gpt41Nano')}</MenuItem>
                          <MenuItem value='gpt-4.1-mini'>{t('settings.openaiModels.gpt41Mini')}</MenuItem>
                          <MenuItem value='gpt-4.1'>{t('settings.openaiModels.gpt41')}</MenuItem>
                          <MenuItem value='o3-mini'>{t('settings.openaiModels.o3Mini')}</MenuItem>
                        </>
                      )}
                    </Select>
                  </FormControl>

                  {loadingModels && <LinearProgress sx={{ mb: 2 }} />}

                  <Button
                    size='small'
                    onClick={loadModels}
                    disabled={loadingModels || !settings.openaiKey}
                    startIcon={<i className='ri-refresh-line' />}
                  >
                    {t('settings.refreshModels')}
                  </Button>
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

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>{t('settings.modelLabel')}</InputLabel>
                    <Select
                      value={settings.anthropicModel || 'claude-haiku-4-5-20251001'}
                      label={t('settings.modelLabel')}
                      onChange={e => setSettings(s => ({ ...s, anthropicModel: e.target.value }))}
                    >
                      {availableModels.length > 0 ? (
                        availableModels.map(m => (
                          <MenuItem key={m} value={m}>{m}</MenuItem>
                        ))
                      ) : (
                        <>
                          <MenuItem value='claude-haiku-4-5-20251001'>{t('settings.anthropicModels.haiku')}</MenuItem>
                          <MenuItem value='claude-sonnet-4-6-20250514'>{t('settings.anthropicModels.sonnet')}</MenuItem>
                          <MenuItem value='claude-opus-4-6-20250918'>{t('settings.anthropicModels.opus')}</MenuItem>
                        </>
                      )}
                    </Select>
                  </FormControl>

                  {loadingModels && <LinearProgress sx={{ mb: 2 }} />}

                  <Button
                    size='small'
                    onClick={loadModels}
                    disabled={loadingModels || !settings.anthropicKey}
                    startIcon={<i className='ri-refresh-line' />}
                  >
                    {t('settings.refreshModels')}
                  </Button>
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

      {/* Save button always visible (even when AI is disabled) */}
      {!settings.enabled && (
        <Card variant='outlined' sx={{ mt: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
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
      )}
    </Box>
  )
}

/* ==================== GreenTab Component (RSE / Green IT) ==================== */

function GreenTab() {
  const t = useTranslations()

  const {
    settings,
    setSettings,
    saving,
    loading,
    message,
    setMessage,
    loadSettings,
    saveSettings: hookSaveSettings,
  } = useGreenSettings()

  const currencyOptions = [
    { code: 'EUR', label: 'Euro (€)' },
    { code: 'USD', label: 'US Dollar ($)' },
    { code: 'GBP', label: 'British Pound (£)' },
    { code: 'CHF', label: 'Swiss Franc (CHF)' },
    { code: 'CAD', label: 'Canadian Dollar (CA$)' },
    { code: 'AUD', label: 'Australian Dollar (A$)' },
    { code: 'JPY', label: 'Japanese Yen (¥)' },
    { code: 'CNY', label: 'Chinese Yuan (¥)' },
    { code: 'SEK', label: 'Swedish Krona (kr)' },
    { code: 'NOK', label: 'Norwegian Krone (kr)' },
    { code: 'DKK', label: 'Danish Krone (kr)' },
    { code: 'PLN', label: 'Polish Złoty (zł)' },
    { code: 'CZK', label: 'Czech Koruna (Kč)' },
    { code: 'HUF', label: 'Hungarian Forint (Ft)' },
    { code: 'RON', label: 'Romanian Leu (lei)' },
    { code: 'BRL', label: 'Brazilian Real (R$)' },
    { code: 'INR', label: 'Indian Rupee (₹)' },
    { code: 'KRW', label: 'South Korean Won (₩)' },
    { code: 'TRY', label: 'Turkish Lira (₺)' },
    { code: 'ZAR', label: 'South African Rand (R)' },
    { code: 'MXN', label: 'Mexican Peso (MX$)' },
  ]

  const currencySymbol = currencyOptions.find(c => c.code === settings.currency)?.label?.match(/\((.+)\)/)?.[1] || '€'

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

  const handleCountryChange = (country) => {
    const factor = co2FactorsByCountry[country]?.value || 0.052

    setSettings(s => ({
      ...s,
      co2Country: country,
      co2Factor: country === 'custom' ? s.co2Factor : factor
    }))
  }

  const saveSettings = async () => {
    const result = await hookSaveSettings()

    if (result.success) {
      setMessage({ type: 'success', text: t('settings.savedSuccess') })
    } else {
      setMessage({ type: 'error', text: result.error || t('settings.saveError') })
    }
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

      {/* Datacenter catalogue — energy + server-spec defaults live per-DC. */}
      <Box sx={{ mb: 3 }}>
        <DatacentersSection />
      </Box>

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

/* ==================== Main Settings Page ==================== */

export default function SettingsPage() {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const { isAdmin: isSuperAdmin } = useRBAC()
  const { data: session } = useSession()
  const currentTenantId = session?.user?.tenantId || 'default'
  const isProviderTenant = currentTenantId === 'default'

  const { setPageInfo } = usePageTitle()

  // Mode onboarding : l'utilisateur doit configurer une connexion
  const isOnboarding = searchParams.get('onboarding') === 'true'
  const tabParam = searchParams.get('tab')

  useEffect(() => {
    if (isOnboarding) {
      setPageInfo(t('settings.welcome'), t('settings.welcomeSubtitle'), 'ri-settings-3-line')
    } else {
      setPageInfo(t('settings.title'), t('settings.subtitle'), 'ri-settings-3-line')
    }

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t, isOnboarding])

  const allTabNames = ['connections', 'appearance', 'alert-thresholds', 'notifications', 'ldap', 'oidc', 'license', 'ai', 'green', 'white-label', 'vdc', 'tenants', 'ssh-commands']

  const allTabs = [
    { label: t('settings.connections'), icon: 'ri-link', component: ConnectionsTab, providerOnly: true },
    { label: t('settings.appearance'), icon: 'ri-palette-line', component: AppearanceTab },
    { label: t('settings.alertThresholds.title'), icon: 'ri-alarm-warning-line', component: AlertThresholdsTab, providerOnly: true },
    { label: t('settings.notifications'), icon: 'ri-notification-3-line', component: NotificationsTab, requiredFeature: Features.NOTIFICATIONS, providerOnly: true },
    { label: 'LDAP / Active Directory', icon: 'ri-server-line', component: LdapConfigTab, requiredFeature: Features.LDAP, providerOnly: true },
    { label: 'OIDC / SSO', icon: 'ri-shield-keyhole-line', component: OidcConfigTab, requiredFeature: Features.OIDC, providerOnly: true },
    { label: t('settings.license'), icon: 'ri-key-2-line', component: LicenseTab, providerOnly: true },
    { label: t('settings.ai'), icon: 'ri-robot-line', component: AITab, requiredFeature: Features.AI_INSIGHTS, providerOnly: true },
    { label: 'RSE / Green IT', icon: 'ri-leaf-line', component: GreenTab, requiredFeature: Features.GREEN_METRICS, providerOnly: true },
    { label: 'White Label', icon: 'ri-pantone-line', component: WhiteLabelTab, requiredFeature: Features.WHITE_LABEL, providerOnly: true },
    { label: t('vdc.title'), icon: 'ri-cloud-line', component: VdcTab, requiredFeature: Features.MULTI_TENANCY, providerOnly: true },
    { label: 'Tenants', icon: 'ri-building-line', component: TenantsTab, requiredFeature: Features.MULTI_TENANCY, providerOnly: true },
    { label: t('settings.sshCommands.tabLabel'), icon: 'ri-terminal-line', component: SshCommandsTab, providerOnly: true },
  ]

  // Hide provider-only tabs (Tenants, vDC) unless super admin AND currently
  // in provider tenant. License-gated tabs are also filtered out entirely
  // when the feature is missing — same UX as the inventory detail tabs:
  // the user only sees what they can actually use, no greyed-out chips.
  // While the license is still loading we keep gated tabs visible to avoid
  // a visible→hidden flicker once the response lands.
  const visibleIndices = allTabs.reduce((acc, tab, idx) => {
    if (tab.providerOnly && !(isSuperAdmin && isProviderTenant)) return acc
    if (!licenseLoading && tab.requiredFeature && !hasFeature(tab.requiredFeature)) return acc
    acc.push(idx)
    return acc
  }, [])

  const tabs = visibleIndices.map(i => allTabs[i])
  const tabNames = visibleIndices.map(i => allTabNames[i])

  // Resolve tab index from URL param
  const resolveTabIndex = () => {
    if (!tabParam) return 0
    const idx = tabNames.indexOf(tabParam)
    return idx >= 0 ? idx : 0
  }

  const [mainTab, setMainTab] = useState(resolveTabIndex)

  // Sync tab from URL changes
  useEffect(() => {
    if (tabParam) {
      const idx = tabNames.indexOf(tabParam)
      if (idx >= 0 && idx !== mainTab) setMainTab(idx)
    }
  }, [tabParam])

  // Update URL when tab changes
  const handleTabChange = (newIndex) => {
    setMainTab(newIndex)
    const name = tabNames[newIndex] || 'connections'
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', name)
    router.replace(`/settings?${params.toString()}`, { scroll: false })
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Onboarding Banner */}
      {isOnboarding && (
        <Alert
          severity="info"
          sx={{
            mb: 2,
            borderRadius: 2,
            '& .MuiAlert-icon': { fontSize: 28 }
          }}
          icon={<i className="ri-rocket-line" style={{ fontSize: 24 }} />}
        >
          <Typography variant="subtitle1" fontWeight={600}>
            {t('settings.onboardingTitle')}
          </Typography>
          <Typography variant="body2">
            {t('settings.onboardingMessage')}
          </Typography>
        </Alert>
      )}

      <Card variant='outlined' sx={{ height: isOnboarding ? 'calc(100vh - 220px)' : 'calc(100vh - 145px)' }}>
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 0 }}>
          {/* Main Tabs */}
          <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, pt: 2 }}>
            <Tabs
              value={mainTab}
              onChange={(_, v) => handleTabChange(v)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{
                '& .MuiTab-root': {
                  minHeight: 56,
                  textTransform: 'none',
                  fontSize: '0.95rem'
                }
              }}
            >
              {tabs.map((tab, idx) => (
                <Tab
                  key={idx}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className={tab.icon} style={{ fontSize: 18 }} />
                      <span>{tab.label}</span>
                    </Box>
                  }
                />
              ))}
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
