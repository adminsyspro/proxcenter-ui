/**
 * Table tests for the grants → visible-vDCs mapping (design §3.8a).
 * Fail-open contract: null grants, or ANY non-mappable grant (global,
 * inherit, tag, unknown scope types) → full list. No right is extended:
 * this only decides what the switcher/landing SHOW; RBAC still gates
 * every action.
 * Run: npx vitest run --config vitest.unit.config.ts src/lib/rbac/vdcVisibility.test.ts
 */
import { describe, expect, it } from 'vitest'

import { filterVisibleVdcs } from './vdcVisibility'

const vdcA = { id: 'vA', connectionId: 'conn-A', pvePoolName: 'vdc-acme-paris', nodes: ['pve-a1', 'pve-a2'] }
const vdcB = { id: 'vB', connectionId: 'conn-B', pvePoolName: 'vdc-acme-fra', nodes: ['pve-b1'] }
const all = [vdcA, vdcB]
const g = (scope_type: string, scope_target: string | null) => ({ scope_type, scope_target })

describe('filterVisibleVdcs', () => {
  it('null grants (admin / token / resolver error) → full list', () => {
    expect(filterVisibleVdcs(all, null)).toEqual(all)
  })

  it.each([
    ['global', null],
    ['inherit', null],
    ['tag', 'prod'],
    ['some-future-scope', 'x'],
  ])('non-mappable grant (%s) → full list (fail-open)', (t, target) => {
    expect(filterVisibleVdcs(all, [g(t, target)])).toEqual(all)
  })

  it('connection grant → the vDC on that connection', () => {
    expect(filterVisibleVdcs(all, [g('connection', 'conn-A')])).toEqual([vdcA])
  })

  it('pool grant → the vDC whose pvePoolName matches', () => {
    expect(filterVisibleVdcs(all, [g('pool', 'vdc-acme-fra')])).toEqual([vdcB])
  })

  it('node grant (connId:node) → the vDC holding that node on that connection', () => {
    expect(filterVisibleVdcs(all, [g('node', 'conn-A:pve-a2')])).toEqual([vdcA])
    expect(filterVisibleVdcs(all, [g('node', 'conn-A:pve-b1')])).toEqual([])
  })

  it('vm grant (connId:node:type:vmid) → the vDC of the grant connection', () => {
    expect(filterVisibleVdcs(all, [g('vm', 'conn-B:pve-b1:qemu:104')])).toEqual([vdcB])
  })

  it('several mappable grants → union, order of the input list preserved', () => {
    expect(filterVisibleVdcs(all, [g('pool', 'vdc-acme-fra'), g('connection', 'conn-A')])).toEqual(all)
  })

  it('mappable + non-mappable mixed → full list (the non-mappable wins, fail-open)', () => {
    expect(filterVisibleVdcs(all, [g('connection', 'conn-A'), g('tag', 'prod')])).toEqual(all)
  })

  it('no matching grant at all → empty list (degenerate case, empty landing state)', () => {
    expect(filterVisibleVdcs(all, [g('connection', 'conn-Z')])).toEqual([])
  })

  it('mappable grant with a null target is ignored, not crashed on', () => {
    expect(filterVisibleVdcs(all, [g('connection', null), g('pool', 'vdc-acme-fra')])).toEqual([vdcB])
  })
})
