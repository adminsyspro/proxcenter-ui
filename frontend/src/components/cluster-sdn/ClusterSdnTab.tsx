'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Snackbar from '@mui/material/Snackbar'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Tooltip from '@mui/material/Tooltip'
import { useTranslations } from 'next-intl'

import { useRBAC } from '@/contexts/RBACContext'

import ClusterSdnZonesPanel from './ClusterSdnZonesPanel'
import ClusterSdnVNetsPanel from './ClusterSdnVNetsPanel'
import ClusterSdnOptionsPanel from './ClusterSdnOptionsPanel'
import ClusterSdnIpamPanel from './ClusterSdnIpamPanel'
import ClusterSdnVNetFirewallPanel from './ClusterSdnVNetFirewallPanel'
import ClusterSdnFabricsPanel from './ClusterSdnFabricsPanel'
import type { SdnStatusResponse } from './types'

interface Props {
  connId: string
}

const STATUS_POLL_INTERVAL_MS = 30_000
const TASK_POLL_INTERVAL_MS = 2_000
const TASK_POLL_MAX_MS = 5 * 60_000

export default function ClusterSdnTab({ connId }: Props) {
  const t = useTranslations()
  const rbac = useRBAC()
  const canManage = rbac?.hasPermission?.('connection.manage') ?? false

  const [sdnTab, setSdnTab] = useState(0)
  const [status, setStatus] = useState<SdnStatusResponse | null>(null)
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const applyingRef = useRef(false)

  // Poll status.
  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/connections/${connId}/sdn/status`, { cache: 'no-store' })
      const body = await res.json()
      if (res.ok) setStatus(body.data)
    } catch {
      // Silent: banner is a nice-to-have; do not block sub-tab work.
    }
  }, [connId])

  useEffect(() => {
    void refreshStatus()
    const h = window.setInterval(refreshStatus, STATUS_POLL_INTERVAL_MS)
    return () => window.clearInterval(h)
  }, [refreshStatus])

  const pollTask = useCallback(async (upid: string): Promise<'ok' | 'failed' | 'timeout'> => {
    // Proxmox UPID is of form UPID:<node>:<pid_hex>:<pstart_hex>:<start_hex>:<type>:<id>:<user>:
    const node = upid.split(':')[1] || ''
    const deadline = Date.now() + TASK_POLL_MAX_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, TASK_POLL_INTERVAL_MS))
      try {
        const res = await fetch(
          `/api/v1/tasks/${encodeURIComponent(connId)}/${encodeURIComponent(node)}/${encodeURIComponent(upid)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) continue
        const body = await res.json()
        if (body.status === 'stopped') {
          return body.exitstatus === 'OK' ? 'ok' : 'failed'
        }
      } catch {
        // transient; keep polling
      }
    }
    return 'timeout'
  }, [connId])

  const performApply = useCallback(async () => {
    if (applyingRef.current) return
    applyingRef.current = true
    setApplying(true)
    setToast({ kind: 'info', text: t('sdn.apply.toast.applying') })
    try {
      const res = await fetch(`/api/v1/connections/${connId}/sdn/apply`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      const upid: string = body.data?.upid
      if (!upid) throw new Error('No UPID returned')
      const result = await pollTask(upid)
      setToast(null)
      if (result === 'ok') {
        setToast({ kind: 'success', text: t('sdn.apply.toast.success') })
      } else if (result === 'timeout') {
        setToast({ kind: 'error', text: t('sdn.apply.toast.failed', { error: 'timeout' }) })
      } else {
        setToast({ kind: 'error', text: t('sdn.apply.toast.failed', { error: 'task failed' }) })
      }
      void refreshStatus()
    } catch (e: any) {
      setToast(null)
      setToast({ kind: 'error', text: t('sdn.apply.toast.failed', { error: e?.message || String(e) }) })
    } finally {
      applyingRef.current = false
      setApplying(false)
    }
  }, [connId, pollTask, refreshStatus, t])

  const pending = Boolean(status?.pending)
  const applyDisabled = !pending || !canManage || applying
  const applyTooltip = !canManage
    ? t('sdn.apply.tooltip.noPermission')
    : !pending
      ? t('sdn.apply.tooltip.noPending')
      : ''

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tabs
          value={sdnTab}
          onChange={(_e, v) => setSdnTab(v)}
          sx={{ flex: 1, minWidth: 0 }}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><i className="ri-grid-line" style={{ fontSize: 16 }} />{t('sdn.subtab.zones')}</Box>} />
          <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><i className="ri-share-line" style={{ fontSize: 16 }} />{t('sdn.subtab.vnets')}</Box>} />
          <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><i className="ri-settings-3-line" style={{ fontSize: 16 }} />{t('sdn.subtab.options')}</Box>} />
          <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><i className="ri-router-line" style={{ fontSize: 16 }} />{t('sdn.subtab.ipam')}</Box>} />
          <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />{t('sdn.subtab.vnetFirewall')}</Box>} />
          <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><i className="ri-node-tree" style={{ fontSize: 16 }} />{t('sdn.subtab.fabrics')}</Box>} />
        </Tabs>
        <Tooltip title={applyTooltip} arrow disableHoverListener={!applyTooltip}>
          <span>
            <Button
              variant="contained"
              color="primary"
              size="small"
              disabled={applyDisabled}
              onClick={() => setApplyDialogOpen(true)}
              startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <i className="ri-check-double-line" />}
              sx={{ ml: 2, flexShrink: 0 }}
            >
              {t('sdn.apply.button')}
            </Button>
          </span>
        </Tooltip>
      </Box>

      {pending && (
        <Alert severity="warning" sx={{ mx: 2, mt: 1, py: 0.5 }}>
          {t('sdn.banner.pending')}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {sdnTab === 0 && <ClusterSdnZonesPanel connId={connId} />}
        {sdnTab === 1 && <ClusterSdnVNetsPanel connId={connId} />}
        {sdnTab === 2 && <ClusterSdnOptionsPanel connId={connId} />}
        {sdnTab === 3 && <ClusterSdnIpamPanel connId={connId} />}
        {sdnTab === 4 && <ClusterSdnVNetFirewallPanel connId={connId} />}
        {sdnTab === 5 && <ClusterSdnFabricsPanel connId={connId} />}
      </Box>

      <Dialog open={applyDialogOpen} onClose={() => !applying && setApplyDialogOpen(false)}>
        <DialogTitle>{t('sdn.apply.dialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('sdn.apply.dialog.body')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplyDialogOpen(false)} disabled={applying}>
            {t('sdn.apply.dialog.cancel')}
          </Button>
          <Button
            color="primary"
            variant="contained"
            disabled={applying}
            onClick={() => {
              setApplyDialogOpen(false)
              void performApply()
            }}
          >
            {t('sdn.apply.dialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        key={toast?.kind ?? 'none'}
        open={!!toast}
        autoHideDuration={toast?.kind === 'info' ? null : 5000}
        onClose={() => setToast(null)}
      >
        {toast ? (
          <Alert severity={toast.kind} onClose={() => setToast(null)}>{toast.text}</Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  )
}
