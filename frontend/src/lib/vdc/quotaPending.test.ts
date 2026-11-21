import { beforeEach, describe, expect, it } from 'vitest'

import { pendingVdcQuota, QUOTA_RESERVATION_TTL_MS, reserveVdcQuota, resetVdcQuotaPending } from './quotaPending'

beforeEach(() => resetVdcQuotaPending())

const one = { vcpus: 2, ramMb: 2048, storageMb: 10240, vms: 1 }

describe('vDC quota reservations', () => {
  it('count on the pool until released', () => {
    const release = reserveVdcQuota('c1', 'pool-a', '150', one)
    expect(pendingVdcQuota('c1', 'pool-a')).toEqual([{ vmid: '150', ...one }])
    release()
    expect(pendingVdcQuota('c1', 'pool-a')).toEqual([])
  })

  it('are kept per connection and per pool', () => {
    reserveVdcQuota('c1', 'pool-a', '150', one)
    expect(pendingVdcQuota('c1', 'pool-b')).toEqual([])
    expect(pendingVdcQuota('c2', 'pool-a')).toEqual([])
  })

  it('expire when the end of the task was never seen', () => {
    reserveVdcQuota('c1', 'pool-a', '150', one, { now: 1000 })
    expect(pendingVdcQuota('c1', 'pool-a', 1000 + QUOTA_RESERVATION_TTL_MS - 1)).toHaveLength(1)
    expect(pendingVdcQuota('c1', 'pool-a', 1000 + QUOTA_RESERVATION_TTL_MS)).toEqual([])
  })

  it('releasing twice is harmless', () => {
    const release = reserveVdcQuota('c1', 'pool-a', '150', one)
    reserveVdcQuota('c1', 'pool-a', '151', one)
    release()
    release()
    expect(pendingVdcQuota('c1', 'pool-a').map(r => r.vmid)).toEqual(['151'])
  })
})
