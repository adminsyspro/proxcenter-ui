import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import en from '@/messages/en.json'

import TenantsTab from './TenantsTab'

const label = (en as any).tenants.apiSelfService
const TENANT = {
  id: 't1', slug: 'acme', name: 'Acme Corp', description: null, enabled: 1, apiSelfService: false,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', operatingModel: 'iaas',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TenantsTab: API self-service of a customer tenant (#1404)', () => {
  it('lets the provider open it, and sends it on save', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const data = url === '/api/v1/tenants' ? [TENANT] : []
      return { ok: true, status: 200, json: async () => ({ data }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<TenantsTab />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    const toggle = await screen.findByRole('switch', { name: new RegExp(label) })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: (en as any).common.update }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/v1/tenants/t1' && (i as RequestInit)?.method === 'PUT')
      expect(JSON.parse((put![1] as RequestInit).body as string)).toMatchObject({ apiSelfService: true })
    })
  })
})
