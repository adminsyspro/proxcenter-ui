'use client'

import { useMemo, useState } from 'react'
import { Autocomplete, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { GuestRefLite } from '@/lib/microseg/types'

import { DialogErrorLine, FormRow, ONE_LINE_SX, useDialogAction } from './dialogParts'
import {
  draftOverlap, draftRuleCount, EXCEPTION_SERVICE_NAMES, EXCEPTION_SERVICES, exceptionServicePorts, isExceptionService, isExceptionServiceText, MAX_EXCEPTION_RULES,
  type ExceptionDraft,
} from './exceptionModel'
import { typedServiceCandidates, typedServiceText } from './zoneForm'
import { byGuestName, guestKey, type PolicyGuest, type ZoneMember } from './zoneModel'

type Props = {
  open: boolean
  /** The exception to edit (it has an id), the picks a new one starts with (it has none), or null for an empty one. */
  exception: ExceptionDraft | null
  /** Every guest of the connection: any of them may be a source or a destination. */
  guests: PolicyGuest[]
  /** The members of the zone, pending ones included: offered first among the destinations. */
  members: ZoneMember[]
  /** A save that throws keeps the dialog open with its input and shows the error. The caller closes the dialog. */
  onSave: (draft: ExceptionDraft) => void | Promise<void>
  onClose: () => void
}

const HELPER_SX = { ...ONE_LINE_SX, mx: 0 } as const
const ONE_LINE_FIELD_SX = { '& .MuiAutocomplete-inputRoot': { flexWrap: 'nowrap' } } as const
const VALUE_SX = { ...ONE_LINE_SX, flex: '0 1 auto', maxWidth: '70%', pl: 1 } as const
const OPTION_TEXT_SX = { display: 'flex', alignItems: 'baseline', gap: 1, m: 0, minWidth: 0 } as const

/** The name of a service of an exception: a listed one by its name, a typed one as it is. */
export function useExceptionServiceName(): (choice: string) => string {
  const t = useTranslations('microsegPilot.policy.zoneDialog.gatewayServices')
  return choice => {
    if (!isExceptionService(choice)) return choice
    return EXCEPTION_SERVICE_NAMES[choice] ?? t(choice as 'ping' | 'all')
  }
}

type GuestOption = {
  key: string
  /** What the exception records for the guest: its inventory name, or the recorded one when the inventory lost it. */
  ref: GuestRefLite
  guest: PolicyGuest | null
  member: boolean
}

const optionName = (o: GuestOption) => o.ref.name || String(o.ref.vmid)

/** The guests of the inventory by name, then the guests the exception names that the inventory no longer has. */
function guestOptions(guests: readonly PolicyGuest[], members: readonly ZoneMember[], named: readonly GuestRefLite[]): GuestOption[] {
  const memberKeys = new Set(members.map(m => guestKey(m.ref)))
  const options: GuestOption[] = [...guests].sort(byGuestName).map(g => ({
    key: guestKey(g), ref: { type: g.type, vmid: g.vmid, name: g.name }, guest: g, member: memberKeys.has(guestKey(g)),
  }))
  const known = new Set(options.map(o => o.key))
  for (const ref of named) {
    const key = guestKey(ref)
    if (known.has(key)) continue
    known.add(key)
    options.push({ key, ref: { type: ref.type, vmid: ref.vmid, name: ref.name }, guest: null, member: memberKeys.has(key) })
  }
  return options
}

/** The guests of one side of the exception: picked in a list, shown on one line in the order they were picked. */
function GuestPicker({ label, testId, options, value, taken, takenText, groups, disabled, onChange }: {
  label: string
  testId: string
  options: GuestOption[]
  value: GuestRefLite[]
  /** The guests picked on the other side: shown, not selectable. */
  taken: ReadonlySet<string>
  takenText: string
  /** The headers of the members and of the other guests, for a list that puts the members first. */
  groups?: { members: string; others: string }
  disabled: boolean
  onChange: (next: GuestRefLite[]) => void
}) {
  const t = useTranslations('microsegPilot.policy.exceptions')
  const [typing, setTyping] = useState('')
  // The same list while the picks do not change: the field drops the text being typed when it is handed a new one.
  const selected = useMemo(() => {
    const byKey = new Map(options.map(o => [o.key, o]))
    return value.map(ref => byKey.get(guestKey(ref))).filter((o): o is GuestOption => !!o)
  }, [options, value])
  const names = selected.map(optionName).join(', ')
  const secondary = (o: GuestOption) => {
    if (taken.has(o.key)) return takenText
    return o.guest ? '' : t('notInInventory')
  }
  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      // While typing, Enter takes the first VM that matches, as the services field does; a VM that cannot be picked (it
      // is on the other side) is never highlighted.
      autoHighlight={!!typing.trim()}
      inputValue={typing}
      onInputChange={(_, text, reason) => setTyping(reason === 'reset' ? '' : text)}
      size='small'
      fullWidth
      options={options}
      value={selected}
      disabled={disabled}
      isOptionEqualToValue={(o, v) => o.key === v.key}
      // The filter reads the name and the VMID.
      getOptionLabel={o => `${optionName(o)} ${o.ref.vmid}`}
      getOptionDisabled={o => taken.has(o.key)}
      groupBy={groups ? o => (o.member ? groups.members : groups.others) : undefined}
      onChange={(_, next) => onChange(next.map(o => o.ref))}
      renderValue={() => (
        <Box component='span' data-testid={testId} title={names} sx={VALUE_SX}>{names}</Box>
      )}
      renderOption={({ key, ...props }, option, { selected: picked }) => (
        <li key={key} {...props}>
          <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', width: 20, mr: 1, flexShrink: 0 }}>
            {option.guest
              ? <StatusIcon type='vm' vmType={option.guest.type} status={option.guest.status} />
              : <i className='ri-question-line' style={{ opacity: 0.6 }} />}
          </Box>
          <ListItemText
            primary={optionName(option)}
            secondary={String(option.ref.vmid)}
            slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
            sx={{ ...OPTION_TEXT_SX, flex: '0 1 auto' }}
          />
          <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0, ml: 1 }}>{secondary(option)}</Typography>
          {picked && <Box component='i' className='ri-check-line' aria-hidden sx={{ fontSize: 18, ml: 1, color: 'primary.main', flexShrink: 0 }} />}
        </li>
      )}
      renderInput={params => (
        <TextField {...params} placeholder={t('guestsPlaceholder')} slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': label } }} />
      )}
      sx={ONE_LINE_FIELD_SX}
    />
  )
}

