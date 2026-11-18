/** What the line of one cluster of a group action says of its run. */

import { describe, expect, it } from 'vitest'

import { clusterRunLine, looksUnreachable } from './ClusterRunRow'
import { planRun } from './planTestKit'

describe('looksUnreachable', () => {
  it('recognises only the wording of the orchestrator PVE client: every node unreachable, or a request that failed to connect', () => {
    for (const error of [
      // The lab text of a cluster whose three nodes refuse the connection.
      'read the guests: GET /cluster/resources?type=vm: request failed: all 3 cluster nodes unreachable (last error: Get "https://10.42.0.111:8006/api2/json/cluster/resources?type=vm": dial tcp 10.42.0.111:8006: connect: connection refused)',
      // A single node.
      'request failed: Get "https://10.0.0.1:8006/api2/json/cluster/resources": dial tcp 10.0.0.1:8006: connect: connection refused',
      'request failed: Get "https://10.0.0.1:8006/api2/json/nodes": dial tcp 10.0.0.1:8006: connect: no route to host',
      'request failed: Get "https://10.0.0.1:8006/api2/json/nodes": dial tcp 10.0.0.1:8006: i/o timeout',
      'cluster nodes unreachable',
    ]) expect(looksUnreachable(error), error).toBe(true)
  })

  it('takes no other failure for an unreachable cluster: a relayed refusal, a database dial, a timeout, a refusal of PVE, a certificate', () => {
    for (const error of [
      '500 proxy: connection refused',
      'dial tcp 127.0.0.1:5432: connect: connection refused',
      'context deadline exceeded',
      '403 Permission check failed',
      'x509: certificate signed by unknown authority',
      'request failed: x509: certificate signed by unknown authority',
      'cluster unreachable',
      'timeout waiting for the guest lock', 'the task timed out', '1 step(s) failed, 0 not run', '', undefined,
    ]) {
      expect(looksUnreachable(error), String(error)).toBe(false)
    }
  })
})

describe('clusterRunLine', () => {
  const failed = (error: string) => ({ ...planRun(), status: 'failed' as const, error })

  it('says a cluster catches up only when its run could not reach it', () => {
    expect(clusterRunLine({ run: failed('request failed: Get "https://10.0.0.1:8006/api2/json/nodes": dial tcp 10.0.0.1:8006: i/o timeout'), run_id: 'a2' }).key).toBe('cluster.applyFailed')
    expect(clusterRunLine({ run: failed('dial tcp 127.0.0.1:5432: connect: connection refused'), run_id: 'a2' }).key).toBe('cluster.runFailed')
    expect(clusterRunLine({ run: failed('the task timed out'), run_id: 'a2' }).key).toBe('cluster.runFailed')
  })

  it('tells a run that cannot be read from one that could not be followed', () => {
    expect(clusterRunLine({ run: null, run_id: 'a2', fatal: true })).toEqual({ status: 'failed', key: 'cluster.unreadable' })
    expect(clusterRunLine({ run: null, run_id: 'a2', fatal: true, abandoned: true })).toEqual({ status: 'failed', key: 'cluster.unfollowed' })
  })

  it('names why a run did not start', () => {
    expect(clusterRunLine({ run: null, connection_id: 'c2', error: 'no_client' } as never)).toEqual({ status: 'skipped', key: 'cluster.error.no_client' })
  })
})

describe('clusterRunLine of a cluster never applied', () => {
  const failed = (error: string) => ({ ...planRun(), status: 'failed' as const, error })
  const UNREACHABLE = 'request failed: Get "https://10.0.0.1:8006/api2/json/nodes": dial tcp 10.0.0.1:8006: connect: connection refused'

  it('asks to apply again instead of promising a catch-up, when the cluster is unreachable or did not start for no_client', () => {
    expect(clusterRunLine({ run: failed(UNREACHABLE), run_id: 'a2' }, true).key).toBe('cluster.neverApplied')
    expect(clusterRunLine({ run: null, error: 'no_client' }, true)).toEqual({ status: 'skipped', key: 'cluster.neverApplied' })
  })

  it('keeps every other wording, and the wording of an active cluster', () => {
    expect(clusterRunLine({ run: failed('the task timed out'), run_id: 'a2' }, true).key).toBe('cluster.runFailed')
    expect(clusterRunLine({ run: null, error: 'engine_stopped' }, true).key).toBe('cluster.error.engine_stopped')
    expect(clusterRunLine({ run: failed(UNREACHABLE), run_id: 'a2' }).key).toBe('cluster.applyFailed')
    expect(clusterRunLine({ run: null, error: 'no_client' }).key).toBe('cluster.error.no_client')
  })
})
