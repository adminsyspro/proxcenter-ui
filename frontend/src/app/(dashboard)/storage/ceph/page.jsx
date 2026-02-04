'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  Collapse,
  Divider,
  FormControl,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material'

import { DataGrid } from '@mui/x-data-grid'
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RTooltip,
  Legend
} from 'recharts'

import { usePageTitle } from '@/contexts/PageTitleContext'

/* -----------------------------
  Helpers
------------------------------ */

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/* -----------------------------
  Components
------------------------------ */

// Health Status Badge
const HealthBadge = ({ status, size = 'medium' }) => {
  const getColor = (s) => {
    if (s === 'HEALTH_OK') return 'success'
    if (s === 'HEALTH_WARN') return 'warning'
    if (s === 'HEALTH_ERR') return 'error'
    
return 'default'
  }
  
  const getLabel = (s) => {
    if (s === 'HEALTH_OK') return 'HEALTH OK'
    if (s === 'HEALTH_WARN') return 'WARNING'
    if (s === 'HEALTH_ERR') return 'ERROR'
    
return s || 'UNKNOWN'
  }

  const getIcon = (s) => {
    if (s === 'HEALTH_OK') return 'ri-checkbox-circle-fill'
    if (s === 'HEALTH_WARN') return 'ri-alert-fill'
    if (s === 'HEALTH_ERR') return 'ri-close-circle-fill'
    
return 'ri-question-fill'
  }

  return (
    <Chip
      icon={<i className={getIcon(status)} style={{ fontSize: size === 'large' ? 20 : 16 }} />}
      label={getLabel(status)}
      color={getColor(status)}
      size={size === 'large' ? 'medium' : 'small'}
      sx={{ 
        fontWeight: 700,
        fontSize: size === 'large' ? 14 : 12,
        py: size === 'large' ? 2.5 : 0,
        px: size === 'large' ? 1 : 0,
      }}
    />
  )
}

