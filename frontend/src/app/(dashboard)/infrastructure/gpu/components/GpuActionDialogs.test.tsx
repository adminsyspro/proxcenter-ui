/**
 * The provider attach dialog (#672): a refusal of the vDC GPU contingent reads
 * as a sentence with the line's use, or as "cannot be checked now".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import { AttachDialog } from './GpuActionDialogs'

const device: any = {
  key: 'c1:n1:0000:03:00', connId: 'c1', node: 'n1', id: '0000:03:00.0', slot: '0000:03:00', functions: [], displayFunctions: [],
  vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA', deviceName: 'GA102GL [RTX A5000]', subsystemName: null, classCode: '0x030000',
  iommuGroup: 35, iommuIsolated: true, mdev: false, vgpu: null, kind: 'gpu', consoleReason: null, mappings: ['a5000'], connectionName: 'LAB', vms: [],
}

let postReply: { status: number; body: unknown }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: postReply.status < 400, status: postReply.status, json: async () => postReply.body } as Response
    if (url.includes('/candidates')) {
      return { ok: true, status: 200, json: async () => ({ data: [{ connId: 'c1', node: 'n1', vmid: '9002', name: 'web', status: 'stopped', pool: 'vdc-acme' }] }) } as Response
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function attach() {
  renderWithProviders(<AttachDialog device={device} onClose={() => {}} onDone={() => {}} />)
  fireEvent.click(await screen.findByRole('radio', { name: 'web' }))
  fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
}

describe('AttachDialog, vDC GPU contingent', () => {
  it('names the use and the size of the full line', async () => {
    postReply = { status: 409, body: { error: 'quota_exceeded', used: 2, count: 3 } }
    await attach()
    expect(await screen.findByText('The vDC of this VM already holds 2 of its 3 GPUs: raise its GPU quota first.')).toBeTruthy()
  })

  it('names the line when the server says which', async () => {
    postReply = { status: 409, body: { error: 'quota_exceeded', used: 1, count: 1, line: { kind: 'vgpu', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q' } } }
    await attach()
    expect(await screen.findByText('The vDC of this VM already holds 1 of its 1 GPUs on the line RTX A5000 RTXA5000-12Q: raise its GPU quota first.')).toBeTruthy()
  })

  it('says the contingent cannot be checked now', async () => {
    postReply = { status: 503, body: { error: 'gpu_check_unavailable' } }
    await attach()
    expect(await screen.findByText('The GPU contingent of the vDC of this VM cannot be checked right now. Try again shortly.')).toBeTruthy()
  })
})
