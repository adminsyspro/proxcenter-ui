// Real Postgres, deliberately: the whole point of this module is what the
// database does with a concurrent INSERT ... ON CONFLICT, and a mocked Prisma
// would only ever assert that the SQL is the SQL we wrote. globalSetup gives
// each run its own migrated schema (src/__tests__/setup/postgres.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import {
  RENEW_LEASE_ID,
  RenewLeaseLostError,
  claimRenewLease,
  refreshRenewLease,
  releaseRenewLease,
  withRenewLease,
} from '@/lib/tls/lease'

const OTHER_REPLICA = 'replica-two'

let previousInstanceId: string | undefined

beforeEach(async () => {
  previousInstanceId = process.env.PROXCENTER_INSTANCE_ID
  process.env.PROXCENTER_INSTANCE_ID = 'replica-one'
  await truncate(['tls_renew_leases'])
})

afterEach(() => {
  if (previousInstanceId === undefined) delete process.env.PROXCENTER_INSTANCE_ID
  else process.env.PROXCENTER_INSTANCE_ID = previousInstanceId
})

function row() {
  return prismaTest.tlsRenewLease.findUnique({ where: { id: RENEW_LEASE_ID } })
}

/** Backdate the lease so it looks like one a crashed replica left behind. */
async function expireLease() {
  await prismaTest.tlsRenewLease.update({
    where: { id: RENEW_LEASE_ID },
    data: { heldUntil: new Date(Date.now() - 60_000) },
  })
}

/** Sleep on the real clock; these cases drive the heartbeat, not fake timers. */
const tick = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms) })

describe('the ACME renewal lease', () => {
  it('lets the first claimant in and writes the row', async () => {
    expect(await claimRenewLease('replica-one')).toBe(true)

    const lease = await row()

    expect(lease?.holder).toBe('replica-one')
    expect(lease!.heldUntil.getTime()).toBeGreaterThan(Date.now())
  })

  it('refuses a second replica while the lease is held, and does not run its work', async () => {
    expect(await claimRenewLease(OTHER_REPLICA)).toBe(true)

    let ran = false

    expect(await withRenewLease(async () => { ran = true })).toBe(false)
    expect(ran).toBe(false)
    expect((await row())?.holder).toBe(OTHER_REPLICA)
  })

  it('hands the lease over once it has expired', async () => {
    await claimRenewLease(OTHER_REPLICA)
    await expireLease()

    let ran = false

    expect(await withRenewLease(async () => { ran = true })).toBe(true)
    expect(ran).toBe(true)
  })

  it('releases the lease even when the work throws', async () => {
    await expect(withRenewLease(async () => { throw new Error('order failed') })).rejects.toThrow('order failed')

    const lease = await row()

    expect(lease?.holder).toBe('replica-one')
    expect(lease!.heldUntil.getTime()).toBeLessThanOrEqual(Date.now() + 1000)

    // And the next replica can take it straight away.
    expect(await claimRenewLease(OTHER_REPLICA)).toBe(true)
  })

  it('releases the lease after the work succeeds', async () => {
    expect(await withRenewLease(async () => {})).toBe(true)
    expect(await claimRenewLease(OTHER_REPLICA)).toBe(true)
  })

  it('never lets a replica release a lease another one holds', async () => {
    await claimRenewLease(OTHER_REPLICA)

    const before = (await row())!.heldUntil

    expect(await releaseRenewLease('replica-one')).toBe(false)
    expect((await row())!.heldUntil.getTime()).toBe(before.getTime())
    expect(await claimRenewLease('replica-one')).toBe(false)
  })

  it('passes the work a handle that says it still holds the lease', async () => {
    let seen: boolean | null = null

    await withRenewLease(async lease => {
      seen = lease.isHeld()
      lease.assertHeld()
    })

    expect(seen).toBe(true)
  })

  it('lets exactly one of several concurrent claimants through', async () => {
    const results = await Promise.all([
      claimRenewLease('replica-one'),
      claimRenewLease('replica-two'),
      claimRenewLease('replica-three'),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })
})

describe('refreshRenewLease', () => {
  it('pushes held_until forward while the lease is genuinely ours', async () => {
    await claimRenewLease('replica-one')
    const before = (await row())!.heldUntil

    await tick(1100)
    expect(await refreshRenewLease('replica-one')).toBe(true)
    expect((await row())!.heldUntil.getTime()).toBeGreaterThan(before.getTime())
  })

  it('refuses to refresh a lease another replica holds, and leaves it alone', async () => {
    await claimRenewLease(OTHER_REPLICA)
    const before = (await row())!.heldUntil

    expect(await refreshRenewLease('replica-one')).toBe(false)
    expect((await row())!.heldUntil.getTime()).toBe(before.getTime())
  })

  it('refuses to revive our OWN lapsed lease', async () => {
    // Silently re-extending an expired lease would be the worst of both
    // worlds: another replica may claim it at any instant, so two orders
    // could be on the wire at once.
    await claimRenewLease('replica-one')
    await expireLease()

    expect(await refreshRenewLease('replica-one')).toBe(false)
    expect((await row())!.heldUntil.getTime()).toBeLessThan(Date.now())
  })
})

describe('a long order under the lease', () => {
  it('keeps refreshing the lease while the work runs', async () => {
    let duringWork: Date | undefined

    await withRenewLease(
      async () => {
        await tick(350)
        duringWork = (await row())!.heldUntil
      },
      { refreshMs: 50 },
    )

    // Refreshed at least once past the moment of the claim, which is what
    // stops a slow ACME order from outliving its own lease.
    expect(duringWork).toBeDefined()
    expect(duringWork!.getTime()).toBeGreaterThan(Date.now())
  })

  it('marks the handle lost when another replica takes the lease over mid-order', async () => {
    let heldAfterTakeover: boolean | null = null
    let threw = false

    await withRenewLease(
      async lease => {
        // Simulate the crash-recovery window: our lease lapses and a
        // neighbour claims it while our order is still in flight.
        await expireLease()
        await claimRenewLease(OTHER_REPLICA)
        await tick(200)

        heldAfterTakeover = lease.isHeld()

        try {
          lease.assertHeld()
        } catch (err) {
          threw = err instanceof RenewLeaseLostError
        }
      },
      { refreshMs: 50 },
    )

    expect(heldAfterTakeover).toBe(false)
    expect(threw).toBe(true)

    // And our release must not have clobbered the new holder's lease.
    const lease = await row()

    expect(lease?.holder).toBe(OTHER_REPLICA)
    expect(lease!.heldUntil.getTime()).toBeGreaterThan(Date.now())
  })

  it('gives up on an order that runs past the ceiling, and releases the lease', async () => {
    let lateHandle: { isHeld(): boolean } | undefined

    // Work that never settles: the ACME client has no request timeout, so a
    // stalled CA request looks exactly like this.
    const promise = withRenewLease(
      async lease => {
        lateHandle = lease

        return new Promise<void>(() => {})
      },
      { refreshMs: 50, maxMs: 200 },
    )

    await expect(promise).rejects.toBeInstanceOf(RenewLeaseLostError)

    // The dangling order can no longer publish behind our back...
    expect(lateHandle?.isHeld()).toBe(false)

    // ...and the row is free for the next replica rather than held for another
    // fifteen minutes.
    expect(await claimRenewLease(OTHER_REPLICA)).toBe(true)
  })
})
