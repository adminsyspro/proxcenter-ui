'use client'

import { useEffect, useState } from 'react'

import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { useToast } from '@/contexts/ToastContext'
import { lastGroupDrain, returnDrainConfig, returnableGuests, type GroupDrainGuest } from '@/lib/hostDrain/groupReturn'

// Leaving the maintenance of a group of nodes (roadmap#198): every node leaves
// HA maintenance (Proxmox brings its HA guests back), then, when asked, the
// guests the group drain moved itself go back to the node they left, through
// a selection drain once no node of the group is in maintenance any more.

export const GROUP_EXIT_POLL_MS = 3_000
export const GROUP_EXIT_WAIT_MS = 90_000

const maintenanceUrl = (connId: string, node: string) =>
  `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`

async function stillInMaintenance(connId: string, nodes: string[]): Promise<boolean> {
  const states = await Promise.all(nodes.map(async node => {
    try {
      const res = await fetch(maintenanceUrl(connId, node), { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))

      return res.ok ? json?.data?.maintenance === 'maintenance' : true
    } catch {
      return true
    }
  }))

  return states.some(Boolean)
}

/** Resolves once no node of the group is in maintenance, false after `timeoutMs`. */
export function waitForGroupOut(connId: string, nodes: string[], opts: { pollMs?: number; timeoutMs?: number } = {}): Promise<boolean> {
  const pollMs = opts.pollMs ?? GROUP_EXIT_POLL_MS
  const deadline = Date.now() + (opts.timeoutMs ?? GROUP_EXIT_WAIT_MS)

  return new Promise(resolve => {
    const check = () => {
      stillInMaintenance(connId, nodes).then(busy => {
        if (!busy) resolve(true)
        else if (Date.now() >= deadline) resolve(false)
        else setTimeout(check, pollMs)
      }, () => resolve(false))
    }

    check()
  })
}

export default function HostGroupExitDialog({ connId, nodes, onClose, onStarted, waitOpts }: {
  connId: string
  nodes: string[]
  onClose: () => void
  /** The return drain, for the Task Center dialog. */
  onStarted?: (drain: unknown) => void
  waitOpts?: { pollMs?: number; timeoutMs?: number }
}) {
  const t = useTranslations()
  const toast = useToast()
  const [guests, setGuests] = useState<GroupDrainGuest[] | null>(null)
  const [bringBack, setBringBack] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The guests the last group drain of exactly these nodes moved itself.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/orchestrator/host-drains?connection_id=${encodeURIComponent(connId)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        const drains = Array.isArray(json?.data) ? json.data : []
        if (!cancelled) setGuests(returnableGuests(lastGroupDrain(drains, nodes)))
      } catch {
        if (!cancelled) setGuests([])
      }
    }

    void load()

    return () => { cancelled = true }
  }, [connId, nodes])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const results = await Promise.all(nodes.map(async node => {
        const res = await fetch(maintenanceUrl(connId, node), { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))

        return res.ok ? null : `${node}: ${json?.error || `HTTP ${res.status}`}`
      }))
      const failed = results.filter((r): r is string => !!r)
      if (failed.length > 0) {
        setError(failed.join(' ; '))
        return
      }
      if (!bringBack || !guests?.length) {
        toast.success(t('hostGroup.exited', { nodes: nodes.join(', ') }))
        onClose()
        return
      }
      // The placement engine never targets a node in maintenance: wait for
      // ha-manager to let the whole group go before sending guests back.
      if (!(await waitForGroupOut(connId, nodes, waitOpts))) {
        setError(t('hostGroup.stillInMaintenance'))
        return
      }
      const res = await fetch('/api/v1/orchestrator/host-drains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connId, config: returnDrainConfig(guests) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.error || `HTTP ${res.status}`)
        return
      }
      toast.success(t('hostGroup.returnStarted', { count: guests.length }))
      onStarted?.(json?.data ?? json)
      onClose()
    } catch (e: any) {
      setError(e?.message || t('hostDrain.orchestratorUnavailable'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose() }} maxWidth="sm" fullWidth data-testid="host-group-exit-dialog">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(76,175,80,0.12)' }}>
          <i className="ri-play-circle-line" style={{ fontSize: 22, color: '#4caf50' }} />
        </Box>
        {t('hostGroup.exitTitle', { nodes: nodes.join(', ') })}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, '&&': { pt: 1.5 } }}>
        <Typography variant="body2" color="text.secondary">{t('hostGroup.exitIntro')}</Typography>
        {guests === null ? (
          <CircularProgress size={18} />
        ) : (
          <FormControlLabel
            control={<Checkbox checked={bringBack} disabled={guests.length === 0 || busy} onChange={e => setBringBack(e.target.checked)} data-testid="host-group-bring-back" />}
            label={guests.length > 0 ? t('hostGroup.bringBack', { count: guests.length }) : t('hostGroup.nothingToBringBack')}
          />
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="contained" color="success" onClick={confirm} disabled={busy || guests === null} startIcon={busy ? <CircularProgress size={16} /> : undefined} data-testid="host-group-exit-confirm">
          {t('inventory.exitMaintenance')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
