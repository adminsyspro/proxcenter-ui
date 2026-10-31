/**
 * The clickable choices of an ambiguous target (roadmap#188): what the routes
 * lift from the trace and what the drawer keeps of what it reads back.
 */

import { describe, expect, it } from 'vitest'

import { collectTargetChoices, consultedOk, MAX_CHOICE_TEXT, sanitizeTargetChoice, sanitizeTargetChoices } from './choices'

const guest = (vmid: number) => ({ kind: 'guest' as const, guestKind: 'qemu' as const, label: `vm · #${vmid}`, reply: `vm (vmid ${vmid}, pve1, PVE-PROD)` })

describe('sanitizeTargetChoice', () => {
  it('keeps the typed fields only', () => {
    expect(sanitizeTargetChoice({ ...guest(1), extra: '<script>' })).toEqual(guest(1))
    expect(sanitizeTargetChoice({ kind: 'cluster', label: 'PVE-PROD', reply: 'PVE-PROD', guestKind: 'lxc' })).toEqual({ kind: 'cluster', label: 'PVE-PROD', reply: 'PVE-PROD' })
    expect(sanitizeTargetChoice({ ...guest(1), guestKind: 'docker' })).toEqual({ kind: 'guest', label: 'vm · #1', reply: 'vm (vmid 1, pve1, PVE-PROD)' })
  })

  it.each([
    ['an unknown kind', { kind: 'storage', label: 'a', reply: 'a' }],
    ['a missing reply', { kind: 'host', label: 'a' }],
    ['a blank label', { kind: 'host', label: '  ', reply: 'a' }],
    ['a label past the limit', { kind: 'host', label: 'x'.repeat(MAX_CHOICE_TEXT + 1), reply: 'a' }],
    ['a reply past the limit', { kind: 'host', label: 'a', reply: 'x'.repeat(MAX_CHOICE_TEXT + 1) }],
    ['a control character', { kind: 'host', label: 'a', reply: 'pve1\nreboot pve2' }],
    ['a non-string text', { kind: 'host', label: 1, reply: 'a' }],
    ['not an object', 'pve1'],
    ['an array', [1]],
  ])('drops %s', (_label, raw) => {
    expect(sanitizeTargetChoice(raw)).toBeNull()
  })

  it('takes a text exactly at the limit', () => {
    expect(sanitizeTargetChoice({ kind: 'host', label: 'x'.repeat(MAX_CHOICE_TEXT), reply: 'a' })).not.toBeNull()
  })
})

describe('sanitizeTargetChoices', () => {
  it('keeps each reply once, at most 8, and nothing from what is not a list', () => {
    const list = [guest(1), guest(1), ...Array.from({ length: 10 }, (_, i) => guest(i + 2))]

    expect(sanitizeTargetChoices(list).map(c => c.reply)).toEqual(Array.from({ length: 8 }, (_, i) => `vm (vmid ${i + 1}, pve1, PVE-PROD)`))
    expect(sanitizeTargetChoices(undefined)).toEqual([])
    expect(sanitizeTargetChoices({ choices: [guest(1)] })).toEqual([])
  })
})

describe('collectTargetChoices', () => {
  it('takes the choices of the last ambiguous entry of the request', () => {
    expect(collectTargetChoices([{ choices: [guest(1)] }, {}, { choices: [guest(2), guest(2)] }, { choices: [] }])).toEqual([guest(2)])
  })

  it('is empty when no entry was ambiguous', () => {
    expect(collectTargetChoices([{}, { choices: [] }])).toEqual([])
  })
})

describe('recette #188 follow-ups', () => {
  const w22 = { label: 'w22-i1000 · #111 · pve3 · PVE-PROD', reply: 'w22-i1000 (vmid 111, pve3, PVE-PROD)', kind: 'guest' as const }

  it('drops the choices once a later call of the same tool succeeded', () => {
    expect(collectTargetChoices([
      { name: 'propose_action', ok: false, choices: [w22] },
      { name: 'propose_action', ok: true },
    ])).toEqual([])
  })

  it('keeps them when only another tool succeeded afterwards', () => {
    expect(collectTargetChoices([
      { name: 'propose_action', ok: false, choices: [w22] },
      { name: 'get_guest_hardware', ok: true },
    ])).toEqual([w22])
  })

  it('drops them once the model went on with one of the listed vmids, whatever the tool and its outcome', () => {
    const pve1 = { label: 'r9lxc-zfs · #9921 · pve1 · PVE-PROD', reply: 'r9lxc-zfs (vmid 9921, pve1, PVE-PROD)', kind: 'guest' as const }
    const dr = { label: 'r9lxc-zfs · #89921 · pve2-dr · PVE-DR', reply: 'r9lxc-zfs (vmid 89921, pve2-dr, PVE-DR)', kind: 'guest' as const }
    const refused = { name: 'simulate_migration', ok: false, args: { guest: 'r9lxc-zfs' }, choices: [pve1, dr] }

    // Refused by the proposal cap, not by a new ambiguity.
    expect(collectTargetChoices([refused, { name: 'propose_action', ok: false, args: { guest: '9921' } }])).toEqual([])
    // 992 is not 9921, and a call raising choices again settles nothing.
    expect(collectTargetChoices([refused, { name: 'propose_action', ok: true, args: { guest: '992' } }])).toEqual([pve1, dr])
    expect(collectTargetChoices([refused, { name: 'propose_action', ok: false, args: { guest: '9921' }, choices: [pve1, dr] }])).toEqual([pve1, dr])
  })

  it('reads a refusal that hands choices as consulted, not failed', () => {
    expect(consultedOk({ ok: false, choices: [w22] })).toBe(true)
    expect(consultedOk({ ok: false })).toBe(false)
    expect(consultedOk({ ok: true })).toBe(true)
  })
})
