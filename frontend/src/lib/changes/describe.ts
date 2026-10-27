/**
 * A change read the way an admin says it: `Memory 2 GB → 4 GB`, `+ scsi1 32 GB`,
 * `net0 e1000 → virtio`, rather than the raw Proxmox config lines. The raw
 * diffs stay one click away in the row details; this is the one-line summary.
 */

import type { ChangeFieldDiff } from './csv'

/**
 * An i18n key under `changes.diff`, optionally after the raw key it belongs to
 * (`net0 Firewall`), or a raw Proxmox key shown as is.
 */
export type FactLabel = { key: string; of?: string } | { text: string }

export type DiffFact =
  | { kind: 'recreated' }
  | { kind: 'changed'; label: FactLabel; from: string; to: string }
  | { kind: 'added'; label: FactLabel; value?: string }
  | { kind: 'removed'; label: FactLabel; value?: string }
  | { kind: 'modified'; label: FactLabel }
  | { kind: 'toggled'; label: FactLabel; on: boolean }

/** The sections a change's details are laid out in, in display order. */
export const FACT_GROUPS = ['general', 'compute', 'disks', 'network', 'cloudinit', 'snapshots', 'other'] as const
export type FactGroup = (typeof FACT_GROUPS)[number]

export type DescribeFormat = {
  /** A size in bytes, unit-labelled for the reader's locale */
  bytes: (n: number) => string
}

// Lines Proxmox rewrites on its own: identity stamps, digests, locks. They say
// nothing to the reader; a new `meta` ctime is read as a re-creation instead.
const SILENT = new Set(['meta', 'vmgenid', 'smbios1', 'digest', 'lock', 'parent'])

const MIB_FIELDS: Record<string, string> = { memory: 'memory', swap: 'swap', balloon: 'balloon' }
const PLAIN_FIELDS: Record<string, string> = {
  cores: 'cores', sockets: 'sockets', vcpus: 'vcpus', cpulimit: 'cpulimit', cpu: 'cpu',
  name: 'name', hostname: 'name', ostype: 'ostype', machine: 'machine', bios: 'bios',
  nameserver: 'nameserver', searchdomain: 'searchdomain', ciuser: 'ciuser'
}
const TOGGLE_FIELDS: Record<string, string> = { onboot: 'onboot', protection: 'protection', template: 'template', numa: 'numa', agent: 'agent' }
const SECRET_FIELDS: Record<string, string> = { cipassword: 'password', sshkeys: 'sshkeys', description: 'description' }
const SET_FIELDS: Record<string, { label: string; sep: RegExp }> = {
  tags: { label: 'tag', sep: /[;, ]+/ },
  snapshots: { label: 'snapshot', sep: /[;, ]+/ }
}

const DISK = /^(scsi|sata|ide|virtio|efidisk|tpmstate|mp|unused)\d+$|^rootfs$/
const NET = /^net\d+$/
const IPCONFIG = /^ipconfig\d+$/
const NIC_MODELS = new Set(['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3', 'ne2k_pci', 'ne2k_isa', 'i82551', 'i82557b', 'i82559er', 'pcnet'])

// A generic value is shown only while it stays readable on one line
const SHORT = 32

const ORDER: Record<string, number> = { recreated: 0, name: 1, memory: 2, swap: 2, balloon: 2, cores: 2, sockets: 2, vcpus: 2, cpulimit: 2, cpu: 2, disk: 3, net: 4, boot: 6 }

type Ranked = { rank: number; fact: DiffFact }

const GENERAL = new Set(['name', 'hostname', 'ostype', 'machine', 'bios', 'description', 'tags', 'template', 'protection', 'onboot', 'startup', 'agent', 'boot', 'meta'])
const COMPUTE = new Set(['memory', 'swap', 'balloon', 'cores', 'sockets', 'vcpus', 'cpulimit', 'cpuunits', 'cpu', 'numa'])
const NETWORK = new Set(['nameserver', 'searchdomain'])
const CLOUDINIT = new Set(['ciuser', 'cipassword', 'sshkeys', 'citype', 'cicustom', 'ciupgrade'])

