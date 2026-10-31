import type { AvailabilityState, Result } from '@/lib/availability/types'

/** A node result whose slots are one minute apart, the first starting at 10:00 UTC. */
export function makeResult(
  node: string,
  states: AvailabilityState[],
  overrides: Partial<Result> = {},
): Result {
  const t0 = Date.UTC(2026, 9, 27, 10, 0, 0)

  return {
    ref: { connection_id: 'c1', kind: 'node', node },
    up_seconds: 0,
    down_seconds: 0,
    maintenance_seconds: 0,
    unobserved_seconds: 0,
    availability: 100,
    coverage: 100,
    slots: states.map((state, i) => ({ start: new Date(t0 + i * 60000).toISOString(), state })),
    incidents: [],
    ...overrides,
  }
}

/** A policy of the list, with a summary at `availability` % and `remaining` of `allowed` budget seconds left. */
export function makePolicy(overrides: Record<string, unknown> = {}, availability: number | null = 99.95, remaining: number | null = 600) {
  return {
    id: 'p1',
    name: 'Gold',
    target: 99.9,
    guests: [{ connectionId: 'c1', vmid: 100 }],
    tags: ['prod'],
    pools: [],
    enabled: true,
    createdBy: 'admin@example.com',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    summary: {
      up_seconds: 0,
      down_seconds: 0,
      unobserved_seconds: 0,
      availability,
      coverage: 100,
      below_target: 0,
      budget: remaining === null ? null : { allowed_seconds: 2400, used_seconds: 2400 - remaining, remaining_seconds: remaining },
    },
    guestCount: 1,
    ...overrides,
  } as import('./slaApi').PolicyItem
}

/** The inventory body of GET /api/v1/inventory, reduced to what the dialogs read. */
export const inventoryFixture = {
  data: {
    clusters: [
      {
        id: 'c1',
        name: 'Paris',
        pools: [{ poolid: 'gold' }],
        nodes: [
          {
            node: 'pve1',
            guests: [
              { vmid: 100, name: 'web', type: 'qemu', tags: 'prod;db', pool: 'gold' },
              { vmid: 101, name: null, type: 'lxc', tags: 'prod' },
            ],
          },
        ],
      },
    ],
  },
}
