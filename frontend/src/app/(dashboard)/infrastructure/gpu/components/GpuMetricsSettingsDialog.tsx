'use client'

import { useEffect, useState } from 'react'

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
  MenuItem,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

import { GuestGlyph } from '@/components/gpu/GpuInventoryPanel'
import { SMALL_SELECT_SX } from '@/components/backup/restoreDrills/DrillTargetPicker'
import type { GpuMetricsSettings } from '@/lib/gpu/metricsShared'

type Candidate = { connectionId: string; connectionName: string; node: string; vmid: number; vmName: string | null; vmStatus: string | null; gpus: string[] }

type Loaded = { settings: GpuMetricsSettings; candidates: { guests: Candidate[]; nodes: Array<{ connectionId: string; connectionName: string; node: string }> } }

type ProbeResult = { status: string; gpus: number; detail?: string } | { status: 'error'; gpus: 0; detail?: string }

const INTERVALS = [30, 60, 120, 300, 600]

const key = (connId: string, vmid: number) => `${connId}|${vmid}`
const nodeKey = (connId: string, node: string) => `${connId}|node|${node}`

const KNOWN_STATUSES = ['agent_unavailable', 'nvidia_smi_missing', 'command_failed', 'parse_error', 'not_found', 'not_running', 'connection_unavailable', 'ssh_unavailable']

function ProbeChip({ p }: { p: ProbeResult }) {
  const t = useTranslations('gpu.settings')
  return (
    <Chip
      size='small'
      variant='outlined'
      color={p.status === 'ok' ? 'success' : 'warning'}
      label={p.status === 'ok' ? t('probeOk', { count: p.gpus }) : t(`status.${KNOWN_STATUSES.includes(p.status) ? p.status : 'error'}`)}
      title={p.detail}
      sx={{ maxWidth: '100%' }}
    />
  )
}

/** Reads the settings when it opens; any tenant but the provider gets 404 and never sees the button. */
export function useGpuMetricsSettings(open: boolean) {
  const [state, setState] = useState<{ data: Loaded | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/v1/gpu/metrics/settings', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        if (!cancelled) setState({ data: json.data, error: null })
      })
      .catch(e => !cancelled && setState({ data: null, error: e?.message || String(e) }))
    return () => {
      cancelled = true
    }
  }, [open])
  return state
}

