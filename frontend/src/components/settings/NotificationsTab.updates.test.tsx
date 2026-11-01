import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, userEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import NotificationsTab from './NotificationsTab'

vi.mock('@/contexts/LicenseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/contexts/LicenseContext')>()

  return { ...actual, useLicense: () => ({ hasFeature: () => false }) }
})

const SETTINGS_URL = '*/api/v1/orchestrator/notifications/settings'

let savedPayload: any = null

function seed(extra: Record<string, unknown>) {
  savedPayload = null
  server.use(
    http.get(SETTINGS_URL, () => HttpResponse.json({
      email: { enabled: false, smtp_port: 587, default_recipients: [] },
      enable_alerts: true,
      min_severity: 'warning',
      rate_limit_per_hour: 100,
      ...extra,
    })),
    http.put(SETTINGS_URL, async ({ request }) => {
      savedPayload = await request.json()

      return HttpResponse.json({ status: 'updated' })
    }),
  )
}

afterEach(cleanup)

describe('NotificationsTab available updates category', () => {
  it('is off by default and never shows a severity select', async () => {
    seed({})
    renderWithProviders(<NotificationsTab />)

    const sw = await screen.findByRole('switch', { name: /^Available updates/ })

    expect(sw).not.toBeChecked()

    const before = screen.getAllByRole('combobox', { name: 'Minimum severity' }).length

    await userEvent.click(sw)
    expect(sw).toBeChecked()
    expect(screen.getAllByRole('combobox', { name: 'Minimum severity' })).toHaveLength(before)
  })

  it('saves enable_updates with the other settings and no updates severity', async () => {
    seed({ enable_updates: false })
    renderWithProviders(<NotificationsTab />)

    await userEvent.click(await screen.findByRole('switch', { name: /^Available updates/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(savedPayload).not.toBeNull())
    expect(savedPayload.enable_updates).toBe(true)
    expect(savedPayload.category_min_severity ?? {}).not.toHaveProperty('updates')
  })

  it('explains the category in its tooltip', async () => {
    seed({})
    renderWithProviders(<NotificationsTab />)

    await screen.findByRole('switch', { name: /^Available updates/ })
    expect(screen.getByLabelText(/^New package versions available on the Proxmox VE nodes/)).toBeInTheDocument()
  })
})
