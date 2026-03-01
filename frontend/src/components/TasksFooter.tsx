'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { getDateLocale } from '@/lib/i18n/date'

import {
  Box,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Skeleton,
  Tooltip,
  Typography,
  alpha,
  useTheme
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'

import { useTaskEvents } from '@/hooks/useTaskEvents'
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

  // SWR hook for task events
  const { data: tasksRaw, mutate: mutateTasks, isLoading: loading } = useTaskEvents(50, 10000)

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

  // Columns
  const columns: GridColDef[] = [
    {
      field: 'startTime',
      headerName: t('tasks.columns.start'),
      width: 90,
      renderCell: (params) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {formatTime(params.value, dateLocale)}
        </Typography>
      )
    },
    {
      field: 'endTime',
      headerName: t('tasks.columns.end'),
      width: 90,
      renderCell: (params) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {formatTime(params.value, dateLocale)}
        </Typography>
      )
    },
    {
      field: 'node',
      headerName: t('tasks.columns.node'),
      width: 140,
      renderCell: (params) => (
        <Typography variant="caption" noWrap title={params.value}>
          {params.value}
        </Typography>
      )
    },
    {
      field: 'user',
      headerName: t('tasks.columns.user'),
      width: 120,
      renderCell: (params) => (
        <Typography variant="caption" noWrap title={params.value}>
          {params.value}
        </Typography>
      )
    },
    {
      field: 'description',
      headerName: t('tasks.columns.description'),
      flex: 1,
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
              '& .MuiChip-label': { px: 1 }
            }}
            icon={isRunning ? (
              <i
                className="ri-loader-4-line"
                style={{
                  fontSize: 12,
                  marginLeft: 4,
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
      <Paper
        elevation={0}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1200, // Above sidebar (1100)
          borderRadius: 0,
          borderTop: '1px solid',
          borderColor: 'rgba(231,227,252,0.12)',
          bgcolor: '#1e1e2d',
          backgroundImage: 'none',
          color: 'rgba(231,227,252,0.9)',
          colorScheme: 'dark',
          // Override MUI CSS vars so child components (IconButton, Chip, DataGrid) render dark
          '--mui-palette-text-primary': 'rgba(231,227,252,0.9)',
          '--mui-palette-text-secondary': 'rgba(231,227,252,0.7)',
          '--mui-palette-text-disabled': 'rgba(231,227,252,0.4)',
          '--mui-palette-divider': 'rgba(231,227,252,0.12)',
          '--mui-palette-action-active': 'rgba(231,227,252,0.6)',
          '--mui-palette-action-hover': 'rgba(231,227,252,0.06)',
          '--mui-palette-action-selected': 'rgba(231,227,252,0.08)',
          '--mui-palette-background-paper': '#1e1e2d',
          '--mui-palette-background-default': '#151521',
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
            bgcolor: 'rgba(255,255,255,0.03)',
            borderBottom: expanded ? '1px solid' : 'none',
            borderColor: 'rgba(231,227,252,0.12)',
            '&:hover': {
              bgcolor: 'rgba(255,255,255,0.06)'
            }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <i
              className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'}
              style={{ fontSize: 18, opacity: 0.7 }}
            />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('tasks.title')}
            </Typography>
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
                color="primary"
                variant="outlined"
                icon={<i className="ri-loader-4-line" style={{ fontSize: 12, animation: 'spin 1s linear infinite' }} />}
                sx={{
                  height: 18,
                  fontSize: '0.7rem',
                  '& .MuiChip-label': { px: 0.5 }
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
          <Box sx={{ height: maxHeight }}>
            {loading ? (
              <Box sx={{ p: 2 }}>
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} height={32} sx={{ my: 0.5 }} />
                ))}
              </Box>
            ) : (
              <DataGrid
                rows={tasks}
                columns={columns}
                density="compact"
                disableRowSelectionOnClick
                disableColumnMenu
                hideFooter
                onRowDoubleClick={handleRowDoubleClick}
                getRowClassName={(params) => {
                  if (params.row.status === 'running') return 'row-running'
                  if (params.row.status && params.row.status !== 'OK' && !params.row.status.includes('WARNINGS')) return 'row-error'

return ''
                }}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-columnHeaders': {
                    bgcolor: '#12121f',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    minHeight: '36px !important',
                    maxHeight: '36px !important',
                  },
                  '& .MuiDataGrid-columnHeader': {
                    py: 0.5
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
                    borderBottom: '1px solid',
                    borderColor: 'rgba(255,255,255,0.05)'
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

      {/* Task Detail Dialog */}
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
            startTime: selectedTask.startTime,
            endTime: selectedTask.endTime,
            duration: selectedTask.duration,
            connectionId: selectedTask.connectionId,
            connectionName: selectedTask.connectionName
          }}
          onClose={handleCloseDialog}
        />
      )}

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
