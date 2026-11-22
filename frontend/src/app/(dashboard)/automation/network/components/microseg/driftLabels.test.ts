import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import type { MicrosegDrift } from '@/lib/microseg/types'

import de from '@/messages/de.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import ko from '@/messages/ko.json'
import zhCN from '@/messages/zh-CN.json'

import { CLUSTER_DRIFT_KINDS, DRIFT_KINDS, canIgnoreDrift, clusterDriftSubject, driftKey, driftLabel } from './driftLabels'
import { KIND_CHIP } from './DriftRow'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const translator = (locale: string) =>
  createTranslator({ locale, messages: locales[locale], namespace: 'microsegPilot.drifts.kind' }) as unknown as (k: string, v?: Record<string, string | number>) => string

const guest = { node: 'pve1', type: 'qemu', vmid: 101 } as const

const SAMPLES: MicrosegDrift[] = [
  { kind: 'unzoned_running', guest, detail: { name: 'web-1' } },
  { kind: 'nic_firewall_off', guest, detail: { nics: ['net0', 'net1'] } },
  { kind: 'foreign_accept', guest, detail: { pos: 3, source: '10.0.0.0/8', proto: 'tcp', dport: '22' } },
  { kind: 'foreign_accept', object: 'pcz-web', detail: { pos: 2 } },
  { kind: 'ipset_out_of_sync', object: 'pcz-web', detail: { desired: ['10.0.0.1/32'], actual: [] } },
  { kind: 'member_without_ip', guest, detail: { zone: 'web' } },
  { kind: 'ambiguous_zone', guest },
  { kind: 'object_collision', object: 'pcz-db' },
  { kind: 'egress_rule_missing', guest, detail: { zone: 'web' } },
  { kind: 'egress_rule_missing', guest, detail: { zone: 'web', reason: 'collision', object: 'pcz-_local' } },
  { kind: 'egress_rule_misplaced', guest, detail: { zone: 'web' } },
  { kind: 'egress_rule_misplaced', guest, object: 'pcz-_known', detail: { zone: 'web' } },
  { kind: 'egress_rule_verdict', guest, detail: { want: 'DROP', have: 'ACCEPT' } },
  { kind: 'egress_rule_verdict', guest, detail: { want_dest: '+pcz-_local', have_dest: '' } },
  { kind: 'egress_rule_verdict', guest, detail: { want_dest: '', have_dest: '+pcz-_local' } },
  { kind: 'egress_rule_verdict', guest, detail: { want_dest: '', have_dest: '10.0.0.0/8' } },
  { kind: 'egress_rule_verdict', guest, detail: { want: 'DROP', have: 'ACCEPT', reason: 'collision', object: 'pcz-_local' } },
  { kind: 'known_rule_missing', guest, object: 'pcz-_known' },
  { kind: 'known_rule_extra', guest, object: 'pcz-_known' },
  { kind: 'local_set_desync', object: 'pcz-_local', detail: { desired: ['10.0.0.0/24'], actual: [] } },
  { kind: 'egress_no_subnet', guest, detail: { zone: 'web' } },
  { kind: 'ipfilter_off', guest, detail: { zone: 'web', option: true, nics: ['net0'] } },
  { kind: 'ipfilter_off', guest, detail: { zone: 'web', option: false, nics: [] } },
  { kind: 'ipfilter_list_changed', guest, detail: { zone: 'web', nic: 'net0', missing: ['10.0.0.5'], extra: ['10.0.0.9'] } },
  { kind: 'ipfilter_no_address', guest, detail: { zone: 'web', nics: ['net1'] } },
  { kind: 'ipfilter_address_held', guest, detail: { zone: 'web', nic: 'net0', addr: '10.0.0.7', reason: 'guest', by: 'db-1' } },
  { kind: 'ipfilter_address_held', guest, detail: { zone: 'web', nic: 'net0', addr: '10.0.0.7', reason: 'peer', by: '' } },
  { kind: 'ipfilter_address_held', guest, detail: { zone: 'web', nic: 'net0', addr: '10.0.0.7', reason: 'source', by: '10.0.0.0/24' } },
  { kind: 'ipfilter_address_held', guest, detail: { zone: 'web', nic: 'net0', addr: '10.0.0.7', reason: 'contested', by: 'lxc/102', by_name: 'app-1' } },
  { kind: 'ipfilter_address_held', guest, detail: { zone: 'web', nic: 'net0', addr: '10.0.0.7', reason: 'contested', by: '' } },
  { kind: 'ipfilter_address_held', guest, detail: { zone: 'web', nic: 'net0', addr: '10.0.0.7', reason: 'later' } },
  { kind: 'ipfilter_manual', guest, detail: { zone: 'web', nics: ['net0'] } },
  { kind: 'unzoned_same_network', guest, detail: { name: 'stray-1', networks: ['vmbr0/20'], zones: ['web', 'db'] } },
]

