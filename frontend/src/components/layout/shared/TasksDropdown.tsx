'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import Link from 'next/link'

import {
  Badge,
  Box,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  Divider,
  Chip,
  Button,
  Switch,
  FormControlLabel,
} from '@mui/material'

import { useRunningTasks } from '@/hooks/useRunningTasks'
import { useRecentChanges } from '@/hooks/useChanges'

type RunningTask = {
  id: string
  startTime: string
  type: string
  typeLabel: string
  icon: string
  entity: string | null
  node: string
  user: string
  durationSec: number
  connectionId: string
  connectionName: string
}

type RecentChange = {
  id: number
  timestamp: string
  resourceType: string
  resourceId: string
  resourceName: string
  action: string
  node: string
  connectionName: string
  fields: { field: string; oldValue: string; newValue: string }[] | null
}

const changeActionIcons: Record<string, string> = {
  config_changed: 'ri-settings-3-line',
  created: 'ri-add-circle-line',
  deleted: 'ri-delete-bin-line',
  migrated: 'ri-swap-box-line',
}

const resourceTypeIcons: Record<string, string> = {
  vm: 'ri-computer-line',
  ct: 'ri-instance-line',
  node: 'ri-server-line',
  storage: 'ri-database-2-line',
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)


return `${hours}h ${mins}m`
}

// Vérifier si les notifications sont supportées
const isNotificationSupported = () => {
  return typeof window !== 'undefined' && 'Notification' in window
}

// Demander la permission
const requestNotificationPermission = async (): Promise<boolean> => {
  if (!isNotificationSupported()) return false

  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false

  const permission = await Notification.requestPermission()


return permission === 'granted'
}

// Envoyer une notification système
const sendNotification = (title: string, options?: NotificationOptions) => {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return

  try {
    const notification = new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      ...options
    })

    setTimeout(() => notification.close(), 5000)

    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch (e) {
    console.error('Notification error:', e)
  }
}

// Gestion du titre de l'onglet
const originalTitle = typeof document !== 'undefined' ? document.title : 'Pulse'

const updateTabTitle = (tasks: RunningTask[], hasNewActivity: boolean) => {
  if (typeof document === 'undefined') return

  if (tasks.length > 0) {
    // Construire la liste des tâches
    const taskNames = tasks.map(t => {
      if (t.entity) {
        return `${t.typeLabel} (${t.entity})`
      }


return t.typeLabel
    }).join(' • ')

    if (hasNewActivity) {
      document.title = `🔔 ${taskNames}`
    } else {
      document.title = `⏳ ${taskNames}`
    }
  } else {
    document.title = originalTitle
  }
}

// Faire clignoter le titre
let blinkInterval: NodeJS.Timeout | null = null

const startTitleBlink = (message: string) => {
  if (typeof document === 'undefined') return

  // Arrêter le clignotement précédent
  if (blinkInterval) {
    clearInterval(blinkInterval)
  }

  let isOriginal = false
  const originalTitleNow = document.title

  blinkInterval = setInterval(() => {
    document.title = isOriginal ? originalTitleNow : `🔔 ${message}`
    isOriginal = !isOriginal
  }, 1000)

  // Arrêter après 10 secondes
  setTimeout(() => {
    if (blinkInterval) {
      clearInterval(blinkInterval)
      blinkInterval = null
    }
  }, 10000)
}

const stopTitleBlink = () => {
  if (blinkInterval) {
    clearInterval(blinkInterval)
    blinkInterval = null
  }
}

