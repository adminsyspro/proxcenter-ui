import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { crossClusterMigrate } from './crossClusterMigrate'

const TARGET = { connId: 'conn-src', node: 'pve1', type: 'qemu', vmid: 100 }
const BASE = {
  targetConnectionId: 'conn-tgt',
  targetNode: 'pve1-dr',
  targetStorage: 'XC-ProdCeph',
  targetBridge: 'vmbr1',
  online: false,
  deleteSource: true,
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const answer = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('crossClusterMigrate', () => {
  it('starts a migration with copy and follows its task on the source cluster', async () => {
    fetchMock.mockReturnValue(answer(200, { data: 'UPID:pve1:qmigrate:100' }))

    const result = await crossClusterMigrate(TARGET, BASE)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections/conn-src/guests/qemu/pve1/100/remote-migrate')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ targetStorage: 'XC-ProdCeph', delete: true })
    expect(result).toMatchObject({ upid: 'UPID:pve1:qmigrate:100', taskConnectionId: 'conn-src', taskNode: 'pve1' })
  })

  it('moves without copy through the handover route and follows the start task on the target cluster', async () => {
    fetchMock.mockReturnValue(answer(200, { data: 'UPID:pve1-dr:qmstart:100', task: { connectionId: 'conn-tgt', node: 'pve1-dr' } }))

    const result = await crossClusterMigrate(TARGET, { ...BASE, handover: true, start: true })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections/conn-src/guests/qemu/pve1/100/remote-migrate/handover')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      targetConnectionId: 'conn-tgt', targetNode: 'pve1-dr', targetBridge: 'vmbr1', start: true,
    })
    expect(result).toMatchObject({ upid: 'UPID:pve1-dr:qmstart:100', taskConnectionId: 'conn-tgt', taskNode: 'pve1-dr' })
  })

  it('has no task to follow when the guest moved without copy and stays stopped', async () => {
    fetchMock.mockReturnValue(answer(200, { data: null, task: { connectionId: 'conn-tgt', node: 'pve1-dr' } }))

    expect((await crossClusterMigrate(TARGET, { ...BASE, handover: true })).upid).toBeNull()
  })

  it('hands back why the guest did not start after a move that succeeded', async () => {
    fetchMock.mockReturnValue(answer(200, { data: null, task: { connectionId: 'conn-tgt', node: 'pve1-dr' }, handover: { ok: true, startError: 'bridge vmbr9 does not exist' } }))

    expect(await crossClusterMigrate(TARGET, { ...BASE, handover: true, start: true })).toMatchObject({ upid: null, startError: 'bridge vmbr9 does not exist' })
  })

  it('throws the route error', async () => {
    fetchMock.mockReturnValue(answer(409, { error: 'The guest must be stopped first', code: 'GUEST_RUNNING' }))

    await expect(crossClusterMigrate(TARGET, { ...BASE, handover: true })).rejects.toThrow('The guest must be stopped first')
  })
})
