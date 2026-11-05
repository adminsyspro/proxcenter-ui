'use client'

import { useState } from 'react'
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, FormHelperText, IconButton, Radio,
  RadioGroup, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { zoneEgress, type EgressMode, type MicrosegZone } from '@/lib/microseg/types'

import { DialogErrorLine, isVersionConflict, ONE_LINE_SX, useDialogAction } from './dialogParts'
import TypedConfirmDialog from './TypedConfirmDialog'
import ZoneStateGate from './ZoneStateGate'
import type { ZoneGate } from './zoneGate'
import { validateZoneForm, ZONE_COLORS, type ZoneFormValues } from './zoneForm'

type Props = {
  /** The zone to edit, or null to create one. */
  zone: MicrosegZone | null
  /** Throws when the write fails: the dialog then keeps its input and shows the error. */
  onSave: (values: ZoneFormValues) => Promise<void>
  onClose: () => void
  /** The pending changes of the draft: an outbound change applies the whole draft, so it is refused while there are some. */
  gate?: ZoneGate
}

const HELPER_SX = { ...ONE_LINE_SX, mx: 0 } as const

function ColorPicker({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const colors: string[] = [...ZONE_COLORS]
  // A zone created elsewhere may carry a color outside the palette: keep it selectable.
  if (value && !colors.some(c => c.toLowerCase() === value.toLowerCase())) colors.push(value)
  return (
    <Box role='group' aria-label={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box component='span' sx={{ width: 90, flexShrink: 0, color: 'text.secondary' }}>{label}</Box>
      {colors.map(color => {
        const selected = color.toLowerCase() === value.toLowerCase()
        return (
          <Tooltip key={color} title={color}>
            <IconButton
              size='small'
              aria-label={color}
              aria-pressed={selected}
              onClick={() => onChange(color)}
              sx={{ p: 0.5, border: '2px solid', borderColor: selected ? 'text.primary' : 'transparent' }}
            >
              <Box component='span' sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: color }} />
            </IconButton>
          </Tooltip>
        )
      })}
    </Box>
  )
}

const EGRESS_MODES: EgressMode[] = ['local', 'all']

type EgressProps = { values: ZoneFormValues; disabled: boolean; stateBlocked: boolean; set: <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) => void }

/** The Outbound section: one control per line, the choice follows the box, the help and the Internet warning are captions. */
function EgressSection({ values, disabled, stateBlocked, set }: EgressProps) {
  const t = useTranslations('microsegPilot.policy.zoneDialog')
  return (
    <Stack spacing={1}>
      <Typography variant='subtitle2' sx={ONE_LINE_SX}>{t('egressSection')}</Typography>
      <Box>
        <FormControlLabel
          control={<Checkbox checked={values.egress_control} onChange={e => set('egress_control', e.target.checked)} disabled={disabled || stateBlocked} />}
          label={t('egressControl')}
          sx={{ m: 0, '& .MuiTypography-root': ONE_LINE_SX }}
        />
        {stateBlocked && <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('egressNeedsState')}</Typography>}
      </Box>
      <FormControl disabled={disabled || stateBlocked || !values.egress_control}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'nowrap', minWidth: 0 }}>
          <Typography component='span' variant='body2' color='text.secondary' sx={{ ...ONE_LINE_SX, flexShrink: 0 }}>{t('egressFilter')}</Typography>
          <RadioGroup row sx={{ flexWrap: 'nowrap', minWidth: 0 }} aria-label={t('egressFilter')} value={values.egress_mode} onChange={e => set('egress_mode', e.target.value as EgressMode)}>
            {EGRESS_MODES.map(mode => (
              <FormControlLabel
                key={mode}
                value={mode}
                control={<Radio />}
                label={t(mode === 'local' ? 'egressLocal' : 'egressAll')}
                sx={{ mr: 1, minWidth: 0, '& .MuiTypography-root': ONE_LINE_SX }}
              />
            ))}
          </RadioGroup>
        </Box>
        <FormHelperText sx={{ mx: 0 }}>{t('egressHelp')}</FormHelperText>
        {values.egress_mode === 'all' && <FormHelperText sx={{ mx: 0, color: 'warning.main' }}>{t('egressAllWarning')}</FormHelperText>}
      </FormControl>
    </Stack>
  )
}