export default function TasksDropdown() {
  const t = useTranslations()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [tasks, setTasks] = useState<RunningTask[]>([])
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default')

  // Référence pour suivre les tâches connues
  const knownTasksRef = useRef<Set<string>>(new Set())
  const previousTasksRef = useRef<RunningTask[]>([])
  const isFirstLoadRef = useRef(true)

  const open = Boolean(anchorEl)

  // SWR hook for running tasks - polls faster when menu is open
  const { data: tasksResponse, isLoading: loading } = useRunningTasks()

  // Recent changes hook
  const { data: changesResponse } = useRecentChanges(5)
  const recentChanges: RecentChange[] = changesResponse?.data || []

  // Sync SWR data to local state and handle notifications
  useEffect(() => {
    if (!tasksResponse?.data) return

    const newTasks: RunningTask[] = tasksResponse.data
    const currentTaskIds = new Set(newTasks.map(t => t.id))
    const previousTaskIds = knownTasksRef.current

    // Ne pas notifier au premier chargement
    if (!isFirstLoadRef.current && notificationsEnabled) {
      // Détecter les nouvelles tâches
      for (const task of newTasks) {
        if (!previousTaskIds.has(task.id)) {
          // Nouvelle tâche - notification système
          sendNotification(`🚀 ${task.typeLabel}`, {
            body: `${task.entity || task.node} - ${task.connectionName}`,
            tag: `task-start-${task.id}`
          })

          // Faire clignoter le titre de l'onglet
          startTitleBlink(t('tasks.notifications.newTask', { type: task.typeLabel }))
        }
      }

      // Détecter les tâches terminées
      for (const prevTask of previousTasksRef.current) {
        if (!currentTaskIds.has(prevTask.id)) {
          // Tâche terminée - notification système
          sendNotification(`✅ ${t('tasks.notifications.taskCompleted', { type: prevTask.typeLabel })}`, {
            body: `${prevTask.entity || prevTask.node} - ${prevTask.connectionName}`,
            tag: `task-end-${prevTask.id}`
          })

          // Faire clignoter le titre
          startTitleBlink(t('tasks.notifications.completed', { type: prevTask.typeLabel }))
        }
      }
    }

    isFirstLoadRef.current = false

    // Mettre à jour les références
    knownTasksRef.current = currentTaskIds
    previousTasksRef.current = newTasks

    setTasks(newTasks)
    setLastUpdate(new Date())
  }, [tasksResponse?.data, notificationsEnabled, t])

  // Vérifier la permission au chargement
  useEffect(() => {
    if (isNotificationSupported()) {
      setNotificationPermission(Notification.permission)
      const saved = localStorage.getItem('tasksNotificationsEnabled')

      if (saved === 'true' && Notification.permission === 'granted') {
        setNotificationsEnabled(true)
      }
    } else {
      setNotificationPermission('unsupported')
    }
  }, [])

  // Sauvegarder la préférence
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('tasksNotificationsEnabled', String(notificationsEnabled))
    }
  }, [notificationsEnabled])

  // Mettre à jour le titre quand les tâches changent
  useEffect(() => {
    updateTabTitle(tasks, false)

    return () => {
      // Restaurer le titre original quand le composant est démonté
      if (typeof document !== 'undefined') {
        document.title = originalTitle
      }

      stopTitleBlink()
    }
  }, [tasks])

  // Arrêter le clignotement quand la fenêtre est focus
  useEffect(() => {
    const handleFocus = () => {
      stopTitleBlink()
      updateTabTitle(tasks, false)
    }

    window.addEventListener('focus', handleFocus)

return () => window.removeEventListener('focus', handleFocus)
  }, [tasks])

  // Mettre à jour les durées toutes les secondes quand le menu est ouvert
  useEffect(() => {
    if (!open || tasks.length === 0) return

    const interval = setInterval(() => {
      setTasks(prev => prev.map(task => ({
        ...task,
        durationSec: Math.floor((Date.now() - new Date(task.startTime).getTime()) / 1000)
      })))
    }, 1000)

    return () => clearInterval(interval)
  }, [open, tasks.length])

  const handleToggleNotifications = async () => {
    if (!notificationsEnabled) {
      const granted = await requestNotificationPermission()

      if (granted) {
        setNotificationPermission('granted')
        setNotificationsEnabled(true)
        sendNotification(t('tasks.notifications.enabled'), {
          body: t('tasks.notifications.enabledBody'),
          tag: 'notifications-enabled'
        })
      } else {
        setNotificationPermission(Notification.permission)
      }
    } else {
      setNotificationsEnabled(false)
    }
  }

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)

    // Arrêter le clignotement quand on ouvre le menu
    stopTitleBlink()
    updateTabTitle(tasks, false)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const taskCount = tasks.length

  return (
    <>
      <Tooltip title={taskCount > 0 ? `${taskCount} ${t('jobs.running').toLowerCase()}` : t('common.noData')}>
        <IconButton size="small" onClick={handleClick}>
          <Badge
            badgeContent={taskCount}
            color="primary"
            max={99}
            sx={{
              '& .MuiBadge-badge': {
                fontSize: '0.65rem',
                height: 16,
                minWidth: 16,
                padding: '0 4px',
              }
            }}
          >
            {taskCount > 0 ? (
              <i className="ri-loader-4-line" style={{ animation: 'spin 2s linear infinite' }} />
            ) : (
              <i className="ri-play-list-line" />
            )}
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            width: 380,
            maxHeight: 500,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {/* Header */}
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-play-list-line" style={{ fontSize: 18 }} />
              <Typography variant="subtitle1" fontWeight={600}>
                {t('jobs.running')}
              </Typography>
              {taskCount > 0 && (
                <Chip label={taskCount} size="small" color="primary" sx={{ height: 20, fontSize: '0.7rem' }} />
              )}
            </Box>
            {loading && <CircularProgress size={16} sx={{ ml: 1 }} />}
          </Box>

          {/* Toggle notifications */}
          {notificationPermission !== 'unsupported' && (
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ opacity: 0.7, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <i className="ri-notification-3-line" style={{ fontSize: 14 }} />
                {t('notifications.title')}
              </Typography>
              <Switch
                size="small"
                checked={notificationsEnabled}
                onChange={handleToggleNotifications}
                disabled={notificationPermission === 'denied'}
              />
            </Box>
          )}
          {notificationPermission === 'denied' && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
              {t('tasks.notifications.browserBlocked')}
            </Typography>
          )}
        </Box>

        {/* Tasks list */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {tasks.length === 0 ? (
            <Box sx={{ px: 2, py: 4, textAlign: 'center' }}>
              <i className="ri-check-double-line" style={{ fontSize: 32, opacity: 0.3 }} />
              <Typography variant="body2" sx={{ mt: 1, opacity: 0.6 }}>
                {t('common.noData')}
              </Typography>
            </Box>
          ) : (
            tasks.map((task, idx) => (
              <Box key={task.id}>
                <Box
                  sx={{
                    px: 2,
                    py: 1.5,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 2,
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                >
                  {/* Icon with spinner */}
                  <Box sx={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    borderRadius: 1,
                    position: 'relative'
                  }}>
                    <i className={task.icon} style={{ fontSize: 16 }} />
                    <CircularProgress
                      size={32}
                      thickness={2}
                      sx={{
                        position: 'absolute',
                        color: 'primary.light',
                        opacity: 0.5
                      }}
                    />
                  </Box>

                  {/* Content */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>
                        {task.typeLabel}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7, flexShrink: 0 }}>
                        {formatDuration(task.durationSec)}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                      {task.entity && (
                        <>
                          <Typography variant="caption" sx={{ opacity: 0.8 }}>
                            {task.entity}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.4 }}>•</Typography>
                        </>
                      )}
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                        {task.node}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.4 }}>•</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.6 }} noWrap>
                        {task.connectionName}
                      </Typography>
                    </Box>

                    <Typography variant="caption" sx={{ opacity: 0.5, display: 'block', mt: 0.25 }}>
                      par {task.user}
                    </Typography>
                  </Box>
                </Box>
                {idx < tasks.length - 1 && <Divider />}
              </Box>
            ))
          )}
        </Box>

        {/* Recent Changes section */}
        {recentChanges.length > 0 && (
          <Box>
            <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-git-commit-line" style={{ fontSize: 16, opacity: 0.6 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ opacity: 0.8 }}>
                {t('changes.recentChanges')}
              </Typography>
              <Chip label={recentChanges.length} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
            </Box>
            <Box sx={{ maxHeight: 180, overflow: 'auto' }}>
              {recentChanges.map((change, idx) => (
                <Box key={change.id}>
                  <Box
                    sx={{
                      px: 2,
                      py: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      '&:hover': { bgcolor: 'action.hover' }
                    }}
                  >
                    <Box sx={{
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'action.selected',
                      borderRadius: 1,
                    }}>
                      <i className={resourceTypeIcons[change.resourceType] || 'ri-file-line'} style={{ fontSize: 14 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <i className={changeActionIcons[change.action] || 'ri-edit-line'} style={{ fontSize: 12, opacity: 0.6 }} />
                        <Typography variant="caption" fontWeight={500} noWrap>
                          {change.resourceType.toUpperCase()} {change.resourceId}
                          {change.resourceName ? ` "${change.resourceName}"` : ''}
                        </Typography>
                      </Box>
                      <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }} noWrap>
                        {change.fields?.length || 0} {(change.fields?.length || 0) === 1 ? t('changes.fieldChanged') : t('changes.fieldsChanged')}
                        {' \u2022 '}{change.connectionName || change.node}
                      </Typography>
                    </Box>
                  </Box>
                  {idx < recentChanges.length - 1 && <Divider />}
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* Footer */}
        <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ opacity: 0.5 }}>
            {lastUpdate && t('tasks.notifications.lastUpdated', { time: lastUpdate.toLocaleTimeString() })}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {recentChanges.length > 0 && (
              <Button
                component={Link}
                href="/operations/changes"
                size="small"
                onClick={handleClose}
              >
                {t('changes.viewAll')}
              </Button>
            )}
            <Button
              component={Link}
              href="/operations/events"
              size="small"
              onClick={handleClose}
            >
              {t('common.all')}
            </Button>
          </Box>
        </Box>
      </Menu>

      {/* CSS for spinner animation */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  )
}
