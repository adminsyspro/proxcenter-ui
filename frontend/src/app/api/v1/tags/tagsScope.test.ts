// roadmap#184: connection.view held on one cluster lists the tags of that perimeter only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ scope: null as any }))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: {
      findMany: async () => [
        { id: 'prod', name: 'PVE-PROD', tags: 'prod;shared' },
        { id: 'dr', name: 'PVE-DR', tags: 'dr' },
      ],
    },
    managedHost: {
      findMany: async () => [
        { id: 'h1', connectionId: 'prod', node: 'pve1', tags: 'prod-node' },
        { id: 'h2', connectionId: 'prod', node: 'pve2', tags: 'granted-node' },
        { id: 'h3', connectionId: 'dr', node: 'pve1-dr', tags: 'dr-node' },
        { id: 'h4', connectionId: null, node: 'orphan', tags: 'orphan-node' },
      ],
    },
  }),
}))
vi.mock('@/lib/rbac', async () => {
  const { isConnectionVisible } = await import('@/lib/rbac/infraScope')
  return {
    checkPermission: async () => null,
    getCurrentRbacInfraScope: async () => h.scope,
    isConnectionVisible,
    PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
  }
})

import { GET as tags } from './route'
import { GET as entities } from './entities/route'

const DR_SCOPED = { fullConnections: new Set(['dr']), nodesByConnection: new Map([['prod', new Set(['pve2'])]]), guestDerived: false }

beforeEach(() => {
  h.scope = null
})

describe('GET /api/v1/tags scope', () => {
  it('lists every tag for an unrestricted caller', async () => {
    expect((await (await tags()).json()).data).toEqual(['dr', 'dr-node', 'granted-node', 'orphan-node', 'prod', 'prod-node', 'shared'])
  })

  it('lists the tags of the clusters the tree shows and of the named nodes only', async () => {
    h.scope = DR_SCOPED

    // A node grant shows its cluster in the tree, so the cluster tags come along; pve1 and the
    // host left without a connection stay out.
    expect((await (await tags()).json()).data).toEqual(['dr', 'dr-node', 'granted-node', 'prod', 'shared'])
  })

  it('lists nothing for a caller whose grants name no cluster', async () => {
    h.scope = { fullConnections: new Set(), nodesByConnection: new Map(), guestDerived: true }

    expect((await (await tags()).json()).data).toEqual([])
  })
})

describe('GET /api/v1/tags/entities scope', () => {
  it('returns every tagged cluster and node for an unrestricted caller', async () => {
    expect((await (await entities()).json()).data).toHaveLength(6)
  })

  it('returns the clusters the tree shows and the named nodes only', async () => {
    h.scope = DR_SCOPED
    const data = (await (await entities()).json()).data

    expect(data.map((e: any) => `${e.entityType}:${e.node ?? e.name}`)).toEqual(['cluster:PVE-PROD', 'cluster:PVE-DR', 'node:pve2', 'node:pve1-dr'])
  })
})
