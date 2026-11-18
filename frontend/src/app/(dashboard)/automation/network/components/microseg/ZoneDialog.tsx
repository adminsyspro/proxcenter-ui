'use client'

import { useId, useMemo, useState } from 'react'
import {
  Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, IconButton, ListItemText,
  Radio, RadioGroup, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { zoneEgress, type EgressMode, type EgressState, type MicrosegFlow, type MicrosegPolicy, type MicrosegZone, type ZoneState } from '@/lib/microseg/types'

import { DialogErrorLine, FLUSH_TOGGLE_SX, FormRow, isVersionConflict, ONE_LINE_SX, useDialogAction } from './dialogParts'
import { clusterGuestsRead, useExceptionScope, type ExceptionClusters } from './ExceptionDialog'
import { draftException, exceptionDraft, exceptionsOfZone, exceptionStatus, ofCluster, shownExceptionStatus, type ExceptionDraft } from './exceptionModel'
import { EXCEPTION_STATUS_COLOR } from './ExceptionLine'
import ExceptionsTableDialog from './ExceptionsTableDialog'
import { useGroupGuests } from './useGroupGuests'
import { missingGatewayFlows, zoneStateChanges, type ExceptionCreated } from './useZoneEdits'
import type { ZoneGate } from './zoneGate'
import {
  DEFAULT_GATEWAY_SERVICES, GATEWAY_SERVICES, gatewayServicePorts, isGatewayService, typedServiceCandidates, typedServiceText, validateZoneForm, ZONE_COLORS,
  type GatewayService,
  type ZoneFormValues,
} from './zoneForm'
import { zoneMembers, type PolicyGuest, type ZoneMember } from './zoneModel'
import ZoneStatesConfirm from './ZoneStatesConfirm'

type Props = {
  /** The zone to edit, or null to create one. */
  zone: MicrosegZone | null
  /** For the readiness of a move to blocking. */
  connectionId: string
  readyAfterHours: number
  /**
   * Throws when the write fails: the dialog then keeps its input and shows the error. `onExceptionCreated` is to be
   * called for each new exception once it is written, even when a later step fails: the dialog gives it its id.
   */
  onSave: (values: ZoneFormValues, onExceptionCreated: ExceptionCreated) => Promise<void>
  onClose: () => void
  /** The pending changes of the draft: a state change applies the whole draft, so it is refused while there are some. */
  gate?: ZoneGate
  /** The flows of the draft: the services the zone already reaches on its gateway show as allowed. */
  flows?: MicrosegFlow[]
  /** The draft: the exceptions of the zone, and its members (offered first as the destinations of an exception). Without it the zone shows none. */
  policy?: MicrosegPolicy
  /** Names a cluster of a shared policy as the user sees it: the clusters an exception may be written on. */
  clusterName?: (id: string) => string
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

/**
 * The gateway of the zone and what the zone may reach on it: services picked in a list or typed ("tcp/8443",
 * "udp/5000:5010", "icmp"), each one becoming a flow from the zone to the gateway, created with the zone. A listed
 * service the draft already allows shows picked and fixed.
 */
function GatewayRows({ values, zoneId, flows, disabled, error, set }: {
  values: ZoneFormValues
  zoneId: string | null
  flows: MicrosegFlow[]
  disabled: boolean
  error?: string
  set: SetField
}) {
  const t = useTranslations()
  const td = useTranslations('microsegPilot.policy.zoneDialog')
  const gatewayId = useId()
  const [typedError, setTypedError] = useState(false)
  const [typing, setTyping] = useState('')
  const gateway = values.gateway.trim()
  const usable = !!gateway && !error
  const allowed = GATEWAY_SERVICES.filter(s => usable && !!zoneId && missingGatewayFlows(zoneId, gateway, [s], flows).length === 0)
  const picked = usable ? [...allowed, ...values.gateway_services.filter(s => !allowed.includes(s as GatewayService))] : []
  const name = (s: string) => (isGatewayService(s) ? td(`gatewayServices.${s}`) : s)
  const change = (next: string[]) => {
    const choices: string[] = []
    let refused = false
    for (const raw of next) {
      const typed = isGatewayService(raw) ? raw : typedServiceText(raw)
      // A typed "any" is the listed "All protocols".
      const choice = typed === 'any' ? 'all' : typed
      if (!choice) refused = true
      else if (!choices.includes(choice) && !allowed.includes(choice as GatewayService)) choices.push(choice)
    }
    setTypedError(refused)
    set('gateway_services', choices)
  }
  return (
    <>
      <FormRow label={td('gateway')} htmlFor={gatewayId}>
        <TextField
          id={gatewayId}
          value={values.gateway}
          onChange={e => set('gateway', e.target.value)}
          disabled={disabled}
          placeholder='10.30.0.1'
          error={!!error}
          helperText={error ? t(error) : td('gatewayHint')}
          slotProps={{ formHelperText: { sx: HELPER_SX } }}
          size='small'
          fullWidth
        />
      </FormRow>
      <FormRow label={td('gatewayAllow')}>
        <Autocomplete
          multiple
          freeSolo
          disableCloseOnSelect
          // While typing, Enter takes the first proposal ("Add tcp/8443"); with nothing typed it toggles nothing by itself.
          autoHighlight={!!typing.trim()}
          size='small'
          fullWidth
          options={[...GATEWAY_SERVICES]}
          // The listed services whose name or ports hold the text, after what the text itself adds ("Add tcp/8443").
          filterOptions={(options, { inputValue }) => {
            const text = inputValue.trim().toLowerCase()
            if (!text) return options
            const adds = typedServiceCandidates(text).filter(c => !picked.includes(c))
            const listed = options.filter(o => `${name(o)} ${gatewayServicePorts(o, gateway)}`.toLowerCase().includes(text))
            return [...adds, ...listed]
          }}
          value={picked}
          disabled={disabled || !usable}
          getOptionDisabled={o => allowed.includes(o as GatewayService)}
          getOptionLabel={name}
          onChange={(_, next) => change(next)}
          inputValue={typing}
          onInputChange={(_, text, reason) => setTyping(reason === 'reset' ? '' : text)}
          // On one line: the picked services as text, the field takes what is typed after them.
          renderValue={selected => (
            <Box component='span' data-testid='gateway-services-value' title={selected.map(name).join(', ')} sx={{ ...ONE_LINE_SX, flex: '0 1 auto', maxWidth: '70%', pl: 1 }}>
              {selected.map(name).join(', ')}
            </Box>
          )}
          renderOption={({ key, ...props }, option, { selected }) => (
            <li key={key} {...props}>
              {isGatewayService(option)
                ? <Checkbox checked={selected || allowed.includes(option as GatewayService)} size='small' sx={{ p: 0, mr: 1 }} />
                : <Box component='i' className='ri-add-line' aria-hidden sx={{ fontSize: 18, mr: 1, color: 'primary.main' }} />}
              <ListItemText
                primary={isGatewayService(option) ? name(option) : td('gatewayAdd', { service: option })}
                secondary={allowed.includes(option as GatewayService) ? td('gatewayAllowed') : isGatewayService(option) ? gatewayServicePorts(option, gateway) : ''}
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                sx={{ display: 'flex', alignItems: 'baseline', gap: 1, m: 0 }}
              />
            </li>
          )}
          renderInput={params => (
            <TextField
              {...params}
              placeholder={usable ? td('gatewayTypeHint') : td('gatewayFirst')}
              error={typedError}
              helperText={typedError ? td('gatewayTypedInvalid') : td('gatewayServicesHint')}
              slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': td('gatewayAllow') }, formHelperText: { sx: HELPER_SX } }}
              // A service typed and left without Enter is taken too, so a click on Save does not lose it.
              onBlur={() => {
                if (typing.trim()) {
                  change([...picked, typing])
                  setTyping('')
                }
              }}
            />
          )}
          sx={{ '& .MuiAutocomplete-inputRoot': { flexWrap: 'nowrap' } }}
        />
      </FormRow>
    </>
  )
}

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
 * The exceptions of the zone on one row: how many it has, a mark when some are not active (the statuses the table
 * says, so none that reads a guest list still unknown), and the button that opens their table.
 */
function ExceptionsRow({ values, guests, members, zoneState, guestsKnown, clusters, disabled, onManage }: {
  values: ExceptionDraft[]
  guests: PolicyGuest[]
  members: ZoneMember[]
  zoneState: ZoneState
  guestsKnown: boolean
  clusters?: ExceptionClusters
  disabled: boolean
  onManage: () => void
}) {
  const t = useTranslations('microsegPilot.policy.exceptions')
  // Each exception is read against the guests of its own cluster on a shared policy.
  const issues = values.flatMap(e => {
    const cluster = clusters ? e.connectionId ?? clusters.preferred : undefined
    const known = guestsKnown && clusterGuestsRead(clusters, cluster)
    return shownExceptionStatus(exceptionStatus(draftException(e, ''), { state: zoneState }, ofCluster(members, cluster), ofCluster(guests, cluster)), known) ?? []
  })
  // Amber as soon as one of them asks for a look, grey when the zone is only not applied.
  const color = issues.some(s => EXCEPTION_STATUS_COLOR[s] === 'warning') ? 'warning' : 'default'
  return (
    <FormRow label={t('title')} tip={t('tip')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', minWidth: 0 }}>
        <Typography variant='body2' data-testid='zone-exceptions-summary' sx={{ ...ONE_LINE_SX, flex: '0 1 auto', minWidth: 0 }}>{t('count', { count: values.length })}</Typography>
        {issues.length > 0 && (
          <Tooltip title={t('notActiveHint')}>
            <Chip size='small' variant='outlined' color={color} data-testid='zone-exceptions-not-active' label={t('notActive', { count: issues.length })} sx={{ flexShrink: 0 }} />
          </Tooltip>
        )}
        <Button size='small' variant='outlined' disabled={disabled} onClick={onManage} sx={{ height: 30, flexShrink: 0, whiteSpace: 'nowrap', ml: 'auto' }}>
          {t('manage')}
        </Button>
      </Box>
    </FormRow>
  )
}

/**
 * Create or edit a zone: name (fixed once created), label, color from a small palette, isolation; for an existing zone
 * also its inbound and outbound states, applied at once with the whole draft after the zone is written (confirmed first,
 * refused while the draft had pending changes), and what its outbound filter covers. Its exceptions are summed up on
 * one row and edited in their own table dialog; they are written with the zone: the save gets the list and the ids of
 * the stored ones that were removed.
 */
export default function ZoneDialog({ zone, connectionId, readyAfterHours, onSave, onClose, gate, flows = [], policy, clusterName }: Props) {
  const t = useTranslations()
  const editing = zone !== null
  const nameId = useId()
  const labelId = useId()
  // The guests are read only for a dialog that edits exceptions (the list the tab already holds, no new request when
  // warm): those of every cluster of a shared policy, so the members queued on any cluster are matched to their guest.
  const scope = useExceptionScope(policy, connectionId, clusterName)
  const { guests, status, errors: guestErrors } = useGroupGuests(policy ? scope.guestIds : [])
  // A cluster whose guests could not be read: no status is said rather than a false one.
  const guestsStatus = status === 'ready' && Object.keys(guestErrors).length > 0 ? 'error' : status
  const members = useMemo(
    () => (zone && policy ? zoneMembers(zone, policy.policy.tag_prefix, guests, policy.pending_members, policy.zones) : []),
    [zone, policy, guests],
  )
  const [loaded] = useState(() => (zone && policy ? exceptionsOfZone(zone.id, policy.exceptions).map(exceptionDraft) : []))
  // The stored exceptions the dialog has listed: the ones it opened with, and the ones a save of its own created
  // before a later step failed. Only those, once removed from the list, are deleted.
  const [listedIds, setListedIds] = useState(() => loaded.flatMap(e => (e.id ? [e.id] : [])))
  const [values, setValues] = useState<ZoneFormValues>({
    name: zone?.name ?? '', label: zone?.label ?? '', color: zone ? zone.color : ZONE_COLORS[0], isolate_members: zone?.isolate_members ?? false,
    state: zone?.state ?? 'disabled', egress_state: zone ? zoneEgress(zone) : 'off', egress_mode: zone?.egress_mode ?? 'local',
    // A zone without a gateway yet gets the three services ticked, to take as soon as the gateway is typed.
    gateway: zone?.gateway ?? '', gateway_services: zone?.gateway ? [] : [...DEFAULT_GATEWAY_SERVICES],
    exceptions: loaded, removed_exceptions: [],
  })
  const [confirming, setConfirming] = useState(false)
  const [managing, setManaging] = useState(false)
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
        const kept = new Set(values.exceptions.map(e => e.id))
        const removed = listedIds.filter(id => !kept.has(id))
        // A new exception written before a later step fails takes its id: the next try updates it instead of creating it again.
        const adopt: ExceptionCreated = (draft, id) => {
          setValues(prev => ({ ...prev, exceptions: prev.exceptions.map(e => (e === draft ? { ...e, id } : e)) }))
          setListedIds(prev => [...prev, id])
        }
        await onSave({ ...values, label: values.label.trim(), gateway: values.gateway.trim(), removed_exceptions: removed }, adopt)
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
          <ExceptionsRow
            values={values.exceptions}
            guests={guests}
            members={members}
            zoneState={values.state}
            guestsKnown={guestsStatus === 'ready'}
            clusters={scope.clusters}
            disabled={busy}
            onManage={() => setManaging(true)}
          />
          <GatewayRows values={values} zoneId={zone?.id ?? null} flows={flows} disabled={busy} error={errors.gateway} set={set} />
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
      {managing && (
        <ExceptionsTableDialog
          zoneName={values.name}
          zoneColor={values.color}
          values={values.exceptions}
          guests={guests}
          members={members}
          zoneState={values.state}
          guestsKnown={guestsStatus === 'ready'}
          clusters={scope.clusters}
          onChange={next => set('exceptions', next)}
          onClose={() => setManaging(false)}
        />
      )}
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
