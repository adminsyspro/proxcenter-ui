import { describe, expect, it, vi } from 'vitest'

import {
  agentStatusLabel,
  createdDate,
  fetchGuestDetails,
  firmwareLabel,
  guestDetailsKey,
  guestOsLabel,
  lastBootDate,
  machineLabel,
  VMIDS_PER_REQUEST,
  type GuestDetails,
} from './guestDetails'

const guest = (vmid: number, extra: Partial<{ connId: string; type: string; status: string }> = {}) => ({
  connId: 'c1', type: 'qemu', node: 'pve1', vmid, status: 'running', ...extra,
})

const details = (extra: Partial<GuestDetails> = {}): GuestDetails => ({
  ostype: 'l26', bios: null, machine: null, agentEnabled: true, createdAt: null, ...extra,
})

function okResponse(vms: unknown[]) {
  return { ok: true, json: async () => ({ data: { vms } }) } as unknown as Response
}

describe('fetchGuestDetails (#1163)', () => {
  it('asks /api/v1/vms per connection in batches, with the agent probe', async () => {
    const guests = [
      ...Array.from({ length: VMIDS_PER_REQUEST + 20 }, (_, i) => guest(1000 + i)),
      guest(5, { connId: 'c2' }),
    ]
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, 'http://x').searchParams
      const vms = params.get('vmids')!.split(',').map(vmid => ({
        connId: params.get('connId'), type: 'qemu', node: 'pve1', vmid, ...details({ agentVersion: '9.2.0' }),
      }))

      return okResponse(vms)
    })

    const out = await fetchGuestDetails(guests, fetchMock as unknown as typeof fetch)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [url] of fetchMock.mock.calls) {
      const params = new URL(url, 'http://x').searchParams
      expect(params.get('include')).toBe('agent')
      expect(params.get('vmids')!.split(',').length).toBeLessThanOrEqual(VMIDS_PER_REQUEST)
    }
    expect(out.size).toBe(guests.length)
    expect(out.get(guestDetailsKey(guest(5, { connId: 'c2' })))?.agentVersion).toBe('9.2.0')
  })

  it('leaves out the guests of a batch that fails, without failing', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('connId=bad')) throw new Error('network down')
      if (url.includes('connId=denied')) return { ok: false } as Response

      return okResponse([{ connId: 'c1', type: 'qemu', node: 'pve1', vmid: '1', ...details() }])
    })

    const out = await fetchGuestDetails(
      [guest(1), guest(2, { connId: 'bad' }), guest(3, { connId: 'denied' })],
      fetchMock as unknown as typeof fetch,
    )

    expect([...out.keys()]).toEqual(['c1:qemu:pve1:1'])
  })

  it('makes no request for an empty list', async () => {
    const fetchMock = vi.fn()
    expect((await fetchGuestDetails([], fetchMock as unknown as typeof fetch)).size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('guest detail labels', () => {
  it('prefers what the agent reports, else the Proxmox OS type', () => {
    expect(guestOsLabel('qemu', details({ ostype: 'win11' }))).toBe('Windows 11/2022/2025')
    expect(guestOsLabel('qemu', details({ agentOsName: 'Debian GNU/Linux 13 (trixie)' }))).toBe('Debian GNU/Linux 13 (trixie)')
    expect(guestOsLabel('qemu', details(), 'Ubuntu 24.04 LTS')).toBe('Ubuntu 24.04 LTS')
    expect(guestOsLabel('lxc', details({ ostype: 'alpine' }))).toBe('alpine')
    expect(guestOsLabel('qemu', details({ ostype: 'unknown-type' }))).toBe('unknown-type')
    expect(guestOsLabel('qemu', undefined)).toBe('')
  })

  it('names the firmware and the machine family of a VM only', () => {
    expect(firmwareLabel('qemu', details({ bios: 'ovmf' }))).toBe('OVMF (UEFI)')
    expect(firmwareLabel('qemu', details())).toBe('SeaBIOS')
    expect(firmwareLabel('lxc', details())).toBe('')
    expect(firmwareLabel('qemu', undefined)).toBe('')

    expect(machineLabel('qemu', details())).toBe('i440fx')
    expect(machineLabel('qemu', details({ machine: 'q35,viommu=virtio' }))).toBe('q35')
    expect(machineLabel('qemu', details({ machine: 'pc-q35-9.2+pve1' }))).toBe('q35 9.2+pve1')
    expect(machineLabel('qemu', details({ machine: 'pc-i440fx-8.1' }))).toBe('i440fx 8.1')
    expect(machineLabel('lxc', details())).toBe('')
  })

  it('tells the agent states apart', () => {
    expect(agentStatusLabel(guest(1), details({ agentEnabled: false }))).toBe('Disabled')
    expect(agentStatusLabel(guest(1, { status: 'stopped' }), details())).toBe('Enabled (VM not running)')
    expect(agentStatusLabel(guest(1), details({ agentResponding: true }))).toBe('Running')
    expect(agentStatusLabel(guest(1), details({ agentResponding: false }))).toBe('Not responding')
    expect(agentStatusLabel(guest(1, { type: 'lxc' }), details())).toBe('')
    expect(agentStatusLabel(guest(1), undefined)).toBe('')
  })

  it('dates the creation and the last boot', () => {
    expect(createdDate(details({ createdAt: 1760000000 }))?.toISOString()).toBe('2025-10-09T08:53:20.000Z')
    expect(createdDate(details())).toBeNull()

    const now = Date.UTC(2026, 9, 21, 12, 0, 0)
    expect(lastBootDate(guest(1), details({ uptimeSeconds: 3600 }), now)?.toISOString()).toBe('2026-10-21T11:00:00.000Z')
    expect(lastBootDate(guest(1, { status: 'stopped' }), details({ uptimeSeconds: 3600 }), now)).toBeNull()
    expect(lastBootDate(guest(1), details(), now)).toBeNull()
  })
})