function groupOf(field: string): FactGroup {
  if (GENERAL.has(field)) return 'general'
  if (COMPUTE.has(field)) return 'compute'
  if (DISK.test(field)) return 'disks'
  if (NET.test(field) || IPCONFIG.test(field) || NETWORK.has(field)) return 'network'
  if (CLOUDINIT.has(field)) return 'cloudinit'
  if (field === 'snapshots') return 'snapshots'

  return 'other'
}

/** Proxmox `key=value,key=value` options, the first bare part under `''`. */
function options(value: string): Record<string, string> {
  const out: Record<string, string> = {}

  value.split(',').forEach((part, i) => {
    const eq = part.indexOf('=')

    if (eq < 0) {
      if (i === 0) out[''] = part
      else out[part] = ''
    } else {
      out[part.slice(0, eq)] = part.slice(eq + 1)
    }
  })

  return out
}

const SIZE_UNITS: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }

/** `25G`, `512M`, `4M` as bytes; a bare number reads as bytes. */
export function parseSize(size: string | undefined): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([KMGT])?$/i.exec(size || '')

  if (!m) return undefined

  return Number(m[1]) * (m[2] ? SIZE_UNITS[m[2].toUpperCase()] : 1)
}

type Disk = { storage: string; volume: string; size?: number; cdrom: boolean; iso?: string }

function parseDisk(value: string): Disk {
  const o = options(value)
  const volume = o[''] || ''
  const storage = volume.includes(':') ? volume.slice(0, volume.indexOf(':')) : volume
  const cdrom = o.media === 'cdrom'
  const iso = cdrom && volume !== 'none' ? volume.slice(volume.lastIndexOf('/') + 1) || volume : undefined

  return { storage, volume, size: parseSize(o.size), cdrom, iso }
}

type Nic = { model?: string; bridge?: string; tag?: string; mac?: string; ip?: string; firewall: boolean; linkDown: boolean; mtu?: string; rate?: string }

function parseNic(value: string): Nic {
  const o = options(value)
  const model = Object.keys(o).find(k => NIC_MODELS.has(k))

  return {
    model,
    bridge: o.bridge,
    tag: o.tag,
    mac: model ? o[model] : o.hwaddr,
    ip: o.ip,
    firewall: o.firewall === '1',
    linkDown: o.link_down === '1',
    mtu: o.mtu,
    rate: o.rate
  }
}

const label = (key: string): FactLabel => ({ key })
const raw = (text: string): FactLabel => ({ text })

function describeDisk(field: string, from: string, to: string, fmt: DescribeFormat): DiffFact[] {
  const name = raw(field)

  if (!from || !to) {
    const d = parseDisk(from || to)
    const value = d.cdrom
      ? d.iso
      : [d.size !== undefined ? fmt.bytes(d.size) : '', d.storage].filter(Boolean).join(' · ')

    return [from ? { kind: 'removed', label: name, value: value || undefined } : { kind: 'added', label: name, value }]
  }

  const a = parseDisk(from)
  const b = parseDisk(to)

  if (a.cdrom || b.cdrom) {
    if (a.iso === b.iso) return [{ kind: 'modified', label: name }]
    if (!b.iso) return [{ kind: 'removed', label: name, value: a.iso }]

    return [a.iso ? { kind: 'changed', label: name, from: a.iso, to: b.iso } : { kind: 'added', label: name, value: b.iso }]
  }

  const facts: DiffFact[] = []

  if (a.storage !== b.storage) facts.push({ kind: 'changed', label: { key: 'storage', of: field }, from: a.storage, to: b.storage })
  if (a.size !== b.size && a.size !== undefined && b.size !== undefined) {
    facts.push({ kind: 'changed', label: { key: 'size', of: field }, from: fmt.bytes(a.size), to: fmt.bytes(b.size) })
  }

  return facts.length ? facts : [{ kind: 'modified', label: name }]
}

