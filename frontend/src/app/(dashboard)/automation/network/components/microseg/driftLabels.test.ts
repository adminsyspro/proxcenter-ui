import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import type { MicrosegDrift } from '@/lib/microseg/types'

import de from '@/messages/de.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import ko from '@/messages/ko.json'
import zhCN from '@/messages/zh-CN.json'

import { DRIFT_KINDS, driftKey, driftLabel } from './driftLabels'

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
  { kind: 'egress_rule_verdict', guest, detail: { want: 'DROP', have: 'ACCEPT', reason: 'collision', object: 'pcz-_local' } },
  { kind: 'known_rule_missing', guest, object: 'pcz-_known' },
  { kind: 'known_rule_extra', guest, object: 'pcz-_known' },
  { kind: 'local_set_desync', object: 'pcz-_local', detail: { desired: ['10.0.0.0/24'], actual: [] } },
  { kind: 'egress_no_subnet', guest, detail: { zone: 'web' } },
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

describe('outbound drifts', () => {
  const t = translator('en')
  const by = (kind: string) => SAMPLES.filter(d => d.kind === kind)

  it('knows the 7 new kinds', () => {
    for (const kind of ['egress_rule_missing', 'egress_rule_misplaced', 'egress_rule_verdict', 'known_rule_missing', 'known_rule_extra', 'local_set_desync', 'egress_no_subnet']) {
      expect(DRIFT_KINDS as readonly string[]).toContain(kind)
    }
  })

  it('says that a zone cannot block when pcz-_local belongs to someone else', () => {
    const [plain, collided] = by('egress_rule_verdict')
    expect(driftLabel(plain, t).detail).toBe('The final outbound rule of qemu/101 is ACCEPT instead of DROP.')
    expect(driftLabel(collided, t).detail).toContain('cannot block')
    expect(driftLabel(collided, t).detail).toContain('pcz-_local')
    expect(driftLabel(collided, t).fix).toBeNull()
    expect(driftLabel(collided, t).hint).toBeTruthy()
    expect(driftLabel(by('egress_rule_missing')[1], t).detail).toContain('cannot block')
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
