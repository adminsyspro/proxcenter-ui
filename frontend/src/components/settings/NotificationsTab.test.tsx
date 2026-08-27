/**
 * Component tests for the default recipients field (ui#812).
 *
 * The field used to derive its displayed value from the parsed array, so a
 * comma parsed to nothing and the very next render put the old text back: the
 * character vanished as it was typed and a second address could never be added.
 * These tests pin the typed text, the chips and the saved payload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import NotificationsTab from './NotificationsTab'

const SETTINGS_URL = '*/api/v1/orchestrator/notifications/settings'

function settingsFixture(defaultRecipients: string[]) {
  return {
    email: {
      enabled: true,
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'user@example.com',
      smtp_from: 'noreply@example.com',
      smtp_from_name: 'ProxCenter',
      use_tls: false,
      use_starttls: true,
      skip_verify: false,
      default_recipients: defaultRecipients,
    },
    enable_alerts: true,
    enable_migrations: true,
    enable_backups: true,
    enable_maintenance: true,
    enable_reports: true,
    enable_replication: true,
    min_severity: 'info',
    rate_limit_per_hour: 100,
  }
}

let savedPayload: any = null

function seed(defaultRecipients: string[]) {
  savedPayload = null
  server.use(
    http.get(SETTINGS_URL, () => HttpResponse.json(settingsFixture(defaultRecipients))),
    http.put(SETTINGS_URL, async ({ request }) => {
      savedPayload = await request.json()

      return HttpResponse.json({ success: true })
    }),
  )
}

async function recipientsField() {
  return (await screen.findByLabelText('Email addresses')) as HTMLInputElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('NotificationsTab default recipients', () => {
  it('keeps the comma the user types instead of swallowing it', async () => {
    seed(['admin@example.com'])
    renderWithProviders(<NotificationsTab />)

    const field = await recipientsField()

    expect(field.value).toBe('admin@example.com')

    fireEvent.change(field, { target: { value: 'admin@example.com,' } })
    expect(field.value).toBe('admin@example.com,')

    fireEvent.change(field, { target: { value: 'admin@example.com, ' } })
    expect(field.value).toBe('admin@example.com, ')

    fireEvent.change(field, { target: { value: 'admin@example.com, ops@example.com' } })
    expect(field.value).toBe('admin@example.com, ops@example.com')
  })

  it('saves a comma separated list as one entry per address', async () => {
    seed(['admin@example.com'])
    renderWithProviders(<NotificationsTab />)

    const field = await recipientsField()

    fireEvent.change(field, { target: { value: 'admin@example.com, ops@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(savedPayload).not.toBeNull())
    expect(savedPayload.email.default_recipients).toEqual(['admin@example.com', 'ops@example.com'])
  })

  it('accepts a semicolon as a separator rather than gluing both addresses together', async () => {
    seed([])
    renderWithProviders(<NotificationsTab />)

    const field = await recipientsField()

    fireEvent.change(field, { target: { value: 'admin@example.com; ops@example.com' } })
    expect(field.value).toBe('admin@example.com; ops@example.com')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedPayload).not.toBeNull())
    expect(savedPayload.email.default_recipients).toEqual(['admin@example.com', 'ops@example.com'])
  })

  it('repairs a glued list saved before the fix and shows one chip per address', async () => {
    seed(['admin@example.com; ops@example.com'])
    renderWithProviders(<NotificationsTab />)

    const field = await recipientsField()

    expect(field.value).toBe('admin@example.com, ops@example.com')
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText('ops@example.com')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedPayload).not.toBeNull())
    expect(savedPayload.email.default_recipients).toEqual(['admin@example.com', 'ops@example.com'])
  })

  it('warns about an address that cannot be one, without blocking the save', async () => {
    seed(['admin@example.com'])
    renderWithProviders(<NotificationsTab />)

    const field = await recipientsField()

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'admin@example.com, oops' } })
    fireEvent.blur(field)
    expect(await screen.findByText('These addresses look invalid: oops')).toBeInTheDocument()

    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

    expect(save).not.toBeDisabled()
  })

  it('stays quiet while the address is still being typed', async () => {
    seed([])
    renderWithProviders(<NotificationsTab />)

    const field = await recipientsField()

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'a' } })
    expect(screen.queryByText(/look invalid/)).not.toBeInTheDocument()

    fireEvent.change(field, { target: { value: 'admin@example.com' } })
    fireEvent.blur(field)
    expect(screen.queryByText(/look invalid/)).not.toBeInTheDocument()
  })

  it('removes an address from the text when its chip is deleted', async () => {
    seed(['admin@example.com', 'ops@example.com'])
    renderWithProviders(<NotificationsTab />)

    const field = await recipientsField()

    expect(field.value).toBe('admin@example.com, ops@example.com')

    const chip = screen.getByText('admin@example.com').closest('.MuiChip-root') as HTMLElement

    fireEvent.click(chip.querySelector('.MuiChip-deleteIcon') as HTMLElement)
    expect(field.value).toBe('ops@example.com')
  })
})
