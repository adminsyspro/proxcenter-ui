import { isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import DiscardDraft from './DiscardDraft'
import type { ZoneEdits } from './useZoneEdits'
import { zoneGateOf } from './zoneGate'

const editsOf = (over: { pending?: boolean; count?: number | null; onOpenPlan?: () => void }) => ({
  connectionId: 'c1',
  policy: { version: 3 },
  onOpenPlan: over.onOpenPlan,
  pendingChanges: { pending: over.pending ?? false, count: over.count ?? null },
}) as unknown as ZoneEdits

describe('zoneGateOf', () => {
  it('carries the pending state and count of the draft', () => {
    const gate = zoneGateOf(editsOf({ pending: true, count: 4 }), vi.fn())
    expect(gate.pending).toBe(true)
    expect(gate.count).toBe(4)
  })

  it('closes the dialog, then opens the plan, when the way to the plan is taken', () => {
    const order: string[] = []
    const gate = zoneGateOf(editsOf({ pending: true, count: 1, onOpenPlan: () => order.push('plan') }), () => order.push('close'))
    gate.onViewPlan?.()
    expect(order).toEqual(['close', 'plan'])
  })

  it('offers no way to the plan where there is no plan window', () => {
    expect(zoneGateOf(editsOf({ pending: true, count: 1 }), vi.fn()).onViewPlan).toBeUndefined()
  })

  it('offers to discard the draft only while it has pending changes, outlined and with its count', () => {
    const gate = zoneGateOf(editsOf({ pending: true, count: 2 }), vi.fn())
    expect(isValidElement(gate.discard)).toBe(true)
    const discard = gate.discard as React.ReactElement<{ connectionId: string; count: number; variant: string }>
    expect(discard.type).toBe(DiscardDraft)
    expect(discard.props).toMatchObject({ connectionId: 'c1', count: 2, variant: 'outlined' })
    expect(zoneGateOf(editsOf({ pending: false }), vi.fn()).discard).toBeUndefined()
  })
})
