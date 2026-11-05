'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Autocomplete,
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
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'

import PagedRows from '@/components/ui/PagedRows'
import { SMALL_SELECT_SX } from '@/components/settings/VdcQuotaRow'
import { GuestGlyph, NodeGlyph } from '@/components/ui/glyphs'

import type { PoolOwner } from './PoolDialog'
import {
  guestCandidates,
  memberRequests,
  storageCandidates,
  type GuestCandidate,
  type PoolMemberRequest,
  type PoolMembersPayload,
} from './poolMembers'

export type PoolMembersState = { poolid: string; owners: PoolOwner[] } | null

type Props = {
  state: PoolMembersState
  /** Every guest of the inventory, with its connection. */
  guests: Array<GuestCandidate & { connId: string }>
  /** Every storage name of each connection. */
  storages: Array<{ connId: string; storage: string }>
  /** Status of each node, by `${connId}:${node}`, for the node glyphs. */
  nodeStatus: Map<string, string>
  onClose: () => void
  /** Called after Proxmox accepted the change, to reload the inventory. */
  onDone: (message: string) => void
}

/** The route's vDC refusals, by code. */
const VDC_ERROR_KEYS: Record<string, string> = {
  POOL_OWNED_BY_VDC: 'inventory.poolMembersVdc',
  GUEST_IN_VDC_POOL: 'inventory.poolMembersGuestInVdc',
}

const ROW_SX = { display: 'flex', alignItems: 'center', gap: 1, height: 32, px: 1, borderBottom: '1px solid', borderColor: 'divider' } as const

/**
 * Adds guests and storages to a resource pool and removes them (roadmap#200).
 * A pool lives on one cluster; when its name exists on several, the dialog
 * asks which one, as the edit and delete dialogs do.
 */
export default function PoolMembersDialog(props: Readonly<Props>) {
  if (!props.state) return null

  return <PoolMembersForm key={props.state.poolid} {...props} state={props.state} />
}