// Capacity Bar
const CapacityBar = ({ usedPct, height = 8 }) => {
  const getColor = (pct) => {
    if (pct >= 85) return '#f44336'
    if (pct >= 70) return '#ff9800'
    
return '#4caf50'
  }
  
  return (
    <LinearProgress 
      variant='determinate' 
      value={Math.min(100, usedPct || 0)} 
      sx={{ 
        height, 
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

// OSD Status Chip
const OsdStatusChip = ({ up, inCluster, status }) => {
  // Utiliser le status string si disponible
  const statusLower = (status || '').toLowerCase()
  const isUp = up || statusLower === 'up' || statusLower.includes('up')
  
  if (isUp && inCluster) {
    return <Chip size='small' label='UP / IN' color='success' sx={{ fontWeight: 600, fontSize: 11 }} />
  }

  if (isUp && !inCluster) {
    return <Chip size='small' label='UP / OUT' color='warning' sx={{ fontWeight: 600, fontSize: 11 }} />
  }

  if (!isUp && inCluster) {
    return <Chip size='small' label='DOWN / IN' color='error' sx={{ fontWeight: 600, fontSize: 11 }} />
  }

  
return <Chip size='small' label='DOWN / OUT' color='default' sx={{ fontWeight: 600, fontSize: 11 }} />
}

// Device Class Chip
const DeviceClassChip = ({ deviceClass }) => {
  const getColor = (dc) => {
    if (dc === 'ssd' || dc === 'nvme') return '#2196f3'
    if (dc === 'hdd') return '#607d8b'
    
return '#9e9e9e'
  }
  
  return (
    <Chip 
      size='small' 
      label={deviceClass?.toUpperCase() || 'N/A'} 
      sx={{ 
        fontWeight: 600, 
        fontSize: 10,
        bgcolor: `${getColor(deviceClass)}20`,
        color: getColor(deviceClass)
      }} 
    />
  )
}

// KPI Card
function KpiCard({ title, value, subtitle, icon, color, children }) {
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
          <Box sx={{ flex: 1 }}>
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
          {children}
        </Box>
      </CardContent>
    </Card>
  )
}

// Stat Box
function StatBox({ label, value, color }) {
  return (
    <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: 'action.hover', borderRadius: 2, minWidth: 100, flex: 1 }}>
      <Typography variant='h4' sx={{ fontWeight: 800, color: color || 'text.primary', mb: 0.5 }}>{value}</Typography>
      <Typography variant='body2' sx={{ opacity: 0.6, fontWeight: 500 }}>{label}</Typography>
    </Box>
  )
}

/* -----------------------------
  Page
------------------------------ */

export default function CephPage() {
  const t = useTranslations()
  const theme = useTheme()

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('storage.ceph'), t('storage.distributed'), 'ri-stack-line')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])
  const primaryColor = theme.palette.primary.main

  // State
  const [connections, setConnections] = useState([])
  const [cephConnections, setCephConnections] = useState([]) // Connexions avec Ceph
  const [connId, setConnId] = useState('')
  const [scanning, setScanning] = useState(true) // Scan initial des connexions

  const [cephData, setCephData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [activeTab, setActiveTab] = useState(0)
  const [showHealthDetails, setShowHealthDetails] = useState(false)

  // RRD / Performance graphs
  const [rrdData, setRrdData] = useState(null)
  const [rrdLoading, setRrdLoading] = useState(false)
  const [rrdTimeframe, setRrdTimeframe] = useState('hour')
  const [liveMode, setLiveMode] = useState(false) // Mode live pour rafraîchissement auto

  // Historique IOPS et Throughput temps réel (30 derniers points)
  const [iopsHistory, setIopsHistory] = useState([])
  const [throughputHistory, setThroughputHistory] = useState([])
  const iopsIntervalRef = useRef(null)
  const rrdIntervalRef = useRef(null)

  // Charger les connexions et scanner celles avec Ceph
  useEffect(() => {
    const scanConnections = async () => {
      setScanning(true)

      try {
        // Récupérer uniquement les connexions PVE avec Ceph activé
        const res = await fetch('/api/v1/connections?type=pve&hasCeph=true', { cache: 'no-store' })
        const json = await res.json()
        const list = Array.isArray(json?.data) ? json.data : []
        
        // Ces connexions ont déjà hasCeph=true, on vérifie juste le health
        const cephChecks = await Promise.all(
          list.map(async (conn) => {
            try {
              const cephRes = await fetch(`/api/v1/connections/${encodeURIComponent(conn.id)}/ceph`, { cache: 'no-store' })
              const cephJson = await cephRes.json()

              
return {
                ...conn,
                hasCeph: cephRes.ok && cephJson?.data?.hasCeph === true,
                cephHealth: cephJson?.data?.health?.status || null
              }
            } catch {
              return { ...conn, hasCeph: false, cephHealth: null }
            }
          })
        )

        // Garder toutes les connexions pour le sélecteur, mais marquer celles qui ont vraiment Ceph
        setConnections(list)
        const withCeph = cephChecks.filter(c => c.hasCeph)

        setCephConnections(withCeph)
        
        // Sélectionner la première connexion avec Ceph
        if (withCeph.length > 0) {
          setConnId(withCeph[0].id)
        }
      } catch (e) {
        console.error('Failed to scan connections', e)
      } finally {
        setScanning(false)
      }
    }

    scanConnections()
  }, [])

  // Charger les données Ceph
  const loadCeph = async () => {
    if (!connId) return
    
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph`, { cache: 'no-store' })
      const json = await res.json()
      
      if (!res.ok) {
        setError(json.error || t('ceph.errorStatus', { status: res.status }))
        setCephData(null)
        
return
      }
      
      setCephData(json.data)
    } catch (e) {
      setError(e?.message || String(e))
      setCephData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!scanning && connId) {
      loadCeph()
    }
  }, [scanning, connId])

  // Charger les données RRD pour les graphiques
  const loadRrd = async () => {
    if (!connId) return
    
    setRrdLoading(true)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/ceph/rrd?timeframe=${rrdTimeframe}`, 
        { cache: 'no-store' }
      )

      const json = await res.json()
      
      if (res.ok && json?.data) {
        setRrdData(json.data)
      }
    } catch (e) {
      console.error('Failed to load RRD data:', e)
    } finally {
      setRrdLoading(false)
    }
  }

  // Fonction légère pour rafraîchir uniquement les RRD (sans indicateur de chargement)
  const refreshRrdOnly = async () => {
    if (!connId) return

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/ceph/rrd?timeframe=${rrdTimeframe}`, 
        { cache: 'no-store' }
      )

      const json = await res.json()

      if (res.ok && json?.data) {
        setRrdData(json.data)
      }
    } catch (e) {
      // Ignorer les erreurs de polling silencieusement
    }
  }

  useEffect(() => {
    if (!scanning && connId && cephData) {
      loadRrd()
    }
  }, [scanning, connId, cephData, rrdTimeframe])

  // Mettre à jour l'historique IOPS et Throughput quand cephData change
  useEffect(() => {
    if (cephData?.performance) {
      const now = new Date()
      const timeFormatted = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      
      // Historique IOPS
      const newIopsPoint = {
        time: now.getTime(),
        timeFormatted,
        readIops: cephData.performance.readOpsSec || 0,
        writeIops: cephData.performance.writeOpsSec || 0,
        totalIops: cephData.performance.totalIops || 0,
      }

      setIopsHistory(prev => {
        const updated = [...prev, newIopsPoint]

        
return updated.slice(-30)
      })
      
      // Historique Throughput (bytes/sec)
      const newThroughputPoint = {
        time: now.getTime(),
        timeFormatted,
        readBytes: cephData.performance.readBytesSec || 0,
        writeBytes: cephData.performance.writeBytesSec || 0,
      }

      setThroughputHistory(prev => {
        const updated = [...prev, newThroughputPoint]

        
return updated.slice(-30)
      })
    }
  }, [cephData])

  // Fonction légère pour rafraîchir uniquement les IOPS (pas tout le dashboard)
  const refreshIopsOnly = async () => {
    if (!connId) return

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph`, { cache: 'no-store' })
      const json = await res.json()

      if (res.ok && json?.data?.performance) {
        // Mettre à jour uniquement les données de performance
        setCephData(prev => prev ? { ...prev, performance: json.data.performance } : prev)
      }
    } catch (e) {
      // Ignorer les erreurs de polling silencieusement
    }
  }

  // Polling pour rafraîchir les IOPS toutes les 5 secondes (seulement en mode live)
  useEffect(() => {
    if (liveMode && connId && cephData) {
      iopsIntervalRef.current = setInterval(() => {
        refreshIopsOnly()
      }, 5000)
    }

    
return () => {
      if (iopsIntervalRef.current) {
        clearInterval(iopsIntervalRef.current)
      }
    }
  }, [liveMode, connId, !!cephData])

  // Polling pour rafraîchir les RRD (Réseau) toutes les 30 secondes (seulement en mode live)
  useEffect(() => {
    if (liveMode && connId && cephData && rrdData) {
      rrdIntervalRef.current = setInterval(() => {
        refreshRrdOnly()
      }, 30000)
    }

    
return () => {
      if (rrdIntervalRef.current) {
        clearInterval(rrdIntervalRef.current)
      }
    }
  }, [liveMode, connId, !!cephData, !!rrdData])

  // Colonnes OSDs
  const osdColumns = useMemo(() => [
    {
      field: 'name',
      headerName: 'OSD',
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2' sx={{ fontWeight: 700 }}>{params.row.name}</Typography>
        </Box>
      )
    },
    {
      field: 'host',
      headerName: 'Host',
      flex: 1,
      minWidth: 120,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2'>{params.row.host}</Typography>
        </Box>
      )
    },
    {
      field: 'status',
      headerName: t('common.status'),
      width: 110,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <OsdStatusChip up={params.row.up} inCluster={params.row.in} status={params.row.status} />
        </Box>
      )
    },
    {
      field: 'deviceClass',
      headerName: t('common.type'),
      width: 90,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <DeviceClassChip deviceClass={params.row.deviceClass} />
        </Box>
      )
    },
    {
      field: 'usedPct',
      headerName: t('storage.usage'),
      width: 150,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', height: '100%' }}>
          <Box sx={{ flex: 1 }}>
            <CapacityBar usedPct={params.row.usedPct} height={6} />
          </Box>
          <Typography variant='body2' sx={{ fontWeight: 600, minWidth: 40, textAlign: 'right' }}>
            {Math.round(params.row.usedPct || 0)}%
          </Typography>
        </Box>
      )
    },
    {
      field: 'commitLatencyMs',
      headerName: 'Latency',
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>
            {params.row.commitLatencyMs || 0} ms
          </Typography>
        </Box>
      )
    },
  ], [t])

  // Colonnes Pools
  const poolColumns = useMemo(() => [
    {
      field: 'name',
      headerName: 'Pool',
      flex: 1,
      minWidth: 150,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2' sx={{ fontWeight: 700 }}>{params.row.name}</Typography>
        </Box>
      )
    },
    {
      field: 'type',
      headerName: t('common.type'),
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Chip size='small' label={params.row.type} variant='outlined' sx={{ fontSize: 11 }} />
        </Box>
      )
    },
    {
      field: 'size',
      headerName: 'Replication',
      width: 110,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2'>
            {params.row.size} / {params.row.minSize}
          </Typography>
        </Box>
      )
    },
    {
      field: 'pgNum',
      headerName: 'PGs',
      width: 80,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.row.pgNum}</Typography>
        </Box>
      )
    },
    {
      field: 'bytesUsed',
      headerName: t('common.used'),
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>{params.row.bytesUsedFormatted}</Typography>
        </Box>
      )
    },
    {
      field: 'maxAvail',
      headerName: t('common.available'),
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2'>{params.row.maxAvailFormatted}</Typography>
        </Box>
      )
    },
    {
      field: 'objects',
      headerName: 'Objects',
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2'>{(params.row.objects || 0).toLocaleString()}</Typography>
        </Box>
      )
    },
  ], [t])

  // Colonnes Monitors
  const monColumns = useMemo(() => [
    {
      field: 'name',
      headerName: 'Monitor',
      width: 120,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
          <Typography variant='body2' sx={{ fontWeight: 700 }}>{params.row.name}</Typography>
          {params.row.leader && (
            <Chip size='small' label='Leader' color='primary' sx={{ fontSize: 10, height: 18 }} />
          )}
        </Box>
      )
    },
    {
      field: 'host',
      headerName: 'Host',
      flex: 1,
      minWidth: 120,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2'>{params.row.host}</Typography>
        </Box>
      )
    },
    {
      field: 'addr',
      headerName: 'Address',
      flex: 1,
      minWidth: 150,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: 12 }}>
            {params.row.addr}
          </Typography>
        </Box>
      )
    },
    {
      field: 'inQuorum',
      headerName: 'Quorum',
      width: 100,
      renderCell: params => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {params.row.inQuorum ? (
            <Chip size='small' label='In Quorum' color='success' sx={{ fontSize: 11 }} />
          ) : (
            <Chip size='small' label='Out' color='error' sx={{ fontSize: 11 }} />
          )}
        </Box>
      )
    },
  ], [t])

  // Scanning state
  if (scanning) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <Typography variant='h5' sx={{ fontWeight: 900 }}>{t('storage.ceph')}</Typography>
          <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('storage.distributed')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, gap: 2 }}>
          <CircularProgress />
          <Typography variant='body2' sx={{ opacity: 0.6 }}>
            {t('common.loading')}
          </Typography>
        </Box>
      </Box>
    )
  }

  // No Ceph clusters found
  if (cephConnections.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant='h5' sx={{ fontWeight: 900 }}>{t('storage.ceph')}</Typography>
            <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('storage.distributed')}</Typography>
          </Box>
          <Button variant='outlined' size='small' component={Link} href='/storage/overview'>
            {t('storage.storages')}
          </Button>
        </Box>
        <Alert severity='info' sx={{ mt: 2 }}>
          <Typography variant='body2' sx={{ fontWeight: 600, mb: 1 }}>
            {t('common.noData')}
          </Typography>
          <Typography variant='body2'>
            {t('common.notAvailable')}
          </Typography>
        </Alert>

        {connections.length > 0 && (
          <Card variant='outlined'>
            <CardContent>
              <Typography variant='subtitle2' sx={{ fontWeight: 700, mb: 2 }}>
                {t('storage.scannedConnections')} ({connections.length})
              </Typography>
              <Stack spacing={1}>
                {connections.map(conn => (
                  <Box
                    key={conn.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover'
                    }}
                  >
                    <Typography variant='body2' sx={{ fontWeight: 600 }}>{conn.name}</Typography>
                    <Chip size='small' label={t('common.notAvailable')} variant='outlined' sx={{ fontSize: 11 }} />
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, alignItems: 'center' }}>
        <FormControl size='small' sx={{ minWidth: 200 }}>
          <Select
            value={connId}
            onChange={e => setConnId(e.target.value)}
            displayEmpty
          >
            {cephConnections.map(c => (
              <MenuItem key={c.id} value={c.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {c.name}
                  {c.cephHealth && (
                    <Chip 
                      size='small' 
                      label={c.cephHealth === 'HEALTH_OK' ? 'OK' : c.cephHealth === 'HEALTH_WARN' ? 'WARN' : 'ERR'}
                      color={c.cephHealth === 'HEALTH_OK' ? 'success' : c.cephHealth === 'HEALTH_WARN' ? 'warning' : 'error'}
                      sx={{ fontSize: 9, height: 18 }}
                    />
                  )}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tooltip title={t('common.refresh')}>
          <IconButton onClick={loadCeph} disabled={loading}>
            <i className='ri-refresh-line' />
          </IconButton>
        </Tooltip>
        <Button variant='outlined' size='small' component={Link} href='/storage/overview'>
          {t('storage.storages')}
        </Button>
      </Box>

      {/* Loading / Error */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {error && !loading && (
        <Alert severity='error' sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Content */}
      {cephData && !loading && (
        <>
          {/* Health + KPIs */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
            {/* Health Card */}
            <Card variant='outlined'>
              <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase' }}>
                      {t('ceph.clusterHealth')}
                    </Typography>
                    <Box sx={{ mt: 1 }}>
                      <HealthBadge status={cephData.health?.status} size='large' />
                    </Box>
                    {cephData.health?.numChecks > 0 && (
                      <Button
                        size='small'
                        sx={{ mt: 1, fontSize: 11 }}
                        onClick={() => setShowHealthDetails(!showHealthDetails)}
                        endIcon={<i className={showHealthDetails ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />}
                      >
                        {cephData.health.numChecks > 1
                          ? t('ceph.alertsCount', { count: cephData.health.numChecks })
                          : t('ceph.alertCount', { count: cephData.health.numChecks })}
                      </Button>
                    )}
                  </Box>
                </Box>
              </CardContent>
            </Card>

            <KpiCard
              title={t('ceph.capacity')}
              value={cephData.capacity?.usedFormatted}
              subtitle={t('ceph.usedOf', { total: cephData.capacity?.totalFormatted, pct: cephData.capacity?.usedPct })}
              icon='ri-database-2-line'
              color='#2196f3'
            />

            <KpiCard
              title='IOPS'
              value={(cephData.performance?.totalIops || 0).toLocaleString()}
              subtitle={`R: ${cephData.performance?.readOpsSec || 0} / W: ${cephData.performance?.writeOpsSec || 0}`}
              icon='ri-speed-line'
              color='#9c27b0'
            />

            <KpiCard
              title='Throughput'
              value={cephData.performance?.readFormatted}
              subtitle={`Write: ${cephData.performance?.writeFormatted}`}
              icon='ri-upload-2-line'
              color='#ff9800'
            />
          </Box>

          {/* Health Details */}
          <Collapse in={showHealthDetails}>
            <Card variant='outlined' sx={{ bgcolor: 'action.hover' }}>
              <CardContent>
                <Typography variant='subtitle2' sx={{ fontWeight: 700, mb: 2 }}>
                  <i className='ri-alert-line' style={{ marginRight: 8 }} />
                  {t('ceph.healthAlerts')}
                </Typography>
                <Stack spacing={1}>
                  {(cephData.health?.checks || []).map((check, idx) => (
                    <Box 
                      key={idx} 
                      sx={{ 
                        p: 1.5, 
                        borderRadius: 1, 
                        bgcolor: check.severity === 'HEALTH_ERR' ? 'error.dark' : 'warning.dark',
                        opacity: 0.9
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Chip 
                          size='small' 
                          label={check.severity} 
                          color={check.severity === 'HEALTH_ERR' ? 'error' : 'warning'}
                          sx={{ fontSize: 10, height: 20 }}
                        />
                        <Typography variant='body2' sx={{ fontWeight: 700 }}>{check.name}</Typography>
                      </Box>
                      <Typography variant='body2' sx={{ opacity: 0.9 }}>{check.summary}</Typography>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Collapse>

          {/* Capacity Bar */}
          <Card variant='outlined'>
            <CardContent sx={{ py: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant='body2' sx={{ fontWeight: 600 }}>{t('ceph.clusterCapacity')}</Typography>
                <Typography variant='body2'>
                  {t('ceph.usedOnOf', { used: cephData.capacity?.usedFormatted, total: cephData.capacity?.totalFormatted })}
                  {' '}({t('ceph.availableCapacity', { available: cephData.capacity?.availFormatted })})
                </Typography>
              </Box>
              <CapacityBar usedPct={cephData.capacity?.usedPct} height={12} />
            </CardContent>
          </Card>

          {/* Performance Graphs */}
          <Card variant='outlined'>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>
                  <i className='ri-line-chart-line' style={{ marginRight: 8 }} />
                  {t('cephPage.performance')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {rrdLoading && <CircularProgress size={16} />}
                  <ToggleButtonGroup
                    value={liveMode ? 'live' : rrdTimeframe}
                    exclusive
                    onChange={(e, v) => {
                      if (v === 'live') {
                        setLiveMode(true)
                        setRrdTimeframe('hour')
                        setIopsHistory([])
                        setThroughputHistory([])
                      } else if (v) {
                        const wasLive = liveMode

                        setLiveMode(false)
                        setRrdTimeframe(v)

                        if (wasLive && v === 'hour') {
                          loadRrd()
                        }
                      }
                    }}
                    size='small'
                  >
                    <ToggleButton 
                      value='live' 
                      sx={{ 
                        px: 1.5, 
                        py: 0.25, 
                        fontSize: 11,
                        color: liveMode ? '#4caf50' : 'inherit',
                        '&.Mui-selected': {
                          bgcolor: 'rgba(76, 175, 80, 0.2)',
                          color: '#4caf50',
                          '&:hover': {
                            bgcolor: 'rgba(76, 175, 80, 0.3)',
                          }
                        }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {liveMode && (
                          <Box 
                            sx={{ 
                              width: 6, 
                              height: 6, 
                              borderRadius: '50%', 
                              bgcolor: '#4caf50',
                              animation: 'pulse 1.5s infinite',
                              '@keyframes pulse': {
                                '0%, 100%': { opacity: 1 },
                                '50%': { opacity: 0.4 }
                              }
                            }} 
                          />
                        )}
                        LIVE
                      </Box>
                    </ToggleButton>
                    <ToggleButton value='hour' sx={{ px: 1.5, py: 0.25, fontSize: 11 }}>1H</ToggleButton>
                    <ToggleButton value='day' sx={{ px: 1.5, py: 0.25, fontSize: 11 }}>24H</ToggleButton>
                    <ToggleButton value='week' sx={{ px: 1.5, py: 0.25, fontSize: 11 }}>{t('cephPage.sevenDays')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: '1fr 1fr 1fr' }, gap: 3 }}>
                {/* IOPS Chart */}
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant='caption' sx={{ fontWeight: 600, opacity: 0.7 }}>
                        IOPS Ceph
                      </Typography>
                      {liveMode && (
                        <Chip 
                          size='small' 
                          label='LIVE' 
                          color='success' 
                          sx={{ 
                            fontSize: 9, 
                            height: 18, 
                            fontWeight: 700,
                            animation: 'pulse 2s infinite',
                            '@keyframes pulse': {
                              '0%, 100%': { opacity: 1 },
                              '50%': { opacity: 0.6 }
                            }
                          }} 
                        />
                      )}
                    </Box>
                    {liveMode && (
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <Typography variant='caption' sx={{ color: '#2196f3', fontWeight: 700 }}>
                          R: {(cephData?.performance?.readOpsSec || 0).toLocaleString()}
                        </Typography>
                        <Typography variant='caption' sx={{ color: '#ff9800', fontWeight: 700 }}>
                          W: {(cephData?.performance?.writeOpsSec || 0).toLocaleString()}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ height: 200 }}>
                    {liveMode ? (

                      // Mode LIVE : afficher le graphique IOPS temps réel
                      iopsHistory.length > 1 ? (
                        <ResponsiveContainer width='100%' height='100%'>
                          <AreaChart data={iopsHistory} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                            <defs>
                              <linearGradient id='readIopsGrad' x1='0' y1='0' x2='0' y2='1'>
                                <stop offset='0%' stopColor='#2196f3' stopOpacity={0.4} />
                                <stop offset='100%' stopColor='#2196f3' stopOpacity={0.05} />
                              </linearGradient>
                              <linearGradient id='writeIopsGrad' x1='0' y1='0' x2='0' y2='1'>
                                <stop offset='0%' stopColor='#ff9800' stopOpacity={0.4} />
                                <stop offset='100%' stopColor='#ff9800' stopOpacity={0.05} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray='3 3' opacity={0.2} />
                            <XAxis dataKey='timeFormatted' tick={{ fontSize: 9 }} interval='preserveStartEnd' />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} width={45} />
                            <RTooltip 
                              contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 8, fontSize: 12 }}
                              formatter={(value, name) => [value.toLocaleString(), name === 'readIops' ? 'Read' : 'Write']}
                            />
                            <Area type='monotone' dataKey='readIops' name='readIops' stroke='#2196f3' fill='url(#readIopsGrad)' strokeWidth={2} />
                            <Area type='monotone' dataKey='writeIops' name='writeIops' stroke='#ff9800' fill='url(#writeIopsGrad)' strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', bgcolor: 'action.hover', borderRadius: 2 }}>
                          <CircularProgress size={24} sx={{ mb: 1 }} />
                          <Typography variant='caption' sx={{ opacity: 0.5 }}>{t('ceph.collectingIops')}</Typography>
                        </Box>
                      )
                    ) : (

                      // Mode historique : afficher les valeurs statiques
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', bgcolor: 'action.hover', borderRadius: 2, p: 3 }}>
                        <Box sx={{ display: 'flex', gap: 6, mb: 2 }}>
                          <Box sx={{ textAlign: 'center' }}>
                            <Typography variant='h3' sx={{ fontWeight: 800, color: '#2196f3' }}>
                              {(cephData?.performance?.readOpsSec || 0).toLocaleString()}
                            </Typography>
                            <Typography variant='body2' sx={{ opacity: 0.7 }}>Read IOPS</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'center' }}>
                            <Typography variant='h3' sx={{ fontWeight: 800, color: '#ff9800' }}>
                              {(cephData?.performance?.writeOpsSec || 0).toLocaleString()}
                            </Typography>
                            <Typography variant='body2' sx={{ opacity: 0.7 }}>Write IOPS</Typography>
                          </Box>
                        </Box>
                        <Divider sx={{ width: '60%', my: 1.5 }} />
                        <Typography variant='caption' sx={{ opacity: 0.5 }}>
                          {t('ceph.enableLiveHistory')}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>

                {/* Throughput Ceph / Réseau Node Chart */}
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant='caption' sx={{ fontWeight: 600, opacity: 0.7 }}>
                        {liveMode ? t('ceph.throughputCeph') : t('ceph.nodeNetwork')}
                      </Typography>
                      {liveMode && (
                        <Chip 
                          size='small' 
                          label='LIVE' 
                          color='success' 
                          sx={{ 
                            fontSize: 9, 
                            height: 18, 
                            fontWeight: 700,
                            animation: 'pulse 2s infinite',
                            '@keyframes pulse': {
                              '0%, 100%': { opacity: 1 },
                              '50%': { opacity: 0.6 }
                            }
                          }} 
                        />
                      )}
                    </Box>
                    {liveMode && (
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <Typography variant='caption' sx={{ color: '#2196f3', fontWeight: 700 }}>
                          R: {formatBytes(cephData?.performance?.readBytesSec || 0)}/s
                        </Typography>
                        <Typography variant='caption' sx={{ color: '#ff9800', fontWeight: 700 }}>
                          W: {formatBytes(cephData?.performance?.writeBytesSec || 0)}/s
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ height: 200 }}>
                    {liveMode ? (

                      // Mode LIVE : afficher le throughput Ceph temps réel
                      throughputHistory.length > 1 ? (
                        <ResponsiveContainer width='100%' height='100%'>
                          <AreaChart data={throughputHistory} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                            <defs>
                              <linearGradient id='readBytesGrad' x1='0' y1='0' x2='0' y2='1'>
                                <stop offset='0%' stopColor='#2196f3' stopOpacity={0.4} />
                                <stop offset='100%' stopColor='#2196f3' stopOpacity={0.05} />
                              </linearGradient>
                              <linearGradient id='writeBytesGrad' x1='0' y1='0' x2='0' y2='1'>
                                <stop offset='0%' stopColor='#ff9800' stopOpacity={0.4} />
                                <stop offset='100%' stopColor='#ff9800' stopOpacity={0.05} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray='3 3' opacity={0.2} />
                            <XAxis dataKey='timeFormatted' tick={{ fontSize: 9 }} interval='preserveStartEnd' />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v)} width={55} />
                            <RTooltip 
                              contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 8, fontSize: 12 }}
                              formatter={(value) => [`${formatBytes(value)}/s`]}
                            />
                            <Area type='monotone' dataKey='readBytes' name={t('ceph.read')} stroke='#2196f3' fill='url(#readBytesGrad)' strokeWidth={2} />
                            <Area type='monotone' dataKey='writeBytes' name={t('ceph.write')} stroke='#ff9800' fill='url(#writeBytesGrad)' strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', bgcolor: 'action.hover', borderRadius: 2 }}>
                          <CircularProgress size={24} sx={{ mb: 1 }} />
                          <Typography variant='caption' sx={{ opacity: 0.5 }}>{t('ceph.collectingData')}</Typography>
                        </Box>
                      )
                    ) : (

                      // Mode historique : afficher le réseau du node depuis les RRD
                      rrdData?.rrd?.length > 0 ? (
                        <ResponsiveContainer width='100%' height='100%'>
                          <AreaChart data={rrdData.rrd} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                            <defs>
                              <linearGradient id='ioInGrad' x1='0' y1='0' x2='0' y2='1'>
                                <stop offset='0%' stopColor='#2196f3' stopOpacity={0.3} />
                                <stop offset='100%' stopColor='#2196f3' stopOpacity={0.05} />
                              </linearGradient>
                              <linearGradient id='ioOutGrad' x1='0' y1='0' x2='0' y2='1'>
                                <stop offset='0%' stopColor='#ff9800' stopOpacity={0.3} />
                                <stop offset='100%' stopColor='#ff9800' stopOpacity={0.05} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray='3 3' opacity={0.2} />
                            <XAxis dataKey='timeFormatted' tick={{ fontSize: 10 }} interval='preserveStartEnd' />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v)} width={60} />
                            <RTooltip 
                              contentStyle={{ 
                                backgroundColor: 'rgba(0,0,0,0.85)', 
                                border: 'none', 
                                borderRadius: 8,
                                fontSize: 12
                              }}
                              formatter={(value) => formatBytes(value)}
                            />
                            <Area type='monotone' dataKey='netIn' name={t('ceph.incoming')} stroke='#2196f3' fill='url(#ioInGrad)' strokeWidth={2} />
                            <Area type='monotone' dataKey='netOut' name={t('ceph.outgoing')} stroke='#ff9800' fill='url(#ioOutGrad)' strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
                          <Typography variant='body2'>{t('ceph.noRrdData')}</Typography>
                        </Box>
                      )
                    )}
                  </Box>
                </Box>

                {/* CPU / Memory Chart */}
                <Box>
                  <Typography variant='caption' sx={{ fontWeight: 600, opacity: 0.7, mb: 1, display: 'block' }}>
                    {t('ceph.cpuMemoryNode')}
                  </Typography>
                  <Box sx={{ height: 200 }}>
                    {rrdData?.rrd?.length > 0 ? (
                      <ResponsiveContainer width='100%' height='100%'>
                        <LineChart data={rrdData.rrd} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray='3 3' opacity={0.2} />
                          <XAxis dataKey='timeFormatted' tick={{ fontSize: 10 }} interval='preserveStartEnd' />
                          <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={40} />
                          <RTooltip 
                            contentStyle={{ 
                              backgroundColor: 'rgba(0,0,0,0.85)', 
                              border: 'none', 
                              borderRadius: 8,
                              fontSize: 12
                            }}
                            formatter={(value) => `${value}%`}
                          />
                          <Line type='monotone' dataKey='cpu' name='CPU' stroke={primaryColor} strokeWidth={2} dot={false} />
                          <Line type='monotone' dataKey='memPct' name={t('ceph.memory')} stroke='#9c27b0' strokeWidth={2} dot={false} />
                          <Line type='monotone' dataKey='iowait' name={t('ceph.ioWait')} stroke='#f44336' strokeWidth={1.5} dot={false} strokeDasharray='3 3' />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
                        <Typography variant='body2'>{t('ceph.noRrdData')}</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              </Box>

              {/* OSD Latency Chart */}
              {(rrdData?.osds?.length > 0 || cephData?.osds?.list?.length > 0) && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant='caption' sx={{ fontWeight: 600, opacity: 0.7, mb: 1, display: 'block' }}>
                    {t('ceph.osdLatency')}
                  </Typography>
                  <Box sx={{ height: 180 }}>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart 
                        data={(rrdData?.osds?.length > 0 ? rrdData.osds : cephData?.osds?.list || []).slice(0, 24)} 
                        margin={{ top: 5, right: 5, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray='3 3' opacity={0.2} />
                        <XAxis dataKey='name' tick={{ fontSize: 9 }} interval={0} angle={-45} textAnchor='end' height={50} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}ms`} width={45} />
                        <RTooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(0,0,0,0.85)', 
                            border: 'none', 
                            borderRadius: 8,
                            fontSize: 12
                          }}
                          formatter={(value) => [`${value} ms`, t('ceph.latency')]}
                        />
                        <Bar 
                          dataKey='commitLatencyMs' 
                          name='Commit Latency' 
                          fill={primaryColor}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                  {(rrdData?.latency || cephData?.osds?.list?.length > 0) && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 4, mt: 1 }}>
                      <Typography variant='caption' sx={{ opacity: 0.7 }}>
                        {t('ceph.average')}: <strong>{rrdData?.latency?.avgCommit ||
                          (cephData?.osds?.list?.length > 0
                            ? Math.round(cephData.osds.list.reduce((acc, o) => acc + (o.commitLatencyMs || 0), 0) / cephData.osds.list.length * 10) / 10
                            : 0)} ms</strong>
                      </Typography>
                      <Typography variant='caption' sx={{ opacity: 0.7 }}>
                        {t('ceph.max')}: <strong>{rrdData?.latency?.maxCommit ||
                          (cephData?.osds?.list?.length > 0
                            ? Math.max(...cephData.osds.list.map(o => o.commitLatencyMs || 0))
                            : 0)} ms</strong>
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Stats Row */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 2 }}>
            {/* OSDs Summary */}
            <Card variant='outlined'>
              <CardContent sx={{ py: 3 }}>
                <Typography variant='subtitle1' sx={{ fontWeight: 700, mb: 3 }}>
                  <i className='ri-hard-drive-2-line' style={{ marginRight: 8 }} />
                  OSDs
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-around' }}>
                  <StatBox label='Total' value={cephData.osds?.total || 0} color={primaryColor} />
                  <StatBox label='Up' value={cephData.osds?.up || 0} color='#4caf50' />
                  <StatBox label='In' value={cephData.osds?.in || 0} color='#2196f3' />
                  <StatBox label='Down' value={cephData.osds?.down || 0} color={cephData.osds?.down > 0 ? '#f44336' : undefined} />
                </Box>
              </CardContent>
            </Card>

            {/* Monitors Summary */}
            <Card variant='outlined'>
              <CardContent sx={{ py: 3 }}>
                <Typography variant='subtitle1' sx={{ fontWeight: 700, mb: 3 }}>
                  <i className='ri-eye-line' style={{ marginRight: 8 }} />
                  Monitors
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-around' }}>
                  <StatBox label='Total' value={cephData.monitors?.total || 0} color={primaryColor} />
                  <StatBox label='In Quorum' value={cephData.monitors?.inQuorum || 0} color='#4caf50' />
                </Box>
                {cephData.monitors?.quorumNames?.length > 0 && (
                  <Typography variant='caption' sx={{ opacity: 0.6, display: 'block', textAlign: 'center', mt: 2 }}>
                    Quorum: {cephData.monitors.quorumNames.join(', ')}
                  </Typography>
                )}
              </CardContent>
            </Card>

            {/* PGs Summary */}
            <Card variant='outlined'>
              <CardContent sx={{ py: 3 }}>
                <Typography variant='subtitle1' sx={{ fontWeight: 700, mb: 3 }}>
                  <i className='ri-pie-chart-line' style={{ marginRight: 8 }} />
                  Placement Groups
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-around' }}>
                  <StatBox label='Total PGs' value={cephData.pgs?.total || 0} color={primaryColor} />
                  <StatBox label='Pools' value={cephData.pools?.total || 0} color='#9c27b0' />
                </Box>
              </CardContent>
            </Card>
          </Box>

          {/* Tabs for detailed views */}
          <Card variant='outlined'>
            <Tabs 
              value={activeTab} 
              onChange={(e, v) => setActiveTab(v)}
              sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
            >
              <Tab label={`OSDs (${cephData.osds?.total || 0})`} />
              <Tab label={`Pools (${cephData.pools?.total || 0})`} />
              <Tab label={`Monitors (${cephData.monitors?.total || 0})`} />
              {cephData.mds?.total > 0 && <Tab label={`MDS (${cephData.mds.total})`} />}
            </Tabs>

            {/* OSDs Tab */}
            {activeTab === 0 && (
              <Box sx={{ height: 400 }}>
                <DataGrid
                  rows={cephData.osds?.list || []}
                  columns={osdColumns}
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{
                    pagination: { paginationModel: { pageSize: 10 } },
                    sorting: { sortModel: [{ field: 'id', sort: 'asc' }] }
                  }}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  sx={{ border: 'none' }}
                />
              </Box>
            )}

            {/* Pools Tab */}
            {activeTab === 1 && (
              <Box sx={{ height: 400 }}>
                <DataGrid
                  rows={cephData.pools?.list || []}
                  columns={poolColumns}
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{
                    pagination: { paginationModel: { pageSize: 10 } },
                  }}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  sx={{ border: 'none' }}
                />
              </Box>
            )}

            {/* Monitors Tab */}
            {activeTab === 2 && (
              <Box sx={{ height: 400 }}>
                <DataGrid
                  rows={cephData.monitors?.list || []}
                  columns={monColumns}
                  pageSizeOptions={[10, 25]}
                  initialState={{
                    pagination: { paginationModel: { pageSize: 10 } },
                  }}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.name}
                  sx={{ border: 'none' }}
                />
              </Box>
            )}

            {/* MDS Tab */}
            {activeTab === 3 && cephData.mds?.total > 0 && (
              <Box sx={{ p: 3 }}>
                <Typography variant='subtitle2' sx={{ fontWeight: 700, mb: 2 }}>
                  {t('ceph.metadataServers')}
                </Typography>
                <Stack spacing={1}>
                  {(cephData.mds?.list || []).map((mds, idx) => (
                    <Box 
                      key={idx}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        p: 1.5,
                        borderRadius: 1,
                        bgcolor: 'action.hover'
                      }}
                    >
                      <Box>
                        <Typography variant='body2' sx={{ fontWeight: 700 }}>{mds.name}</Typography>
                        <Typography variant='caption' sx={{ opacity: 0.6 }}>{mds.host}</Typography>
                      </Box>
                      <Chip 
                        size='small' 
                        label={mds.state} 
                        color={mds.state === 'active' ? 'success' : 'default'}
                        sx={{ fontSize: 11 }}
                      />
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Card>
        </>
      )}
    </Box>
  )
}