describe('driftLabel', () => {
  it('labels every drift kind with a title and a detail, in the 6 locales', () => {
    expect(new Set(SAMPLES.map(s => s.kind))).toEqual(new Set(DRIFT_KINDS))
    for (const locale of Object.keys(locales)) {
      const t = translator(locale)
      for (const drift of SAMPLES) {
        const label = driftLabel(drift, t)
        expect(label.title.trim(), `${locale}: ${drift.kind} title`).not.toBe('')
        expect(label.detail.trim(), `${locale}: ${drift.kind} detail`).not.toBe('')
        expect(label.title, `${locale}: ${drift.kind}`).not.toMatch(/microsegPilot|\{|\}/)
        expect(label.detail, `${locale}: ${drift.kind}`).not.toMatch(/microsegPilot|\{|\}/)
        expect(label.fixable).toBe(label.fix !== null)
      }
    }
  })

  it('has a group header label for every drift kind, in the 6 locales, without an em-dash in French', () => {
    for (const locale of Object.keys(locales)) {
      const groups = locales[locale].microsegPilot.drifts.groups as Record<string, string>
      for (const kind of DRIFT_KINDS) {
        expect(groups[kind], `${locale}: groups.${kind}`).toBeTruthy()
        expect(groups[kind], `${locale}: groups.${kind}`).toContain('{count, number}')
        if (locale === 'fr') expect(groups[kind]).not.toContain('\u2014')
        if (locale !== 'en') expect(groups[kind], `${locale}: groups.${kind} left in English`).not.toBe(locales.en.microsegPilot.drifts.groups[kind])
      }
    }
  })

  it('gives the three drifts without a fix a hint on what to do in Proxmox, and the others none', () => {
    for (const locale of Object.keys(locales)) {
      const t = translator(locale)
      for (const drift of SAMPLES) {
        const label = driftLabel(drift, t)
        if (label.fix === null) expect(label.hint?.trim(), `${locale}: ${drift.kind} hint`).toBeTruthy()
        else expect(label.hint, `${locale}: ${drift.kind}`).toBeNull()
        if (label.hint) expect(label.hint, `${locale}: ${drift.kind}`).not.toMatch(/microsegPilot|\{|\}/)
      }
    }
    const en = translator('en')
    expect(driftLabel(SAMPLES[2], en).hint).toBe('An ACCEPT rule added outside micro-segmentation opens this guest: review it in Proxmox.')
    expect(driftLabel(SAMPLES[3], en).hint).toContain('this group')
    expect(driftLabel(SAMPLES[7], en).hint).toBe('An object named pcz-* exists in Proxmox without the micro-segmentation marker: rename or delete it in Proxmox.')
    expect(driftLabel(SAMPLES[5], en).hint).toBe('No IP known: install the QEMU guest agent or set an IP in cloud-init / the container network.')
  })

  it('writes the values of the drift in the detail', () => {
    const t = translator('en')
    expect(driftLabel(SAMPLES[0], t).detail).toContain('web-1')
    expect(driftLabel(SAMPLES[1], t).detail).toContain('net0, net1')
    expect(driftLabel(SAMPLES[2], t).detail).toContain('position 3 (10.0.0.0/8 SSH)')
    expect(driftLabel(SAMPLES[4], t).detail).toContain('pcz-web')
    expect(driftLabel(SAMPLES[5], t).detail).toContain('web')
  })

  it('names the group, not a guest, for a foreign rule found in one of our groups', () => {
    const t = translator('en')
    expect(driftLabel(SAMPLES[3], t).detail).toContain('group pcz-web')
    expect(driftLabel(SAMPLES[2], t).detail).not.toContain('group')
  })

  it('fixes unzoned and ambiguous guests by assigning them, the NIC and ipset drifts by the plan, the rest by nothing', () => {
    const t = translator('en')
    const fixes = Object.fromEntries(SAMPLES.map(s => [s.kind, driftLabel(s, t).fix]))
    expect(fixes).toEqual({
      unzoned_running: 'assign', ambiguous_zone: 'assign', nic_firewall_off: 'plan', foreign_accept: null,
      ipset_out_of_sync: 'plan', member_without_ip: null, object_collision: null,
      // The last sample of a kind wins: the collided ones have no fix (Proxmox holds it), the misplaced known rule is realigned.
      egress_rule_missing: null, egress_rule_misplaced: 'plan', egress_rule_verdict: null, known_rule_missing: 'plan',
      known_rule_extra: 'plan', local_set_desync: 'plan', egress_no_subnet: null,
      // The IP filter: what the plan realigns, the address the admin allows, the guest to assign, and the two the admin handles.
      ipfilter_off: 'plan', ipfilter_list_changed: 'plan', ipfilter_no_address: null, ipfilter_address_held: 'allow', ipfilter_manual: null,
      unzoned_same_network: 'assign',
    })
  })

  it('gives an unknown kind a generic label and no fix', () => {
    const label = driftLabel({ kind: 'something_new' }, translator('en'))
    expect(label.title).toBe('Drift: something_new')
    expect(label.detail).not.toBe('')
    expect(label.fixable).toBe(false)
    expect(label.fix).toBeNull()
    expect(label.hint).toBeNull()
  })
})

