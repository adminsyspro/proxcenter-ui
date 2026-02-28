'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import {
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
  Typography
} from '@mui/material'
import { useTheme, darken } from '@mui/material/styles'

import { useLocale } from '@/contexts/LocaleContext'
import { useSettings } from '@core/hooks/useSettings'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { useRBAC } from '@/contexts/RBACContext'
import { useActiveAlerts, useDRSRecommendations, useVersionCheck, useOrchestratorHealth } from '@/hooks/useNavbarNotifications'
import { GIT_SHA } from '@/config/version'

import ThemeDropdown from '@components/layout/shared/ThemeDropdown'
import AIChatDrawer from '@components/layout/shared/AIChatDrawer'
import TasksDropdown from '@components/layout/shared/TasksDropdown'
import AboutDialog from '@components/dialogs/AboutDialog'
import CommandPalette from '@components/layout/shared/CommandPalette'
import { LogoIcon } from '@components/layout/shared/Logo'

import VCenterBurgerMenu from './VCenterBurgerMenu'

const getInitials = (name, email) => {
  if (name) {
    const parts = name.split(' ')
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return name.substring(0, 2).toUpperCase()
  }
  if (email) return email.substring(0, 2).toUpperCase()
  return 'U'
}

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

const getAlertIcon = (alert) => {
  const msg = alert.message?.toLowerCase() || ''
  if (msg.includes('offline') || msg.includes('quorum')) return { icon: 'ri-server-line', color: 'error' }
  if (msg.includes('ceph')) return { icon: 'ri-database-2-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  if (msg.includes('pbs') || msg.includes('backup')) return { icon: 'ri-shield-check-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  if (msg.includes('cpu')) return { icon: 'ri-cpu-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  if (msg.includes('ram') || msg.includes('memory')) return { icon: 'ri-ram-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  if (msg.includes('stockage') || msg.includes('storage')) return { icon: 'ri-hard-drive-2-line', color: alert.severity === 'crit' ? 'error' : 'warning' }
  return {
    icon: alert.severity === 'crit' ? 'ri-error-warning-line' : 'ri-alarm-warning-line',
    color: alert.severity === 'crit' ? 'error' : 'warning'
  }
}

const VCenterHeader = () => {
  const theme = useTheme()
  const { settings } = useSettings()
  const router = useRouter()
  const { data: session } = useSession()
  const user = session?.user
  const { hasFeature, loading: licenseLoading, status: licenseStatus, isEnterprise } = useLicense()
  const { roles: rbacRoles, hasPermission } = useRBAC()

  const aiAvailable = !licenseLoading && hasFeature(Features.AI_INSIGHTS)

  const t = useTranslations()
  const { locale, locales, localeNames, localeFlags, changeLocale, isPending } = useLocale()
  const timeAgo = createTimeAgo(t)

  // State
  const [searchOpen, setSearchOpen] = useState(false)
  const [aiChatOpen, setAiChatOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [burgerAnchor, setBurgerAnchor] = useState(null)
  const [langAnchor, setLangAnchor] = useState(null)
  const [notifAnchor, setNotifAnchor] = useState(null)
  const [userAnchor, setUserAnchor] = useState(null)

  // RBAC-based notification visibility
  const canViewAlerts = hasPermission('alerts.view')
  const canViewAdmin = hasPermission('admin.settings')
  const canViewDrs = hasPermission('automation.view')

  // SWR hooks for notifications
  const { data: alertsResponse, mutate: mutateAlerts } = useActiveAlerts(isEnterprise && canViewAlerts, 30000)
  const { data: drsRecsResponse } = useDRSRecommendations(isEnterprise && canViewDrs, hasFeature(Features.DRS), 30000)
  const { data: updateInfoData } = useVersionCheck(3600000)
  const { data: healthData } = useOrchestratorHealth(isEnterprise, 30000)

  // Notifications
  const notifications = useMemo(() => {
    if (!alertsResponse?.data) return []
    return (alertsResponse.data || []).map(a => ({
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

  const licenseExpirationNotif = canViewAdmin && licenseStatus?.licensed &&
    licenseStatus?.expiration_warn &&
    licenseStatus?.days_remaining > 0 ? {
      id: 'license-expiration',
      message: t('license.expirationWarning', { days: licenseStatus.days_remaining }),
      severity: licenseStatus.days_remaining <= 7 ? 'crit' : 'warn',
      source: 'License',
      isLicenseNotif: true
    } : null

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

  const drsNotifications = drsRecommendations
    .filter(r => r.status === 'pending')
    .slice(0, 5)
    .map(r => ({
      id: `drs-${r.id}`,
      message: t('drs.recommendationNotif', { vm: r.vm_name, source: r.source_node, target: r.target_node }),
      severity: r.priority === 'critical' ? 'crit' : r.priority === 'high' ? 'warn' : 'info',
      source: 'DRS',
      isDrsNotif: true,
      recommendation: r
    }))

  const allNotifications = [
    ...(nodeLimitNotif ? [nodeLimitNotif] : []),
    ...(updateNotif ? [updateNotif] : []),
    ...(licenseExpirationNotif ? [licenseExpirationNotif] : []),
    ...drsNotifications,
    ...notifications
  ]

  const drsCount = drsRecommendations.filter(r => r.status === 'pending').length
  const totalNotifCount = notifCount + (licenseExpirationNotif ? 1 : 0) + (updateNotif ? 1 : 0) + (nodeLimitNotif ? 1 : 0) + drsCount
  const totalNotifStats = {
    crit: notifStats.crit + (licenseExpirationNotif?.severity === 'crit' ? 1 : 0) + (nodeLimitNotif ? 1 : 0) + drsNotifications.filter(d => d.severity === 'crit').length,
    warn: notifStats.warn + (licenseExpirationNotif?.severity === 'warn' ? 1 : 0) + drsNotifications.filter(d => d.severity === 'warn').length,
    info: (updateNotif ? 1 : 0) + drsNotifications.filter(d => d.severity === 'info').length,
    drs: drsCount
  }

  const openLang = Boolean(langAnchor)
  const openNotif = Boolean(notifAnchor)
  const openUser = Boolean(userAnchor)

  // Handlers
  const handleAcknowledge = async (e, alertId) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/v1/orchestrator/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged_by: user?.email || user?.name || 'unknown' })
      })
      if (res.ok) mutateAlerts()
    } catch (e) { console.error('Failed to acknowledge:', e) }
  }

  const handleDeleteOne = async (e, alertId) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/v1/orchestrator/alerts/${alertId}/resolve`, { method: 'POST' })
      if (res.ok) mutateAlerts()
    } catch (e) { console.error('Failed to resolve:', e) }
  }

  const handleDeleteAll = async () => {
    if (notifications.length === 0) return
    if (!confirm(t('alerts.resolveConfirm', { count: notifications.length }))) return
    try {
      const res = await fetch('/api/v1/orchestrator/alerts', { method: 'DELETE' })
      if (res.ok) mutateAlerts()
    } catch (e) { console.error('Failed to clear all:', e) }
  }

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
    } catch (e) { console.error('Failed to acknowledge all:', e) }
  }

  const handleOpenNotif = (e) => {
    setNotifAnchor(e.currentTarget)
    mutateAlerts()
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = e => {
      if ((e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setLangAnchor(null)
        setNotifAnchor(null)
        setUserAnchor(null)
        setBurgerAnchor(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleLogout = async () => {
    setUserAnchor(null)
    await signOut({ callbackUrl: '/login' })
  }

  // PXCore status
  const pxcoreStatus = useMemo(() => {
    if (!healthData) return { status: 'unknown', components: null }
    const components = healthData.components
    let status = 'healthy'
    if (components?.database && components.database.status !== 'ok' && components.database.status !== 'connected') {
      status = 'error'
    }
    return { status, components }
  }, [healthData])

  const getPXCoreInfo = (status, components) => {
    let details = ''
    if (components) {
      const parts = []
      if (components.database) {
        const dbOk = components.database.status === 'ok' || components.database.status === 'connected'
        parts.push(dbOk ? t('pxcore.databaseOk') : t('pxcore.databaseError'))
      }
      if (components.drs && hasFeature(Features.DRS)) {
        parts.push(components.drs.enabled ? t('pxcore.drsActive') : t('pxcore.drsInactive'))
        if (components.drs.active_migrations > 0) parts.push(t('pxcore.migrations', { count: components.drs.active_migrations }))
      }
      details = parts.length > 0 ? ` • ${parts.join(' • ')}` : ''
    }
    switch (status) {
      case 'healthy': return { color: '#4caf50', label: `${t('pxcore.operational')}${details}`, icon: 'ri-pulse-line' }
      case 'degraded': return { color: '#ff9800', label: `${t('pxcore.degraded')}${details}`, icon: 'ri-pulse-line' }
      case 'error': return { color: '#f44336', label: `${t('pxcore.error')}${details}`, icon: 'ri-pulse-line' }
      case 'offline': return { color: '#9e9e9e', label: t('pxcore.offline'), icon: 'ri-pulse-line' }
      default: return { color: '#9e9e9e', label: t('pxcore.unknown'), icon: 'ri-pulse-line' }
    }
  }

  const pxcoreInfo = getPXCoreInfo(pxcoreStatus.status, pxcoreStatus.components)

  // Derive header colors from theme primary
  const primaryColor = theme.palette.primary.main
  const headerBg = darken(primaryColor, 0.82)
  const headerBorder = darken(primaryColor, 0.65)
  const headerHover = darken(primaryColor, 0.55)
  const headerTextMuted = darken(primaryColor, 0.15)
  const accentLight = theme.palette.primary.light || primaryColor

  return (
    <>
      {/* Main header bar */}
      <Box
        className='vcenter-header'
        sx={{
          display: 'flex',
          alignItems: 'center',
          height: 56,
          backgroundColor: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
          px: 2,
          position: 'sticky',
          top: 0,
          zIndex: 1100,
          boxShadow: 'none'
        }}
      >
        {/* LEFT: Logo + Burger */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
          {/* Logo */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              cursor: 'pointer',
              mr: 1
            }}
            onClick={() => router.push('/home')}
          >
            <LogoIcon size={24} accentColor={primaryColor} />
            <Typography
              sx={{
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.02em',
                display: { xs: 'none', sm: 'block' }
              }}
            >
              ProxCenter
            </Typography>
          </Box>

          {/* Burger button */}
          <Button
            size='small'
            onClick={(e) => setBurgerAnchor(e.currentTarget)}
            sx={{
              color: 'rgba(255,255,255,0.75)',
              textTransform: 'none',
              fontSize: 12,
              fontWeight: 500,
              minWidth: 'auto',
              px: 1,
              py: 0.5,
              borderRadius: '3px',
              '&:hover': {
                backgroundColor: headerHover,
                color: '#fff'
              }
            }}
          >
            <i className='ri-menu-line' style={{ fontSize: 18, marginRight: 4 }} />
            <Box component='span' sx={{ display: { xs: 'none', sm: 'inline' } }}>Menu</Box>
          </Button>
        </Box>

        {/* CENTER: Search */}
        <Box
          onClick={() => setSearchOpen(true)}
          sx={{
            display: { xs: 'none', lg: 'flex' },
            alignItems: 'center',
            gap: 0.75,
            px: 1.5,
            py: 0.5,
            borderRadius: '3px',
            border: `1px solid ${headerBorder}`,
            cursor: 'pointer',
            width: 260,
            mx: 2,
            transition: 'all 150ms',
            '&:hover': {
              borderColor: accentLight,
              backgroundColor: 'rgba(255,255,255,0.05)'
            }
          }}
        >
          <i className='ri-search-line' style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }} />
          <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, flex: 1, userSelect: 'none' }}>
            {t('navbar.search')}...
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, fontFamily: 'monospace' }}>
            Ctrl+K
          </Typography>
        </Box>

        {/* RIGHT: Icons */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {/* PXCore Status */}
          {isEnterprise && (
            <Tooltip title={pxcoreInfo.label}>
              <Box
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  alignItems: 'center',
                  gap: 0.5,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: '3px',
                  bgcolor: `${pxcoreInfo.color}15`
                }}
              >
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: pxcoreInfo.color,
                    boxShadow: `0 0 4px ${pxcoreInfo.color}`
                  }}
                />
                <Typography sx={{ fontWeight: 600, color: pxcoreInfo.color, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  PXCore
                </Typography>
              </Box>
            </Tooltip>
          )}

          {/* Language */}
          <Tooltip title={t('navbar.language')}>
            <IconButton size='small' onClick={e => setLangAnchor(e.currentTarget)} disabled={isPending} sx={{ color: 'rgba(255,255,255,0.75)' }}>
              <span style={{ fontSize: 16 }}>{localeFlags[locale]}</span>
            </IconButton>
          </Tooltip>

          {/* Theme */}
          <ThemeDropdown />

          {/* AI */}
          <Tooltip title={aiAvailable ? t('navbar.aiAssistant') : t('license.enterpriseRequired')}>
            <span>
              <IconButton
                size='small'
                onClick={() => aiAvailable && setAiChatOpen(true)}
                disabled={!aiAvailable}
                sx={{ color: 'rgba(255,255,255,0.75)', ...(!aiAvailable && { opacity: 0.3 }) }}
              >
                <i className='ri-sparkling-2-line' style={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>

          {/* Tasks */}
          <TasksDropdown />

          {/* Notifications */}
          <Tooltip title={t('navbar.notifications')}>
            <IconButton size='small' onClick={handleOpenNotif} sx={{ color: 'rgba(255,255,255,0.75)' }}>
              <Badge badgeContent={totalNotifCount} color={totalNotifStats.crit > 0 ? 'error' : 'warning'} invisible={totalNotifCount === 0}>
                <i className='ri-notification-3-line' style={{ fontSize: 18 }} />
              </Badge>
            </IconButton>
          </Tooltip>

          {/* Profile */}
          <Tooltip title={t('navbar.profile')}>
            <IconButton size='small' onClick={e => setUserAnchor(e.currentTarget)} sx={{ ml: 0.5 }}>
              <Avatar
                src={user?.avatar || undefined}
                sx={{ width: 28, height: 28, fontSize: 11, fontWeight: 600, bgcolor: primaryColor }}
              >
                {!user?.avatar && getInitials(user?.name, user?.email)}
              </Avatar>
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* BURGER MENU */}
      <VCenterBurgerMenu
        anchorEl={burgerAnchor}
        open={Boolean(burgerAnchor)}
        onClose={() => setBurgerAnchor(null)}
      />

      {/* COMMAND PALETTE */}
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* LANGUAGE MENU */}
      <Menu anchorEl={langAnchor} open={openLang} onClose={() => setLangAnchor(null)}>
        {locales.map((loc) => (
          <MenuItem
            key={loc}
            onClick={() => { changeLocale(loc); setLangAnchor(null) }}
            selected={locale === loc}
          >
            <ListItemIcon><span style={{ fontSize: '1.2rem' }}>{localeFlags[loc]}</span></ListItemIcon>
            {localeNames[loc]}
          </MenuItem>
        ))}
      </Menu>

      {/* NOTIFICATIONS MENU */}
      <Menu
        anchorEl={notifAnchor}
        open={openNotif}
        onClose={() => setNotifAnchor(null)}
        PaperProps={{ sx: { width: 400, maxHeight: 520 } }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>{t('navbar.notifications')}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {totalNotifStats.crit > 0 && (
              <Chip size='small' label={`${totalNotifStats.crit} ${totalNotifStats.crit > 1 ? t('alerts.criticals') : t('alerts.critical')}`} color='error' sx={{ height: 20, fontSize: '0.6rem' }} />
            )}
            {totalNotifStats.warn > 0 && (
              <Chip size='small' label={`${totalNotifStats.warn} ${totalNotifStats.warn > 1 ? t('alerts.warnings') : t('alerts.warning')}`} color='warning' sx={{ height: 20, fontSize: '0.6rem' }} />
            )}
            {totalNotifStats.drs > 0 && (
              <Chip size='small' label={`${totalNotifStats.drs} DRS`} color='primary' sx={{ height: 20, fontSize: '0.6rem' }} />
            )}
          </Box>
        </Box>
        <Divider />

        {allNotifications.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <i className='ri-checkbox-circle-line' style={{ fontSize: 32, color: 'var(--mui-palette-success-main)', opacity: 0.7 }} />
            <Typography variant='body2' sx={{ mt: 1, opacity: 0.7 }}>{t('alerts.noActiveAlerts')}</Typography>
            <Typography variant='caption' sx={{ opacity: 0.5 }}>{t('alerts.allSystemsNormal')}</Typography>
          </Box>
        ) : (
          <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
            {allNotifications.map((notif) => {
              if (notif.isUpdateNotif) {
                return (
                  <Box key={notif.id} sx={{ display: 'flex', alignItems: 'center', py: 1.5, px: 2, borderLeft: '3px solid', borderColor: 'info.main', cursor: 'pointer', bgcolor: 'info.lighter', '&:hover': { bgcolor: 'info.light', opacity: 0.9 } }}
                    onClick={() => { setNotifAnchor(null); setAboutOpen(true) }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <i className='ri-download-cloud-line' style={{ color: 'var(--mui-palette-info-main)', fontSize: 20 }} />
                    </ListItemIcon>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{notif.message}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <Chip size='small' label={t('about.updateAvailable')} color='info' sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700 }} />
                      </Box>
                    </Box>
                  </Box>
                )
              }

              if (notif.isLicenseNotif) {
                const lColor = notif.severity === 'crit' ? 'error' : 'warning'
                return (
                  <Box key={notif.id} sx={{ display: 'flex', alignItems: 'center', py: 1.5, px: 2, borderLeft: '3px solid', borderColor: `${lColor}.main`, cursor: 'pointer', bgcolor: `${lColor}.lighter`, '&:hover': { bgcolor: `${lColor}.light`, opacity: 0.9 } }}
                    onClick={() => { setNotifAnchor(null); router.push('/settings') }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <i className='ri-key-2-line' style={{ color: `var(--mui-palette-${lColor}-main)`, fontSize: 20 }} />
                    </ListItemIcon>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{notif.message}</Typography>
                    </Box>
                  </Box>
                )
              }

              if (notif.isNodeLimitNotif) {
                return (
                  <Box key={notif.id} sx={{ display: 'flex', alignItems: 'center', py: 1.5, px: 2, borderLeft: '3px solid', borderColor: 'error.main', cursor: 'pointer', bgcolor: 'error.lighter', '&:hover': { bgcolor: 'error.light', opacity: 0.9 } }}
                    onClick={() => { setNotifAnchor(null); router.push('/settings') }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <i className='ri-server-line' style={{ color: 'var(--mui-palette-error-main)', fontSize: 20 }} />
                    </ListItemIcon>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{notif.message}</Typography>
                    </Box>
                  </Box>
                )
              }

              if (notif.isDrsNotif) {
                const rec = notif.recommendation
                return (
                  <Box key={notif.id} sx={{ display: 'flex', alignItems: 'center', py: 1.5, px: 2, borderLeft: '3px solid', borderColor: 'primary.main', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                    onClick={() => { setNotifAnchor(null); router.push('/automation/drs') }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <i className='ri-swap-line' style={{ color: 'var(--mui-palette-primary-main)', fontSize: 20 }} />
                    </ListItemIcon>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{rec.vm_name}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <Chip size='small' label='DRS' color='primary' sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700 }} />
                        <Typography variant='caption' sx={{ opacity: 0.6, fontSize: '0.65rem' }}>{rec.source_node} → {rec.target_node}</Typography>
                      </Box>
                    </Box>
                  </Box>
                )
              }

              const { icon, color } = getAlertIcon(notif)
              return (
                <Box key={notif.id} sx={{ display: 'flex', alignItems: 'center', py: 1.5, px: 2, borderLeft: '3px solid', borderColor: `${color}.main`, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => { setNotifAnchor(null); router.push('/operations/alerts') }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <i className={icon} style={{ color: `var(--mui-palette-${color}-main)`, fontSize: 20 }} />
                  </ListItemIcon>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{notif.message}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                      <Chip size='small' label={notif.severity === 'crit' ? 'CRITIQUE' : 'WARNING'} color={color} sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700 }} />
                      <Typography variant='caption' sx={{ opacity: 0.6, fontSize: '0.65rem' }}>{notif.source}</Typography>
                      <Typography variant='caption' sx={{ opacity: 0.5, fontSize: '0.65rem' }}>• {timeAgo(notif.lastSeenAt || notif.firstSeenAt)}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', ml: 1 }}>
                    <Tooltip title={t('alerts.acknowledge')}>
                      <IconButton size='small' onClick={(e) => handleAcknowledge(e, notif.id)} sx={{ opacity: 0.5, '&:hover': { opacity: 1, color: 'warning.main' } }}>
                        <i className='ri-checkbox-circle-line' style={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                      <IconButton size='small' onClick={(e) => handleDeleteOne(e, notif.id)} sx={{ opacity: 0.5, '&:hover': { opacity: 1, color: 'error.main' } }}>
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
        {notifications.length > 0 && (
          <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, justifyContent: 'center' }}>
            <Tooltip title={t('alerts.acknowledgeAll')}>
              <IconButton size='small' onClick={handleAcknowledgeAll} sx={{ color: 'warning.main' }}>
                <i className='ri-checkbox-multiple-line' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('alerts.resolveAll')}>
              <IconButton size='small' onClick={handleDeleteAll} sx={{ color: 'error.main' }}>
                <i className='ri-delete-bin-2-line' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        <Divider />
        <MenuItem onClick={() => { setNotifAnchor(null); router.push('/operations/alerts') }} sx={{ justifyContent: 'center', py: 1.5 }}>
          <Typography variant='body2' color='primary' sx={{ fontWeight: 600 }}>{t('alerts.viewAll')}</Typography>
        </MenuItem>
      </Menu>

      {/* USER MENU */}
      <Menu anchorEl={userAnchor} open={openUser} onClose={() => setUserAnchor(null)}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 600 }}>{user?.name || t('user.defaultName')}</Typography>
          <Typography variant='caption' sx={{ opacity: 0.6 }}>{user?.email}</Typography>
          {rbacRoles.length > 0 && (
            <Chip size='small' label={rbacRoles[0]?.name || '—'} sx={{ ml: 1, height: 20, fontSize: '0.65rem', bgcolor: rbacRoles[0]?.color || undefined, color: '#fff' }} />
          )}
        </Box>
        <Divider />
        <MenuItem onClick={() => { setUserAnchor(null); router.push('/profile') }}>
          <ListItemIcon><i className='ri-user-line' /></ListItemIcon>
          {t('navbar.profile')}
        </MenuItem>
        <MenuItem onClick={() => { setUserAnchor(null); router.push('/settings') }}>
          <ListItemIcon><i className='ri-settings-3-line' /></ListItemIcon>
          {t('navigation.settings')}
        </MenuItem>
        {hasPermission('admin.users') && (
          <MenuItem onClick={() => { setUserAnchor(null); router.push('/security/users') }}>
            <ListItemIcon><i className='ri-shield-user-line' /></ListItemIcon>
            {t('navigation.users')}
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => { setUserAnchor(null); setAboutOpen(true) }}>
          <ListItemIcon><i className='ri-information-line' /></ListItemIcon>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {t('about.title')}
            <Chip label={GIT_SHA ? GIT_SHA.substring(0, 7) : 'dev'} size='small' sx={{ height: 18, fontSize: '0.6rem', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }} color={updateInfo?.updateAvailable ? 'warning' : 'default'} />
          </Box>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
          <ListItemIcon><i className='ri-logout-box-r-line' style={{ color: 'inherit' }} /></ListItemIcon>
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

export default VCenterHeader