function PoolMembersForm({ state, guests, storages, nodeStatus, onClose, onDone }: Readonly<Props & { state: NonNullable<PoolMembersState> }>) {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const [connId, setConnId] = useState(state.owners[0]?.connId || '')
  const [members, setMembers] = useState<PoolMembersPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addGuests, setAddGuests] = useState<GuestCandidate[]>([])
  const [addStorages, setAddStorages] = useState<string[]>([])
  const [removeGuests, setRemoveGuests] = useState<Set<number>>(new Set())
  const [removeStorages, setRemoveStorages] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!connId) return
    const controller = new AbortController()

    setMembers(null)
    setLoadError(null)
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/pools?poolid=${encodeURIComponent(state.poolid)}`, { signal: controller.signal })
        const body = await res.json().catch(() => ({}))

        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
        setMembers(body.data)
      } catch (e: any) {
        if (!controller.signal.aborted) setLoadError(e?.message || String(e))
      }
    }

    void load()

    return () => controller.abort()
  }, [connId, state.poolid])

  const selectCluster = (id: string) => {
    setConnId(id)
    setAddGuests([])
    setAddStorages([])
    setRemoveGuests(new Set())
    setRemoveStorages(new Set())
  }

  const guestOptions = useMemo(
    () => guestCandidates(guests.filter(g => g.connId === connId), members?.guests || [], state.poolid),
    [guests, connId, members, state.poolid],
  )
  const storageOptions = useMemo(
    () => storageCandidates(storages.filter(s => s.connId === connId).map(s => s.storage), members?.storages || []),
    [storages, connId, members],
  )

  const requests = memberRequests(state.poolid, {
    addGuests,
    removeGuests: [...removeGuests],
    addStorages,
    removeStorages: [...removeStorages],
  })
  const moves = addGuests.filter(g => !!g.pool).length

  const toggle = <T,>(set: Set<T>, value: T, update: (next: Set<T>) => void) => {
    const next = new Set(set)

    if (next.has(value)) next.delete(value)
    else next.add(value)
    update(next)
  }

  // One call after the other: the additions land before the removals, and a
  // refused call leaves the next one unsent.
  const send = async (pending: PoolMemberRequest[]): Promise<void> => {
    const [body, ...rest] = pending

    if (!body) return

    const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/pools`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(VDC_ERROR_KEYS[err?.code] ? t(VDC_ERROR_KEYS[err.code]) : err?.error || `HTTP ${res.status}`)
    }

    return send(rest)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)

    try {
      await send(requests)
      onDone(t('inventory.poolMembersUpdated', { pool: state.poolid }))
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
      setBusy(false)
    }
  }

  const removeButton = (marked: boolean, onClick: () => void) => (
    <Tooltip title={marked ? t('inventory.poolMembersUndo') : t('inventory.poolMembersRemove')}>
      <IconButton size="small" onClick={onClick} disabled={busy} aria-label={marked ? t('inventory.poolMembersUndo') : t('inventory.poolMembersRemove')}>
        <i className={marked ? 'ri-arrow-go-back-line' : 'ri-close-line'} style={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  )

  const markedSx = (marked: boolean) => (marked ? { textDecoration: 'line-through', opacity: 0.5 } : {})

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-folder-user-line" style={{ fontSize: 20 }} />
        {t('inventory.poolMembersTitle', { pool: state.poolid })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {state.owners.length > 1 && (
            <FormControl size="small" fullWidth>
              <InputLabel id="pool-members-cluster-label">{t('inventory.poolCluster')}</InputLabel>
              <Select labelId="pool-members-cluster-label" label={t('inventory.poolCluster')} sx={SMALL_SELECT_SX} value={connId} onChange={e => selectCluster(String(e.target.value))} disabled={busy}>
                {state.owners.map(c => (
                  <MenuItem key={c.connId} value={c.connId}>
                    <i className="ri-server-line" style={{ fontSize: 14, marginRight: 8, opacity: 0.7 }} />
                    {c.connName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {loadError && <Alert severity="error">{loadError}</Alert>}
          {!members && !loadError && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          )}

          {members && (
            <>
              <Box>
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <i className="ri-computer-line" style={{ fontSize: 16, opacity: 0.7 }} />
                  {t('inventory.poolMembersGuests')} ({members.guests.length})
                </Typography>
                <Autocomplete
                  multiple
                  size="small"
                  options={guestOptions}
                  value={addGuests}
                  onChange={(_e, value) => setAddGuests(value)}
                  getOptionLabel={g => `${g.name || g.vmid} #${g.vmid}`}
                  isOptionEqualToValue={(a, b) => a.vmid === b.vmid}
                  disabled={busy}
                  renderOption={(props, g) => {
                    const { key, ...rest } = props as any

                    return (
                      <li key={key} {...rest}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 0 }}>
                          <GuestGlyph type={g.type} status={g.status || undefined} dotBorder={dotBorder} />
                          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{g.name || g.vmid}</Typography>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>#{g.vmid}</Typography>
                          {g.pool && (
                            <Typography variant="caption" noWrap sx={{ color: 'warning.main', maxWidth: 140, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                              <i className="ri-folder-fill" style={{ fontSize: 12 }} />{g.pool}
                            </Typography>
                          )}
                        </Box>
                      </li>
                    )
                  }}
                  renderInput={params => <TextField {...params} label={t('inventory.poolMembersAddGuests')} />}
                />
                {moves > 0 && (
                  <Typography variant="caption" sx={{ display: 'block', color: 'warning.main', mt: 0.5 }}>
                    {t('inventory.poolMembersMoves', { count: moves })}
                  </Typography>
                )}
                <Box sx={{ mt: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                  {members.guests.length === 0 ? (
                    <Typography variant="caption" sx={{ display: 'block', px: 1, py: 1, opacity: 0.6 }}>{t('inventory.poolMembersNoGuests')}</Typography>
                  ) : (
                    <PagedRows items={members.guests}>
                      {g => {
                        const marked = removeGuests.has(g.vmid)

                        return (
                          <Box key={g.vmid} sx={ROW_SX}>
                            <GuestGlyph type={g.type} status={g.status || undefined} dotBorder={dotBorder} />
                            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, ...markedSx(marked) }}>{g.name || g.vmid}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6, width: 64 }}>#{g.vmid}</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: 110, minWidth: 0 }}>
                              <NodeGlyph status={nodeStatus.get(`${connId}:${g.node}`)} dark={dark} dotBorder={dotBorder} />
                              <Typography variant="caption" noWrap>{g.node}</Typography>
                            </Box>
                            {removeButton(marked, () => toggle(removeGuests, g.vmid, setRemoveGuests))}
                          </Box>
                        )
                      }}
                    </PagedRows>
                  )}
                </Box>
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <i className="ri-database-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                  {t('inventory.poolMembersStorages')} ({members.storages.length})
                </Typography>
                <Autocomplete
                  multiple
                  size="small"
                  options={storageOptions}
                  value={addStorages}
                  onChange={(_e, value) => setAddStorages(value)}
                  disabled={busy}
                  renderInput={params => <TextField {...params} label={t('inventory.poolMembersAddStorages')} />}
                />
                <Box sx={{ mt: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                  {members.storages.length === 0 ? (
                    <Typography variant="caption" sx={{ display: 'block', px: 1, py: 1, opacity: 0.6 }}>{t('inventory.poolMembersNoStorages')}</Typography>
                  ) : (
                    <PagedRows items={members.storages}>
                      {s => {
                        const marked = removeStorages.has(s.storage)

                        return (
                          <Box key={s.storage} sx={ROW_SX}>
                            <i className="ri-database-2-line" style={{ fontSize: 16, opacity: 0.8 }} />
                            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, ...markedSx(marked) }}>{s.storage}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6, width: 64 }}>{s.type || ''}</Typography>
                            <Typography variant="caption" noWrap sx={{ width: 110 }}>
                              {s.shared ? t('inventory.poolMembersShared') : s.nodes.join(', ')}
                            </Typography>
                            {removeButton(marked, () => toggle(removeStorages, s.storage, setRemoveStorages))}
                          </Box>
                        )
                      }}
                    </PagedRows>
                  )}
                </Box>
              </Box>
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !members || requests.length === 0}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