describe('driftKey', () => {
  it('tells apart two foreign rules of one guest or one group by position', () => {
    expect(driftKey({ kind: 'foreign_accept', guest, detail: { pos: 1 } })).not.toBe(driftKey({ kind: 'foreign_accept', guest, detail: { pos: 2 } }))
    expect(driftKey({ kind: 'foreign_accept', object: 'pcz-web', detail: { pos: 1 } })).not.toBe(driftKey({ kind: 'foreign_accept', object: 'pcz-web', detail: { pos: 2 } }))
  })

  it('ignores the node a guest runs on, like the backend', () => {
    expect(driftKey({ kind: 'ambiguous_zone', guest })).toBe(driftKey({ kind: 'ambiguous_zone', guest: { ...guest, node: 'pve2' } }))
  })
})

describe('IP filter drifts', () => {
  const t = translator('en')
  const by = (kind: string) => SAMPLES.filter(d => d.kind === kind)

  it('knows the six kinds, each with its chip in the 6 locales', () => {
    for (const kind of ['ipfilter_off', 'ipfilter_list_changed', 'ipfilter_no_address', 'ipfilter_address_held', 'ipfilter_manual', 'unzoned_same_network']) {
      expect(DRIFT_KINDS as readonly string[]).toContain(kind)
      expect(KIND_CHIP[kind], kind).toBeTruthy()
      for (const locale of Object.keys(locales)) expect(locales[locale].microsegPilot.drifts.chip[kind], `${locale}: chip.${kind}`).toBeTruthy()
    }
  })

  it('tells lists that are missing from an option taken off by hand', () => {
    const [lists, option] = by('ipfilter_off').map(d => driftLabel(d, t).detail)
    expect(lists).toBe('The IP filter is not applied on net0: this member of web can send from any address.')
    expect(option).toBe('The IP filter option was taken off this member of web: its lists no longer apply.')
  })

  it('says what a changed list misses and has in excess', () => {
    expect(driftLabel(by('ipfilter_list_changed')[0], t).detail).toBe('The list of net0 differs from the policy (missing: 10.0.0.5; in excess: 10.0.0.9).')
  })

  it('says who holds an address, by reason, and keeps a general sentence for a reason it does not know', () => {
    const [guestHeld, peer, source, contested, contestedPeer, unknown] = by('ipfilter_address_held').map(d => driftLabel(d, t))
    expect(guestHeld.detail).toBe('10.0.0.7 on net0 was not added: db-1, a member of another zone, holds it.')
    expect(peer.detail).toBe('10.0.0.7 on net0 was not added: a member of another zone on another cluster holds it.')
    expect(source.detail).toBe('10.0.0.7 on net0 was not added: it is inside the source network 10.0.0.0/24 of a flow.')
    expect(contested.detail).toBe('10.0.0.7 on net0 was not added: app-1 (102), a member of another zone, reports it too and neither holds it. Allow it for the guest it belongs to.')
    expect(contestedPeer.detail).toBe('10.0.0.7 on net0 was not added: a member of another zone on another cluster reports it too and neither holds it. Allow it for the guest it belongs to.')
    expect(unknown.detail).toBe('10.0.0.7 on net0 was not added to the list of this guest.')
    for (const label of [guestHeld, peer, source, unknown]) expect(label).toMatchObject({ fix: 'allow', fixable: true, hint: null })
  })

  it('leaves the member without an address and the hand-made list to the admin, with what to do', () => {
    expect(driftLabel(by('ipfilter_no_address')[0], t)).toMatchObject({ fix: null, detail: 'No address is known on net1: this member of web is not filtered.' })
    expect(driftLabel(by('ipfilter_no_address')[0], t).hint).toContain('additional address')
    expect(driftLabel(by('ipfilter_manual')[0], t)).toMatchObject({ fix: null })
    expect(driftLabel(by('ipfilter_manual')[0], t).hint).toContain('Nothing to do')
  })

  it('names the guest outside every zone, its networks and the zones it shares them with, and assigns it', () => {
    const label = driftLabel(by('unzoned_same_network')[0], t)
    expect(label.detail).toBe('stray-1 is in no zone and shares vmbr0/20 with web, db: it is not filtered.')
    expect(label.fix).toBe('assign')
  })

  it('keys an address held and a changed list per NIC and address, the other kinds as before', () => {
    const held = (addr: string): MicrosegDrift => ({ kind: 'ipfilter_address_held', guest, detail: { nic: 'net0', addr } })
    expect(driftKey(held('10.0.0.7'))).toBe('ipfilter_address_held|qemu/101|||net0|10.0.0.7')
    expect(driftKey(held('10.0.0.7'))).not.toBe(driftKey(held('10.0.0.8')))
    expect(driftKey({ kind: 'ipfilter_list_changed', guest, detail: { nic: 'net1' } })).toBe('ipfilter_list_changed|qemu/101|||net1|')
    expect(driftKey({ kind: 'ipfilter_off', guest, detail: { nics: ['net0'] } })).toBe('ipfilter_off|qemu/101||')
  })
})

