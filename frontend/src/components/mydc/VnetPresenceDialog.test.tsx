/**
 * Component tests for VnetPresenceDialog (#1334): the vDCs of the tenant that
 * carry one of its shared networks, ticked or not, saved in one PUT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import VnetPresenceDialog from './VnetPresenceDialog'

const CONTEXT = {
  available: true,
  vdcs: [{ id: 'a1', name: 'Acme Paris' }, { id: 'a2', name: 'Acme Lyon' }, { id: 'a3', name: 'Acme Nice' }],
  networks: [{ id: 'n1', name: 'backbone', vdcIds: ['a1', 'a2'] }],
}

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

let putBody: any
let putFails: string | null
let loadFails: boolean
const onSaved = vi.fn()

beforeEach(() => {
  putBody = undefined
  putFails = null
  loadFails = false
  onSaved.mockReset()
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    if (init?.method === 'PUT') {
      putBody = { url: String(input), body: JSON.parse(init.body) }
      return putFails ? jsonRes({ error: putFails }, 409) : jsonRes({ data: { vdcIds: putBody.body.vdcIds } })
    }
    return loadFails ? jsonRes({ error: 'vDC not found' }, 404) : jsonRes({ data: CONTEXT })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const render = () => renderWithProviders(
  <VnetPresenceDialog vdcId="a1" networkId="n1" networkName="backbone" onClose={() => {}} onSaved={onSaved} />,
)
const box = (name: RegExp | string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

describe('VnetPresenceDialog', () => {
  it('ticks the vDCs that carry the network and saves the new selection', async () => {
    render()
    await waitFor(() => expect(box(/Acme Paris/).checked).toBe(true))
    expect(box(/Acme Lyon/).checked).toBe(true)
    expect(box(/Acme Nice/).checked).toBe(false)
    fireEvent.click(box(/Acme Nice/))
    fireEvent.click(box(/Acme Lyon/))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(putBody).toEqual({ url: '/api/v1/vdcs/a1/evpn-networks/n1', body: { vdcIds: ['a1', 'a3'] } })
  })

  it('ticks or unticks every vDC at once, and refuses to save an empty selection', async () => {
    render()
    await waitFor(() => expect(box(/Acme Paris/).checked).toBe(true))
    fireEvent.click(box('All'))
    expect(box(/Acme Nice/).checked).toBe(true)
    fireEvent.click(box('All'))
    expect(box(/Acme Paris/).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the refusal of the server and keeps the dialog open', async () => {
    putFails = 'Quota exceeded on vDC "Acme Nice": max_vnets=2, current=2'
    render()
    await waitFor(() => expect(box(/Acme Nice/)).toBeTruthy())
    fireEvent.click(box(/Acme Nice/))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Quota exceeded on vDC "Acme Nice"/)).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows a load failure', async () => {
    loadFails = true
    render()
    expect(await screen.findByText('vDC not found')).toBeTruthy()
  })
})