function describeNic(field: string, from: string, to: string): DiffFact[] {
  const name = raw(field)

  if (!from || !to) {
    const n = parseNic(from || to)
    const value = [n.bridge, n.tag ? `VLAN ${n.tag}` : ''].filter(Boolean).join(' · ') || undefined

    return [{ kind: from ? 'removed' : 'added', label: name, value }]
  }

  const a = parseNic(from)
  const b = parseNic(to)
  const facts: DiffFact[] = []

  if (a.model !== b.model && a.model && b.model) facts.push({ kind: 'changed', label: { key: 'model', of: field }, from: a.model, to: b.model })
  if (a.bridge !== b.bridge) facts.push({ kind: 'changed', label: { key: 'bridge', of: field }, from: a.bridge || '-', to: b.bridge || '-' })
  if (a.tag !== b.tag) facts.push({ kind: 'changed', label: { key: 'vlan', of: field }, from: a.tag || '-', to: b.tag || '-' })
  if (a.ip !== b.ip) facts.push({ kind: 'changed', label: { key: 'ip', of: field }, from: a.ip || '-', to: b.ip || '-' })
  if (a.firewall !== b.firewall) facts.push({ kind: 'toggled', label: { key: 'firewall', of: field }, on: b.firewall })
  if (a.linkDown !== b.linkDown) facts.push({ kind: 'toggled', label: { key: 'link', of: field }, on: !b.linkDown })
  if (a.mtu !== b.mtu) facts.push({ kind: 'changed', label: { key: 'mtu', of: field }, from: a.mtu || '-', to: b.mtu || '-' })
  if (a.rate !== b.rate) facts.push({ kind: 'changed', label: { key: 'rate', of: field }, from: a.rate || '-', to: b.rate || '-' })
  if (!facts.length && a.mac !== b.mac) facts.push({ kind: 'changed', label: { key: 'mac', of: field }, from: a.mac || '-', to: b.mac || '-' })

  return facts.length ? facts : [{ kind: 'modified', label: name }]
}

function describeSet(field: string, from: string, to: string): DiffFact[] {
  const { label: key, sep } = SET_FIELDS[field]
  const a = new Set(from.split(sep).filter(Boolean))
  const b = new Set(to.split(sep).filter(Boolean))

  return [
    ...[...b].filter(v => !a.has(v)).map((value): DiffFact => ({ kind: 'added', label: label(key), value })),
    ...[...a].filter(v => !b.has(v)).map((value): DiffFact => ({ kind: 'removed', label: label(key), value }))
  ]
}

const isOn = (value: string) => value === '1' || /(^|,)enabled=1(,|$)/.test(value)

function describeGeneric(lbl: FactLabel, from: string, to: string): DiffFact {
  if (from.length > SHORT || to.length > SHORT) return { kind: 'modified', label: lbl }
  if (!from) return { kind: 'added', label: lbl, value: to }
  if (!to) return { kind: 'removed', label: lbl, value: from }

  return { kind: 'changed', label: lbl, from, to }
}

function ctime(meta: string): string | undefined {
  return options(meta).ctime
}

function describeField(f: ChangeFieldDiff, fmt: DescribeFormat): Ranked[] {
  const field = f.field || ''
  const from = f.oldValue ?? ''
  const to = f.newValue ?? ''
  const at = (rank: number) => (fact: DiffFact): Ranked => ({ rank, fact })

  if (from === to) return []

  if (field === 'meta') {
    const a = ctime(from)
    const b = ctime(to)

    return a && b && a !== b ? [{ rank: ORDER.recreated, fact: { kind: 'recreated' } }] : []
  }

  if (SILENT.has(field)) return []

  if (MIB_FIELDS[field]) {
    const mib = (v: string) => (v ? fmt.bytes(Number(v) * 1024 ** 2) : '')
    const fact = describeGeneric(label(MIB_FIELDS[field]), mib(from), mib(to))

    return [at(ORDER[field])(fact)]
  }

  if (PLAIN_FIELDS[field]) {
    const key = PLAIN_FIELDS[field]

    return [at(ORDER[key] ?? 5)(describeGeneric(label(key), from, to))]
  }

  if (TOGGLE_FIELDS[field]) {
    const on = isOn(to)

    // `agent: 1` and `agent: enabled=1` are the same setting
    if (isOn(from) === on) return []

    return [at(5)({ kind: 'toggled', label: label(TOGGLE_FIELDS[field]), on })]
  }

  if (SECRET_FIELDS[field]) return [at(5)({ kind: 'modified', label: label(SECRET_FIELDS[field]) })]
  if (SET_FIELDS[field]) return describeSet(field, from, to).map(at(5))
  if (DISK.test(field)) return describeDisk(field, from, to, fmt).map(at(ORDER.disk))
  if (NET.test(field)) return describeNic(field, from, to).map(at(ORDER.net))

  if (field === 'boot') {
    const order = (v: string) => (options(v).order || v).split(';').join(', ')

    return [at(ORDER.boot)(describeGeneric(label('boot'), order(from), order(to)))]
  }

  if (IPCONFIG.test(field)) {
    const ip = (v: string) => options(v).ip || v

    return [at(ORDER.net)(describeGeneric(raw(field), ip(from), ip(to)))]
  }

  return [at(5)(describeGeneric(raw(field), from, to))]
}