describe('outbound drifts', () => {
  const t = translator('en')
  const by = (kind: string) => SAMPLES.filter(d => d.kind === kind)

  it('knows the 7 new kinds', () => {
    for (const kind of ['egress_rule_missing', 'egress_rule_misplaced', 'egress_rule_verdict', 'known_rule_missing', 'known_rule_extra', 'local_set_desync', 'egress_no_subnet']) {
      expect(DRIFT_KINDS as readonly string[]).toContain(kind)
    }
  })

  it('says that a zone cannot block when pcz-_local belongs to someone else', () => {
    const [plain, , , , collided] = by('egress_rule_verdict')
    expect(driftLabel(plain, t).detail).toBe('The final outbound rule of qemu/101 is ACCEPT instead of DROP.')
    expect(driftLabel(collided, t).detail).toContain('cannot block')
    expect(driftLabel(collided, t).detail).toContain('pcz-_local')
    expect(driftLabel(collided, t).fix).toBeNull()
    expect(driftLabel(collided, t).hint).toBeTruthy()
    expect(driftLabel(by('egress_rule_missing')[1], t).detail).toContain('cannot block')
  })

  it('says which destination a rule aims at, with an empty one as all destinations and pcz-_local as the local network', () => {
    const [, local, all, other] = by('egress_rule_verdict')
    expect(driftLabel(local, t).detail).toBe('The outbound rule of qemu/101 targets all destinations instead of the local network.')
    expect(driftLabel(all, t).detail).toBe('The outbound rule of qemu/101 targets the local network instead of all destinations.')
    expect(driftLabel(other, t).detail).toBe('The outbound rule of qemu/101 targets 10.0.0.0/8 instead of all destinations.')
    expect(driftLabel(local, t).fix).toBe('plan')
    for (const locale of Object.keys(locales)) {
      const detail = driftLabel(local, translator(locale)).detail
      expect(detail, locale).not.toMatch(/[{}]|MISSING/)
      expect(detail, locale).not.toContain('—')
    }
  })

  it('tells a misplaced known rule from a misplaced outbound rule, and fixes the realignable ones with the plan', () => {
    const [rule, known] = by('egress_rule_misplaced')
    expect(driftLabel(known, t).detail).toContain('known')
    expect(driftLabel(rule, t).detail).not.toContain('known')
    for (const kind of ['egress_rule_missing', 'egress_rule_misplaced', 'known_rule_missing', 'known_rule_extra', 'local_set_desync']) {
      expect(driftLabel(by(kind)[0], t).fix, kind).toBe('plan')
    }
    expect(driftLabel(by('egress_no_subnet')[0], t).fix).toBeNull()
  })
})

