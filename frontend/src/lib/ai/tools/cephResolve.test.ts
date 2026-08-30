/**
 * Which cluster a Ceph question is about when the model names none (#459).
 *
 * On a multi-cluster estate with Ceph on one cluster, asking the model to name
 * it first sent llama3.1:8b into four rounds of guessing argument names. The
 * snapshot already knows which clusters report a Ceph health.
 */

import { describe, it, expect } from 'vitest'

import type { AiSnapshot } from '@/lib/ai/context'
import { resolveCephConnection } from './ceph'
import { ToolScopeError, type AiToolContext } from './types'

function ctxWith(clusters: AiSnapshot['clusters']): AiToolContext {
  return {
    snapshot: { clusters, nodes: [], guests: [], summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: 0, onlineNodes: 0 }, cached: false },
    tenantId: 't',
    locale: 'en',
  }
}

const prodCeph = { id: 'c1', name: 'PVE-STORE-GRA4', nodeCount: 3, guestCount: 10, cephHealth: 'HEALTH_OK' }
const lab = { id: 'c2', name: 'lab', nodeCount: 1, guestCount: 2 }
const starwind = { id: 'c3', name: 'PROXMOX-STARWIND-GRA', nodeCount: 2, guestCount: 4 }

describe('resolveCephConnection', () => {
  it('picks the one visible cluster that reports Ceph when none is named', () => {
    expect(resolveCephConnection(ctxWith([lab, prodCeph, starwind]))).toEqual({ id: 'c1', name: 'PVE-STORE-GRA4' })
  })

  it('still honours an explicit cluster, Ceph or not', () => {
    expect(resolveCephConnection(ctxWith([lab, prodCeph]), 'lab')).toEqual({ id: 'c2', name: 'lab' })
  })

  it('asks for the "cluster" argument by name when several clusters run Ceph', () => {
    const second = { ...starwind, cephHealth: 'HEALTH_WARN' }

    expect(() => resolveCephConnection(ctxWith([prodCeph, second]))).toThrow(ToolScopeError)
    expect(() => resolveCephConnection(ctxWith([prodCeph, second]))).toThrow('pass the "cluster" argument with one of: PVE-STORE-GRA4, PROXMOX-STARWIND-GRA')
  })

  it('says no cluster reports Ceph rather than asking to pick one blindly', () => {
    expect(() => resolveCephConnection(ctxWith([lab, starwind]))).toThrow('No visible cluster reports Ceph')
  })

  it('falls back to the single visible cluster, so a Ceph-less estate gets the hasCeph:false answer', () => {
    expect(resolveCephConnection(ctxWith([lab]))).toEqual({ id: 'c2', name: 'lab' })
  })

  it('refuses a cluster outside the perimeter like every other tool', () => {
    expect(() => resolveCephConnection(ctxWith([lab, prodCeph]), 'prod-secret')).toThrow(ToolScopeError)
  })
})
