'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import PbsStatusChip from './PbsStatusChip'

interface PbsTasksTabProps {
  pbsId: string
}

type Order = 'asc' | 'desc'

type PbsTask = {
  upid: string
  node?: string
  pid?: number
  pstart?: number
  starttime?: number
  endtime?: number
  type?: string
  user?: string
  status?: string
  worker_type?: string
  worker_id?: string
}

type PbsTaskStatus = {
  upid?: string
  status?: string
  exitstatus?: string
  type?: string
  user?: string
  starttime?: number
  endtime?: number
  node?: string
  worker_id?: string
} | null

type LogLine = { n: number; t: string }

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatTimestamp(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return ''
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function isRunningStatus(task: PbsTask): boolean {
  const s = (task.status || '').toLowerCase()
  if (s === 'running') return true
  if (!task.endtime || task.endtime === 0) return true
  return false
}

type ChipKind = 'ok' | 'running' | 'stopped' | 'error' | 'unknown'

function classifyStatus(task: PbsTask): { kind: ChipKind; text: string } {
  const raw = (task.status || '').trim()
  if (!task.endtime || task.endtime === 0 || raw.toLowerCase() === 'running') {
    return { kind: 'running', text: raw || 'running' }
  }
  if (raw === 'OK') return { kind: 'ok', text: 'OK' }
  if (raw.toLowerCase() === 'stopped') return { kind: 'stopped', text: raw }
  if (/^ERROR/i.test(raw) || raw.includes(':')) return { kind: 'error', text: raw }
  if (!raw) return { kind: 'unknown', text: '' }
  return { kind: 'unknown', text: raw }
}

function classifyStatusString(raw: string): ChipKind {
  const r = (raw || '').trim()
  if (!r) return 'unknown'
  if (r.toLowerCase() === 'running') return 'running'
  if (r === 'OK') return 'ok'
  if (r.toLowerCase() === 'stopped') return 'stopped'
  if (/^ERROR/i.test(r) || r.includes(':')) return 'error'
  return 'unknown'
}

export default function PbsTasksTab({ pbsId }: PbsTasksTabProps) {
  const t = useTranslations()

  const [tasks, setTasks] = useState<PbsTask[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Filters
  const [runningOnly, setRunningOnly] = useState<boolean>(true)
  const [errorsOnly, setErrorsOnly] = useState<boolean>(false)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [userFilter, setUserFilter] = useState<string>('')

  const [typeFilterInput, setTypeFilterInput] = useState<string>('')
  const [userFilterInput, setUserFilterInput] = useState<string>('')

  // Sorting and pagination
  const [order, setOrder] = useState<Order>('desc')
  const [page, setPage] = useState<number>(0)
  const [rowsPerPage, setRowsPerPage] = useState<number>(50)

  // Log dialog
  const [logOpen, setLogOpen] = useState<boolean>(false)
  const [logTask, setLogTask] = useState<PbsTask | null>(null)
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [logStatus, setLogStatus] = useState<PbsTaskStatus>(null)
  const [logLoading, setLogLoading] = useState<boolean>(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [logCopied, setLogCopied] = useState<boolean>(false)

  const logPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastLineRef = useRef<number>(0)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        limit: String(rowsPerPage),
        start: String(page * rowsPerPage),
        running: runningOnly ? '1' : '0',
        errors: errorsOnly ? '1' : '0',
      })
      if (typeFilter) qs.set('typefilter', typeFilter)
      if (userFilter) qs.set('userfilter', userFilter)

      const res = await fetch(`/api/v1/pbs/${pbsId}/tasks?${qs.toString()}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      const data: PbsTask[] = Array.isArray(body?.data) ? body.data : []
      setTasks(data)
      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId, page, rowsPerPage, runningOnly, errorsOnly, typeFilter, userFilter])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const sortedTasks = useMemo(() => {
    const arr = [...tasks]
    arr.sort((a, b) => {
      const ta = a.starttime || 0
      const tb = b.starttime || 0
      if (ta < tb) return order === 'asc' ? -1 : 1
      if (ta > tb) return order === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [tasks, order])

  const displayTasks = useMemo(() => {
    if (!runningOnly) return sortedTasks
    return sortedTasks.filter(isRunningStatus)
  }, [sortedTasks, runningOnly])

  const handleSortStart = () => {
    setOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
  }

  const applyTextFilters = () => {
    setTypeFilter(typeFilterInput.trim())
    setUserFilter(userFilterInput.trim())
    setPage(0)
  }

  const clearTextFilters = () => {
    setTypeFilterInput('')
    setUserFilterInput('')
    setTypeFilter('')
    setUserFilter('')
    setPage(0)
  }

  const onChangePage = (_: unknown, newPage: number) => setPage(newPage)

  const onChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(e.target.value, 10))
    setPage(0)
  }

  // ---- Log dialog handling ----

  const stopLogPolling = useCallback(() => {
    if (logPollTimerRef.current) {
      clearInterval(logPollTimerRef.current)
      logPollTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      stopLogPolling()
    }
  }, [stopLogPolling])

  const fetchLogChunk = useCallback(
    async (
      upid: string,
      start: number,
      limit: number
    ): Promise<{ log: LogLine[]; status: PbsTaskStatus } | null> => {
      const res = await fetch(
        `/api/v1/pbs/${pbsId}/tasks/${encodeURIComponent(upid)}/log?start=${start}&limit=${limit}`,
        { cache: 'no-store' }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      return {
        log: Array.isArray(body?.data?.log) ? body.data.log : [],
        status: body?.data?.status ?? null,
      }
    },
    [pbsId]
  )

  const openLogDialog = useCallback(
    async (task: PbsTask) => {
      setLogOpen(true)
      setLogTask(task)
      setLogLines([])
      setLogStatus(null)
      setLogError(null)
      setLogLoading(true)
      setLogCopied(false)
      lastLineRef.current = 0
      stopLogPolling()

      try {
        const chunk = await fetchLogChunk(task.upid, 0, 1000)
        if (!chunk) return
        const { log, status } = chunk
        setLogLines(log)
        setLogStatus(status)
        lastLineRef.current = log.length > 0 ? log[log.length - 1].n : 0

        const statusStr = (status?.status || '').toLowerCase()
        const stillRunning = statusStr === 'running' || (!status?.endtime && statusStr !== 'stopped')
        if (stillRunning) {
          logPollTimerRef.current = setInterval(async () => {
            try {
              const next = await fetchLogChunk(task.upid, lastLineRef.current, 1000)
              if (!next) return
              if (next.log.length > 0) {
                setLogLines(prev => [...prev, ...next.log])
                lastLineRef.current = next.log[next.log.length - 1].n
              }
              setLogStatus(next.status)
              const ns = (next.status?.status || '').toLowerCase()
              if (ns !== 'running') {
                stopLogPolling()
              }
            } catch (e: any) {
              setLogError(e?.message || String(e))
              stopLogPolling()
            }
          }, 2000)
        }
      } catch (e: any) {
        setLogError(e?.message || String(e))
      } finally {
        setLogLoading(false)
      }
    },
    [fetchLogChunk, stopLogPolling]
  )

  const closeLogDialog = () => {
    stopLogPolling()
    setLogOpen(false)
    setLogTask(null)
    setLogLines([])
    setLogStatus(null)
    setLogError(null)
    lastLineRef.current = 0
  }

  const copyLogs = async () => {
    const text = logLines.map(l => l.t).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setLogCopied(true)
      setTimeout(() => setLogCopied(false), 2000)
    } catch {
      setLogCopied(false)
    }
  }

  // ---- Chip renderer ----

  const renderStatusChip = (task: PbsTask) => {
    const { kind, text } = classifyStatus(task)
    const size: 'small' = 'small'
    if (kind === 'ok') {
      return (
        <PbsStatusChip color="success" label={t('inventory.pbsTasksStatus.ok')} sx={{ fontWeight: 600 }} />
      )
    }
    if (kind === 'running') {
      return (
        <Chip
          size={size}
          variant="tonal"
          color="info"
          icon={<CircularProgress size={12} sx={{ color: 'inherit !important', ml: '6px' }} />}
          label={t('inventory.pbsTasksStatus.running')}
          sx={{ fontWeight: 600 }}
        />
      )
    }
    if (kind === 'stopped') {
      return (
        <Chip
          size={size}
          label={t('inventory.pbsTasksStatus.stopped')}
          sx={{ fontWeight: 600, bgcolor: 'action.hover' }}
        />
      )
    }
    if (kind === 'error') {
      const display = text.length > 40 ? `${text.slice(0, 40)}…` : text
      return (
        <Tooltip title={text} placement="top-start">
          <PbsStatusChip color="error" label={display || t('inventory.pbsTasksStatus.error')} sx={{ fontWeight: 600, maxWidth: 260 }} />
        </Tooltip>
      )
    }
    return <Chip size={size} label={text || '—'} sx={{ fontWeight: 600 }} />
  }

  const renderDialogStatusChip = (status: PbsTaskStatus) => {
    if (!status) return null
    const raw = status.status || ''
    const kind = classifyStatusString(raw)
    if (kind === 'ok') {
      return <PbsStatusChip color="success" label={t('inventory.pbsTasksStatus.ok')} />
    }
    if (kind === 'running') {
      return (
        <Chip
          size="small"
          variant="tonal"
          color="info"
          icon={<CircularProgress size={12} sx={{ color: 'inherit !important', ml: '6px' }} />}
          label={t('inventory.pbsTasksStatus.running')}
        />
      )
    }
    if (kind === 'stopped') {
      return <Chip size="small" label={t('inventory.pbsTasksStatus.stopped')} />
    }
    if (kind === 'error') {
      const display = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw
      return (
        <Tooltip title={raw} placement="top-start">
          <PbsStatusChip color="error" label={display || t('inventory.pbsTasksStatus.error')} />
        </Tooltip>
      )
    }
    return <Chip size="small" label={raw || '—'} />
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            label={t('inventory.pbsTasksShowRunning')}
            color={runningOnly ? 'primary' : 'default'}
            onClick={() => {
              setRunningOnly(v => !v)
              setPage(0)
            }}
            sx={{ fontWeight: 600, cursor: 'pointer' }}
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={errorsOnly}
                onChange={e => {
                  setErrorsOnly(e.target.checked)
                  setPage(0)
                }}
              />
            }
            label={<Typography variant="body2">{t('inventory.pbsTasksShowErrors')}</Typography>}
            sx={{ m: 0 }}
          />
          <TextField
            size="small"
            label={t('inventory.pbsTasksFilterType')}
            value={typeFilterInput}
            onChange={e => setTypeFilterInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') applyTextFilters()
            }}
            sx={{ minWidth: 160 }}
          />
          <TextField
            size="small"
            label={t('inventory.pbsTasksFilterUser')}
            value={userFilterInput}
            onChange={e => setUserFilterInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') applyTextFilters()
            }}
            sx={{ minWidth: 180 }}
          />
          <Button size="small" variant="outlined" onClick={applyTextFilters} disabled={loading}>
            {t('inventory.pbsTasksApply')}
          </Button>
          {(typeFilter || userFilter) && (
            <Button size="small" variant="text" onClick={clearTextFilters}>
              {t('inventory.pbsTasksClear')}
            </Button>
          )}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={fetchTasks}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsTasksRefresh')}
          </Button>
          {lastUpdated && (
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {t('inventory.pbsTasksLastUpdated')}: {lastUpdated.toLocaleTimeString()}
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Content */}
      {loading && tasks.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchTasks}>
              {t('inventory.pbsTasksRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsTasksLoadError')}: {error}
        </Alert>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sortDirection={order}>
                  <TableSortLabel active direction={order} onClick={handleSortStart}>
                    {t('inventory.pbsTasksCol.startTime')}
                  </TableSortLabel>
                </TableCell>
                <TableCell>{t('inventory.pbsTasksCol.endTime')}</TableCell>
                <TableCell>{t('inventory.pbsTasksCol.node')}</TableCell>
                <TableCell>{t('inventory.pbsTasksCol.user')}</TableCell>
                <TableCell>{t('inventory.pbsTasksCol.type')}</TableCell>
                <TableCell>{t('inventory.pbsTasksCol.workerId')}</TableCell>
                <TableCell>{t('inventory.pbsTasksCol.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {displayTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, opacity: 0.6 }}>
                    {t('inventory.pbsTasksNone')}
                  </TableCell>
                </TableRow>
              ) : (
                displayTasks.map(task => {
                  const endLabel = task.endtime ? formatTimestamp(task.endtime) : '—'
                  return (
                    <TableRow
                      key={task.upid}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => openLogDialog(task)}
                    >
                      <TableCell sx={{ fontSize: 12 }}>
                        {formatTimestamp(task.starttime)}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        {endLabel}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">{task.node || '—'}</Typography>
                      </TableCell>
                      <TableCell
                        sx={{
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <Tooltip title={task.user || ''} placement="top-start">
                          <Typography
                            variant="caption"
                            sx={{
                              
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {task.user || '—'}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{  }}>
                          {task.worker_type || task.type || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell
                        sx={{
                          maxWidth: 240,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <Tooltip title={task.worker_id || ''} placement="top-start">
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {task.worker_id || '—'}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{renderStatusChip(task)}</TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={-1}
            page={page}
            onPageChange={onChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={onChangeRowsPerPage}
            rowsPerPageOptions={[25, 50, 100, 200]}
            labelRowsPerPage={t('inventory.pbsTasksRowsPerPage')}
          />
        </TableContainer>
      )}

      {/* Log dialog */}
      <Dialog open={logOpen} onClose={closeLogDialog} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 6 }}>
          <i className="ri-terminal-box-line" style={{ fontSize: 18 }} />
          <Box component="span" sx={{ fontWeight: 700 }}>
            {t('inventory.pbsTasksLogTitle')}
          </Box>
          {logTask && (
            <>
              <Chip
                size="small"
                label={logTask.worker_type || logTask.type || '—'}
                sx={{  }}
              />
              <Box component="span" sx={{ opacity: 0.7, fontSize: 12 }}>
                {logTask.user || ''}
              </Box>
              <Box sx={{ ml: 'auto' }}>{renderDialogStatusChip(logStatus)}</Box>
            </>
          )}
          <IconButton
            aria-label="close"
            onClick={closeLogDialog}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {logTask && (
            <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography
                variant="caption"
                sx={{
                  
                  opacity: 0.6,
                  wordBreak: 'break-all',
                }}
              >
                {logTask.upid}
              </Typography>
            </Box>
          )}
          {logLoading && logLines.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          ) : logError ? (
            <Box sx={{ p: 2 }}>
              <Alert severity="error">{logError}</Alert>
            </Box>
          ) : (
            <Box
              component="pre"
              sx={{
                m: 0,
                bgcolor: '#1e1e1e',
                color: '#d4d4d4',
                
                fontSize: 12,
                lineHeight: 1.5,
                overflow: 'auto',
                maxHeight: '70vh',
                p: 2,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {logLines.length === 0 ? (
                <Box sx={{ opacity: 0.5, fontStyle: 'italic' }}>
                  {t('inventory.pbsTasksLogEmpty')}
                </Box>
              ) : (
                logLines.map(line => (
                  <Box key={line.n} sx={{ display: 'flex', gap: 1.5 }}>
                    <Box
                      component="span"
                      sx={{
                        color: '#6b7280',
                        userSelect: 'none',
                        minWidth: 48,
                        textAlign: 'right',
                        flexShrink: 0,
                      }}
                    >
                      {line.n}
                    </Box>
                    <Box component="span" sx={{ flex: 1 }}>
                      {line.t}
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={copyLogs}
            startIcon={<i className="ri-clipboard-line" style={{ fontSize: 16 }} />}
            disabled={logLines.length === 0}
          >
            {logCopied ? t('inventory.pbsTasksLogCopied') : t('inventory.pbsTasksLogCopy')}
          </Button>
          <Button onClick={closeLogDialog} variant="contained">
            {t('inventory.pbsTasksLogClose')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
