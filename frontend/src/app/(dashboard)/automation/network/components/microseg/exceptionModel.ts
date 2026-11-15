// The model of the exceptions of a zone: the services the dialog offers, the bound on the rules an exception
// compiles to, what state an exception is in, and how a list names it. Pure functions, no i18n: the callers
// translate the service ids and the statuses.

import type { ExceptionService, GuestRefLite, MicrosegException, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { parseTypedService } from './zoneForm'
import { guestKey } from './zoneModel'
import type { PolicyGuest, ZoneMember } from './zoneModel'

/** The services an exception offers: what one guest usually opens to another (databases, web, administration, directory), or everything. */
export const EXCEPTION_SERVICES = [
  'postgresql', 'mysql', 'redis', 'mongodb', 'http', 'https', 'ssh', 'rdp', 'smb', 'ldap', 'ldaps', 'ping', 'all',
] as const
export type ExceptionServiceChoice = (typeof EXCEPTION_SERVICES)[number]

const EXCEPTION_SERVICE_FLOWS: Record<ExceptionServiceChoice, ExceptionService[]> = {
  postgresql: [{ proto: 'tcp', dport: '5432' }],
  mysql: [{ proto: 'tcp', dport: '3306' }],
  redis: [{ proto: 'tcp', dport: '6379' }],
  mongodb: [{ proto: 'tcp', dport: '27017' }],
  http: [{ proto: 'tcp', dport: '80' }],
  https: [{ proto: 'tcp', dport: '443' }],
  ssh: [{ proto: 'tcp', dport: '22' }],
  rdp: [{ proto: 'tcp', dport: '3389' }],
  smb: [{ proto: 'tcp', dport: '445' }],
  ldap: [{ proto: 'tcp', dport: '389' }],
  ldaps: [{ proto: 'tcp', dport: '636' }],
  // The destinations of an exception are guests of either family: a ping is both.
  ping: [{ proto: 'icmp', dport: '' }, { proto: 'icmpv6', dport: '' }],
  all: [{ proto: 'any', dport: '' }],
}

export const isExceptionService = (choice: string): choice is ExceptionServiceChoice =>
  (EXCEPTION_SERVICES as readonly string[]).includes(choice)

/** A whole protocol, which the orchestrator stores without port: "tcp", "UDP". Read back from a stored exception, never taken as typed input. */
function bareProtocol(text: string): ExceptionService | null {
  const proto = text.trim().toLowerCase()

  return proto === 'tcp' || proto === 'udp' ? { proto, dport: '' } : null
}

/**
 * True for a text the dialog may take as a service: a listed one, or a typed one as the gateway list of a zone takes
 * it ("tcp/8443", "icmp"). A whole protocol ("tcp", "udp") is refused as typed input: Enter pressed before the ports
 * would open every port. `exceptionServiceFlows` is wider: it also gives back a stored service this refuses (a whole
 * protocol among them), so that editing an exception never drops one.
 */
export const isExceptionServiceText = (text: string) => isExceptionService(text) || parseTypedService(text) !== null

/**
 * The services of a choice: those of a listed service, or the one a typed text is ("tcp/8443", "udp 5000:5010", as
 * the gateway list of a zone takes it, and a whole protocol a stored exception holds, "tcp"). Any other text is a service the orchestrator
 * stored and the dialog would not write (an unknown protocol, ports it cannot read): it is given back as it is,
 * protocol before the first "/", ports after, so that every choice of `servicesToChoices` maps back to its service.
 * The dialog checks what a person types with `isExceptionServiceText`. None for an empty text.
 */
export function exceptionServiceFlows(choice: string): ExceptionService[] {
  if (isExceptionService(choice)) return EXCEPTION_SERVICE_FLOWS[choice].map(f => ({ ...f }))
  const typed = parseTypedService(choice) ?? bareProtocol(choice)
  if (typed) return [typed]
  if (!choice.trim()) return []
  const slash = choice.indexOf('/')

  return [slash < 0 ? { proto: choice, dport: '' } : { proto: choice.slice(0, slash), dport: choice.slice(slash + 1) }]
}

/** The ports of a choice as a list shows them: "tcp/5432", "icmp, icmpv6", "any". */
export const exceptionServicePorts = (choice: string) => exceptionServiceFlows(choice).map(serviceText).join(', ')

const serviceKey = (s: ExceptionService) => `${s.proto}/${s.dport}`

/** "tcp/8443", "icmp", "tcp": the stored protocol and ports, the text `exceptionServiceFlows` reads back as this service. */
const serviceText = (s: ExceptionService) => (s.dport ? `${s.proto}/${s.dport}` : s.proto)

/**
 * The choices of the dialog for stored services, the inverse of `exceptionServiceFlows`: a listed service when all its
 * flows are there (ICMP and ICMPv6 together are "ping", one of them alone stays "icmp" or "icmpv6"), the text of the
 * service ("tcp/8443", "tcp" for the whole protocol) for the others, whatever was stored: no service is left out.
 * In the order of the input, a choice at the place of its first service, each one once.
 */
export function servicesToChoices(services: readonly ExceptionService[]): string[] {
  const present = new Set(services.map(serviceKey))
  const taken = new Set<string>()
  const choices: string[] = []

  for (const s of services) {
    const key = serviceKey(s)
    if (taken.has(key)) continue
    const listed = EXCEPTION_SERVICES.find(c => {
      const flows = EXCEPTION_SERVICE_FLOWS[c]

      return flows.some(f => serviceKey(f) === key) && flows.every(f => present.has(serviceKey(f)))
    })
    if (listed) {
      for (const f of EXCEPTION_SERVICE_FLOWS[listed]) taken.add(serviceKey(f))
      choices.push(listed)
    } else {
      taken.add(key)
      choices.push(serviceText(s))
    }
  }

  return choices
}

/** The most rules one exception may compile to; beyond it the orchestrator refuses the exception (a flow of the zone fits better). */
export const MAX_EXCEPTION_RULES = 50

/**
 * The rules an exception compiles to: one per source, destination and service. `services` counts the stored services
 * (`exceptionServiceFlows`), not the choices of the dialog: a ping is two.
 */
export function exceptionRuleCount(sources: number, destinations: number, services: number): number {
  return sources * destinations * services
}

export type ExceptionStatus = 'active' | 'inactive_zone' | 'no_destination' | 'missing_guest' | 'waiting_address' | 'renamed'

/**
 * What state an exception is in, the first that applies:
 * - `inactive_zone`: the zone is neither observed nor enforced, so nothing of it is written;
 * - `no_destination`: none of its destinations is among `members` (the members the panel shows, pending ones included);
 * - `missing_guest`: a source or a destination is not in the inventory;
 * - `waiting_address`: a source of the inventory has no known address yet, so its rules match nothing; never said when
 *   no guest of the list carries an address (the list read without the inventory, which gives none);
 * - `renamed`: a source or a destination does not have the name it was recorded with (renamed, or its VMID reused);
 *   a guest recorded without a name (an exception written through the API) is never one;
 * - `active` otherwise.
 * Guests are matched by type and vmid.
 */
export function exceptionStatus(
  e: MicrosegException,
  zone: Pick<MicrosegZone, 'state'>,
  members: readonly ZoneMember[],
  guests: readonly PolicyGuest[],
): ExceptionStatus {
  if (zone.state !== 'observe' && zone.state !== 'enforce') return 'inactive_zone'

  const memberKeys = new Set(members.map(m => guestKey(m.ref)))
  if (!e.destinations.some(d => memberKeys.has(guestKey(d)))) return 'no_destination'

  const inventory = new Map(guests.map(g => [guestKey(g), g]))
  const named = [...e.sources, ...e.destinations]
  if (named.some(r => !inventory.has(guestKey(r)))) return 'missing_guest'
  const addressed = guests.some(g => g.ips?.length)
  if (addressed && e.sources.some(r => !inventory.get(guestKey(r))?.ips?.length)) return 'waiting_address'
  if (named.some(r => r.name !== '' && inventory.get(guestKey(r))?.name !== r.name)) return 'renamed'

  return 'active'
}

/** A status a list says: every one but `active`. */
export type ExceptionIssue = Exclude<ExceptionStatus, 'active'>

/**
 * The status a list says of an exception, null when it says none: nothing for an active one, and nothing that reads
 * the guest list while that list is unknown (loading or failed), which leaves the zone that is not applied.
 */
export function shownExceptionStatus(status: ExceptionStatus, guestsKnown: boolean): ExceptionIssue | null {
  if (status === 'active') return null

  return guestsKnown || status === 'inactive_zone' ? status : null
}

export function exceptionsOfZone(zoneId: string, exceptions: readonly MicrosegException[]): MicrosegException[] {
  return exceptions.filter(e => e.zone_id === zoneId)
}

/**
 * What the confirmation of a zone deletion says: the exceptions of the zone are deleted with it (the orchestrator
 * drops them in the same write), so their number is told when it has some. `t` reads `microsegPilot.policy`.
 */
export function zoneDeleteBody(t: (key: string, values?: Record<string, number>) => string, zoneId: string, exceptions: readonly MicrosegException[]): string {
  const count = exceptionsOfZone(zoneId, exceptions).length
  return count > 0 ? t('delete.zoneBodyExceptions', { count }) : t('delete.zoneBody')
}

/**
 * How a list names an exception: "app-01, app-02 → db-01 · postgresql". Guests by their inventory name, the recorded
 * one for a guest that is gone (its VMID when it has neither). The services are the choices of `servicesToChoices`:
 * the id of a listed service ("postgresql", "ping", "all") or the text of a typed one ("tcp/8443"). The function
 * knows no translation: a caller that shows the label passes `serviceName` to turn each choice into its display name.
 */
export function exceptionLabel(
  e: MicrosegException,
  guests: readonly PolicyGuest[],
  serviceName: (choice: string) => string = choice => choice,
): string {
  const names = (refs: GuestRefLite[]) => namedGuests(refs, guests).map(n => n.name).join(', ')

  return `${names(e.sources)} → ${names(e.destinations)} · ${servicesToChoices(e.services).map(serviceName).join(', ')}`
}

/** A guest an exception names, as a list shows it: its guest of the inventory when it is still there, and its name. */
export type NamedGuest = {
  key: string
  vmid: number
  /** The inventory name, the recorded one for a guest that is gone, its VMID when it has neither. */
  name: string
  guest: PolicyGuest | undefined
}

/** The guests of one side of an exception, in their order, each with its guest of the inventory and its name. */
export function namedGuests(refs: readonly GuestRefLite[], guests: readonly PolicyGuest[]): NamedGuest[] {
  const inventory = new Map(guests.map(g => [guestKey(g), g]))

  return refs.map(r => {
    const guest = inventory.get(guestKey(r))

    return { key: guestKey(r), vmid: r.vmid, name: guest?.name || r.name || String(r.vmid), guest }
  })
}

/**
 * An exception as the dialogs edit it: its guests in the order they were picked, its services as the choices of the
 * dialog (`servicesToChoices`). Without `id` it is not written yet.
 */
export type ExceptionDraft = { id?: string; sources: GuestRefLite[]; destinations: GuestRefLite[]; services: string[]; comment: string }

/** The draft of a stored exception: same guests and services, in the stored order. */
export function exceptionDraft(e: MicrosegException): ExceptionDraft {
  return {
    id: e.id,
    sources: e.sources.map(r => ({ ...r })),
    destinations: e.destinations.map(r => ({ ...r })),
    services: servicesToChoices(e.services),
    comment: e.comment,
  }
}

/** The one guest of the inventory that carries an address; null when none does, or when two do (the flow is then of no guest for sure). */
function guestOfAddress(ip: string, guests: readonly PolicyGuest[]): PolicyGuest | null {
  if (!ip) return null
  const carriers = guests.filter(g => g.ips?.includes(ip))

  return carriers.length === 1 ? carriers[0] : null
}

/**
 * The exception an observed flow would be, for "allow this flow only": the guest that sent it to the guest that
 * received it, on the observed service (a listed one by its id, another as its text, "tcp/8443"). Null when the flow
 * is not one an exception can name: an outbound flow, an address that is not of exactly one guest of the inventory
 * (a guest list read without the inventory carries no address), both addresses of one guest, a destination that is
 * not among `members` (the members of the destination zone of the flow, pending ones included), or a service the
 * dialog would not take (a whole protocol, an unknown one).
 */
export function exceptionFromSuggestion(s: MicrosegSuggestion, guests: readonly PolicyGuest[], members: readonly ZoneMember[]): ExceptionDraft | null {
  if (s.direction === 'out' || !s.dst_zone_id) return null
  const source = guestOfAddress(s.src_ip, guests)
  const destination = guestOfAddress(s.dst_ip, guests)
  if (!source || !destination || guestKey(source) === guestKey(destination)) return null
  if (!members.some(m => guestKey(m.ref) === guestKey(destination))) return null
  const [service] = servicesToChoices([{ proto: s.proto.trim().toLowerCase(), dport: s.dport.trim() }])
  if (!isExceptionServiceText(service)) return null
  const ref = ({ type, vmid, name }: PolicyGuest): GuestRefLite => ({ type, vmid, name })

  return { sources: [ref(source)], destinations: [ref(destination)], services: [service], comment: '' }
}

/**
 * True when an exception of the zone already allows what the draft would: every source, destination and service of
 * the draft is in one stored exception of `zoneId`. "Allow this flow only" is then not offered again (the suggestion
 * stays pending until the exception is applied).
 */
export function exceptionCovered(draft: Pick<ExceptionDraft, 'sources' | 'destinations' | 'services'>, zoneId: string, exceptions: readonly MicrosegException[]): boolean {
  const wanted = draftServices(draft.services).map(serviceKey)

  return exceptionsOfZone(zoneId, exceptions).some(e => {
    const sources = new Set(e.sources.map(guestKey))
    const destinations = new Set(e.destinations.map(guestKey))
    const services = new Set(e.services.map(serviceKey))

    return draft.sources.every(r => sources.has(guestKey(r))) && draft.destinations.every(r => destinations.has(guestKey(r))) && wanted.every(k => services.has(k))
  })
}

/**
 * The services the choices of a draft are stored as, in the order of the choices, each one once: "postgresql" and a
 * typed "tcp/5432" are one service (the orchestrator refuses a service named twice).
 */
export function draftServices(choices: readonly string[]): ExceptionService[] {
  const flows = choices.flatMap(exceptionServiceFlows)

  return flows.filter((f, i) => flows.findIndex(o => serviceKey(o) === serviceKey(f)) === i)
}

/** The rules a draft compiles to, counted on the services it is stored as. */
export function draftRuleCount(draft: Pick<ExceptionDraft, 'sources' | 'destinations' | 'services'>): number {
  return exceptionRuleCount(draft.sources.length, draft.destinations.length, draftServices(draft.services).length)
}

/** The guests a draft names on both sides: an exception takes a guest as a source or as a destination, not both. */
export function draftOverlap(draft: Pick<ExceptionDraft, 'sources' | 'destinations'>): GuestRefLite[] {
  const destinations = new Set(draft.destinations.map(guestKey))

  return draft.sources.filter(r => destinations.has(guestKey(r)))
}

/** What a draft is written as: its guests and comment as they are, its services as they are stored. */
export function draftBody(draft: ExceptionDraft): Pick<MicrosegException, 'sources' | 'destinations' | 'services' | 'comment'> {
  return {
    sources: draft.sources.map(({ type, vmid, name }) => ({ type, vmid, name })),
    destinations: draft.destinations.map(({ type, vmid, name }) => ({ type, vmid, name })),
    services: draftServices(draft.services),
    comment: draft.comment,
  }
}

/** True when writing the draft would change the stored exception: the orchestrator compares guests and services in order. */
export function draftChanged(draft: ExceptionDraft, stored: MicrosegException): boolean {
  const { sources, destinations, services, comment } = stored

  return JSON.stringify(draftBody(draft)) !== JSON.stringify(draftBody({ sources, destinations, services: servicesToChoices(services), comment }))
}

/** A draft read as an exception of `zoneId`, for what takes one (`exceptionLabel`, `exceptionStatus`). */
export function draftException(draft: ExceptionDraft, zoneId: string): MicrosegException {
  return { id: draft.id ?? '', policy_id: '', zone_id: zoneId, created_by: '', ...draftBody(draft) }
}

/** The display name of a listed service that is a product or protocol name, the same in every language; "ping" and "all" are translated by the caller. */
export const EXCEPTION_SERVICE_NAMES: Partial<Record<ExceptionServiceChoice, string>> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL', redis: 'Redis', mongodb: 'MongoDB', http: 'HTTP', https: 'HTTPS', ssh: 'SSH', rdp: 'RDP', smb: 'SMB',
  ldap: 'LDAP', ldaps: 'LDAPS',
}

/**
 * True when a draft answers a filter text: the text is in the name or the VMID of one of its guests, or in one of its
 * services (the display name `serviceName` gives, the choice itself, or its ports: "postgres", "tcp/8443", "5432").
 * Whatever the case; an empty text matches every draft.
 */
export function draftMatches(
  draft: Pick<ExceptionDraft, 'sources' | 'destinations' | 'services'>,
  guests: readonly PolicyGuest[],
  serviceName: (choice: string) => string,
  text: string,
): boolean {
  const wanted = text.trim().toLowerCase()
  if (!wanted) return true
  const named = namedGuests([...draft.sources, ...draft.destinations], guests).flatMap(n => [n.name, String(n.vmid)])
  const services = draft.services.flatMap(choice => [serviceName(choice), choice, exceptionServicePorts(choice)])

  return [...named, ...services].some(value => value.toLowerCase().includes(wanted))
}
