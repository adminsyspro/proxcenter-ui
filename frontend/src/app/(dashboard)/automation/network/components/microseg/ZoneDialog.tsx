'use client'

import { useId, useState } from 'react'
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, IconButton, Radio, RadioGroup,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { zoneEgress, type EgressMode, type EgressState, type MicrosegZone, type ZoneState } from '@/lib/microseg/types'

import { DialogErrorLine, FLUSH_TOGGLE_SX, FormRow, isVersionConflict, ONE_LINE_SX, useDialogAction } from './dialogParts'
import { zoneStateChanges } from './useZoneEdits'
import type { ZoneGate } from './zoneGate'
import { validateZoneForm, ZONE_COLORS, type ZoneFormValues } from './zoneForm'
import ZoneStatesConfirm from './ZoneStatesConfirm'

type Props = {
  /** The zone to edit, or null to create one. */
  zone: MicrosegZone | null
  /** For the readiness of a move to blocking. */
  connectionId: string
  readyAfterHours: number
  /** Throws when the write fails: the dialog then keeps its input and shows the error. */
  onSave: (values: ZoneFormValues) => Promise<void>
  onClose: () => void
  /** The pending changes of the draft: a state change applies the whole draft, so it is refused while there are some. */
  gate?: ZoneGate
}

const HELPER_SX = { ...ONE_LINE_SX, mx: 0 } as const
/** The label of a checkbox or a radio: on one line, without the theme's negative start margin. */
const TOGGLE_LABEL_SX = { m: 0, minWidth: 0, '& .MuiFormControlLabel-label': ONE_LINE_SX } as const
const CAPTION_SX = { display: 'block', mt: 1 } as const

function ColorPicker({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const colors: string[] = [...ZONE_COLORS]
  // A zone created elsewhere may carry a color outside the palette: keep it selectable.
  if (value && !colors.some(c => c.toLowerCase() === value.toLowerCase())) colors.push(value)
  return (
    <Box role='group' aria-label={label} sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, ml: 'calc(-2px - 0.125rem)', minWidth: 0 }}>
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
const INBOUND_STATES: ZoneState[] = ['disabled', 'observe', 'enforce']
const OUTBOUND_STATES: EgressState[] = ['off', 'observe', 'enforce']

/** An option label with its explanation behind an info icon at its right. */
function TipLabel({ text, tip }: { text: string; tip: string }) {
  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: '100%' }}>
      <Box component='span' sx={{ ...ONE_LINE_SX, minWidth: 0 }}>{text}</Box>
      <Tooltip title={tip} describeChild>
        <Box component='i' className='ri-information-line' data-testid='zone-dialog-tip' sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0, cursor: 'help' }} />
      </Tooltip>
    </Box>
  )
}

type StateOption<T extends string> = { value: T; label: string; tip: string }

