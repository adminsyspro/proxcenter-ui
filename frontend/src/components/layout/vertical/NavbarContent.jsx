'use client'

import { useEffect, useState, useMemo } from 'react'

import { useRouter } from 'next/navigation'

import { useSession, signOut } from 'next-auth/react'
import {
  Avatar,
  Badge,
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
  Typography
} from '@mui/material'

// i18n
import { useTranslations } from 'next-intl'

import { useLocale } from '@/contexts/LocaleContext'

// Materio settings hook (theme, mode, etc.)
import { useSettings } from '@core/hooks/useSettings'

// Theme Dropdown
import ThemeDropdown from '@components/layout/shared/ThemeDropdown'

// AI Chat Drawer
import AIChatDrawer from '@components/layout/shared/AIChatDrawer'

// Tasks Dropdown
import TasksDropdown from '@components/layout/shared/TasksDropdown'

// About Dialog
import AboutDialog from '@components/dialogs/AboutDialog'

// Command Palette
import CommandPalette from '@components/layout/shared/CommandPalette'

// Page Title Context
import { usePageTitle } from '@/contexts/PageTitleContext'

// License Context
import { useLicense, Features } from '@/contexts/LicenseContext'

// RBAC Context
import { useRBAC } from '@/contexts/RBACContext'

import { useActiveAlerts, useDRSRecommendations, useVersionCheck, useOrchestratorHealth } from '@/hooks/useNavbarNotifications'

// Version config
import { GIT_SHA } from '@/config/version'

// Fonction pour obtenir les initiales
const getInitials = (name, email) => {
  if (name) {
    const parts = name.split(' ')

    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }

    
return name.substring(0, 2).toUpperCase()
  }

  if (email) {
    return email.substring(0, 2).toUpperCase()
  }

  
return 'U'
}

// Fonction pour formater le temps écoulé (localized version inside component)
const createTimeAgo = (t) => (date) => {
  if (!date) return ''
  const now = new Date()
  const past = new Date(date)
  const diff = Math.floor((now - past) / 1000)

  if (diff < 60) return t('time.justNow')
  if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })
  
return t('time.daysAgo', { count: Math.floor(diff / 86400) })
}

