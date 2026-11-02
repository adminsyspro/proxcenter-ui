import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'

import en from '@/messages/en.json'

import CephPageGuarded from './page'

const setPageInfo = vi.fn()
let allowed = true
const fetchMock = vi.fn()

vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo }) }))
vi.mock('@/components/guards/PermissionGuard', () => ({
  default: ({ permission, children }: { permission: string; children: ReactNode }) => (
    <div data-testid='guard' data-permission={permission}>{allowed ? children : null}</div>
  ),
}))
vi.mock('@/components/ceph/cockpit/CephCockpit', () => ({
  default: ({ connections }: { connections: { id: string; name: string }[] }) => (
    <div data-testid='cockpit'>{connections.map(c => `${c.id}:${c.name}`).join(',')}</div>
  ),
}))

function renderPage() {
  render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
        <CephPageGuarded />
      </SWRConfig>
    </NextIntlClientProvider>,
  )
}

beforeEach(() => {
  allowed = true
  setPageInfo.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/storage/ceph page', () => {
  it('is guarded by storage.admin and titles the app bar', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
    renderPage()

    expect(screen.getByTestId('guard')).toHaveAttribute('data-permission', 'storage.admin')
    await waitFor(() => expect(setPageInfo).toHaveBeenCalledWith(en.storage.ceph, en.storage.distributed, 'simple-icons-ceph'))
  })

  it('hands the PVE connections flagged with Ceph to the cockpit', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: 'c1', name: 'PVE-PROD' }, { id: 7 }, null] }) })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('cockpit')).toHaveTextContent('c1:PVE-PROD,7:7'))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections?type=pve&hasCeph=true')
  })

  it('says so when the connection list cannot be read', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    renderPage()

    expect(await screen.findByText(en.cephCockpit.error.connections)).toBeInTheDocument()
  })

  it('runs nothing without the permission', () => {
    allowed = false
    renderPage()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
