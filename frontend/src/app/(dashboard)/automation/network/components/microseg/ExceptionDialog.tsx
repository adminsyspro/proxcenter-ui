'use client'

import { useMemo, useState } from 'react'
import {
  Autocomplete, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, ListItemText, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import type { GuestRefLite, MicrosegPolicy } from '@/lib/microseg/types'

import type { NamedConnection } from './clusterModel'
import { shownClusterName } from './ClusterRunRow'
import { DialogErrorLine, FormRow, ONE_LINE_SX, useDialogAction } from './dialogParts'
import {
  draftOverlap, draftRuleCount, EXCEPTION_SERVICE_NAMES, EXCEPTION_SERVICES, exceptionClusterOptions, exceptionServicePorts, isExceptionService, isExceptionServiceText,
  MAX_EXCEPTION_RULES,
  type ExceptionDraft,
} from './exceptionModel'
import { typedServiceCandidates, typedServiceText } from './zoneForm'
import { byGuestName, guestKey, type PolicyGuest, type ZoneMember } from './zoneModel'
import { useMicrosegClusterWrite } from './microsegAccess'

/** The cluster choice of an exception of a shared policy: an exception belongs to one cluster, its guests are guests of that cluster. */
export type ExceptionClusters = {
  /** The clusters a new exception may be written on: the active ones the user sees, by name (`exceptionClusterOptions`). */
  options: NamedConnection[]
  /** The cluster a new exception starts on (the tab's, or the one of the flow it was opened from), unless it is not an option. */
  preferred: string
  /** The name of any cluster as the user may see it ("Another cluster" outside their scope). */
  name: (id: string) => string
  /** The clusters whose guests are read: an exception of another one says no status (its guests are unknown). */
  readIds: string[]
  /** The clusters of the group the user sees: an exception of another one (outside their scope, or a cluster that left) is locked. */
  editIds: string[]
}

/** True when an exception of `cluster` may be edited or deleted: always on one cluster; on a shared policy, on a cluster of the group the user sees. */
export function exceptionEditable(clusters: ExceptionClusters | undefined, cluster: string | undefined): boolean {
  return !clusters || !cluster || clusters.editIds.includes(cluster)
}

/** True when the guests an exception of `cluster` names can be checked: always on one cluster, on a read cluster otherwise. */
export function clusterGuestsRead(clusters: ExceptionClusters | undefined, cluster: string | undefined): boolean {
  return !clusters || !cluster || clusters.readIds.includes(cluster)
}

/**
 * What the exceptions of a policy need of its clusters: the cluster choice, only when the policy is shared (GET /policy
 * lists more than one cluster), and the clusters whose guests are read (the tab's alone for one cluster: the request
 * of today). With a name lookup, a cluster the user cannot see is neither offered nor read.
 */
export function useExceptionScope(policy: Pick<MicrosegPolicy, 'clusters'> | undefined, connectionId: string, clusterName?: (id: string) => string): { clusters?: ExceptionClusters; guestIds: string[] } {
  const other = useTranslations('microsegPilot.plan.cluster')('other')
  // An exception is written on its own cluster: only a cluster the user may write is offered, or editable.
  const { canWriteOn } = useMicrosegClusterWrite()
  const links = policy?.clusters
  return useMemo(() => {
    if (!links || links.length < 2) return { guestIds: connectionId ? [connectionId] : [] }
    const nameOf = (id: string) => shownClusterName(id, connectionId, clusterName)
    const linked = links.map(c => c.connection_id).sort()
    const ids = linked.filter(id => !clusterName || nameOf(id) !== null)
    return {
      clusters: {
        options: exceptionClusterOptions(links, nameOf).filter(o => canWriteOn(o.id)),
        preferred: connectionId,
        name: (id: string) => shownClusterName(id, connectionId, clusterName, other),
        readIds: ids,
        editIds: linked.filter(id => nameOf(id) !== null && canWriteOn(id)),
      },
      guestIds: ids,
    }
  }, [links, connectionId, clusterName, other, canWriteOn])
}

type Props = {
  open: boolean
  /** The exception to edit (it has an id), the picks a new one starts with (it has none), or null for an empty one. */
  exception: ExceptionDraft | null
  /** Every guest of the connection (of every cluster of a shared policy): any of them may be a source or a destination. */
  guests: PolicyGuest[]
  /** The members of the zone, pending ones included: offered first among the destinations. */
  members: ZoneMember[]
  /** Given only when the policy is shared: the cluster is chosen on the first line, and only its guests are offered. */
  clusters?: ExceptionClusters
  /** A save that throws keeps the dialog open with its input and shows the error. The caller closes the dialog. */
  onSave: (draft: ExceptionDraft) => void | Promise<void>
  onClose: () => void
}

const HELPER_SX = { ...ONE_LINE_SX, mx: 0 } as const
const ONE_LINE_FIELD_SX = { '& .MuiAutocomplete-inputRoot': { flexWrap: 'nowrap' } } as const
const VALUE_SX = { ...ONE_LINE_SX, flex: '0 1 auto', maxWidth: '70%', pl: 1 } as const
const OPTION_TEXT_SX = { display: 'flex', alignItems: 'baseline', gap: 1, m: 0, minWidth: 0 } as const
const CAPTION_SX = { ...ONE_LINE_SX, display: 'block', mt: 1 } as const

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

/**
 * Where a dialog of a shared policy starts: an exception being edited on its own cluster, a new one on the cluster it
 * was opened from when it is an option, else on the first option (`moved`: the picks it came with belong to the other
 * cluster and are dropped).
 */
function startCluster(clusters: ExceptionClusters | undefined, exception: ExceptionDraft | null): { cluster: string; wanted: string; moved: boolean } {
  if (!clusters) return { cluster: '', wanted: '', moved: false }
  const wanted = exception?.connectionId ?? clusters.preferred
  if (exception?.id || clusters.options.some(o => o.id === wanted)) return { cluster: wanted, wanted, moved: false }
  return { cluster: clusters.options[0]?.id ?? '', wanted, moved: true }
}

/** The cluster of the exception, on its own line: fixed once the exception exists; the line under it says when the wanted cluster is not applied yet. */
function ClusterRow({ clusters, value, editing, note, disabled, onChange }: {
  clusters: ExceptionClusters
  value: string
  editing: boolean
  note: string | null
  disabled: boolean
  onChange: (id: string) => void
}) {
  const t = useTranslations('microsegPilot.policy.exceptions')
  // An exception being edited stays on its cluster, whatever the options: it is listed even when it is not one.
  const listed = editing && value && !clusters.options.some(o => o.id === value)
    ? [...clusters.options, { id: value, name: clusters.name(value) }]
    : clusters.options
  return (
    <FormRow label={t('cluster')} below={note ? <Typography variant='caption' color='text.secondary' title={note} sx={CAPTION_SX}>{note}</Typography> : null}>
      <Select
        size='small'
        fullWidth
        displayEmpty
        value={value}
        disabled={disabled || editing}
        onChange={e => onChange(e.target.value)}
        inputProps={{ 'aria-label': t('cluster') }}
        sx={SMALL_SELECT_SX}
      >
        {listed.map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
      </Select>
    </FormRow>
  )
}

function ExceptionForm({ exception, guests, members, clusters, onSave, onClose }: Omit<Props, 'open'>) {
  const t = useTranslations('microsegPilot.policy.exceptions')
  const tc = useTranslations('common')
  const td = useTranslations('microsegPilot.policy.zoneDialog')
  const editing = !!exception?.id
  const [start] = useState(() => startCluster(clusters, exception))
  const [cluster, setCluster] = useState(start.cluster)
  const [sources, setSources] = useState<GuestRefLite[]>(start.moved ? [] : exception?.sources ?? [])
  const [destinations, setDestinations] = useState<GuestRefLite[]>(start.moved ? [] : exception?.destinations ?? [])
  const [services, setServices] = useState<string[]>(exception?.services ?? [])
  const [typedError, setTypedError] = useState(false)
  const { busy, error, run } = useDialogAction()

  // A shared policy: the guests and the members of the chosen cluster only (the same VMID elsewhere is another VM).
  const shownGuests = useMemo(() => (clusters ? guests.filter(g => g.connectionId === cluster) : guests), [clusters, guests, cluster])
  const shownMembers = useMemo(() => (clusters ? members.filter(m => m.connectionId === cluster) : members), [clusters, members, cluster])
  const named = useMemo(() => (start.moved ? [] : [...(exception?.sources ?? []), ...(exception?.destinations ?? [])]), [exception, start.moved])
  const options = useMemo(() => guestOptions(shownGuests, shownMembers, named), [shownGuests, shownMembers, named])
  const membersFirst = useMemo(() => [...options.filter(o => o.member), ...options.filter(o => !o.member)], [options])
  const byKey = new Map(options.map(o => [o.key, o]))
  // What is written: each guest with its inventory name, the recorded one for a guest the inventory lost.
  const recorded = (refs: GuestRefLite[]) => refs.map(ref => byKey.get(guestKey(ref))?.ref ?? ref)

  const count = draftRuleCount({ sources, destinations, services })
  const tooMany = count > MAX_EXCEPTION_RULES
  const overlap = draftOverlap({ sources, destinations })
  const incomplete = sources.length === 0 || destinations.length === 0 || services.length === 0 || (!!clusters && !cluster)
  let clusterNote: string | null = null
  if (clusters && start.moved) clusterNote = start.cluster ? t('clusterInactive', { name: clusters.name(start.wanted) }) : t('noActiveCluster')
  // Another cluster: the picks were guests of the one left, they are dropped.
  const changeCluster = (id: string) => {
    if (id === cluster) return
    setCluster(id)
    setSources([])
    setDestinations([])
  }
  let servicesHelper = td('gatewayServicesHint')
  if (tooMany) servicesHelper = t('tooManyRules', { count, max: MAX_EXCEPTION_RULES })
  else if (count > 0) servicesHelper = t('ruleCount', { count })

  const save = () => run(async () => {
    await onSave({
      ...(exception?.id ? { id: exception.id } : {}),
      ...(clusters ? { connectionId: cluster } : exception?.connectionId ? { connectionId: exception.connectionId } : {}),
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
          {clusters && <ClusterRow clusters={clusters} value={cluster} editing={editing} note={clusterNote} disabled={busy} onChange={changeCluster} />}
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
 * joins the zone), and the services. A VM is on one side only, and the exception compiles to 50 rules at most. On a
 * shared policy a first line chooses the cluster (an exception is local to one cluster): changing it empties both
 * lists of VMs.
 */
export default function ExceptionDialog({ open, ...form }: Props) {
  // Mounted when it opens: every opening starts from the exception it is given.
  return open ? <ExceptionForm {...form} /> : null
}
