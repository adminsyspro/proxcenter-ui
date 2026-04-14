'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { getDateLocale } from '@/lib/i18n/date'

import {
  Box,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Tooltip,
  Typography,
  alpha,
  createTheme,
  ThemeProvider,
  useTheme
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'

import { useTaskEvents } from '@/hooks/useTaskEvents'
import { useProxCenterTasks, type PCTask } from '@/contexts/ProxCenterTasksContext'
import TaskDetailDialog from './TaskDetailDialog'

// ============================================
// Types
// ============================================

interface TaskEvent {
  id: string
  upid: string
  type: string
  status: string
  startTime: string
  endTime: string | null
  duration: string
  node: string
  user: string
  description: string
  entity: string | null
  entityName: string | null
  connectionId: string
  connectionName: string
}

// ============================================
// Helpers
// ============================================

// Task type keys for translation
const TASK_TYPE_KEYS: Record<string, string> = {
  qmstart: 'tasks.types.qmstart',
  qmstop: 'tasks.types.qmstop',
  qmshutdown: 'tasks.types.qmshutdown',
  qmreboot: 'tasks.types.qmreboot',
  qmmigrate: 'tasks.types.qmmigrate',
  qmigrate: 'tasks.types.qmigrate',
  qmclone: 'tasks.types.qmclone',
  qmcreate: 'tasks.types.qmcreate',
  qmdestroy: 'tasks.types.qmdestroy',
  qmsnapshot: 'tasks.types.qmsnapshot',
  qmrollback: 'tasks.types.qmrollback',
  vzstart: 'tasks.types.vzstart',
  vzstop: 'tasks.types.vzstop',
  vzshutdown: 'tasks.types.vzshutdown',
  vzmigrate: 'tasks.types.vzmigrate',
  vzdump: 'tasks.types.vzdump',
  vncproxy: 'tasks.types.vncproxy',
  vncshell: 'tasks.types.vncshell',
  spiceproxy: 'tasks.types.spiceproxy',
  imgcopy: 'tasks.types.imgcopy',
  download: 'tasks.types.download',
  aptupdate: 'tasks.types.aptupdate',
  startall: 'tasks.types.startall',
  stopall: 'tasks.types.stopall',
  migrateall: 'tasks.types.migrateall',
}

function getStatusColor(status: string): 'success' | 'error' | 'warning' | 'primary' | 'default' {
  if (!status || status === 'running') return 'primary'
  if (status === 'OK') return 'success'
  if (status.includes('WARNINGS')) return 'warning'

return 'error'
}

// Status label keys for translation
const STATUS_LABEL_KEYS: Record<string, string> = {
  running: 'tasks.status.running',
  OK: 'tasks.status.ok',
  stopped: 'tasks.status.stopped',
}

function formatTime(dateStr: string | null, dateLocale: string): string {
  if (!dateStr) return '—'

  try {
    const date = new Date(dateStr)
    return date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return dateStr
  }
}

function formatDateStr(dateStr: string | null, dateLocale: string): string {
  if (!dateStr) return '—'

  try {
    const date = new Date(dateStr)
    const today = new Date()
    const isToday = date.toDateString() === today.toDateString()

    if (isToday) {
      return date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    return date.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' }) + ' ' +
           date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return dateStr
  }
}

// ============================================
// Component
// ============================================

interface TasksFooterProps {
  defaultExpanded?: boolean
  maxHeight?: number
}

export default function TasksFooter({
  defaultExpanded = false,
  maxHeight = 250
}: TasksFooterProps) {
  const theme = useTheme()
  const t = useTranslations()
  const locale = useLocale()
  const dateLocale = getDateLocale(locale)

  // Helper functions that use translations
  const formatTaskType = (type: string): string => {
    const key = TASK_TYPE_KEYS[type]
    return key ? t(key) : type
  }

  const getStatusLabel = (status: string): string => {
    if (!status || status === 'running') return t('tasks.status.running')
    if (status === 'OK') return t('tasks.status.ok')
    if (status === 'stopped') return t('tasks.status.stopped')
    return status
  }

  const [activeTab, setActiveTab] = useState<'proxmox' | 'proxcenter'>('proxmox')

  // ProxCenter tasks
  const { tasks: pcTasks, clearDone: clearPCDone, restoreTask } = useProxCenterTasks()
  const pcRunningCount = pcTasks.filter(t => t.status === 'running').length

  // SWR hook for task events
  const { data: tasksRaw, mutate: mutateTasks, isLoading: loading } = useTaskEvents(50)

  // Derive tasks from SWR data
  const tasks: TaskEvent[] = (tasksRaw?.data || []).map((e: any) => ({
    id: e.id,
    upid: e.id,
    type: e.type,
    status: e.status,
    startTime: e.ts,
    endTime: e.endTs,
    duration: e.duration,
    node: e.node,
    user: e.user,
    description: e.typeLabel || e.message,
    entity: e.entity || null,
    entityName: e.entityName || null,
    connectionId: e.connectionId,
    connectionName: e.connectionName
  }))

  // State - initialize with defaults, then hydrate from localStorage
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [hidden, setHidden] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [selectedTask, setSelectedTask] = useState<TaskEvent | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Hydrate from localStorage after mount (client-side only)
  useEffect(() => {
    const savedExpanded = localStorage.getItem('tasksFooterExpanded')
    const savedHidden = localStorage.getItem('tasksFooterHidden')

    if (savedExpanded !== null) {
      setExpanded(savedExpanded === 'true')
    }

    if (savedHidden !== null) {
      setHidden(savedHidden === 'true')
    }

    setIsHydrated(true)
  }, [])

  // Communicate taskbar height to layout via CSS custom property
  useEffect(() => {
    if (!isHydrated) return
    const headerHeight = 36
    let height = 0
    if (!hidden) {
      height = expanded ? headerHeight + maxHeight : headerHeight
    }
    document.documentElement.style.setProperty('--taskbar-height', `${height}px`)
    return () => {
      document.documentElement.style.setProperty('--taskbar-height', '0px')
    }
  }, [hidden, expanded, maxHeight, isHydrated])

  // Persist state
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem('tasksFooterExpanded', String(expanded))
    }
  }, [expanded, isHydrated])

  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem('tasksFooterHidden', String(hidden))
    }
  }, [hidden, isHydrated])

  // Handlers
  const handleToggleExpand = () => {
    setExpanded(prev => !prev)
  }

  const handleHide = () => {
    setHidden(true)
  }

  const handleShow = () => {
    setHidden(false)
  }

  const handleRowDoubleClick = (params: any) => {
    setSelectedTask(params.row)
    setDialogOpen(true)
  }

  const handleCloseDialog = () => {
    setDialogOpen(false)
    setSelectedTask(null)
  }

  // Count running tasks
  const runningCount = tasks.filter(t => t.status === 'running').length
  const errorCount = tasks.filter(t => t.status && t.status !== 'running' && t.status !== 'OK' && !t.status.includes('WARNINGS')).length

  // Always-dark theme for the taskbar (must stay dark even in light mode)
  // Inherit typography from the current theme so fonts match the rest of the app
  const darkTaskbarTheme = useMemo(() => createTheme({
    palette: {
      mode: 'dark',
      background: { paper: '#1e1e2d', default: '#151521' },
      text: { primary: 'rgba(231,227,252,0.9)', secondary: 'rgba(231,227,252,0.7)' },
      divider: 'rgba(231,227,252,0.12)',
    },
    typography: theme.typography,
  }), [theme.typography])

  // Columns
  const columns: GridColDef[] = [
    {
      field: 'startTime',
      headerName: t('tasks.columns.start'),
      width: 110,
      renderCell: (params) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {formatTime(params.value, dateLocale)}
        </Typography>
      )
    },
    {
      field: 'endTime',
      headerName: t('tasks.columns.end'),
      width: 110,
      renderCell: (params) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {formatTime(params.value, dateLocale)}
        </Typography>
      )
    },
    {
      field: 'node',
      headerName: t('tasks.columns.node'),
      width: 180,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <img src="/images/proxmox-logo-dark.svg" alt="" style={{ width: 14, height: 14, opacity: 0.7, flexShrink: 0 }} />
          <Typography variant="caption" noWrap title={params.value}>
            {params.value}
          </Typography>
        </Box>
      )
    },
    {
      field: 'entity',
      headerName: t('tasks.columns.target'),
      flex: 1,
      minWidth: 150,
      renderCell: (params) => {
        const name = params.row.entityName
        const vmid = params.value

        if (!vmid || vmid === params.row.node) return <Typography variant="caption" sx={{ opacity: 0.3 }}>—</Typography>

        return (
          <Typography variant="caption" noWrap title={name ? `${name} (${vmid})` : vmid}>
            {name ? (
              <>{name} <span style={{ opacity: 0.5 }}>({vmid})</span></>
            ) : vmid}
          </Typography>
        )
      }
    },
    {
      field: 'user',
      headerName: t('tasks.columns.user'),
      width: 150,
      renderCell: (params) => (
        <Typography variant="caption" noWrap title={params.value}>
          {params.value}
        </Typography>
      )
    },
    {
      field: 'description',
      headerName: t('tasks.columns.description'),
      flex: 2,
      minWidth: 200,
      renderCell: (params) => (
        <Typography variant="caption" noWrap title={params.value}>
          {params.value || formatTaskType(params.row.type)}
        </Typography>
      )
    },
    {
      field: 'status',
      headerName: t('tasks.columns.status'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) => {
        const status = params.value || 'running'
        const color = getStatusColor(status)
        const isRunning = status === 'running'

        return (
          <Chip
            size="small"
            label={getStatusLabel(status)}
            color={color}
            variant={isRunning ? 'outlined' : 'filled'}
            sx={{
              height: 20,
              fontSize: '0.7rem',
              '& .MuiChip-icon': { ml: 0.5, mr: -0.25 },
              '& .MuiChip-label': { px: 1 }
            }}
            icon={isRunning ? (
              <i
                className="ri-loader-4-line"
                style={{
                  fontSize: 12,
                  animation: 'spin 1s linear infinite'
                }}
              />
            ) : undefined}
          />
        )
      }
    }
  ]

  // Don't render anything until hydrated to avoid flash
  if (!isHydrated) {
    return null
  }

  // If completely hidden, show a small button to restore
  if (hidden) {
    return (
      <Box
        sx={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 1200
        }}
      >
        <Tooltip title={t('tasks.showTasks')}>
          <IconButton
            onClick={handleShow}
            sx={{
              bgcolor: 'background.paper',
              boxShadow: 2,
              '&:hover': { bgcolor: 'action.hover' }
            }}
          >
            <i className="ri-terminal-box-line" style={{ fontSize: 20 }} />
            {runningCount > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  borderRadius: '50%',
                  width: 18,
                  height: 18,
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {runningCount}
              </Box>
            )}
          </IconButton>
        </Tooltip>
      </Box>
    )
  }

  return (
    <>
    <ThemeProvider theme={darkTaskbarTheme}>
      <Paper
        elevation={0}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1200, // Above sidebar (1100)
          borderRadius: 0,
          borderTop: '1px solid #2a2a3c',
          bgcolor: '#1e1e2d',
          backgroundImage: 'none',
          color: 'rgba(231,227,252,0.9)',
          colorScheme: 'dark',
        }}
      >
        {/* Header */}
        <Box
          onClick={handleToggleExpand}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 0.75,
            cursor: 'pointer',
            bgcolor: '#151521',
            borderBottom: expanded ? '1px solid' : 'none',
            borderColor: 'rgba(231,227,252,0.12)',
            '&:hover': {
              bgcolor: '#1a1a2e'
            }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <i
              className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'}
              style={{ fontSize: 18, opacity: 0.7 }}
            />
            {/* Tab toggle */}
            <Box sx={{ display: 'flex', gap: 0, borderRadius: 1, overflow: 'hidden', border: '1px solid rgba(231,227,252,0.15)' }}>
              <Box
                onClick={(e) => { e.stopPropagation(); setActiveTab('proxmox') }}
                sx={{
                  px: 1.25, py: 0.25, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                  bgcolor: activeTab === 'proxmox' ? 'rgba(231,227,252,0.12)' : 'transparent',
                  opacity: activeTab === 'proxmox' ? 1 : 0.5,
                  '&:hover': { opacity: 1 },
                  display: 'flex', alignItems: 'center', gap: 0.5,
                }}
              >
                <img src="/images/proxmox-logo-dark.svg" alt="" style={{ height: 14, width: 'auto' }} />{' '}
                Proxmox
              </Box>
              <Box
                onClick={(e) => { e.stopPropagation(); setActiveTab('proxcenter') }}
                sx={{
                  px: 1.25, py: 0.25, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                  bgcolor: activeTab === 'proxcenter' ? 'rgba(231,227,252,0.12)' : 'transparent',
                  opacity: activeTab === 'proxcenter' ? 1 : 0.5,
                  '&:hover': { opacity: 1 },
                  display: 'flex', alignItems: 'center', gap: 0.5,
                  borderLeft: '1px solid rgba(231,227,252,0.15)',
                }}
              >
                <img src="/images/proxcenter-logo-dark.svg" alt="" style={{ height: 14, width: 'auto' }} />
                ProxCenter
                {pcRunningCount > 0 && (
                  <Box sx={{
                    bgcolor: 'primary.main', color: '#fff', borderRadius: '50%',
                    width: 16, height: 16, fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', ml: 0.25,
                  }}>
                    {pcRunningCount}
                  </Box>
                )}
              </Box>
            </Box>
            {activeTab === 'proxmox' && (
              <>
                <Chip
                  size="small"
                  label={tasks.length}
                  sx={{
                    height: 18,
                    fontSize: '0.7rem',
                    '& .MuiChip-label': { px: 0.75 }
                  }}
                />
                {runningCount > 0 && (
                  <Chip
                    size="small"
                    label={`${runningCount} ${t('tasks.inProgress')}`}
                    variant="outlined"
                    icon={<i className="ri-loader-4-line" style={{ fontSize: 12, animation: 'spin 1s linear infinite', color: 'inherit' }} />}
                    sx={{
                      height: 18,
                      fontSize: '0.7rem',
                      gap: 0.5,
                      color: theme.palette.primary.main,
                      borderColor: alpha(theme.palette.primary.main, 0.5),
                      '& .MuiChip-icon': { ml: 0.5, mr: -0.25, color: theme.palette.primary.main },
                      '& .MuiChip-label': { px: 0.75 }
                    }}
                  />
                )}
                {errorCount > 0 && (
                  <Chip
                    size="small"
                    label={`${errorCount} ${errorCount > 1 ? t('tasks.errors') : t('tasks.error')}`}
                    color="error"
                    sx={{
                      height: 18,
                      fontSize: '0.7rem',
                      '& .MuiChip-label': { px: 0.75 }
                    }}
                  />
                )}
              </>
            )}
            {activeTab === 'proxcenter' && pcTasks.length > 0 && (
              <Chip
                size="small"
                label={pcTasks.length}
                sx={{
                  height: 18,
                  fontSize: '0.7rem',
                  '& .MuiChip-label': { px: 0.75 }
                }}
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title={t('tasks.refresh')}>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); mutateTasks(); }}
              >
                <i className="ri-refresh-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={expanded ? t('tasks.collapse') : t('tasks.expand')}>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleToggleExpand(); }}>
                <i className={expanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('tasks.hideTasks')}>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleHide(); }}>
                <i className="ri-close-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Content */}
        <Collapse in={expanded}>
          {/* ProxCenter tasks tab */}
          {activeTab === 'proxcenter' && (
            <Box sx={{ height: maxHeight, overflow: 'auto', bgcolor: '#1e1e2d' }}>
              {pcTasks.length === 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.4 }}>
                  <Typography variant="body2">No ProxCenter tasks</Typography>
                </Box>
              ) : (
                <>
                  {pcTasks.map((task) => (
                    <Box
                      key={task.id}
                      onClick={() => restoreTask(task.id)}
                      sx={{
                        px: 2, py: 1,
                        borderBottom: '1px solid rgba(231,227,252,0.08)',
                        display: 'flex', alignItems: 'center', gap: 2,
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'rgba(231,227,252,0.06)' },
                      }}
                    >
                      {/* Icon */}
                      <i
                        className={
                          task.type === 'upload' ? 'ri-upload-2-line' :
                          task.type === 'download' ? 'ri-download-2-line' :
                          'ri-settings-3-line'
                        }
                        style={{ fontSize: 16, opacity: 0.6, flexShrink: 0 }}
                      />
                      {/* Label */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }} noWrap>
                          {task.label}
                        </Typography>
                        {task.detail && (
                          <Typography variant="caption" sx={{ opacity: 0.5, fontSize: '0.65rem' }} noWrap>
                            {task.detail}
                          </Typography>
                        )}
                      </Box>
                      {/* Progress */}
                      <Box sx={{ width: 120, flexShrink: 0 }}>
                        {task.status === 'running' ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <LinearProgress
                              variant={task.progress > 0 ? 'determinate' : 'indeterminate'}
                              value={task.progress > 0 ? task.progress : undefined}
                              sx={{ flex: 1, height: 4, borderRadius: 1 }}
                            />
                            {task.progress > 0 && (
                              <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 700, minWidth: 28, textAlign: 'right' }}>
                                {task.progress}%
                              </Typography>
                            )}
                          </Box>
                        ) : null}
                      </Box>
                      {/* Status */}
                      <Chip
                        size="small"
                        label={task.status === 'running' ? t('tasks.status.running') : task.status === 'done' ? 'Done' : 'Error'}
                        color={task.status === 'running' ? 'primary' : task.status === 'done' ? 'success' : 'error'}
                        variant={task.status === 'running' ? 'outlined' : 'filled'}
                        icon={task.status === 'running' ? (
                          <i className="ri-loader-4-line" style={{ fontSize: 12, animation: 'spin 1s linear infinite' }} />
                        ) : undefined}
                        sx={{ height: 20, fontSize: '0.7rem', '& .MuiChip-icon': { ml: 0.5, mr: -0.25 }, '& .MuiChip-label': { px: 1 } }}
                      />
                    </Box>
                  ))}
                  {pcTasks.some(t => t.status !== 'running') && (
                    <Box sx={{ px: 2, py: 0.75, display: 'flex', justifyContent: 'flex-end' }}>
                      <Typography
                        variant="caption"
                        onClick={(e) => { e.stopPropagation(); clearPCDone() }}
                        sx={{ opacity: 0.4, cursor: 'pointer', '&:hover': { opacity: 0.8 }, fontSize: '0.65rem' }}
                      >
                        Clear completed
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          )}
          {/* Proxmox tasks tab */}
          <Box sx={{ height: maxHeight, display: activeTab === 'proxmox' ? 'block' : 'none', bgcolor: '#1e1e2d' }}>
            {loading ? (
              <Box sx={{ p: 2 }}>
                {[...new Array(5)].map((_, i) => (
                  <Skeleton key={i} height={32} sx={{ my: 0.5 }} />
                ))}
              </Box>
            ) : (
              <DataGrid
                rows={[...tasks].sort((a, b) => {
                  const aRunning = a.status === 'running' ? 0 : 1
                  const bRunning = b.status === 'running' ? 0 : 1
                  return aRunning - bRunning
                })}
                columns={columns}
                density="compact"
                disableRowSelectionOnClick
                disableColumnMenu={false}
                hideFooter
                onRowDoubleClick={handleRowDoubleClick}
                getRowClassName={(params) => {
                  if (params.row.status === 'running') return 'row-running'
                  if (params.row.status && params.row.status !== 'OK' && !params.row.status.includes('WARNINGS')) return 'row-error'

return ''
                }}
                sx={{
                  border: 'none',
                  '--DataGrid-rowBorderColor': 'rgba(231,227,252,0.08)',
                  '--DataGrid-containerBackground': '#1e1e2d',
                  '& .MuiDataGrid-columnHeaders': {
                    bgcolor: '#151521',
                    borderBottom: '1px solid rgba(231,227,252,0.08)',
                    minHeight: '36px !important',
                    maxHeight: '36px !important',
                  },
                  '& .MuiDataGrid-columnSeparator': {
                    opacity: 0.3,
                  },
                  '& .MuiDataGrid-columnHeaderTitle': {
                    fontSize: '0.75rem',
                    fontWeight: 600
                  },
                  '& .MuiDataGrid-row': {
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.04)
                    }
                  },
                  '& .MuiDataGrid-cell': {
                    py: 0.5,
                    borderBottom: '1px solid rgba(231,227,252,0.08)',
                  },
                  '& .row-running': {
                    bgcolor: alpha(theme.palette.primary.main, 0.05)
                  },
                  '& .row-error': {
                    bgcolor: alpha(theme.palette.error.main, 0.05)
                  },
                  '& .MuiDataGrid-virtualScroller': {
                    '&::-webkit-scrollbar': {
                      width: 8,
                      height: 8
                    },
                    '&::-webkit-scrollbar-thumb': {
                      bgcolor: 'rgba(255,255,255,0.1)',
                      borderRadius: 4
                    }
                  }
                }}
              />
            )}
          </Box>
        </Collapse>
      </Paper>

      {/* CSS for spinner animation */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </ThemeProvider>

    {/* Task Detail Dialog - outside dark ThemeProvider so it follows user theme */}
    {selectedTask && (
      <TaskDetailDialog
        open={dialogOpen}
        task={{
          id: selectedTask.upid,    // TaskDetailDialog uses task.id
          upid: selectedTask.upid,
          type: selectedTask.type,
          typeLabel: selectedTask.description || formatTaskType(selectedTask.type),
          status: selectedTask.status,
          node: selectedTask.node,
          user: selectedTask.user,
          entity: selectedTask.entityName
            ? `${selectedTask.entityName} (${selectedTask.entity})`
            : selectedTask.entity,
          startTime: selectedTask.startTime,
          endTime: selectedTask.endTime,
          duration: selectedTask.duration,
          connectionId: selectedTask.connectionId,
          connectionName: selectedTask.connectionName
        }}
        onClose={handleCloseDialog}
      />
    )}
    </>
  )
}