export default function GpuMetricsSettingsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('gpu.settings')
  const theme = useTheme()
  const { data, error } = useGpuMetricsSettings(open)
  const [draft, setDraft] = useState<GpuMetricsSettings | null>(null)
  const [probes, setProbes] = useState<Record<string, ProbeResult | 'running'>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (data) setDraft(data.settings)
  }, [data])
  useEffect(() => {
    if (!open) {
      setDraft(null)
      setProbes({})
      setSaveError(null)
    }
  }, [open])

  const selected = new Set((draft?.guest_vms ?? []).map(g => key(g.connection_id, g.vmid)))
  const toggle = (c: Candidate) => {
    if (!draft) return
    const k = key(c.connectionId, c.vmid)
    setDraft({
      ...draft,
      guest_vms: selected.has(k) ? draft.guest_vms.filter(g => key(g.connection_id, g.vmid) !== k) : [...draft.guest_vms, { connection_id: c.connectionId, vmid: c.vmid }],
    })
  }

  const selectedNodes = new Set((draft?.host_nodes ?? []).map(n => nodeKey(n.connection_id, n.node)))
  const toggleNode = (connId: string, node: string) => {
    if (!draft) return
    const k = nodeKey(connId, node)
    setDraft({
      ...draft,
      host_nodes: selectedNodes.has(k) ? draft.host_nodes.filter(n => nodeKey(n.connection_id, n.node) !== k) : [...draft.host_nodes, { connection_id: connId, node }],
    })
  }

  const probe = async (k: string, body: { connectionId: string; vmid?: number; node?: string }) => {
    setProbes(p => ({ ...p, [k]: 'running' }))
    try {
      const res = await fetch('/api/v1/gpu/metrics/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      const p = json?.data?.probes?.[0]
      setProbes(s => ({ ...s, [k]: res.ok && p ? { status: p.status, gpus: p.gpus, detail: p.detail } : { status: 'error', gpus: 0, detail: json?.error } }))
    } catch {
      setProbes(s => ({ ...s, [k]: { status: 'error', gpus: 0 } }))
    }
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/v1/gpu/metrics/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      onSaved()
      onClose()
    } catch (e: any) {
      setSaveError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const setNumber = (field: 'retention_days', v: string) => draft && setDraft({ ...draft, [field]: Number(v) })
  const setThreshold = (field: keyof GpuMetricsSettings['thresholds'], v: string) => draft && setDraft({ ...draft, thresholds: { ...draft.thresholds, [field]: Number(v) } })
  const known = new Set((data?.candidates.guests ?? []).map(c => key(c.connectionId, c.vmid)))
  const orphans = (draft?.guest_vms ?? []).filter(g => !known.has(key(g.connection_id, g.vmid)))

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>{t('title')}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity='error'>{t('loadError')}</Alert>}
        {!draft && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>}
        {draft && (
          <>
            <Alert severity='info' icon={<i className='ri-information-line' />}>{t('howItWorks')}</Alert>
            <FormControlLabel control={<Switch checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />} label={t('enabled')} />
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1.5 }}>
              <TextField select size='small' label={t('interval')} value={draft.interval_seconds} onChange={e => setDraft({ ...draft, interval_seconds: Number(e.target.value) })} sx={SMALL_SELECT_SX}>
                {INTERVALS.map(s => <MenuItem key={s} value={s}>{t('everySeconds', { seconds: s })}</MenuItem>)}
              </TextField>
              <TextField size='small' type='number' label={t('retention')} value={draft.retention_days} onChange={e => setNumber('retention_days', e.target.value)} slotProps={{ htmlInput: { min: 1, max: 400 } }} />
              <TextField size='small' type='number' label={t('utilThreshold')} value={draft.thresholds.util_pct} onChange={e => setThreshold('util_pct', e.target.value)} slotProps={{ htmlInput: { min: 1, max: 100 } }} />
              <TextField size='small' type='number' label={t('memoryThreshold')} value={draft.thresholds.memory_pct} onChange={e => setThreshold('memory_pct', e.target.value)} slotProps={{ htmlInput: { min: 1, max: 100 } }} />
              <TextField size='small' type='number' label={t('tempThreshold')} value={draft.thresholds.temp_c} onChange={e => setThreshold('temp_c', e.target.value)} slotProps={{ htmlInput: { min: 1, max: 120 } }} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <FormControlLabel control={<Switch checked={draft.alerts} onChange={e => setDraft({ ...draft, alerts: e.target.checked })} />} label={t('alerts')} />
              <TextField
                size='small'
                type='number'
                label={t('idleDays')}
                value={draft.idle_days}
                disabled={!draft.alerts}
                onChange={e => setDraft({ ...draft, idle_days: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                slotProps={{ htmlInput: { min: 0, max: 365 } }}
                sx={{ width: 260 }}
              />
              <Typography variant='caption' color='text.secondary' sx={{ flex: 1, minWidth: 240 }}>{t('alertsHint')}</Typography>
            </Box>

            <Box>
              <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>{t('guests')}</Typography>
              <Typography variant='caption' color='text.secondary'>{t('guestsHint')}</Typography>
            </Box>
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
              {(data?.candidates.guests ?? []).length === 0 && <Typography variant='body2' color='text.secondary' sx={{ p: 2 }}>{t('noGuest')}</Typography>}
              {(data?.candidates.guests ?? []).map(c => {
                const k = key(c.connectionId, c.vmid)
                const p = probes[k]
                return (
                  <Box key={k} data-testid='gpu-settings-guest' sx={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr) 160px 220px', gap: 1, alignItems: 'center', px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                    <Checkbox size='small' checked={selected.has(k)} onChange={() => toggle(c)} slotProps={{ input: { 'aria-label': `${c.vmName ?? c.vmid}` } }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                      <GuestGlyph status={c.vmStatus} dotBorder={theme.palette.background.paper} />
                      <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.vmName ?? `VM ${c.vmid}`}</Typography>
                      <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>#{c.vmid}</Typography>
                      <Typography variant='caption' color='text.secondary' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.connectionName} · {c.gpus.join(', ')}</Typography>
                    </Box>
                    <Button size='small' variant='text' disabled={p === 'running' || c.vmStatus !== 'running'} onClick={() => probe(k, { connectionId: c.connectionId, vmid: c.vmid })} startIcon={p === 'running' ? <CircularProgress size={12} /> : <i className='ri-flask-line' />}>
                      {t('test')}
                    </Button>
                    <Box sx={{ minWidth: 0 }}>
                      {c.vmStatus !== 'running' && !p && <Typography variant='caption' color='text.secondary'>{t('status.not_running')}</Typography>}
                      {p && p !== 'running' && <ProbeChip p={p} />}
                    </Box>
                  </Box>
                )
              })}
            </Box>
            {orphans.length > 0 && <Typography variant='caption' color='text.secondary'>{t('orphans', { count: orphans.length })}</Typography>}

            <Box>
              <Typography variant='subtitle2' sx={{ fontWeight: 700 }}>{t('nodes')}</Typography>
              <Typography variant='caption' color='text.secondary'>{t('nodesHint')}</Typography>
            </Box>
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
              {(data?.candidates.nodes ?? []).length === 0 && <Typography variant='body2' color='text.secondary' sx={{ p: 2 }}>{t('noNode')}</Typography>}
              {(data?.candidates.nodes ?? []).map(n => {
                const k = nodeKey(n.connectionId, n.node)
                const p = probes[k]
                return (
                  <Box key={k} data-testid='gpu-settings-node' sx={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr) 160px 220px', gap: 1, alignItems: 'center', px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                    <Checkbox size='small' checked={selectedNodes.has(k)} onChange={() => toggleNode(n.connectionId, n.node)} slotProps={{ input: { 'aria-label': n.node } }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                      <i className='ri-server-line' style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
                      <Typography variant='body2' sx={{ fontWeight: 600 }}>{n.node}</Typography>
                      <Typography variant='caption' color='text.secondary' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.connectionName}</Typography>
                    </Box>
                    <Button size='small' variant='text' disabled={p === 'running'} onClick={() => probe(k, { connectionId: n.connectionId, node: n.node })} startIcon={p === 'running' ? <CircularProgress size={12} /> : <i className='ri-flask-line' />}>
                      {t('test')}
                    </Button>
                    <Box sx={{ minWidth: 0 }}>{p && p !== 'running' && <ProbeChip p={p} />}</Box>
                  </Box>
                )
              })}
            </Box>
            {saveError && <Alert severity='error'>{t('saveError', { error: saveError })}</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant='contained' onClick={save} disabled={!draft || saving}>{t('save')}</Button>
      </DialogActions>
    </Dialog>
  )
}