describe('a disabled outbound rule', () => {
  it('says "disabled" in the language of the user and keeps the PVE verdict names', () => {
    const drift: MicrosegDrift = { kind: 'egress_rule_verdict', guest, detail: { want: 'DROP', have: 'DISABLED' } }
    expect(driftLabel(drift, translator('en')).detail).toBe('The final outbound rule of qemu/101 is disabled instead of DROP.')
    expect(driftLabel(drift, translator('fr')).detail).toContain('désactivée')
    expect(driftLabel(drift, translator('fr')).detail).toContain('DROP')
  })
})

describe('drifts of the clusters of a shared policy', () => {
  const t = translator('en')
  const names: Record<string, string> = { c1: 'PVE-PROD', c2: 'PVE-DR' }
  // The lookup of the page gives back the bare ID for a cluster the user cannot see.
  const clusterName = (id: string) => names[id] ?? id
  const peer: MicrosegDrift = { kind: 'peer_unreadable', object: 'c2', detail: { name: 'backend-name-of-c2' } }
  const held: MicrosegDrift = { kind: 'stop_lift_held', object: 'c1', detail: { socle_rules: false } }

  it('says which associated cluster cannot be read, with the name the user knows, and offers no action', () => {
    const label = driftLabel(peer, t, clusterName)
    expect(label.detail).toBe('Cluster PVE-DR cannot be read: address removals are on hold')
    expect(label.title).toContain('PVE-DR')
    expect(label.fix).toBeNull()
    expect(label.fixable).toBe(false)
    expect(canIgnoreDrift(peer)).toBe(false)
  })

  it('never shows the name the backend sent, nor the ID, for a cluster the user cannot see', () => {
    const label = driftLabel({ ...peer, object: 'c9' }, t, clusterName)
    expect(label.detail).toBe('An associated cluster cannot be read: address removals are on hold')
    expect(`${label.title} ${label.detail} ${label.hint}`).not.toMatch(/backend-name|c9/)
  })

  it('says the cluster firewall stays off after a lifted stop, as an error without a fix nor an ignore', () => {
    const label = driftLabel(held, t, clusterName)
    expect(label.detail).toBe('Cluster firewall of PVE-PROD stays off: the node access rules must be checked before it is turned back on')
    expect(label.fix).toBeNull()
    expect(canIgnoreDrift(held)).toBe(false)
    expect(canIgnoreDrift({ kind: 'unzoned_running' })).toBe(true)
  })

  it('notes a removal held until every associated cluster can be read, without making it an error', () => {
    const label = driftLabel({ kind: 'ipset_out_of_sync', object: 'pcz-web', detail: { desired: [], actual: ['10.0.0.1/32'], held: true } }, t)
    expect(label.note).toBe('Removal on hold until every associated cluster can be read.')
    expect(label.fix).toBe('plan')
    expect(driftLabel({ kind: 'local_set_desync', object: 'pcz-_local', detail: { held: true } }, t).note).toBeTruthy()
    expect(driftLabel(SAMPLES[4], t).note).toBeNull()
  })

  it('labels both kinds in the 6 locales, with their group header and chip', () => {
    for (const locale of Object.keys(locales)) {
      const tl = translator(locale)
      for (const drift of [peer, held, { ...peer, object: 'c9' }]) {
        const label = driftLabel(drift, tl, clusterName)
        for (const text of [label.title, label.detail, label.hint ?? '']) expect(text, `${locale}: ${drift.kind}`).not.toMatch(/microsegPilot|\{|\}|\u2014/)
        expect(label.hint?.trim(), `${locale}: ${drift.kind} hint`).toBeTruthy()
      }
      for (const kind of CLUSTER_DRIFT_KINDS) {
        expect(locales[locale].microsegPilot.drifts.groups[kind], `${locale}: groups.${kind}`).toContain('{count, number}')
        expect(locales[locale].microsegPilot.drifts.chip[kind], `${locale}: chip.${kind}`).toBeTruthy()
        if (locale !== 'en') expect(locales[locale].microsegPilot.drifts.groups[kind]).not.toBe(locales.en.microsegPilot.drifts.groups[kind])
      }
    }
  })
})

