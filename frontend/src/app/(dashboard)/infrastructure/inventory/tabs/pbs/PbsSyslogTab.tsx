'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { keyframes } from '@mui/material/styles'

interface PbsSyslogTabProps {
  pbsId: string
}

type SyslogSource = 'journal' | 'syslog'

const POLL_INTERVAL_MS = 3000
const TAIL_FETCH_COUNT = 100
const SERVICE_DEBOUNCE_MS = 400
const BOTTOM_STICKY_THRESHOLD_PX = 50
const MAX_BUFFER_LINES = 10000

const pulse = keyframes`
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
  100% { transform: scale(1); opacity: 1; }
`

/** Convert an ISO-ish datetime-local string (YYYY-MM-DDTHH:mm) to unix seconds. */
function datetimeLocalToUnix(value: string): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (isNaN(ms)) return null
  return Math.floor(ms / 1000)
}

/** Escape a string for inclusion in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build highlighted fragments for a line given a client-side search term. */
function highlightLine(line: string, search: string): React.ReactNode {
  if (!search) return line
  const re = new RegExp(`(${escapeRegExp(search)})`, 'gi')
  const parts = line.split(re)
  return parts.map((part, idx) =>
    re.test(part) ? (
      <Box
        key={idx}
        component="span"
        sx={{ bgcolor: '#fde047', color: '#000', borderRadius: 0.5, px: 0.25 }}
      >
        {part}
      </Box>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  )
}

export default function PbsSyslogTab({ pbsId }: PbsSyslogTabProps) {
  const t = useTranslations()

  const [since, setSince] = useState<string>('')
  const [until, setUntil] = useState<string>('')
  const [lastEntries, setLastEntries] = useState<number>(500)
  const [serviceInput, setServiceInput] = useState<string>('')
  const [serviceFilter, setServiceFilter] = useState<string>('')
  const [search, setSearch] = useState<string>('')

  const [lines, setLines] = useState<string[]>([])
  const [source, setSource] = useState<SyslogSource | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [liveTail, setLiveTail] = useState<boolean>(false)

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollContainerRef = useRef<HTMLPreElement | null>(null)
  const userAtBottomRef = useRef<boolean>(true)
  const linesRef = useRef<string[]>([])

  // Keep linesRef in sync for polling dedup without re-creating the interval
  useEffect(() => {
    linesRef.current = lines
  }, [lines])

  // Debounce service filter input
  useEffect(() => {
    const handle = setTimeout(() => {
      setServiceFilter(serviceInput.trim())
    }, SERVICE_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [serviceInput])

  const buildQuery = useCallback(
    (overrides?: { lastentries?: number; service?: string; since?: number; until?: number }) => {
      const qs = new URLSearchParams()
      const le = overrides?.lastentries ?? lastEntries
      qs.set('lastentries', String(le))
      const s = overrides?.since
      if (typeof s === 'number' && !isNaN(s)) {
        qs.set('since', String(s))
      } else if (s === undefined) {
        const sinceUnix = datetimeLocalToUnix(since)
        if (sinceUnix !== null) qs.set('since', String(sinceUnix))
      }
      const u = overrides?.until
      if (typeof u === 'number' && !isNaN(u)) {
        qs.set('until', String(u))
      } else if (u === undefined) {
        const untilUnix = datetimeLocalToUnix(until)
        if (untilUnix !== null) qs.set('until', String(untilUnix))
      }
      const svc = overrides?.service ?? serviceFilter
      if (svc) qs.set('service', svc)
      return qs
    },
    [lastEntries, since, until, serviceFilter]
  )

  const fetchSyslog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = buildQuery()
      const res = await fetch(`/api/v1/pbs/${pbsId}/syslog?${qs.toString()}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      const newLines: string[] = Array.isArray(body?.data?.lines) ? body.data.lines : []
      const src: SyslogSource | null =
        body?.data?.source === 'journal' || body?.data?.source === 'syslog'
          ? body.data.source
          : null
      setLines(newLines)
      setSource(src)
      setLastUpdated(new Date())
      // After initial load, scroll to bottom
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current
        if (el) {
          el.scrollTop = el.scrollHeight
          userAtBottomRef.current = true
        }
      })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId, buildQuery])

  // Initial fetch + refetch on toolbar changes (lastEntries, since, until, serviceFilter)
  useEffect(() => {
    fetchSyslog()
  }, [fetchSyslog])

  // --- Live tail polling ---

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const pollTailOnce = useCallback(async () => {
    try {
      const qs = buildQuery({ lastentries: TAIL_FETCH_COUNT })
      const res = await fetch(`/api/v1/pbs/${pbsId}/syslog?${qs.toString()}`, {
        cache: 'no-store',
      })
      if (!res.ok) return // silently skip — keep polling
      const body = await res.json().catch(() => null)
      const fetched: string[] = Array.isArray(body?.data?.lines) ? body.data.lines : []
      if (fetched.length === 0) return

      // Dedupe: find the longest overlap suffix of current buffer with the fetched prefix
      const current = linesRef.current
      let appendFrom = 0
      if (current.length > 0) {
        const tail = current.slice(-Math.min(current.length, fetched.length))
        // Walk k from largest possible down to 1; append fetched[k:] if tail.endsWith(fetched[0..k])
        let matched = false
        for (let k = Math.min(tail.length, fetched.length); k > 0; k--) {
          let ok = true
          for (let i = 0; i < k; i++) {
            if (tail[tail.length - k + i] !== fetched[i]) {
              ok = false
              break
            }
          }
          if (ok) {
            appendFrom = k
            matched = true
            break
          }
        }
        if (!matched) {
          // No overlap found; fall back to line-by-line dedup against a tail set
          const tailSet = new Set(current.slice(-Math.max(fetched.length, 200)))
          const filtered = fetched.filter(l => !tailSet.has(l))
          if (filtered.length === 0) return
          setLines(prev => {
            const next = prev.concat(filtered)
            return next.length > MAX_BUFFER_LINES ? next.slice(next.length - MAX_BUFFER_LINES) : next
          })
          setLastUpdated(new Date())
          maybeScrollToBottom()
          return
        }
      }

      const toAppend = fetched.slice(appendFrom)
      if (toAppend.length === 0) return
      setLines(prev => {
        const next = prev.concat(toAppend)
        return next.length > MAX_BUFFER_LINES ? next.slice(next.length - MAX_BUFFER_LINES) : next
      })
      setLastUpdated(new Date())
      maybeScrollToBottom()
    } catch {
      // ignore transient errors while tailing
    }
  }, [pbsId, buildQuery])

  const maybeScrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current
      if (el && userAtBottomRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
  }

  useEffect(() => {
    if (!liveTail) {
      stopPolling()
      return
    }
    // Start interval
    pollTimerRef.current = setInterval(() => {
      pollTailOnce()
    }, POLL_INTERVAL_MS)
    return () => {
      stopPolling()
    }
  }, [liveTail, pollTailOnce, stopPolling])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  const handleScroll = (e: React.UIEvent<HTMLPreElement>) => {
    const el = e.currentTarget
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userAtBottomRef.current = distFromBottom < BOTTOM_STICKY_THRESHOLD_PX
  }

  // Filter lines client-side by `search`
  const filteredLines = useMemo(() => {
    if (!search) return lines
    const needle = search.toLowerCase()
    return lines.filter(l => l.toLowerCase().includes(needle))
  }, [lines, search])

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          position: 'sticky',
          top: 0,
          zIndex: 2,
          bgcolor: 'background.paper',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            type="datetime-local"
            label={t('inventory.pbsSyslogSince')}
            value={since}
            onChange={e => setSince(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 200 }}
          />
          <TextField
            size="small"
            type="datetime-local"
            label={t('inventory.pbsSyslogUntil')}
            value={until}
            onChange={e => setUntil(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 200 }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t('inventory.pbsSyslogLastEntries')}</InputLabel>
            <Select
              value={lastEntries}
              label={t('inventory.pbsSyslogLastEntries')}
              onChange={e => setLastEntries(Number(e.target.value))}
            >
              <MenuItem value={100}>100</MenuItem>
              <MenuItem value={500}>500</MenuItem>
              <MenuItem value={1000}>1000</MenuItem>
              <MenuItem value={2000}>2000</MenuItem>
              <MenuItem value={5000}>5000</MenuItem>
            </Select>
          </FormControl>
          <TextField
            size="small"
            label={t('inventory.pbsSyslogServiceFilter')}
            value={serviceInput}
            onChange={e => setServiceInput(e.target.value)}
            sx={{ minWidth: 180 }}
          />
          <TextField
            size="small"
            label={t('inventory.pbsSyslogSearch')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ minWidth: 200 }}
          />
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            size="small"
            onClick={fetchSyslog}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsSyslogRefresh')}
          </Button>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Switch
              size="small"
              checked={liveTail}
              onChange={e => setLiveTail(e.target.checked)}
            />
            <Typography variant="body2">{t('inventory.pbsSyslogLiveTail')}</Typography>
            {liveTail && (
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: '#22c55e',
                  ml: 0.5,
                  animation: `${pulse} 1.5s ease-in-out infinite`,
                }}
              />
            )}
          </Stack>
          {source && (
            <Chip
              size="small"
              label={t('inventory.pbsSyslogSource', { source })}
              variant="outlined"
              sx={{ fontSize: 11 }}
            />
          )}
          {lastUpdated && (
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {t('inventory.pbsSyslogLastUpdated')}: {lastUpdated.toLocaleTimeString()}
            </Typography>
          )}
          {!loading && !error && (
            <Typography variant="caption" sx={{ opacity: 0.75 }}>
              {t('inventory.pbsSyslogLineCount', {
                filtered: filteredLines.length,
                total: lines.length,
              })}
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Content */}
      {loading && lines.length === 0 ? (
        <Box
          sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}
        >
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchSyslog}>
              {t('inventory.pbsSyslogRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsSyslogLoadError')}: {error}
        </Alert>
      ) : (
        <Box
          component="pre"
          ref={scrollContainerRef}
          onScroll={handleScroll}
          sx={{
            m: 0,
            bgcolor: '#1e1e1e',
            color: '#d4d4d4',
            
            fontSize: 12,
            lineHeight: 1.5,
            overflow: 'auto',
            p: 2,
            borderRadius: 1,
            flex: 1,
            minHeight: 0,
            maxHeight: 'calc(100vh - 350px)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {filteredLines.length === 0 ? (
            <Box sx={{ opacity: 0.5, fontStyle: 'italic' }}>
              {t('inventory.pbsSyslogEmpty')}
            </Box>
          ) : (
            filteredLines.map((line, idx) => (
              <Box key={idx} sx={{ display: 'flex', gap: 1.5 }}>
                <Box
                  component="span"
                  sx={{
                    color: '#6b7280',
                    userSelect: 'none',
                    minWidth: 56,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {idx + 1}
                </Box>
                <Box component="span" sx={{ flex: 1 }}>
                  {highlightLine(line, search)}
                </Box>
              </Box>
            ))
          )}
        </Box>
      )}
    </Box>
  )
}
