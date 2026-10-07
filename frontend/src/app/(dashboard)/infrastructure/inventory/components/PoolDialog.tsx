'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

/** One cluster a pool is declared on, with that cluster's comment for it. */
export type PoolOwner = { connId: string; connName: string; comment?: string }

export type PoolDialogState =
  | { mode: 'create'; clusters: PoolOwner[]; parent?: string }
  | { mode: 'edit' | 'delete'; poolid: string; owners: PoolOwner[] }
  | null

type Props = {
  state: PoolDialogState
  onClose: () => void
  /** Called after Proxmox accepted the change, to reload the inventory. */
  onDone: (message: string) => void
}

const POOLID_RE = /^[A-Za-z][A-Za-z0-9._-]*(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._-]+){0,2}$/

/**
 * Create, edit the comment of, or delete a Proxmox resource pool. A pool lives
 * on one cluster; the Pools view merges same-named pools across clusters, so
 * edit and delete ask which cluster when the name exists on more than one.
 */
export default function PoolDialog({ state, onClose, onDone }: Props) {
  if (!state) return null

  // Un nouvel état remonte le formulaire, qui repart de ses valeurs initiales.
  const key = state.mode === 'create' ? `create:${state.parent || ''}` : `${state.mode}:${state.poolid}`

  return <PoolDialogForm key={key} state={state} onClose={onClose} onDone={onDone} />
}

function PoolDialogForm({ state, onClose, onDone }: Props & { state: NonNullable<PoolDialogState> }) {
  const t = useTranslations()
  const choices = state.mode === 'create' ? state.clusters : state.owners
  const [connId, setConnId] = useState(choices[0]?.connId || '')
  const [poolid, setPoolid] = useState(state.mode === 'create' ? (state.parent ? `${state.parent}/` : '') : state.poolid)
  const [comment, setComment] = useState(state.mode === 'edit' ? choices[0]?.comment || '' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectCluster = (id: string) => {
    setConnId(id)

    // Each cluster carries its own comment for a same-named pool.
    if (state.mode === 'edit') setComment(state.owners.find(o => o.connId === id)?.comment || '')
  }

  const trimmedId = poolid.trim()
  const idInvalid = state.mode === 'create' && trimmedId !== '' && !POOLID_RE.test(trimmedId)
  const canSubmit = !!connId && !busy && (state.mode !== 'create' || (trimmedId !== '' && !idInvalid))

  const submit = async () => {
    setBusy(true)
    setError(null)

    const base = `/api/v1/connections/${encodeURIComponent(connId)}/pools`

    try {
      const res = state.mode === 'delete'
        ? await fetch(`${base}?poolid=${encodeURIComponent(trimmedId)}`, { method: 'DELETE' })
        : await fetch(base, {
            method: state.mode === 'create' ? 'POST' : 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poolid: trimmedId, comment }),
          })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))

        setError(body?.code === 'POOL_OWNED_BY_VDC'
          ? t('inventory.poolOwnedByVdc', { vdc: body.vdc || '' })
          : body?.error || `HTTP ${res.status}`)
        setBusy(false)

        return
      }

      onDone(t(state.mode === 'create' ? 'inventory.poolCreated' : state.mode === 'edit' ? 'inventory.poolUpdated' : 'inventory.poolDeleted', { pool: trimmedId }))
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
      setBusy(false)
    }
  }

  const title = state.mode === 'create'
    ? t('inventory.createPool')
    : state.mode === 'edit'
      ? t('inventory.editPool', { pool: state.poolid })
      : t('inventory.deletePool', { pool: state.poolid })

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={state.mode === 'delete' ? 'ri-delete-bin-line' : 'ri-folder-fill'} style={{ fontSize: 20 }} />
        {title}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {choices.length > 1 && (
            <FormControl size="small" fullWidth>
              <InputLabel>{t('inventory.poolCluster')}</InputLabel>
              <Select label={t('inventory.poolCluster')} value={connId} onChange={e => selectCluster(String(e.target.value))} disabled={busy}>
                {choices.map(c => (
                  <MenuItem key={c.connId} value={c.connId}>
                    <i className="ri-server-line" style={{ fontSize: 14, marginRight: 8, opacity: 0.7 }} />
                    {c.connName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {state.mode === 'create' && (
            <TextField
              size="small"
              label={t('inventory.poolId')}
              value={poolid}
              onChange={e => setPoolid(e.target.value)}
              error={idInvalid}
              helperText={t('inventory.poolIdHelp')}
              disabled={busy}
              autoFocus
              fullWidth
            />
          )}

          {state.mode !== 'delete' && (
            <TextField
              size="small"
              label={t('inventory.poolComment')}
              value={comment}
              onChange={e => setComment(e.target.value)}
              disabled={busy}
              autoFocus={state.mode === 'edit'}
              multiline
              minRows={2}
              fullWidth
            />
          )}

          {state.mode === 'delete' && (
            <Typography variant="body2">{t('inventory.deletePoolConfirm', { pool: state.poolid })}</Typography>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color={state.mode === 'delete' ? 'error' : 'primary'}
          onClick={submit}
          disabled={!canSubmit}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {state.mode === 'create' ? t('common.create') : state.mode === 'edit' ? t('common.save') : t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