describe('drifts about a firewall that filters nothing', () => {
  const t = translator('en')
  const names: Record<string, string> = { c1: 'PVE-PROD' }
  const clusterName = (id: string) => names[id] ?? id
  const off: MicrosegDrift = { kind: 'cluster_firewall_off', object: 'c1', detail: { name: 'backend-name' } }
  const service: MicrosegDrift = { kind: 'firewall_service_stopped', object: 'pve2', detail: { node: 'pve2' } }

  it('names the cluster as the user knows it, in one line, with no fix and no ignore', () => {
    const label = driftLabel(off, t, clusterName)
    expect(label.title).toBe('Cluster firewall of PVE-PROD is off')
    expect(label.detail).toBe('Cluster firewall of PVE-PROD is off: nothing is filtered there')
    expect(label.fix).toBeNull()
    expect(canIgnoreDrift(off)).toBe(false)
    expect(clusterDriftSubject(off, 'Another cluster', clusterName)).toBe('PVE-PROD')
  })

  it('names a cluster outside the scope in general words, never by ID nor by the name the backend sent', () => {
    const label = driftLabel({ ...off, object: 'c9' }, t, clusterName)
    expect(label.detail).toBe('The cluster firewall of an associated cluster is off: nothing is filtered there')
    expect(`${label.title} ${label.detail} ${label.hint}`).not.toMatch(/backend-name|c9/)
  })

  it('names the node whose firewall service is stopped', () => {
    const label = driftLabel(service, t, clusterName)
    expect(label.title).toBe('Firewall service stopped on pve2')
    expect(label.detail).toBe('The firewall service is stopped on pve2: nothing is filtered on this node')
    expect(label.fix).toBeNull()
    expect(canIgnoreDrift(service)).toBe(false)
    expect(clusterDriftSubject(service, 'Another cluster', clusterName)).toBe('pve2')
  })

  it('is as severe as the most severe existing kind', () => {
    expect(KIND_CHIP.cluster_firewall_off.color).toBe('error')
    expect(KIND_CHIP.firewall_service_stopped.color).toBe('error')
    expect(CLUSTER_DRIFT_KINDS).toContain('cluster_firewall_off')
    expect(CLUSTER_DRIFT_KINDS).toContain('firewall_service_stopped')
  })

  it('is labelled in the 6 locales without a placeholder left', () => {
    for (const locale of Object.keys(locales)) {
      const tl = translator(locale)
      for (const drift of [off, service, { ...off, object: 'c9' }]) {
        const label = driftLabel(drift, tl, clusterName)
        for (const text of [label.title, label.detail, label.hint ?? '']) expect(text, `${locale}: ${drift.kind}`).not.toMatch(/microsegPilot|\{|\}|\u2014/)
        expect(label.hint?.trim(), `${locale}: ${drift.kind} hint`).toBeTruthy()
      }
    }
  })
})
