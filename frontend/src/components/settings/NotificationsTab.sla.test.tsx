import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, userEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import NotificationsTab from './NotificationsTab'

const { licensed } = vi.hoisted(() => ({ licensed: { sla: true } }))

vi.mock('@/contexts/LicenseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/contexts/LicenseContext')>()

  return {
    ...actual,
    useLicense: () => ({ hasFeature: (f: string) => f === actual.Features.SLA_MONITORING && licensed.sla }),
  }
})

const SETTINGS_URL = '*/api/v1/orchestrator/notifications/settings'

let savedPayload: any = null

function seed(sla: Record<string, unknown>) {
  savedPayload = null
  server.use(
    http.get(SETTINGS_URL, () => HttpResponse.json({
      email: { enabled: false, smtp_port: 587, default_recipients: [] },
      enable_alerts: true,
      min_severity: 'warning',
      rate_limit_per_hour: 100,
      ...sla,
    })),
    http.put(SETTINGS_URL, async ({ request }) => {
      savedPayload = await request.json()

      return HttpResponse.json({ status: 'updated' })
    }),
  )
}

beforeEach(() => {
  licensed.sla = true
})

afterEach(cleanup)

describe('NotificationsTab SLA category', () => {
  it('saves the SLA budget settings with the others', async () => {
    seed({ enable_sla: true, sla_budget_warn_percent: 80, sla_period: 'month' })
    renderWithProviders(<NotificationsTab />)

    expect(await screen.findByRole('switch', { name: /^SLA/ })).toBeChecked()

    await userEvent.hover(screen.getByLabelText(/^Warns when an SLA policy spends its downtime budget/))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/come through the Alerts category\.$/)

    fireEvent.change(screen.getByLabelText('Warning threshold'), { target: { value: '60' } })
    await userEvent.click(screen.getByRole('combobox', { name: 'Budget period' }))
    await userEvent.click(screen.getByRole('option', { name: 'Last 30 days (rolling)' }))
    // The SLA row comes after the five other categories with a severity.
    await userEvent.click(screen.getAllByRole('combobox', { name: 'Minimum severity' })[5])
    await userEvent.click(screen.getByRole('option', { name: /Critical only/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(savedPayload).not.toBeNull())
    expect(savedPayload).toMatchObject({
      enable_sla: true,
      sla_budget_warn_percent: 60,
      sla_period: 'rolling30',
      category_min_severity: { sla: 'critical' },
    })
  })

  it('hides the severity, period and threshold while the SLA notifications are off', async () => {
    seed({ enable_sla: false })
    renderWithProviders(<NotificationsTab />)

    const toggle = await screen.findByRole('switch', { name: /^SLA/ })

    expect(screen.queryByLabelText('Warning threshold')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.getByLabelText('Warning threshold')).toHaveValue(80)
    expect(screen.getByRole('combobox', { name: 'Budget period' })).toHaveTextContent('Calendar month')
  })

  it('has no SLA category without the SLA feature', async () => {
    licensed.sla = false
    seed({ enable_sla: true })
    renderWithProviders(<NotificationsTab />)

    expect(await screen.findByLabelText('Email addresses')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /^SLA/ })).not.toBeInTheDocument()
  })
})

describe('NotificationsTab category help', () => {
  it('explains every category in a tooltip that does not toggle its switch', async () => {
    licensed.sla = false
    seed({})
    renderWithProviders(<NotificationsTab />)

    const alerts = await screen.findByRole('switch', { name: /^Alerts/ })
    const help = screen.getByLabelText(/^Threshold and state alerts/)

    await userEvent.hover(help)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/when they fire and when they resolve\.$/)
    await userEvent.click(help)
    expect(alerts).toBeChecked()

    for (const text of [/^Migrations run by DRS/, /^Proxmox backup jobs/, /^Site Recovery/, /^A node entering or leaving maintenance/, /^Scheduled reports/]) {
      expect(screen.getByLabelText(text)).toBeInTheDocument()
    }
  })
})