// Icônes et couleurs selon le type d'alerte
const getAlertIcon = (alert) => {
  const msg = alert.message?.toLowerCase() || ''
  
  if (msg.includes('offline') || msg.includes('quorum')) {
    return { icon: 'ri-server-line', color: 'error' }
  }

  if (msg.includes('ceph')) {
    return { icon: 'ri-database-2-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  }

  if (msg.includes('pbs') || msg.includes('backup')) {
    return { icon: 'ri-shield-check-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  }

  if (msg.includes('cpu')) {
    return { icon: 'ri-cpu-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  }

  if (msg.includes('ram') || msg.includes('memory')) {
    return { icon: 'ri-ram-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  }

  if (msg.includes('stockage') || msg.includes('storage')) {
    return { icon: 'ri-hard-drive-2-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  }
  
  return { 
    icon: alert.severity === 'crit' ? 'ri-error-warning-line' : 'ri-alarm-warning-line', 
    color: alert.severity === 'crit' ? 'error' : 'warning' 
  }
}

const NavbarContent = () => {
  const { settings, updateSettings } = useSettings()
  const router = useRouter()
  const { data: session } = useSession()
  const user = session?.user
  const { title, subtitle, icon } = usePageTitle()
  const { hasFeature, loading: licenseLoading, status: licenseStatus, isEnterprise } = useLicense()
  const { roles: rbacRoles, hasPermission } = useRBAC()

  // Check if AI feature is available
  const aiAvailable = !licenseLoading && hasFeature(Features.AI_INSIGHTS)

  // i18n hooks
  const t = useTranslations()
  const { locale, locales, localeNames, localeFlags, changeLocale, isPending } = useLocale()
  const timeAgo = createTimeAgo(t)

  // Search dialog
  const [searchOpen, setSearchOpen] = useState(false)

  // AI Chat
  const [aiChatOpen, setAiChatOpen] = useState(false)

  // About Dialog
  const [aboutOpen, setAboutOpen] = useState(false)

  // Menus anchors
  const [langAnchor, setLangAnchor] = useState(null)
  const [notifAnchor, setNotifAnchor] = useState(null)
  const [userAnchor, setUserAnchor] = useState(null)

  // RBAC-based notification visibility
  const canViewAlerts = hasPermission('alerts.view')
  const canViewAdmin = hasPermission('admin.settings')
  const canViewDrs = hasPermission('automation.view')

  // SWR hooks for notifications — gated by permissions to avoid unnecessary fetches
  const { data: alertsResponse, mutate: mutateAlerts } = useActiveAlerts(isEnterprise && canViewAlerts, 30000)
  const { data: drsRecsResponse, mutate: mutateDrsRecs } = useDRSRecommendations(isEnterprise && canViewDrs, hasFeature(Features.DRS), 30000)
  const { data: updateInfoData } = useVersionCheck(3600000)
  const { data: healthData } = useOrchestratorHealth(isEnterprise, 30000)

  // Derive notifications from SWR data
  const notifications = useMemo(() => {
    if (!alertsResponse?.data) return []
    const alerts = alertsResponse.data || []
    return alerts.map(a => ({
      id: a.id,
      message: a.message,
      severity: a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'info',
      source: a.resource || a.connection_id,
      lastSeenAt: a.last_seen_at,
      firstSeenAt: a.first_seen_at,
      occurrences: a.occurrences || 1
    }))
  }, [alertsResponse])

  const notifCount = notifications.length
  const notifStats = useMemo(() => {
    const alerts = alertsResponse?.data || []
    return {
      crit: alerts.filter(a => a.severity === 'critical').length,
      warn: alerts.filter(a => a.severity === 'warning').length
    }
  }, [alertsResponse])

  const drsRecommendations = useMemo(() => {
    return Array.isArray(drsRecsResponse) ? drsRecsResponse : []
  }, [drsRecsResponse])

  const updateInfo = updateInfoData || null

  // License expiration notification (admin only)
  const licenseExpirationNotif = canViewAdmin && licenseStatus?.licensed &&
    licenseStatus?.expiration_warn &&
    licenseStatus?.days_remaining > 0 ? {
      id: 'license-expiration',
      message: t('license.expirationWarning', { days: licenseStatus.days_remaining }),
      severity: licenseStatus.days_remaining <= 7 ? 'crit' : 'warn',
      source: 'License',
      isLicenseNotif: true
    } : null

  // Node limit exceeded notification (admin only)
  const nodeLimitNotif = canViewAdmin && licenseStatus?.node_status?.exceeded ? {
    id: 'node-limit-exceeded',
    message: t('license.nodeLimitExceeded', {
      current: licenseStatus.node_status.current_nodes,
      max: licenseStatus.node_status.max_nodes
    }),
    severity: 'crit',
    source: 'License',
    isNodeLimitNotif: true
  } : null

  // Update available notification (admin only)
  const updateNotif = canViewAdmin && updateInfo?.updateAvailable ? {
    id: 'version-update',
    message: updateInfo.commitsBehind > 0
      ? t('about.commitsBehind', { count: updateInfo.commitsBehind })
      : t('about.newCommitAvailable', { count: 0 }),
    severity: 'info',
    source: 'ProxCenter',
    isUpdateNotif: true,
    compareUrl: updateInfo.compareUrl
  } : null

  // DRS recommendations as notifications (only pending ones, requires automation.view)
  const drsNotifications = drsRecommendations
    .filter(r => r.status === 'pending')
    .slice(0, 5)
    .map(r => ({
      id: `drs-${r.id}`,
      message: t('drs.recommendationNotif', {
        vm: r.vm_name,
        source: r.source_node,
        target: r.target_node
      }),
      severity: r.priority === 'critical' ? 'crit' : r.priority === 'high' ? 'warn' : 'info',
      source: 'DRS',
      isDrsNotif: true,
      recommendation: r
    }))

  // Combined notifications (update + node limit + license + DRS + alerts)
  const allNotifications = [
    ...(nodeLimitNotif ? [nodeLimitNotif] : []),
    ...(updateNotif ? [updateNotif] : []),
    ...(licenseExpirationNotif ? [licenseExpirationNotif] : []),
    ...drsNotifications,
    ...notifications
  ]

  // Combined count
  const drsCount = drsRecommendations.filter(r => r.status === 'pending').length
  const totalNotifCount = notifCount + (licenseExpirationNotif ? 1 : 0) + (updateNotif ? 1 : 0) + (nodeLimitNotif ? 1 : 0) + drsCount

  // Combined stats
  const totalNotifStats = {
    crit: notifStats.crit + (licenseExpirationNotif?.severity === 'crit' ? 1 : 0) + (nodeLimitNotif ? 1 : 0) + drsNotifications.filter(d => d.severity === 'crit').length,
    warn: notifStats.warn + (licenseExpirationNotif?.severity === 'warn' ? 1 : 0) + drsNotifications.filter(d => d.severity === 'warn').length,
    info: (updateNotif ? 1 : 0) + drsNotifications.filter(d => d.severity === 'info').length,
    drs: drsCount
  }

  const openLang = Boolean(langAnchor)
  const openNotif = Boolean(notifAnchor)
  const openUser = Boolean(userAnchor)

  // Acquitter une alerte depuis la cloche (via orchestrator)
  const handleAcknowledge = async (e, alertId) => {
    e.stopPropagation()

    try {
      const res = await fetch(`/api/v1/orchestrator/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acknowledged_by: user?.email || user?.name || 'unknown'
        })
      })

      if (res.ok) {
        mutateAlerts()
      }
    } catch (e) {
      console.error('Failed to acknowledge:', e)
    }
  }

  // Résoudre une alerte (via orchestrator)
  const handleDeleteOne = async (e, alertId) => {
    e.stopPropagation()

    try {
      const res = await fetch(`/api/v1/orchestrator/alerts/${alertId}/resolve`, {
        method: 'POST'
      })

      if (res.ok) {
        mutateAlerts()
      }
    } catch (e) {
      console.error('Failed to resolve:', e)
    }
  }

  // Résoudre toutes les alertes affichées (via orchestrator)
  const handleDeleteAll = async () => {
    if (notifications.length === 0) return
    if (!confirm(t('alerts.resolveConfirm', { count: notifications.length }))) return

    try {
      const res = await fetch('/api/v1/orchestrator/alerts', {
        method: 'DELETE'
      })

      if (res.ok) {
        mutateAlerts()
      }
    } catch (e) {
      console.error('Failed to clear all:', e)
    }
  }

  // Acquitter toutes les alertes (via orchestrator - une par une)
  const handleAcknowledgeAll = async () => {
    if (notifications.length === 0) return
    
    try {
      const userId = user?.email || user?.name || 'unknown'

      for (const notif of notifications) {
        await fetch(`/api/v1/orchestrator/alerts/${notif.id}/acknowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acknowledged_by: userId })
        })
      }

      mutateAlerts()
    } catch (e) {
      console.error('Failed to acknowledge all:', e)
    }
  }

  // Charger les notifications quand on ouvre le menu
  const handleOpenNotif = (e) => {
    setNotifAnchor(e.currentTarget)
    mutateAlerts()
  }

  // Ctrl/Cmd + K => open search; ESC => close
  useEffect(() => {
    const onKeyDown = e => {
      const isK = e.key?.toLowerCase() === 'k'

      if ((e.ctrlKey || e.metaKey) && isK) {
        e.preventDefault()
        setSearchOpen(true)
      }

      if (e.key === 'Escape') {
        setSearchOpen(false)
        setLangAnchor(null)
        setNotifAnchor(null)
        setUserAnchor(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    
return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleLogout = async () => {
    setUserAnchor(null)
    await signOut({ callbackUrl: '/login' })
  }

  // PXCore (orchestrator) status - derived from orchestrator-native components only
  const pxcoreStatus = useMemo(() => {
    if (!healthData) return { status: 'unknown', components: null }

    const components = healthData.components

    // Derive status from orchestrator-internal health (database, DRS engine)
    // NOT from infrastructure metrics (connections, alerts)
    let status = 'healthy'

    if (components?.database && components.database.status !== 'ok' && components.database.status !== 'connected') {
      status = 'error'
    }

    return { status, components }
  }, [healthData])

  // PXCore status colors and labels
  const getPXCoreInfo = (status, components) => {
    let details = ''

    if (components) {
      const parts = []

      // Database status (orchestrator-native)
      if (components.database) {
        const dbOk = components.database.status === 'ok' || components.database.status === 'connected'
        parts.push(dbOk ? t('pxcore.databaseOk') : t('pxcore.databaseError'))
      }

      // Only show DRS info if license feature is available
      if (components.drs && hasFeature(Features.DRS)) {
        parts.push(components.drs.enabled ? t('pxcore.drsActive') : t('pxcore.drsInactive'))

        if (components.drs.active_migrations > 0) {
          parts.push(t('pxcore.migrations', { count: components.drs.active_migrations }))
        }
      }

      details = parts.length > 0 ? ` • ${parts.join(' • ')}` : ''
    }

    switch (status) {
      case 'healthy':
        return { color: '#4caf50', label: `${t('pxcore.operational')}${details}`, icon: 'ri-pulse-line' }
      case 'degraded':
        return { color: '#ff9800', label: `${t('pxcore.degraded')}${details}`, icon: 'ri-pulse-line' }
      case 'error':
        return { color: '#f44336', label: `${t('pxcore.error')}${details}`, icon: 'ri-pulse-line' }
      case 'offline':
        return { color: '#9e9e9e', label: t('pxcore.offline'), icon: 'ri-pulse-line' }
      default:
        return { color: '#9e9e9e', label: t('pxcore.unknown'), icon: 'ri-pulse-line' }
    }
  }

  const pxcoreInfo = getPXCoreInfo(pxcoreStatus.status, pxcoreStatus.components)

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 2, px: 2, position: 'relative' }}>
        {/* Page Title - Left side */}
        <Box sx={{ flex: 1, display: { xs: 'none', md: 'flex' }, alignItems: 'baseline', minWidth: 0 }}>
          {title && (
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
              {icon && (
                <i 
                  className={icon} 
                  style={{ 
                    fontSize: 18, 
                    color: 'var(--mui-palette-primary-main)',
                    opacity: 0.9,
                    flexShrink: 0,
                    position: 'relative',
                    top: 2
                  }} 
                />
              )}
              <Typography 
                variant='h6' 
                sx={{ 
                  fontWeight: 800, 
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  fontSize: '1.1rem'
                }}
              >
                {title}
              </Typography>
              {subtitle && (
                <>
                  <Typography 
                    component='span'
                    sx={{ 
                      opacity: 0.3,
                      mx: 0.5,
                      fontSize: '0.9rem',
                      lineHeight: 1
                    }}
                  >
                    •
                  </Typography>
                  <Typography 
                    variant='body2' 
                    sx={{ 
                      opacity: 0.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: '0.85rem',
                      lineHeight: 1
                    }}
                  >
                    {subtitle}
                  </Typography>
                </>
              )}
            </Box>
          )}
        </Box>

        {/* Search bar - Centered absolutely */}
        <Box sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 1 }}>
          <Box
            onClick={() => setSearchOpen(true)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.5,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              cursor: 'pointer',
              width: 360,
              transition: 'all 0.2s',
              '&:hover': {
                borderColor: 'primary.main',
                bgcolor: 'action.hover'
              }
            }}
          >
            <i className='ri-search-line' style={{ opacity: 0.5, fontSize: '1rem' }} />
            <Typography variant='body2' sx={{ opacity: 0.5, flex: 1, fontSize: '0.8rem', userSelect: 'none' }}>
              {t('navbar.search')}...
            </Typography>
          </Box>
        </Box>

        {/* RIGHT ICONS */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}>
          {/* Orchestrator Status Badge - Only show for Enterprise */}
          {isEnterprise && (
            <Tooltip title={pxcoreInfo.label}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  bgcolor: `${pxcoreInfo.color}15`,
                  transition: 'all 0.2s'
                }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: pxcoreInfo.color,
                    boxShadow: `0 0 6px ${pxcoreInfo.color}`,
                    animation: pxcoreStatus.syncing
                      ? 'pxcore-sync 0.8s ease-in-out infinite'
                      : pxcoreStatus.status === 'healthy'
                        ? 'pxcore-glow 2s ease-in-out infinite'
                        : 'none',
                    '@keyframes pxcore-glow': {
                      '0%, 100%': {
                        opacity: 1,
                        boxShadow: `0 0 6px ${pxcoreInfo.color}`
                      },
                      '50%': {
                        opacity: 0.6,
                        boxShadow: `0 0 2px ${pxcoreInfo.color}`
                      }
                    },
                    '@keyframes pxcore-sync': {
                      '0%, 100%': {
                        transform: 'scale(1)',
                        opacity: 1
                      },
                      '50%': {
                        transform: 'scale(1.3)',
                        opacity: 0.5
                      }
                    }
                  }}
                />
                <Typography
                  variant='caption'
                  sx={{
                    fontWeight: 600,
                    color: pxcoreInfo.color,
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5
                  }}
                >
                  PXCore
                </Typography>
              </Box>
            </Tooltip>
          )}

          {/* Lang */}
          <Tooltip title={t('navbar.language')}>
            <IconButton size='small' onClick={e => setLangAnchor(e.currentTarget)} disabled={isPending}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <span style={{ fontSize: '1.1rem' }}>{localeFlags[locale]}</span>
              </Box>
            </IconButton>
          </Tooltip>

          {/* Theme Dropdown */}
          <ThemeDropdown />

          {/* AI Assistant */}
          <Tooltip title={aiAvailable ? t('navbar.aiAssistant') : t('license.enterpriseRequired')}>
            <span>
              <IconButton
                size='small'
                onClick={() => aiAvailable && setAiChatOpen(true)}
                disabled={!aiAvailable}
                sx={!aiAvailable ? { opacity: 0.4 } : {}}
              >
                <i className='ri-sparkling-2-line' />
                {!aiAvailable && (
                  <Box
                    component='span'
                    sx={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      bgcolor: 'warning.main',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.5rem',
                      fontWeight: 700,
                      color: 'warning.contrastText'
                    }}
                  >
                    E
                  </Box>
                )}
              </IconButton>
            </span>
          </Tooltip>

          {/* Running Tasks */}
          <TasksDropdown />

          {/* Notifications */}
          <Tooltip title={t('navbar.notifications')}>
            <IconButton size='small' onClick={handleOpenNotif}>
              <Badge
                badgeContent={totalNotifCount}
                color={totalNotifStats.crit > 0 ? 'error' : 'warning'}
                invisible={totalNotifCount === 0}
              >
                <i className='ri-notification-3-line' />
              </Badge>
            </IconButton>
          </Tooltip>

          {/* Toggle to Horizontal Layout */}
          <Tooltip title={t('navbar.horizontalLayout')}>
            <IconButton size='small' onClick={() => updateSettings({ layout: 'horizontal' })}>
              <i className='ri-layout-top-line' />
            </IconButton>
          </Tooltip>

          {/* Profile */}
          <Tooltip title={t('navbar.profile')}>
            <IconButton size='small' onClick={e => setUserAnchor(e.currentTarget)}>
              <Avatar
                src={user?.avatar || undefined}
                sx={{
                  width: 32,
                  height: 32,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  bgcolor: 'primary.main'
                }}
              >
                {!user?.avatar && getInitials(user?.name, user?.email)}
              </Avatar>
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* COMMAND PALETTE (Ctrl+K) */}
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* LANGUAGE MENU */}
      <Menu anchorEl={langAnchor} open={openLang} onClose={() => setLangAnchor(null)}>
        {locales.map((loc) => (
          <MenuItem
            key={loc}
            onClick={() => {
              changeLocale(loc)
              setLangAnchor(null)
            }}
            selected={locale === loc}
          >
            <ListItemIcon>
              <span style={{ fontSize: '1.2rem' }}>{localeFlags[loc]}</span>
            </ListItemIcon>
            {localeNames[loc]}
          </MenuItem>
        ))}
      </Menu>

      {/* NOTIFICATIONS MENU */}
      <Menu
        anchorEl={notifAnchor}
        open={openNotif}
        onClose={() => setNotifAnchor(null)}
        PaperProps={{
          sx: { width: 400, maxHeight: 520 }
        }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>{t('navbar.notifications')}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {totalNotifStats.crit > 0 && (
              <Chip
                size='small'
                label={`${totalNotifStats.crit} ${totalNotifStats.crit > 1 ? t('alerts.criticals') : t('alerts.critical')}`}
                color='error'
                sx={{ height: 20, fontSize: '0.6rem' }}
              />
            )}
            {totalNotifStats.warn > 0 && (
              <Chip
                size='small'
                label={`${totalNotifStats.warn} ${totalNotifStats.warn > 1 ? t('alerts.warnings') : t('alerts.warning')}`}
                color='warning'
                sx={{ height: 20, fontSize: '0.6rem' }}
              />
            )}
            {totalNotifStats.drs > 0 && (
              <Chip
                size='small'
                label={`${totalNotifStats.drs} DRS`}
                color='primary'
                sx={{ height: 20, fontSize: '0.6rem' }}
              />
            )}
          </Box>
        </Box>
        <Divider />

        {allNotifications.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <i className='ri-checkbox-circle-line' style={{ fontSize: 32, color: 'var(--mui-palette-success-main)', opacity: 0.7 }} />
            <Typography variant='body2' sx={{ mt: 1, opacity: 0.7 }}>
              {t('alerts.noActiveAlerts')}
            </Typography>
            <Typography variant='caption' sx={{ opacity: 0.5 }}>
              {t('alerts.allSystemsNormal')}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
            {allNotifications.map((notif) => {
              // Handle update notification specially
              if (notif.isUpdateNotif) {
                return (
                  <Box
                    key={notif.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      py: 1.5,
                      px: 2,
                      borderLeft: '3px solid',
                      borderColor: 'info.main',
                      cursor: 'pointer',
                      bgcolor: 'info.lighter',
                      '&:hover': { bgcolor: 'info.light', opacity: 0.9 }
                    }}
                    onClick={() => {
                      setNotifAnchor(null)
                      setAboutOpen(true)
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <i className='ri-download-cloud-line' style={{
                        color: 'var(--mui-palette-info-main)',
                        fontSize: 20
                      }} />
                    </ListItemIcon>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='body2' sx={{
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '0.8rem'
                      }}>
                        {notif.message}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <Chip
                          size='small'
                          label={t('about.updateAvailable')}
                          color='info'
                          sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700 }}
                        />
                        {updateInfo?.latestSha && (
                          <Typography variant='caption' sx={{ opacity: 0.6, fontSize: '0.65rem', fontFamily: 'JetBrains Mono, monospace' }}>
                            {updateInfo.latestSha.substring(0, 7)}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', ml: 1 }}>
                      {notif.compareUrl && (
                        <Tooltip title={t('about.viewChanges')}>
                          <IconButton
                            size='small'
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(notif.compareUrl, '_blank')
                            }}
                            sx={{
                              opacity: 0.7,
                              '&:hover': { opacity: 1, color: 'info.main' }
                            }}
                          >
                            <i className='ri-external-link-line' style={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                )
              }

              // Handle license notification specially
              if (notif.isLicenseNotif) {
                const licenseColor = notif.severity === 'crit' ? 'error' : 'warning'
                return (
                  <Box
                    key={notif.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      py: 1.5,
                      px: 2,
                      borderLeft: '3px solid',
                      borderColor: `${licenseColor}.main`,
                      cursor: 'pointer',
                      bgcolor: `${licenseColor}.lighter`,
                      '&:hover': { bgcolor: `${licenseColor}.light`, opacity: 0.9 }
                    }}
                    onClick={() => {
                      setNotifAnchor(null)
                      router.push('/settings')
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <i className='ri-key-2-line' style={{
                        color: `var(--mui-palette-${licenseColor}-main)`,
                        fontSize: 20
                      }} />
                    </ListItemIcon>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='body2' sx={{
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '0.8rem'
                      }}>
                        {notif.message}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <Chip
                          size='small'
                          label={notif.severity === 'crit' ? t('license.expiringSoon') : t('license.expiringNotice')}
                          color={licenseColor}
                          sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700 }}
                        />
                        <Typography variant='caption' sx={{ opacity: 0.6, fontSize: '0.65rem' }}>
                          {notif.source}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', ml: 1 }}>
                      <Tooltip title={t('license.renewLicense')}>
                        <IconButton
                          size='small'
                          onClick={(e) => {
                            e.stopPropagation()
                            setNotifAnchor(null)
                            router.push('/settings')
                          }}
                          sx={{
                            opacity: 0.7,
                            '&:hover': { opacity: 1, color: `${licenseColor}.main` }
                          }}
                        >
                          <i className='ri-arrow-right-line' style={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                )
              }

              // Handle node limit exceeded notification
              if (notif.isNodeLimitNotif) {
                return (
                  <Box
                    key={notif.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      py: 1.5,
                      px: 2,
                      borderLeft: '3px solid',
                      borderColor: 'error.main',
                      cursor: 'pointer',
                      bgcolor: 'error.lighter',
                      '&:hover': { bgcolor: 'error.light', opacity: 0.9 }
                    }}
                    onClick={() => {
                      setNotifAnchor(null)
                      router.push('/settings')
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <i className='ri-server-line' style={{
                        color: 'var(--mui-palette-error-main)',
                        fontSize: 20
                      }} />
                    </ListItemIcon>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='body2' sx={{
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '0.8rem'
                      }}>
                        {notif.message}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <Chip
                          size='small'
                          label={t('license.nodeLimitWarning')}
                          color='error'
                          sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700 }}
                        />
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', ml: 1 }}>
                      <Tooltip title={t('license.nodeLimitUpgrade')}>
                        <IconButton
                          size='small'
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open('https://proxcenter.io/account/subscribe', '_blank')
                          }}
                          sx={{
                            opacity: 0.7,
                            '&:hover': { opacity: 1, color: 'error.main' }
                          }}
                        >
                          <i className='ri-shopping-cart-line' style={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                )
              }

              // Handle DRS recommendation notification
              if (notif.isDrsNotif) {
                const drsColor = notif.severity === 'crit' ? 'error' : notif.severity === 'warn' ? 'warning' : 'info'
                const rec = notif.recommendation
                return (
                  <Box
                    key={notif.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      py: 1.5,
                      px: 2,
                      borderLeft: '3px solid',
                      borderColor: 'primary.main',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' }
                    }}
                    onClick={() => {
                      setNotifAnchor(null)
                      router.push('/automation/drs')
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <i className='ri-swap-line' style={{
                        color: 'var(--mui-palette-primary-main)',
                        fontSize: 20
                      }} />
                    </ListItemIcon>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='body2' sx={{
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '0.8rem'
                      }}>
                        {rec.vm_name}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <Chip
                          size='small'
                          label='DRS'
                          color='primary'
                          sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700 }}
                        />
                        <Typography variant='caption' sx={{ opacity: 0.6, fontSize: '0.65rem' }}>
                          {rec.source_node} → {rec.target_node}
                        </Typography>
                      </Box>
                      <Typography variant='caption' sx={{ opacity: 0.5, fontSize: '0.6rem', display: 'block', mt: 0.25 }}>
                        {rec.reason}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', ml: 1 }}>
                      <Tooltip title={t('drs.viewRecommendations')}>
                        <IconButton
                          size='small'
                          onClick={(e) => {
                            e.stopPropagation()
                            setNotifAnchor(null)
                            router.push('/automation/drs')
                          }}
                          sx={{
                            opacity: 0.7,
                            '&:hover': { opacity: 1, color: 'primary.main' }
                          }}
                        >
                          <i className='ri-arrow-right-line' style={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                )
              }

              const { icon, color } = getAlertIcon(notif)

              return (
                <Box
                  key={notif.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    py: 1.5,
                    px: 2,
                    borderLeft: '3px solid',
                    borderColor: `${color}.main`,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                  onClick={() => {
                    setNotifAnchor(null)
                    router.push('/operations/alerts')
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <i className={icon} style={{
                      color: `var(--mui-palette-${color}-main)`,
                      fontSize: 20
                    }} />
                  </ListItemIcon>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant='body2' sx={{
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: '0.8rem'
                    }}>
                      {notif.message}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                      <Chip
                        size='small'
                        label={notif.severity === 'crit' ? 'CRITIQUE' : 'WARNING'}
                        color={color}
                        sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700 }}
                      />
                      <Typography variant='caption' sx={{ opacity: 0.6, fontSize: '0.65rem' }}>
                        {notif.source}
                      </Typography>
                      <Typography variant='caption' sx={{ opacity: 0.5, fontSize: '0.65rem' }}>
                        • {timeAgo(notif.lastSeenAt || notif.firstSeenAt)}
                      </Typography>
                      {notif.occurrences > 1 && (
                        <Chip
                          size='small'
                          label={`×${notif.occurrences}`}
                          variant='outlined'
                          sx={{ height: 14, fontSize: '0.55rem', ml: 0.5 }}
                        />
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', ml: 1 }}>
                    <Tooltip title={t('alerts.acknowledge')}>
                      <IconButton
                        size='small'
                        onClick={(e) => handleAcknowledge(e, notif.id)}
                        sx={{
                          opacity: 0.5,
                          '&:hover': { opacity: 1, color: 'warning.main' }
                        }}
                      >
                        <i className='ri-checkbox-circle-line' style={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                      <IconButton
                        size='small'
                        onClick={(e) => handleDeleteOne(e, notif.id)}
                        sx={{
                          opacity: 0.5,
                          '&:hover': { opacity: 1, color: 'error.main' }
                        }}
                      >
                        <i className='ri-delete-bin-line' style={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
        
        <Divider />
        
        {/* Actions globales */}
        {notifications.length > 0 && (
          <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, justifyContent: 'center' }}>
            <Tooltip title={t('alerts.acknowledgeAll')}>
              <IconButton
                size='small'
                onClick={handleAcknowledgeAll}
                sx={{ color: 'warning.main' }}
              >
                <i className='ri-checkbox-multiple-line' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('alerts.resolveAll')}>
              <IconButton
                size='small'
                onClick={handleDeleteAll}
                sx={{ color: 'error.main' }}
              >
                <i className='ri-delete-bin-2-line' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Divider />
        <MenuItem
          onClick={() => {
            setNotifAnchor(null)
            router.push('/operations/alerts')
          }}
          sx={{ justifyContent: 'center', py: 1.5 }}
        >
          <Typography variant='body2' color='primary' sx={{ fontWeight: 600 }}>
            {t('alerts.viewAll')}
          </Typography>
        </MenuItem>
      </Menu>

      {/* USER MENU */}
      <Menu anchorEl={userAnchor} open={openUser} onClose={() => setUserAnchor(null)}>
        {/* User info header */}
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 600 }}>
            {user?.name || t('user.defaultName')}
          </Typography>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>
            {user?.email}
          </Typography>
          {rbacRoles.length > 0 && (
            <Chip
              size='small'
              label={rbacRoles[0]?.name || '—'}
              sx={{ ml: 1, height: 20, fontSize: '0.65rem', bgcolor: rbacRoles[0]?.color || undefined, color: '#fff' }}
            />
          )}
        </Box>
        <Divider />

        <MenuItem
          onClick={() => {
            setUserAnchor(null)
            router.push('/profile')
          }}
        >
          <ListItemIcon>
            <i className='ri-user-line' />
          </ListItemIcon>
          {t('navbar.profile')}
        </MenuItem>

        <MenuItem
          onClick={() => {
            setUserAnchor(null)
            router.push('/settings')
          }}
        >
          <ListItemIcon>
            <i className='ri-settings-3-line' />
          </ListItemIcon>
          {t('navigation.settings')}
        </MenuItem>

        {hasPermission('admin.users') && (
          <MenuItem
            onClick={() => {
              setUserAnchor(null)
              router.push('/security/users')
            }}
          >
            <ListItemIcon>
              <i className='ri-shield-user-line' />
            </ListItemIcon>
            {t('navigation.users')}
          </MenuItem>
        )}

        <Divider />

        <MenuItem
          onClick={() => {
            setUserAnchor(null)
            setAboutOpen(true)
          }}
        >
          <ListItemIcon>
            <i className='ri-information-line' />
          </ListItemIcon>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {t('about.title')}
            <Chip
              label={GIT_SHA ? GIT_SHA.substring(0, 7) : 'dev'}
              size='small'
              sx={{ height: 18, fontSize: '0.6rem', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}
              color={updateInfo?.updateAvailable ? 'warning' : 'default'}
            />
          </Box>
        </MenuItem>

        <Divider />

        <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
          <ListItemIcon>
            <i className='ri-logout-box-r-line' style={{ color: 'inherit' }} />
          </ListItemIcon>
          {t('auth.logout')}
        </MenuItem>
      </Menu>

      {/* AI Chat Drawer */}
      <AIChatDrawer open={aiChatOpen} onClose={() => setAiChatOpen(false)} />

      {/* About Dialog */}
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  )
}

export default NavbarContent