/** Create or edit a zone: name (fixed once created), label, color from a small palette, isolation. */
export default function ZoneDialog({ zone, onSave, onClose, gate }: Props) {
  const t = useTranslations()
  const editing = zone !== null
  const [values, setValues] = useState<ZoneFormValues>({
    name: zone?.name ?? '', label: zone?.label ?? '', color: zone ? zone.color : ZONE_COLORS[0], isolate_members: zone?.isolate_members ?? false,
    egress_control: zone ? zoneEgress(zone) !== 'off' : false, egress_mode: zone?.egress_mode ?? 'local',
  })
  const [confirming, setConfirming] = useState(false)
  // The gate as it was when the question was asked: once the dialog has written (its own mode change makes the draft
  // dirty), a retry must not be refused for that change.
  const [frozenGate, setFrozenGate] = useState<ZoneGate | null>(null)
  const [touched, setTouched] = useState(false)
  const { busy, error, run } = useDialogAction()

  const errors = validateZoneForm(values)
  const nameError = values.name !== '' || touched ? errors.name : undefined
  const set = <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) => setValues(prev => ({ ...prev, [key]: value }))

  // A new zone is disabled, and so is a disabled one: its outbound cannot be controlled until it is observed or enforced.
  const stateBlocked = !zone || (zone.state !== 'observe' && zone.state !== 'enforce')
  const egressChanged = !!zone && values.egress_control !== (zoneEgress(zone) !== 'off')

  const isolationChanged = !!zone && values.isolate_members !== zone.isolate_members

  const save = () => {
    setFrozenGate(prev => prev ?? gate ?? null)
    return run(async () => {
      try {
        await onSave({ ...values, label: values.label.trim() })
      } catch (e) {
        // The draft moved elsewhere: the next try is a new question, gated on the draft as it is then.
        if (isVersionConflict(e)) setFrozenGate(null)
        throw e
      }
    })
  }
  const submit = () => {
    if (Object.keys(errors).length > 0) return
    if (egressChanged) setConfirming(true)
    else void save()
  }
  const egressText = values.egress_control
    ? { title: 'egressOnTitle', body: 'egressOnBody', confirm: 'egressOnConfirm' }
    : { title: 'egressOffTitle', body: 'egressOffBody', confirm: 'egressOffConfirm' }
  const egressGate = frozenGate ?? gate

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth aria-labelledby='microseg-zone-title'>
      <DialogTitle id='microseg-zone-title' sx={ONE_LINE_SX}>
        {editing ? t('microsegPilot.policy.zoneDialog.editTitle') : t('microsegPilot.policy.zoneDialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label={t('microsegPilot.policy.zoneDialog.name')}
            value={values.name}
            onChange={e => set('name', e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={editing || busy}
            error={!!nameError}
            helperText={nameError ? t(nameError) : t('microsegPilot.policy.zoneDialog.nameHint')}
            slotProps={{ htmlInput: { maxLength: 14 }, formHelperText: { sx: HELPER_SX } }}
            size='small'
            fullWidth
            autoFocus={!editing}
          />
          <TextField
            label={t('microsegPilot.policy.zoneDialog.label')}
            value={values.label}
            onChange={e => set('label', e.target.value)}
            disabled={busy}
            size='small'
            fullWidth
          />
          <ColorPicker value={values.color} onChange={color => set('color', color)} label={t('microsegPilot.policy.zoneDialog.color')} />
          <FormControlLabel
            control={<Checkbox checked={values.isolate_members} onChange={e => set('isolate_members', e.target.checked)} disabled={busy} />}
            label={t('microsegPilot.policy.zoneDialog.isolate')}
            sx={{ m: 0, '& .MuiTypography-root': ONE_LINE_SX }}
          />
          <EgressSection values={values} disabled={busy} stateBlocked={stateBlocked} set={set} />
          {error && <DialogErrorLine message={error} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button onClick={submit} variant='contained' disabled={busy || Object.keys(errors).length > 0}>
          {editing ? t('microsegPilot.policy.zoneDialog.save') : t('microsegPilot.policy.zoneDialog.create')}
        </Button>
      </DialogActions>
      {confirming && (
        <TypedConfirmDialog
          title={t(`microsegPilot.policy.zoneDialog.${egressText.title}`, { name: values.name })}
          lines={[
            t(`microsegPilot.policy.zoneDialog.${egressText.body}`),
            ...(isolationChanged ? [t('microsegPilot.policy.zoneDialog.egressIsolateNote')] : []),
          ]}
          confirmLabel={t(`microsegPilot.policy.zoneDialog.${egressText.confirm}`)}
          color='warning'
          ready={!egressGate?.pending}
          busy={busy}
          onConfirm={() => void save().then(ok => { if (!ok) setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        >
          <ZoneStateGate pending={!!egressGate?.pending} count={egressGate?.count ?? null} onViewPlan={egressGate?.onViewPlan} discard={egressGate?.discard} />
        </TypedConfirmDialog>
      )}
    </Dialog>
  )
}
