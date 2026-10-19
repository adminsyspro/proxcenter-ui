import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { http, HttpResponse, server } from '@/__tests__/setup/msw-server'

import RestoreDrillSettingsDialog, { invalidSettingsFields } from './RestoreDrillSettingsDialog'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const ROW = {
  max_concurrent: 1, capacity_budget_gb: 0, free_space_margin_pct: 10, restore_timeout_sec: 14400,
  boot_timeout_sec: 600, agent_timeout_sec: 300, default_network_mode: 'link_down', default_bridge: '',
  screenshot_delay_sec: 45,
}

beforeEach(() => {
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(() => cleanup())

describe('invalidSettingsFields', () => {
  it('flags every out-of-range value', () => {
    expect(invalidSettingsFields(ROW as any)).toEqual([])
    expect(invalidSettingsFields({ ...ROW, max_concurrent: 0, agent_timeout_sec: 2000, boot_timeout_sec: 1.5 } as any))
      .toEqual(['max_concurrent', 'boot_timeout_sec', 'agent_timeout_sec'])
    expect(invalidSettingsFields({ ...ROW, screenshot_delay_sec: 0 } as any)).toEqual([])
    expect(invalidSettingsFields({ ...ROW, screenshot_delay_sec: 601 } as any)).toEqual(['screenshot_delay_sec'])
  })
})

describe('RestoreDrillSettingsDialog', () => {
  it('loads, validates and saves the settings row', async () => {
    let saved: any = null
    server.use(
      http.get('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json(ROW)),
      http.put('*/api/v1/backups/restore-drills/settings', async ({ request }) => {
        saved = await request.json()
        return HttpResponse.json(saved)
      }),
    )
    const onClose = vi.fn()
    const onSaved = vi.fn()
    renderWithProviders(<RestoreDrillSettingsDialog onClose={onClose} onSaved={onSaved} />)
    const concurrent = await screen.findByLabelText('Simultaneous drills')
    fireEvent.change(concurrent, { target: { value: '12' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(concurrent, { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Default isolated bridge'), { target: { value: ' vmbr9 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(saved).toMatchObject({ max_concurrent: 3, default_bridge: 'vmbr9' })
    expect(onSaved).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Restore drill settings saved')
  })

  it('edits the screenshot delay within 0 to 600 s, 45 s for a row that predates it', async () => {
    let saved: any = null
    const { screenshot_delay_sec: _omitted, ...legacy } = ROW
    server.use(
      http.get('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json(legacy)),
      http.put('*/api/v1/backups/restore-drills/settings', async ({ request }) => {
        saved = await request.json()
        return HttpResponse.json(saved)
      }),
    )
    const onClose = vi.fn()
    renderWithProviders(<RestoreDrillSettingsDialog onClose={onClose} />)
    const delay = await screen.findByLabelText('Screenshot delay (s)')
    expect(delay).toHaveValue('45')
    expect(screen.getByText('Between 0 and 600')).toBeInTheDocument()
    fireEvent.change(delay, { target: { value: '601' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(delay, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(saved).toMatchObject({ screenshot_delay_sec: 0 })
  })

  it('shows the orchestrator refusal', async () => {
    server.use(
      http.get('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json(ROW)),
      http.put('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json({ error: 'out of range' }, { status: 400 })),
    )
    renderWithProviders(<RestoreDrillSettingsDialog onClose={vi.fn()} />)
    await screen.findByLabelText('Simultaneous drills')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save the settings: out of range')).toBeInTheDocument()
  })

  it('reports a load failure', async () => {
    server.use(http.get('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json({ error: 'Feature not licensed' }, { status: 403 })))
    renderWithProviders(<RestoreDrillSettingsDialog onClose={vi.fn()} />)
    expect(await screen.findByText('Could not load the settings: Feature not licensed')).toBeInTheDocument()
  })
})