/**
 * The services of the exception, as the zone dialog takes the services of its gateway: picked in a list or typed
 * ("tcp/8443", "udp 5000:5010", "icmp"). Only a text typed here is checked: a service loaded from a stored exception
 * stays as it is stored, whatever it is.
 */
function ServicePicker({ label, value, helper, error, typedError, disabled, onChange, onTypedError }: {
  label: string
  value: string[]
  /** The line under the field while nothing typed is refused: the hint, the rule count or the bound. */
  helper: string
  error: boolean
  /** The field holds a typed text that is not a service: it stays in the field, and the dialog does not save. */
  typedError: boolean
  disabled: boolean
  onChange: (next: string[]) => void
  onTypedError: (refused: boolean) => void
}) {
  const td = useTranslations('microsegPilot.policy.zoneDialog')
  const name = useExceptionServiceName()
  const [typing, setTyping] = useState('')
  /** Takes the choices; a text that is not a service is refused and put back in the field, where the person corrects or erases it. */
  const change = (next: string[]) => {
    const choices: string[] = []
    let refused: string | null = null
    for (const raw of next) {
      // Already there: a service picked before, or one a stored exception holds.
      if (value.includes(raw)) {
        if (!choices.includes(raw)) choices.push(raw)
        continue
      }
      if (!isExceptionServiceText(raw)) {
        refused = raw
        continue
      }
      const typed = isExceptionService(raw) ? raw : typedServiceText(raw)
      // A typed "any" is the listed "All protocols".
      const choice = typed === 'any' ? 'all' : typed
      if (choice && !choices.includes(choice)) choices.push(choice)
    }
    onTypedError(refused !== null)
    // The field was emptied when the text was taken: a refused one goes back in it.
    setTyping(refused ?? '')
    onChange(choices)
  }
  const names = value.map(name).join(', ')
  return (
    <Autocomplete
      multiple
      freeSolo
      disableCloseOnSelect
      // While typing, Enter takes the first proposal ("Add tcp/8443"); with nothing typed it toggles nothing by itself.
      autoHighlight={!!typing.trim()}
      size='small'
      fullWidth
      options={[...EXCEPTION_SERVICES] as string[]}
      // The listed services whose name holds the text, or whose ports do once a port is typed, after what the text
      // itself adds ("Add tcp/8443"). A protocol alone ("tcp") matches no port: Enter would take the first service
      // that runs over it.
      filterOptions={(options, { inputValue }) => {
        const text = inputValue.trim().toLowerCase()
        if (!text) return options
        const adds = typedServiceCandidates(text).filter(c => !value.includes(c))
        const withPorts = /\d/.test(text)
        const listed = options.filter(o => name(o).toLowerCase().includes(text) || (withPorts && exceptionServicePorts(o).includes(text)))
        return [...adds, ...listed]
      }}
      value={value}
      disabled={disabled}
      getOptionLabel={name}
      onChange={(_, next) => change(next)}
      inputValue={typing}
      onInputChange={(_, text, reason) => {
        setTyping(reason === 'reset' ? '' : text)
        // The refused text is being corrected or erased.
        if (reason !== 'reset') onTypedError(false)
      }}
      renderValue={() => (
        <Box component='span' data-testid='exception-services-value' title={names} sx={VALUE_SX}>{names}</Box>
      )}
      renderOption={({ key, ...props }, option, { selected }) => (
        <li key={key} {...props}>
          {isExceptionService(option)
            ? <Checkbox checked={selected} size='small' sx={{ p: 0, mr: 1 }} />
            : <Box component='i' className='ri-add-line' aria-hidden sx={{ fontSize: 18, mr: 1, color: 'primary.main' }} />}
          <ListItemText
            primary={isExceptionService(option) ? name(option) : td('gatewayAdd', { service: option })}
            secondary={isExceptionService(option) ? exceptionServicePorts(option) : ''}
            slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
            sx={OPTION_TEXT_SX}
          />
        </li>
      )}
      renderInput={params => (
        <TextField
          {...params}
          placeholder={td('gatewayTypeHint')}
          error={typedError || error}
          helperText={typedError ? td('gatewayTypedInvalid') : helper}
          slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': label }, formHelperText: { sx: HELPER_SX } }}
          // A service typed and left without Enter is taken too, so a click on the save does not lose it.
          onBlur={() => {
            if (typing.trim()) change([...value, typing])
          }}
        />
      )}
      sx={ONE_LINE_FIELD_SX}
    />
  )
}

