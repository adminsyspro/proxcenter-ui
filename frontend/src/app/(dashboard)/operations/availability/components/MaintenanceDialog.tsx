'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

import { useAllPolicies, useInventoryOptions } from '../hooks/useSlaLists'

import { guestKey } from './inventoryOptions'
import { GlyphIcon, PROXMOX } from './RowGlyph'
import { errorCodeOf, slaRequest, type WindowItem } from './slaApi'

// A small Select is 38 px against 35.9 px for a small TextField: same line height.
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } } as const

const SCOPES = ['connection', 'node', 'guest', 'policy'] as const

type Scope = (typeof SCOPES)[number]

const SCOPE_ICON: Record<Scope, string> = {
  connection: 'ri-server-line',
  node: PROXMOX,
  guest: 'ri-computer-line',
  policy: 'ri-shield-check-line',
}

// One-click lengths of a window, from its start.
const QUICK_HOURS = [1, 4, 8, 24] as const

const pad = (n: number) => String(n).padStart(2, '0')

/** A datetime-local value is read as local time: built from the local getters. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface Props {
  open: boolean
  /** The window to edit, null to declare one. */
  window: WindowItem | null
  onClose: () => void
  onSaved: () => void
}

/** Declare or edit a maintenance window: scope, target, period and reason. */
export default function MaintenanceDialog({ open, window: edited, onClose, onSaved }: Props) {
  const t = useTranslations('availability')
  const { options, error: inventoryError, isLoading } = useInventoryOptions(open)

  const [scope, setScope] = useState<Scope>('connection')
  const [connectionId, setConnectionId] = useState('')
  const [node, setNode] = useState('')
  const [guest, setGuest] = useState('')
  const [policyId, setPolicyId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  // An edited date stays the stored ISO until the user touches its field: a round trip through the
  // local input loses seconds and, in the repeated hour of a clock change, the offset.
  const [startsTouched, setStartsTouched] = useState(false)
  const [endsTouched, setEndsTouched] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const policies = useAllPolicies(open && scope === 'policy').data?.items ?? []

  useEffect(() => {
    if (!open) return

    const now = new Date()

    now.setSeconds(0, 0)

    setScope((edited?.scope as Scope) ?? 'connection')
    setConnectionId(edited?.connectionId ?? '')
    setNode(edited?.node ?? '')
    setGuest(edited?.connectionId && edited.vmid ? guestKey(edited.connectionId, edited.vmid) : '')
    setPolicyId(edited?.policyId ?? '')
    setStartsAt(toLocalInput(edited ? new Date(edited.startsAt) : now))
    setEndsAt(toLocalInput(edited ? new Date(edited.endsAt) : new Date(now.getTime() + 3600_000)))
    setReason(edited?.reason ?? '')
    setStartsTouched(false)
    setEndsTouched(false)
    setError(null)
    setBusy(false)
  }, [open, edited])

  const nodes = useMemo(() => options.connections.find(c => c.id === connectionId)?.nodes ?? [], [options.connections, connectionId])

  const start = new Date(edited && !startsTouched ? edited.startsAt : startsAt)
  const end = new Date(edited && !endsTouched ? edited.endsAt : endsAt)
  const datesValid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start
  const targetValid =
    (scope === 'connection' && connectionId !== '') ||
    (scope === 'node' && connectionId !== '' && node !== '') ||
    (scope === 'guest' && guest !== '') ||
    (scope === 'policy' && policyId !== '')
  const canSave = targetValid && datesValid && reason.trim() !== '' && !busy

  const save = async () => {
    setBusy(true)
    setError(null)

    const body: Record<string, unknown> = { scope, startsAt: edited && !startsTouched ? edited.startsAt : start.toISOString(), endsAt: edited && !endsTouched ? edited.endsAt : end.toISOString(), reason: reason.trim() }

    if (scope === 'policy') body.policyId = policyId
    else if (scope === 'guest') {
      const i = guest.lastIndexOf(':')

      body.connectionId = guest.slice(0, i)
      body.vmid = Number(guest.slice(i + 1))
    } else {
      body.connectionId = connectionId
      if (scope === 'node') body.node = node
    }

    try {
      await (edited ? slaRequest(`/api/v1/sla/maintenance-windows/${edited.id}`, 'PUT', body) : slaRequest('/api/v1/sla/maintenance-windows', 'POST', body))
      onSaved()
    } catch (e) {
      setError(t(`errors.${errorCodeOf(e)}`))
      setBusy(false)
    }
  }

  const select = (id: string, label: string, value: string, onChange: (v: string) => void, items: { value: string; label: string }[]) => (
    <FormControl size='small' fullWidth>
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select labelId={`${id}-label`} id={id} label={label} value={items.some(i => i.value === value) ? value : ''} onChange={e => onChange(e.target.value)} sx={SMALL_SELECT_SX}>
        {items.map(i => <MenuItem key={i.value} value={i.value}>{i.label}</MenuItem>)}
      </Select>
    </FormControl>
  )

  const connectionItems = options.connections.map(c => ({ value: c.id, label: c.name }))

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{t(edited ? 'maintenance.editTitle' : 'maintenance.createTitle')}</DialogTitle>
      <DialogContent sx={{ pt: '20px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity='error'>{error}</Alert>}
        <Box>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 0.5 }}>{t('maintenance.scope')}</Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size='small'
            value={scope}
            aria-label={t('maintenance.scope')}
            onChange={(_, next: Scope | null) => {
              if (!next) return
              setScope(next)
              setNode('')
              setGuest('')
              setPolicyId('')
            }}
          >
            {SCOPES.map(s => (
              <ToggleButton key={s} value={s} sx={{ gap: 1, textTransform: 'none' }}>
                <GlyphIcon icon={SCOPE_ICON[s]} />
                {t(`maintenance.scopes.${s}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        {inventoryError && scope !== 'policy' ? (
          <Alert severity='warning'>{t('dialog.inventoryError')}</Alert>
        ) : isLoading && scope !== 'policy' ? (
          <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress size={20} aria-label={t('loading')} /></Box>
        ) : (
          <>
            {(scope === 'connection' || scope === 'node') && (
              <Box sx={{ display: 'grid', gridTemplateColumns: scope === 'node' ? { xs: '1fr', sm: '1fr 1fr' } : '1fr', gap: 2 }}>
                {select('window-connection', t('maintenance.connection'), connectionId, v => { setConnectionId(v); setNode('') }, connectionItems)}
                {scope === 'node' && select('window-node', t('maintenance.node'), node, setNode, nodes.map(n => ({ value: n, label: n })))}
              </Box>
            )}
            {scope === 'guest' &&
              select('window-guest', t('maintenance.guest'), guest, setGuest, options.guests.map(g => ({
                value: g.key,
                label: `${g.name ?? t(g.type === 'lxc' ? 'policies.guestFallbackCt' : 'policies.guestFallbackVm', { vmid: g.vmid })} (${g.vmid}, ${g.connectionName})`,
              })))}
            {scope === 'policy' && select('window-policy', t('maintenance.policy'), policyId, setPolicyId, policies.map(p => ({ value: p.id, label: p.name })))}
          </>
        )}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            size='small'
            fullWidth
            type='datetime-local'
            label={t('maintenance.startsAt')}
            value={startsAt}
            onChange={e => { setStartsAt(e.target.value); setStartsTouched(!edited || e.target.value !== toLocalInput(new Date(edited.startsAt))) }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size='small'
            fullWidth
            type='datetime-local'
            label={t('maintenance.endsAt')}
            value={endsAt}
            onChange={e => { setEndsAt(e.target.value); setEndsTouched(!edited || e.target.value !== toLocalInput(new Date(edited.endsAt))) }}
            error={startsAt !== '' && endsAt !== '' && !datesValid}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: -1 }}>
          <Typography variant='caption' color='text.secondary'>{t('maintenance.quickEnd')}</Typography>
          {QUICK_HOURS.map(h => (
            <Chip
              key={h}
              size='small'
              variant='outlined'
              clickable
              label={t('maintenance.hours', { hours: h })}
              onClick={() => {
                if (Number.isNaN(start.getTime())) return
                setEndsAt(toLocalInput(new Date(start.getTime() + h * 3600_000)))
                setEndsTouched(true)
              }}
            />
          ))}
        </Box>
        <TextField
          size='small'
          fullWidth
          required
          multiline
          minRows={2}
          label={t('maintenance.reason')}
          helperText={t('maintenance.limit')}
          value={reason}
          onChange={e => setReason(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant='contained' onClick={save} disabled={!canSave}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  )
}