/** One state of the zone (inbound or outbound): three exclusive buttons, each explained by its tooltip. */
function StateToggle<T extends string>({ label, value, options, disabled, onChange }: {
  label: string
  value: T
  options: StateOption<T>[]
  disabled: boolean
  onChange: (value: T) => void
}) {
  return (
    <ToggleButtonGroup exclusive size='small' value={value} aria-label={label} disabled={disabled} onChange={(_, next: T | null) => next && onChange(next)} sx={{ minWidth: 0 }}>
      {options.map(o => (
        // A disabled button cannot show a tooltip: the caption of the row says why instead.
        <Tooltip key={o.value} title={disabled ? '' : o.tip} describeChild>
          <ToggleButton value={o.value} sx={{ textTransform: 'none', px: 1.5, whiteSpace: 'nowrap' }}>{o.label}</ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  )
}

type SetField = <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) => void

/** The Inbound and Outbound state rows of an existing zone: the outbound waits for an inbound in observation or blocking. */
function StateRows({ values, disabled, set }: { values: ZoneFormValues; disabled: boolean; set: SetField }) {
  const t = useTranslations('microsegPilot.policy.zoneDialog')
  const inboundOff = values.state === 'disabled'
  return (
    <>
      <FormRow label={t('inboundSection')}>
        <StateToggle
          label={t('inboundSection')}
          value={values.state}
          options={INBOUND_STATES.map(v => ({ value: v, label: t(`inboundStates.${v}`), tip: t(`tips.inbound.${v}`) }))}
          disabled={disabled}
          onChange={v => set('state', v)}
        />
      </FormRow>
      <FormRow
        label={t('egressSection')}
        below={inboundOff && <Typography variant='caption' color='text.secondary' sx={CAPTION_SX}>{t('egressNeedsState')}</Typography>}
      >
        <StateToggle
          label={t('egressSection')}
          // A disabled zone has no outbound control: the backend turns it off with the inbound.
          value={inboundOff ? 'off' : values.egress_state}
          options={OUTBOUND_STATES.map(v => ({ value: v, label: t(`outboundStates.${v}`), tip: t(`tips.outbound.${v}`) }))}
          disabled={disabled || inboundOff}
          onChange={v => set('egress_state', v)}
        />
      </FormRow>
    </>
  )
}

/** The choice of what the outbound filter covers, explained by the tooltips; the Internet warning stays visible under it. */
function EgressModeRow({ values, disabled, set }: { values: ZoneFormValues; disabled: boolean; set: SetField }) {
  const t = useTranslations('microsegPilot.policy.zoneDialog')
  return (
    <FormRow
      label={t('egressFilterTo')}
      below={values.egress_mode === 'all' && <Typography variant='caption' color='warning.main' sx={CAPTION_SX}>{t('egressAllWarning')}</Typography>}
    >
      <FormControl disabled={disabled} sx={{ minWidth: 0 }}>
        <RadioGroup row sx={{ flexWrap: 'nowrap', gap: 4, minWidth: 0 }} aria-label={t('egressFilter')} value={values.egress_mode} onChange={e => set('egress_mode', e.target.value as EgressMode)}>
          {EGRESS_MODES.map(mode => (
            <FormControlLabel
              key={mode}
              value={mode}
              control={<Radio sx={FLUSH_TOGGLE_SX} />}
              label={<TipLabel text={t(mode === 'local' ? 'egressLocal' : 'egressAll')} tip={t(`tips.${mode}`)} />}
              sx={TOGGLE_LABEL_SX}
            />
          ))}
        </RadioGroup>
      </FormControl>
    </FormRow>
  )
}

/**
 * Create or edit a zone: name (fixed once created), label, color from a small palette, isolation; for an existing zone
 * also its inbound and outbound states, applied at once with the whole draft after the zone is written (confirmed first,
 * refused while the draft had pending changes), and what its outbound filter covers.
 */
export default function ZoneDialog({ zone, connectionId, readyAfterHours, onSave, onClose, gate }: Props) {
  const t = useTranslations()
  const editing = zone !== null
  const nameId = useId()
  const labelId = useId()
  const [values, setValues] = useState<ZoneFormValues>({
    name: zone?.name ?? '', label: zone?.label ?? '', color: zone ? zone.color : ZONE_COLORS[0], isolate_members: zone?.isolate_members ?? false,
    state: zone?.state ?? 'disabled', egress_state: zone ? zoneEgress(zone) : 'off', egress_mode: zone?.egress_mode ?? 'local',
  })
  const [confirming, setConfirming] = useState(false)
  // The gate as it was when the question was asked: once the dialog has written (its own changes make the draft
  // dirty), a retry must not be refused for them.
  const [frozenGate, setFrozenGate] = useState<ZoneGate | null>(null)
  const [touched, setTouched] = useState(false)
  const { busy, error, run } = useDialogAction()

  const errors = validateZoneForm(values)
  const nameError = values.name !== '' || touched ? errors.name : undefined
  const set = <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) => setValues(prev => ({ ...prev, [key]: value }))

  const changes = zone ? zoneStateChanges(zone, values) : { inbound: null, outbound: null }
  const isolationChanged = !!zone && values.isolate_members !== zone.isolate_members
  const stateGate = frozenGate ?? gate
  // Reopening the outbound (blocking to observation) is one click when the draft is clean, as in the panel.
  const reopenOnly = !!zone && !changes.inbound && changes.outbound === 'observe' && zoneEgress(zone) === 'enforce' && !gate?.pending
  // The filter only means something while the outbound is controlled.
  const modeDisabled = busy || values.state === 'disabled' || values.egress_state === 'off'

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
    if ((changes.inbound || changes.outbound) && !reopenOnly) setConfirming(true)
    else void save()
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth aria-labelledby='microseg-zone-title'>
      <DialogTitle id='microseg-zone-heading' sx={{ ...ONE_LINE_SX, display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-shield-fill' data-testid='zone-dialog-icon' style={{ fontSize: 18, flexShrink: 0, color: values.color || undefined }} />
        <Box component='span' id='microseg-zone-title' sx={{ ...ONE_LINE_SX, flexShrink: 0 }}>
          {editing ? t('microsegPilot.policy.zoneDialog.editTitle') : t('microsegPilot.policy.zoneDialog.createTitle')}
        </Box>
        {values.name.trim() ? <Box component='span' data-testid='zone-dialog-name' sx={{ ...ONE_LINE_SX, minWidth: 0, fontWeight: 700 }}>{`\u00B7 ${values.name.trim()}`}</Box> : null}
      </DialogTitle>
      <DialogContent sx={{ '&&': { pt: 5 } }}>
        <Stack spacing={4}>
          <FormRow label={t('microsegPilot.policy.zoneDialog.name')} htmlFor={nameId}>
            <TextField
              id={nameId}
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
          </FormRow>
          <FormRow label={t('microsegPilot.policy.zoneDialog.label')} htmlFor={labelId}>
            <TextField id={labelId} value={values.label} onChange={e => set('label', e.target.value)} disabled={busy} size='small' fullWidth />
          </FormRow>
          <FormRow label={t('microsegPilot.policy.zoneDialog.color')}>
            <ColorPicker value={values.color} onChange={color => set('color', color)} label={t('microsegPilot.policy.zoneDialog.color')} />
          </FormRow>
          <FormRow label={t('microsegPilot.policy.zoneDialog.members')}>
            <FormControlLabel
              control={<Checkbox checked={values.isolate_members} onChange={e => set('isolate_members', e.target.checked)} disabled={busy} sx={FLUSH_TOGGLE_SX} />}
              label={<TipLabel text={t('microsegPilot.policy.zoneDialog.isolate')} tip={t('microsegPilot.policy.zoneDialog.tips.isolate')} />}
              sx={TOGGLE_LABEL_SX}
            />
          </FormRow>
          <Divider />
          {/* A new zone is created disabled: its states are changed once it exists. */}
          {editing && <StateRows values={values} disabled={busy} set={set} />}
          <EgressModeRow values={values} disabled={modeDisabled} set={set} />
          {error && <DialogErrorLine message={error} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button onClick={submit} variant='contained' disabled={busy || Object.keys(errors).length > 0}>
          {editing ? t('microsegPilot.policy.zoneDialog.save') : t('microsegPilot.policy.zoneDialog.create')}
        </Button>
      </DialogActions>
      {confirming && zone && (
        <ZoneStatesConfirm
          connectionId={connectionId}
          zone={zone}
          readyAfterHours={readyAfterHours}
          inbound={changes.inbound}
          outbound={changes.outbound}
          isolationChanged={isolationChanged}
          gate={stateGate}
          busy={busy}
          onConfirm={() => void save().then(ok => { if (!ok) setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Dialog>
  )
}
