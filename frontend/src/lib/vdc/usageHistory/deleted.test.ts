/**
 * Usage history of deleted vDCs (#902): found by vdc_id after the vDC row is
 * gone, identified by the columns copied on each sample.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../../__tests__/setup/prisma-test'

import { findHistoryIdentity, listDeletedVdcHistories } from './deleted'

function row(id: string, vdcId: string, at: string, extra: Record<string, string> = {}) {
  return {
    id, vdcId, vdcName: `${vdcId}-name`, tenantId: 't1', tenantName: 'Tenant 1',
    connectionId: 'conn1', pvePoolName: `pool-${vdcId}`, sampledAt: new Date(at), ...extra,
  }
}

beforeEach(async () => {
  await truncate(['vdc_usage_history', 'vdcs', 'provider_connections', 'Connection', 'tenants'])
  const now = new Date()

  await prismaTest.tenant.create({ data: { id: 't1', slug: 't1', name: 'Tenant 1', operatingModel: 'iaas', createdAt: now, updatedAt: now } })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({ data: { id: 'conn1', tenantId: 'default', name: 'pve', baseUrl: 'https://pve', apiTokenEnc: 'enc' } })
    await tx.providerConnection.create({ data: { connectionId: 'conn1' } })
  })
  await prismaTest.vdc.create({ data: { id: 'live', tenantId: 't1', connectionId: 'conn1', name: 'Live', slug: 'live', pvePoolName: 'pool-live' } })
  await prismaTest.vdcUsageSample.createMany({
    data: [
      row('a', 'live', '2026-10-14T10:00:00Z'),
      row('b', 'gone-1', '2026-10-10T10:00:00Z', { vdcName: 'Old name' }),
      row('c', 'gone-1', '2026-10-12T10:00:00Z', { vdcName: 'Renamed' }),
      row('d', 'gone-2', '2026-10-13T10:00:00Z', { tenantId: 't2', tenantName: 'Tenant 2' }),
    ],
  })
})

describe('findHistoryIdentity', () => {
  it('returns the identity recorded by the most recent sample', async () => {
    expect(await findHistoryIdentity('gone-1')).toEqual({
      id: 'gone-1', name: 'Renamed', tenantId: 't1', tenantName: 'Tenant 1', connectionId: 'conn1', pvePoolName: 'pool-gone-1',
    })
    expect(await findHistoryIdentity('never')).toBeNull()
  })
})

describe('listDeletedVdcHistories', () => {
  it('lists the deleted vDCs with samples left, most recent first, never a live one', async () => {
    expect(await listDeletedVdcHistories()).toEqual([
      {
        vdcId: 'gone-2', vdcName: 'gone-2-name', tenantId: 't2', tenantName: 'Tenant 2',
        firstSampledAt: '2026-10-13T10:00:00.000Z', lastSampledAt: '2026-10-13T10:00:00.000Z', samples: 1,
      },
      {
        vdcId: 'gone-1', vdcName: 'Renamed', tenantId: 't1', tenantName: 'Tenant 1',
        firstSampledAt: '2026-10-10T10:00:00.000Z', lastSampledAt: '2026-10-12T10:00:00.000Z', samples: 2,
      },
    ])
  })

  it('restricts the list to one tenant', async () => {
    expect((await listDeletedVdcHistories('t1')).map(r => r.vdcId)).toEqual(['gone-1'])
  })
})
