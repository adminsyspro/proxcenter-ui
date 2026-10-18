import { describe, expect, it } from "vitest"

import {
  BULK_MIG_CONCURRENCY_DEFAULT, BULK_MIG_CONCURRENCY_MAX, BULK_MIG_CONCURRENCY_MIN,
  bulkTempBytesRequired, clampBulkConcurrency, bulkTargetNodes, bulkVmDiskBytes,
} from "./bulkMigrationConfig"

describe("clampBulkConcurrency", () => {
  it("keeps a value inside the range", () => {
    expect(clampBulkConcurrency(3)).toBe(3)
    expect(clampBulkConcurrency("2")).toBe(2)
  })

  it("clamps to the bounds", () => {
    expect(clampBulkConcurrency(0)).toBe(BULK_MIG_CONCURRENCY_MIN)
    expect(clampBulkConcurrency(-4)).toBe(BULK_MIG_CONCURRENCY_MIN)
    expect(clampBulkConcurrency(99)).toBe(BULK_MIG_CONCURRENCY_MAX)
  })

  it("falls back to the default for garbage and rounds fractions", () => {
    expect(clampBulkConcurrency(undefined)).toBe(BULK_MIG_CONCURRENCY_DEFAULT)
    expect(clampBulkConcurrency("abc")).toBe(BULK_MIG_CONCURRENCY_DEFAULT)
    expect(clampBulkConcurrency(Number.NaN)).toBe(BULK_MIG_CONCURRENCY_DEFAULT)
    expect(clampBulkConcurrency(2.6)).toBe(3)
  })

  it("has a sequential default", () => {
    expect(BULK_MIG_CONCURRENCY_DEFAULT).toBe(1)
  })
})

describe("bulkTempBytesRequired", () => {
  const gib = (n: number) => n * 1024 ** 3

  it("is twice the biggest VM when sequential", () => {
    expect(bulkTempBytesRequired([gib(10), gib(40), gib(20)], 1)).toBe(gib(80))
  })

  it("sums the N biggest VMs when N run at once", () => {
    expect(bulkTempBytesRequired([gib(10), gib(40), gib(20)], 2)).toBe(gib(120))
    expect(bulkTempBytesRequired([gib(10), gib(40), gib(20)], 5)).toBe(gib(140))
  })

  it("ignores unknown sizes and an empty batch", () => {
    expect(bulkTempBytesRequired([Number.NaN, gib(4), -1], 3)).toBe(gib(8))
    expect(bulkTempBytesRequired([], 3)).toBe(0)
  })
})

describe('bulkTargetNodes / bulkVmDiskBytes (roadmap#53, batch target space)', () => {
  const nodes = [
    { connId: 'c1', node: 'pve1', status: 'online' },
    { connId: 'c1', node: 'pve2', status: 'offline' },
    { connId: 'c1', node: 'pve3', status: 'online' },
    { connId: 'c2', node: 'dr1', status: 'online' },
  ]
  it('spreads Auto over the online nodes of the chosen cluster, a node takes everything', () => {
    expect(bulkTargetNodes('__auto__', 'c1', nodes)).toEqual(['pve1', 'pve3'])
    expect(bulkTargetNodes('__auto__', 'c1', nodes.map(n => ({ ...n, status: undefined })))).toEqual(['pve1', 'pve2', 'pve3'])
    expect(bulkTargetNodes('pve2', 'c1', nodes)).toEqual(['pve2'])
    expect(bulkTargetNodes('', 'c1', nodes)).toEqual([])
  })
  it('counts the provisioned size when the source reports it', () => {
    expect(bulkVmDiskBytes({ committed: 3, uncommitted: 2 })).toBe(5)
    expect(bulkVmDiskBytes({ committed: 3 })).toBe(3)
    expect(bulkVmDiskBytes({})).toBe(0)
    expect(bulkVmDiskBytes({ committed: -1, uncommitted: null })).toBe(0)
  })
})
