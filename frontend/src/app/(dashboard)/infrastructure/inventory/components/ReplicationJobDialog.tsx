'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

import { humanizePveError } from '../helpers'

/** A storage replication job as the node replication route lists it. */
export type ReplicationJob = {
  id: string
  guest: number | string
  target: string
  schedule?: string
  rate?: number | string
  comment?: string
  enabled?: boolean
}

export type ReplicationGuest = { vmid: number | string; name?: string; type?: string }

export type ReplicationJobDialogState =
  | { mode: 'create'; guest: string }
  | { mode: 'create'; guests: ReplicationGuest[] }
  | { mode: 'edit'; job: ReplicationJob }
  | null

type Props = {
  state: ReplicationJobDialogState
  connId: string
  /** Node the guest runs on, the one whose replication route is called. */
  node: string
  targets: { node: string; online: boolean }[]
  /** Jobs already declared, so a target the guest already replicates to is not offered again. */
  jobs: ReplicationJob[]
  onClose: () => void
  /** Called after Proxmox accepted the change, to reload the job list. */
  onSaved: () => void
}

// Chaque valeur est acceptée par le parseur de Proxmox (PVE::CalendarEvent).
export const REPLICATION_SCHEDULE_PRESETS: { value: string; labelKey: string }[] = [
  { value: '*/1', labelKey: 'replication.every1min' },
  { value: '*/5', labelKey: 'replication.every5min' },
  { value: '*/10', labelKey: 'replication.every10min' },
  { value: '*/15', labelKey: 'replication.every15min' },
  { value: '*/30', labelKey: 'replication.every30min' },
  { value: 'hourly', labelKey: 'replication.everyHour' },
  { value: '*/2:00', labelKey: 'replication.every2hours' },
  { value: '*/6:00', labelKey: 'replication.every6hours' },
  { value: '*/12:00', labelKey: 'replication.every12hours' },
  { value: 'daily', labelKey: 'replication.daily' },
]

const DEFAULT_SCHEDULE = '*/15'

/**
 * Create or edit a Proxmox storage replication job. The schedule is a free
 * Proxmox calendar event with presets, and Proxmox's refusal is shown as is.
 */
export default function ReplicationJobDialog(props: Props) {
  const { state } = props

  if (!state) return null

  // Un nouvel état remonte le formulaire, qui repart de ses valeurs initiales.
  const key = state.mode === 'edit' ? `edit:${state.job.id}` : `create:${'guest' in state ? state.guest : ''}`

  return <ReplicationJobForm key={key} {...props} state={state} />
}

function ReplicationJobForm({ state, connId, node, targets, jobs, onClose, onSaved }: Props & { state: NonNullable<ReplicationJobDialogState> }) {
  const t = useTranslations()
  const editing = state.mode === 'edit' ? state.job : null

  const [guest, setGuest] = useState(editing ? String(editing.guest) : 'guest' in state ? state.guest : '')
  const [target, setTarget] = useState(editing?.target || '')
  const [schedule, setSchedule] = useState(editing?.schedule || DEFAULT_SCHEDULE)
  const [rate, setRate] = useState(editing?.rate !== undefined && editing?.rate !== null ? String(editing.rate) : '')
  const [comment, setComment] = useState(editing?.comment || '')
  const [enabled, setEnabled] = useState(editing ? editing.enabled !== false : true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const replicatedTo = new Set(jobs.filter(j => String(j.guest) === guest).map(j => j.target))
  const canSave = !busy && schedule.trim() !== '' && (editing ? true : !!guest && !!target)

  const save = async () => {
    setBusy(true)
    setError(null)

    const body = editing
      ? { jobId: editing.id, schedule: schedule.trim(), rate: rate.trim(), comment: comment.trim(), enabled }
      : {
          guest,
          target,
          schedule: schedule.trim(),
          ...(rate.trim() ? { rate: rate.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          enabled,
        }

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication`, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))

        setError(json?.error ? humanizePveError(json.error) : t('replication.saveFailed'))

        return
      }

      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message || t('replication.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={editing ? 'ri-edit-line' : 'ri-repeat-line'} style={{ fontSize: 24 }} />
        {editing ? t('replication.editJob') : t('replication.createJob')}
      </DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {state.mode === 'create' && 'guests' in state ? (
            <FormControl fullWidth size="small">
              <InputLabel id="replication-guest-label">{t('replication.guest')}</InputLabel>
              <Select
                labelId="replication-guest-label"
                value={guest}
                label={t('replication.guest')}
                onChange={e => {
                  setGuest(e.target.value)
                  setTarget('')
                }}
              >
                {state.guests.map(g => (
                  <MenuItem key={g.vmid} value={String(g.vmid)}>
                    {g.vmid}{g.name ? ` - ${g.name}` : ''}{g.type ? ` (${g.type})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <TextField fullWidth size="small" label={t('replication.guest')} value={guest} disabled />
          )}

          {editing ? (
            <TextField fullWidth size="small" label={t('replication.target')} value={editing.target} disabled />
          ) : (
            <FormControl fullWidth size="small">
              <InputLabel id="replication-target-label">{t('replication.target')}</InputLabel>
              <Select labelId="replication-target-label" value={target} label={t('replication.target')} onChange={e => setTarget(e.target.value)}>
                {targets.map(n => {
                  const already = replicatedTo.has(n.node)

                  return (
                    <MenuItem key={n.node} value={n.node} disabled={!n.online || already}>
                      {n.node}
                      {already ? ` (${t('replication.alreadyReplicated')})` : !n.online ? ` (${t('replication.offline')})` : ''}
                    </MenuItem>
                  )
                })}
              </Select>
            </FormControl>
          )}

          <Autocomplete
            freeSolo
            disableClearable
            options={REPLICATION_SCHEDULE_PRESETS.map(p => p.value)}
            // Valeur vide ou préréglage exact : toute la liste ; sinon les seuls préréglages qui contiennent la saisie.
            filterOptions={(options, { inputValue }) => {
              const typed = inputValue.trim()

              return !typed || options.includes(typed) ? options : options.filter(o => o.includes(typed))
            }}
            inputValue={schedule}
            onInputChange={(_, value) => setSchedule(value)}
            renderOption={(optionProps, option) => {
              const { key, ...rest } = optionProps as any
              const preset = REPLICATION_SCHEDULE_PRESETS.find(p => p.value === option)

              return (
                <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1.5 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', minWidth: 64 }}>{option}</Typography>
                  <Typography variant="body2" sx={{ opacity: 0.7 }}>{preset ? t(preset.labelKey) : ''}</Typography>
                </Box>
              )
            }}
            renderInput={params => (
              <TextField
                {...params}
                size="small"
                label={t('replication.schedule')}
                helperText={t('replication.scheduleHelper')}
              />
            )}
          />

          <TextField
            fullWidth
            size="small"
            type="number"
            label={t('replication.rateLimit')}
            value={rate}
            onChange={e => setRate(e.target.value)}
            placeholder={t('replication.unlimited')}
            slotProps={{
              htmlInput: { min: 1 },
              input: { endAdornment: <InputAdornment position="end">MB/s</InputAdornment> },
            }}
          />

          <TextField
            fullWidth
            size="small"
            label={t('replication.comment')}
            value={comment}
            onChange={e => setComment(e.target.value)}
            multiline
            rows={2}
          />

          <FormControlLabel
            control={<Checkbox checked={enabled} onChange={e => setEnabled(e.target.checked)} />}
            label={t('replication.enabled')}
          />

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!canSave}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={save}
        >
          {editing ? t('common.save') : t('replication.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
