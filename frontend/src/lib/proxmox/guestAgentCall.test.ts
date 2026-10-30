import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(conn: any, path: string) => Promise<any>>(),
}))

vi.mock('./client', () => ({ pveFetch: pveFetchMock }))

import { resetDaemonSlots } from './daemonSlots'
import { AGENT_MUTE_MS, callGuestAgent, GuestAgentMuted, isGuestAgentMuted, resetGuestAgentMutes } from './guestAgentCall'

const CONN = { id: 'c1', baseUrl: 'https://pve.test', apiToken: 'x' }

beforeEach(() => {
  vi.clearAllMocks()
  resetDaemonSlots()
  resetGuestAgentMutes()
})

describe('callGuestAgent', () => {
  it('calls the agent command of the VM', async () => {
    pveFetchMock.mockResolvedValue({ result: [] })
    expect(await callGuestAgent(CONN, 'pve1', 101, 'network-get-interfaces')).toEqual({ result: [] })
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes/pve1/qemu/101/agent/network-get-interfaces')
  })

  it('leaves an agent that did not answer alone for AGENT_MUTE_MS, then asks again', async () => {
    let clock = 1_000_000
    const now = () => clock

    pveFetchMock.mockRejectedValueOnce(new Error('QEMU guest agent is not running'))
    await expect(callGuestAgent(CONN, 'pve1', 101, 'info', { now })).rejects.toThrow('not running')
    expect(isGuestAgentMuted(CONN, 'pve1', 101, clock)).toBe(true)

    await expect(callGuestAgent(CONN, 'pve1', 101, 'get-osinfo', { now })).rejects.toBeInstanceOf(GuestAgentMuted)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    // Another VM of the same node is not concerned.
    pveFetchMock.mockResolvedValueOnce({ result: {} })
    await callGuestAgent(CONN, 'pve1', 102, 'info', { now })

    clock += AGENT_MUTE_MS + 1
    pveFetchMock.mockResolvedValueOnce({ result: {} })
    await callGuestAgent(CONN, 'pve1', 101, 'info', { now })
    expect(pveFetchMock).toHaveBeenCalledTimes(3)
    expect(isGuestAgentMuted(CONN, 'pve1', 101, clock)).toBe(false)
  })

  it('does not mute on a command the agent may lack, nor when the call was never sent', async () => {
    pveFetchMock.mockRejectedValueOnce(new Error('unsupported command'))
    await expect(callGuestAgent(CONN, 'pve1', 101, 'get-osinfo', { mute: false })).rejects.toThrow('unsupported')
    expect(isGuestAgentMuted(CONN, 'pve1', 101)).toBe(false)

    await expect(callGuestAgent(CONN, 'pve1', 101, 'info', { deadline: Date.now() - 1 })).rejects.toThrow('free pvedaemon slot')
    expect(isGuestAgentMuted(CONN, 'pve1', 101)).toBe(false)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })
})