function ExceptionForm({ exception, guests, members, onSave, onClose }: Omit<Props, 'open'>) {
  const t = useTranslations('microsegPilot.policy.exceptions')
  const tc = useTranslations('common')
  const td = useTranslations('microsegPilot.policy.zoneDialog')
  const editing = !!exception?.id
  const [sources, setSources] = useState<GuestRefLite[]>(exception?.sources ?? [])
  const [destinations, setDestinations] = useState<GuestRefLite[]>(exception?.destinations ?? [])
  const [services, setServices] = useState<string[]>(exception?.services ?? [])
  const [typedError, setTypedError] = useState(false)
  const { busy, error, run } = useDialogAction()

  const named = useMemo(() => [...(exception?.sources ?? []), ...(exception?.destinations ?? [])], [exception])
  const options = useMemo(() => guestOptions(guests, members, named), [guests, members, named])
  const membersFirst = useMemo(() => [...options.filter(o => o.member), ...options.filter(o => !o.member)], [options])
  const byKey = new Map(options.map(o => [o.key, o]))
  // What is written: each guest with its inventory name, the recorded one for a guest the inventory lost.
  const recorded = (refs: GuestRefLite[]) => refs.map(ref => byKey.get(guestKey(ref))?.ref ?? ref)

  const count = draftRuleCount({ sources, destinations, services })
  const tooMany = count > MAX_EXCEPTION_RULES
  const overlap = draftOverlap({ sources, destinations })
  const incomplete = sources.length === 0 || destinations.length === 0 || services.length === 0
  let servicesHelper = td('gatewayServicesHint')
  if (tooMany) servicesHelper = t('tooManyRules', { count, max: MAX_EXCEPTION_RULES })
  else if (count > 0) servicesHelper = t('ruleCount', { count })

  const save = () => run(async () => {
    await onSave({
      ...(exception?.id ? { id: exception.id } : {}),
      sources: recorded(sources),
      destinations: recorded(destinations),
      services,
      comment: exception?.comment ?? '',
    })
  })

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth aria-labelledby='microseg-exception-title'>
      <DialogTitle sx={{ ...ONE_LINE_SX, display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-door-open-line' style={{ fontSize: 18, flexShrink: 0 }} />
        <Box component='span' id='microseg-exception-title' sx={ONE_LINE_SX}>{editing ? t('edit') : t('createTitle')}</Box>
      </DialogTitle>
      <DialogContent sx={{ '&&': { pt: 5 } }}>
        <Stack spacing={4}>
          <FormRow label={t('sources')}>
            <GuestPicker
              label={t('sources')}
              testId='exception-sources-value'
              options={options}
              value={sources}
              taken={new Set(destinations.map(guestKey))}
              takenText={t('alreadyDestination')}
              disabled={busy}
              onChange={setSources}
            />
          </FormRow>
          <FormRow label={t('destinations')}>
            <GuestPicker
              label={t('destinations')}
              testId='exception-destinations-value'
              options={membersFirst}
              value={destinations}
              taken={new Set(sources.map(guestKey))}
              takenText={t('alreadySource')}
              groups={{ members: t('membersGroup'), others: t('notMembersGroup') }}
              disabled={busy}
              onChange={setDestinations}
            />
          </FormRow>
          <FormRow label={t('services')}>
            <ServicePicker
              label={t('services')}
              value={services}
              helper={servicesHelper}
              error={tooMany}
              typedError={typedError}
              disabled={busy}
              onChange={setServices}
              onTypedError={setTypedError}
            />
          </FormRow>
          {overlap.length > 0 && <DialogErrorLine message={t('overlap', { names: overlap.map(r => r.name || String(r.vmid)).join(', ') })} />}
          {error && <DialogErrorLine message={error} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
        <Button onClick={() => void save()} variant='contained' disabled={busy || incomplete || tooMany || typedError || overlap.length > 0}>
          {editing ? tc('save') : tc('add')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Create or edit an exception of a zone on three lines: the VMs allowed in (any guest of the connection), the VMs
 * they reach (the members of the zone first; another guest is taken too, the exception then allows nothing until it
 * joins the zone), and the services. A VM is on one side only, and the exception compiles to 50 rules at most.
 */
export default function ExceptionDialog({ open, ...form }: Props) {
  // Mounted when it opens: every opening starts from the exception it is given.
  return open ? <ExceptionForm {...form} /> : null
}