function ranked(fields: readonly ChangeFieldDiff[] | undefined, fmt: DescribeFormat) {
  return (fields || [])
    .flatMap(f => describeField(f, fmt).map(r => ({ ...r, group: groupOf(f.field || '') })))
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
}

/** The facts a change's field diffs amount to, most telling first. */
export function describeChange(fields: readonly ChangeFieldDiff[] | undefined, fmt: DescribeFormat): DiffFact[] {
  return ranked(fields, fmt).map(r => r.fact)
}

export type GroupedFacts = {
  /** A new `meta` ctime: another guest took the ID, the old values are its predecessor's */
  recreated: boolean
  groups: { group: FactGroup; facts: DiffFact[] }[]
}

/** The same facts laid out by section, for the row details. */
export function describeGrouped(fields: readonly ChangeFieldDiff[] | undefined, fmt: DescribeFormat): GroupedFacts {
  const all = ranked(fields, fmt)
  const groups = FACT_GROUPS
    .map(group => ({ group, facts: all.filter(r => r.group === group && r.fact.kind !== 'recreated').map(r => r.fact) }))
    .filter(g => g.facts.length > 0)

  return { recreated: all.some(r => r.fact.kind === 'recreated'), groups }
}

export type GuestSpec = { vcpus?: number; memory?: string; disks: number; nics: number }

/**
 * A guest's size from a creation's new values or a deletion's old ones:
 * `4 vCPU · 4 GB · 2 disks · 1 NIC`.
 */
export function describeSpec(fields: readonly ChangeFieldDiff[] | undefined, side: 'before' | 'after', fmt: DescribeFormat): GuestSpec {
  const values = new Map((fields || []).map(f => [f.field || '', (side === 'after' ? f.newValue : f.oldValue) ?? '']))
  const num = (key: string) => (values.get(key) ? Number(values.get(key)) : undefined)
  const cores = num('cores')
  const memory = num('memory')
  const disks = [...values].filter(([k, v]) => v && DISK.test(k) && !k.startsWith('unused') && !/^(efidisk|tpmstate)/.test(k) && !parseDisk(v).cdrom)

  return {
    vcpus: num('vcpus') ?? (cores !== undefined ? cores * (num('sockets') ?? 1) : undefined),
    memory: memory !== undefined && !Number.isNaN(memory) ? fmt.bytes(memory * 1024 ** 2) : undefined,
    disks: disks.length,
    nics: [...values].filter(([k, v]) => v && NET.test(k)).length
  }
}

/**
 * The net diff of several changes on one resource, oldest first: each field
 * from its first old value to its last new value. A field that came back to
 * where it started drops out, which is what a burst of retries usually leaves.
 */
export function netFields(oldestFirst: readonly { fields?: ChangeFieldDiff[] }[]): ChangeFieldDiff[] {
  const net = new Map<string, ChangeFieldDiff>()

  for (const change of oldestFirst) {
    for (const f of change.fields || []) {
      const key = f.field || ''
      const seen = net.get(key)

      net.set(key, { field: key, oldValue: seen ? seen.oldValue : f.oldValue, newValue: f.newValue })
    }
  }

  return [...net.values()].filter(f => (f.oldValue ?? '') !== (f.newValue ?? ''))
}
