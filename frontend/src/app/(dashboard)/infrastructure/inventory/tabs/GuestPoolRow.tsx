'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/VdcQuotaRow'

import { isVdcPool } from '../components/poolMembers'

type Props = {
  connId: string
  vmid: string | number
  /** The pool the guest is in now, from the inventory. */
  pool: string | null
  /** Changing a pool needs connection.manage, as every pool write does. */
  canManage: boolean
  /** Called once Proxmox accepted the move, to reload the inventory. */
  onChanged: () => void
}

const cellBorder = '1px solid var(--mui-palette-divider)'
const NO_POOL = ''

/**
 * Resource pool row of the Options tab (roadmap#200): moves the guest to
 * another pool, or out of its pool. A vDC pool is the vDC's, so a guest in
 * one shows it locked, and no vDC pool is offered as a target.
 */
export default function GuestPoolRow({ connId, vmid, pool, canManage, onChanged }: Readonly<Props>) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const [pools, setPools] = useState<string[] | null>(null)
  const [target, setTarget] = useState(pool || NO_POOL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = isVdcPool(pool)
  const base = `/api/v1/connections/${encodeURIComponent(connId)}/pools`

  const loadPools = async () => {
    try {
      const res = await fetch(base)
      const body = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setPools((body.data || []).map((p: any) => String(p.poolid)).filter((p: string) => !isVdcPool(p)))
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  const openDialog = () => {
    setTarget(pool || NO_POOL)
    setError(null)
    setPools(null)
    setOpen(true)
    void loadPools()
  }

  const save = async () => {
    setBusy(true)
    setError(null)

    // Into a pool: one call, moving the guest out of the one it is in.
    // Out of every pool: removed from its current one.
    const body = target === NO_POOL
      ? { poolid: pool, vms: [Number(vmid)], delete: true }
      : { poolid: target, vms: [Number(vmid)], ...(pool ? { allowMove: true } : {}) }

    try {
      const res = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err?.code === 'GUEST_IN_VDC_POOL' || err?.code === 'POOL_OWNED_BY_VDC' ? t('inventory.guestPoolVdc') : err?.error || `HTTP ${res.status}`)
      }

      setOpen(false)
      onChanged()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <tr>
        <td style={{ padding: '3px 12px', borderBottom: cellBorder, fontSize: 12, fontWeight: 500 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-folder-line" style={{ fontSize: 16, opacity: 0.6 }} />
            {t('inventory.guestPool')}
          </Box>
        </td>
        <td style={{ padding: '3px 12px', borderBottom: cellBorder, fontSize: 12 }}>
          {pool || <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('inventory.guestPoolNone')}</Typography>}
        </td>
        <td style={{ padding: '3px 12px', borderBottom: cellBorder, fontSize: 12, textAlign: 'center' }}>
          {canManage && (locked ? (
            <Tooltip title={t('inventory.guestPoolVdc')}>
              <span>
                <IconButton size="small" disabled>
                  <i className="ri-lock-line" style={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title={t('common.edit')}>
              <IconButton size="small" aria-label={t('common.edit')} onClick={openDialog}>
                <i className="ri-pencil-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          ))}
        </td>
      </tr>
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-folder-line" style={{ fontSize: 20 }} />
          {t('inventory.guestPool')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            {pools === null && !error ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} /></Box>
            ) : (
              <FormControl size="small" fullWidth>
                <InputLabel id="guest-pool-label">{t('inventory.guestPool')}</InputLabel>
                <Select
                  labelId="guest-pool-label"
                  label={t('inventory.guestPool')}
                  value={target}
                  onChange={e => setTarget(String(e.target.value))}
                  disabled={busy || pools === null}
                  sx={SMALL_SELECT_SX}
                >
                  <MenuItem value={NO_POOL}><em>{t('inventory.guestPoolNone')}</em></MenuItem>
                  {(pools || []).map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={busy || pools === null || target === (pool || NO_POOL)}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
