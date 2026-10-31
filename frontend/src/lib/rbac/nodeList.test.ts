import { beforeEach, describe, expect, it, vi } from 'vitest'

const perimeterMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/rbac', () => ({
  getRequestGuestScopePerimeter: perimeterMock,
  PERMISSIONS: { NODE_VIEW: 'node.view' },
}))

import { isNodeInScope, listableNodes } from './nodeList'
import type { RbacInfraScope } from './infraScope'

const scope = (over: Partial<RbacInfraScope> = {}): RbacInfraScope => ({
  fullConnections: new Set(['dr']),
  nodesByConnection: new Map([['prod', new Set(['pve2'])]]),
  guestDerived: false,
  ...over,
})

beforeEach(() => {
  perimeterMock.mockReset().mockResolvedValue({ nodes: new Set(['pve3']) })
})

describe('isNodeInScope', () => {
  it('opens every node when unrestricted or when the connection is granted whole', () => {
    expect(isNodeInScope(null, 'prod', 'pve1')).toBe(true)
    expect(isNodeInScope(scope(), 'dr', 'pve1-dr')).toBe(true)
  })

  it('opens only the nodes the grants name elsewhere', () => {
    expect(isNodeInScope(scope(), 'prod', 'pve2')).toBe(true)
    expect(isNodeInScope(scope(), 'prod', 'pve1')).toBe(false)
    expect(isNodeInScope(scope(), 'other', 'pve1')).toBe(false)
  })
})

describe('listableNodes', () => {
  it('returns null (every node) when unrestricted or for a connection granted whole', async () => {
    expect(await listableNodes(null, 'prod')).toBeNull()
    expect(await listableNodes(scope(), 'dr')).toBeNull()
  })

  it('returns the named nodes, and nothing for a connection the grants do not name', async () => {
    expect([...(await listableNodes(scope(), 'prod'))!]).toEqual(['pve2'])
    expect([...(await listableNodes(scope(), 'other'))!]).toEqual([])
    expect(perimeterMock).not.toHaveBeenCalled()
  })

  it('adds the nodes hosting a visible guest on a tag or pool scope', async () => {
    const nodes = await listableNodes(scope({ guestDerived: true }), 'prod')

    expect([...nodes!].sort()).toEqual(['pve2', 'pve3'])
    expect(perimeterMock).toHaveBeenCalledWith('prod', 'node.view')
  })

  it('adds nothing when the guest perimeter cannot be read', async () => {
    perimeterMock.mockResolvedValue(null)

    expect([...(await listableNodes(scope({ guestDerived: true }), 'prod'))!]).toEqual(['pve2'])
  })
})
