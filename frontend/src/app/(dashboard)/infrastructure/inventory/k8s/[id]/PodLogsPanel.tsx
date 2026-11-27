'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, MenuItem, Select, FormControlLabel, Switch, Button, Alert, IconButton, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'
import { panelMessage } from '@/lib/k8s/panelState'
import type { PodLogsResult, ContainerInfo } from '@/lib/k8s/types'

const LIVE_INTERVAL_MS = 2500

export function PodLogsPanel({
  clusterId,
  namespace,
  pod,
  containers,
}: {
  clusterId: string
  namespace: string
  pod: string
  containers: ContainerInfo[]
}) {
  const t = useTranslations('kubernetes.explorer')
  const [container, setContainer] = useState(containers[0]?.name || '')
  const [previous, setPrevious] = useState(false)
  const [tail, setTail] = useState(200)
  const [live, setLive] = useState(false)
  const [state, setState] = useState<{
    status: string
    errorCode?: string
    truncated?: boolean
    logs?: string
  }>({ status: 'idle' })
  const logRef = useRef<HTMLElement>(null)

  const load = useCallback(async () => {
    // Only show the loading state on the first fetch; live refreshes update in place.
    setState(s => (s.logs === undefined ? { ...s, status: 'loading' } : s))
    const qs = new URLSearchParams({ namespace, pod, tailLines: String(tail) })
    if (container) qs.set('container', container)
    if (previous) qs.set('previous', '1')
    try {
      const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/logs?${qs.toString()}`)
      const body = (await res.json()) as PodLogsResult & { error?: string }
      if (!res.ok) {
        setState({ status: 'error', errorCode: 'unreachable' })
        return
      }
      if (body.errorCode) {
        setState({ status: body.errorCode === 'forbidden' ? 'forbidden' : 'error', errorCode: body.errorCode })
        return
      }
      setState({ status: 'ok', truncated: body.truncated, logs: body.logs })
    } catch {
      setState({ status: 'error', errorCode: 'unreachable' })
    }
  }, [clusterId, namespace, pod, container, previous, tail])

  useEffect(() => { load() }, [load])

  // Live mode: poll the snapshot endpoint on an interval (no server-side streaming).
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => { load() }, LIVE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [live, load])

  // Following a previous (crashed) container makes no sense in live mode.
  useEffect(() => { if (live && previous) setPrevious(false) }, [live, previous])

  // Keep the newest lines in view (tail behavior).
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [state.logs])

  const copyLogs = () => {
    try { navigator.clipboard?.writeText(state.logs || '') } catch { /* clipboard unavailable */ }
  }

  const msg = panelMessage(state)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap', flexShrink: 0 }}>
        <Select size="small" value={container} onChange={e => setContainer(e.target.value)}>
          {containers.map(c => (
            <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>
          ))}
        </Select>
        <Select size="small" value={tail} onChange={e => setTail(Number(e.target.value))}>
          {[100, 200, 500, 1000].map(n => (
            <MenuItem key={n} value={n}>{n}</MenuItem>
          ))}
        </Select>
        <FormControlLabel
          control={<Switch size="small" checked={previous} disabled={live} onChange={e => setPrevious(e.target.checked)} />}
          label={t('logs.previous')}
        />
        <FormControlLabel
          control={<Switch size="small" color="success" checked={live} onChange={e => setLive(e.target.checked)} />}
          label={t('logs.live')}
        />
        <Button size="small" onClick={load} disabled={live}>{t('refresh')}</Button>
      </Box>
      {msg && (
        <Alert severity={msg.tone} sx={{ mb: 1, flexShrink: 0 }}>
          {t(`msg.${msg.key}`)}
        </Alert>
      )}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {live && (
          <Box
            sx={{
              position: 'absolute', top: 8, left: 10, zIndex: 1,
              display: 'flex', alignItems: 'center', gap: 0.5,
              fontSize: '0.68rem', fontWeight: 700, letterSpacing: 0.5,
              color: '#4caf50', textTransform: 'uppercase',
            }}
          >
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#4caf50' }} />
            {t('logs.live')}
          </Box>
        )}
        <Tooltip title={t('logs.copy')}>
          <span style={{ position: 'absolute', top: 6, right: 8, zIndex: 1 }}>
            <IconButton
              size="small"
              onClick={copyLogs}
              disabled={!state.logs}
              aria-label={t('logs.copy')}
              sx={{
                color: 'rgba(255,255,255,0.75)',
                bgcolor: 'rgba(255,255,255,0.08)',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
              }}
            >
              <i className="ri-file-copy-line" style={{ fontSize: 15 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Box
          component="pre"
          ref={logRef}
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.78rem',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            height: '100%',
            overflow: 'auto',
            m: 0,
            p: 1.5,
            borderRadius: 1,
            bgcolor: '#0d1117',
            color: '#e6edf3',
          }}
        >
          {state.logs || ''}
        </Box>
      </Box>
    </Box>
  )
}
