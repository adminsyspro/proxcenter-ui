import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import AIActionsTab from './AIActionsTab'

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const off = { snapshot: false, start: false, migrate: false, drs_apply: false, backup_add: false, shutdown: false, reboot: false, maintenance: false }
let stored: any
let fetchMock: ReturnType<typeof vi.fn>

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  toast.success.mockReset()
  toast.error.mockReset()
  stored = { enabled: true, actions: { ...off, snapshot: true }, maxPerConversation: 5 }
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return respond(200, { success: true, data: JSON.parse(String(init.body)) })

    return respond(200, { data: stored })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save' })

async function renderLoaded() {
  renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true }}>
      <AIActionsTab />
    </SWRConfig>,
  )
  await waitFor(() => expect(box('Create a snapshot')).toBeChecked())
}

describe('AIActionsTab', () => {
  it('shows the approval notice and loads the saved settings with save disabled', async () => {
    await renderLoaded()
    expect(screen.getByText(/never runs anything on its own/)).toBeInTheDocument()
    expect(screen.getByText(/vDC tenants follow these settings/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Allow the assistant to propose actions' })).toBeChecked()
    expect(box('Start a guest')).not.toBeChecked()
    expect(screen.getByLabelText('Max actions per conversation')).toHaveValue(5)
    expect(save()).toBeDisabled()
  })

  it('gives each group an All box with three states', async () => {
    await renderLoaded()
    const [safeAll, disruptiveAll] = screen.getAllByRole('checkbox', { name: 'All' }) as HTMLInputElement[]

    expect(safeAll.dataset.indeterminate).toBe('true')
    expect(disruptiveAll.dataset.indeterminate).toBe('false')
    expect(disruptiveAll).not.toBeChecked()

    fireEvent.click(safeAll)
    for (const n of ['Create a snapshot', 'Start a guest', 'Migrate a guest', 'Apply a DRS recommendation', 'Add a guest to a backup job']) {
      expect(box(n)).toBeChecked()
    }
    expect(safeAll).toBeChecked()
    expect(box('Shut down a guest')).not.toBeChecked()

    fireEvent.click(safeAll)
    expect(box('Create a snapshot')).not.toBeChecked()
    expect(safeAll).not.toBeChecked()

    fireEvent.click(disruptiveAll)
    expect(box('Reboot a guest')).toBeChecked()
    expect(box('Enter or exit maintenance mode')).toBeChecked()
  })

  it('greys the boxes out when the master switch is off but keeps their values', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('switch', { name: 'Allow the assistant to propose actions' }))
    expect(box('Create a snapshot')).toBeDisabled()
    expect(box('Create a snapshot')).toBeChecked()
    expect(screen.getAllByRole('checkbox', { name: 'All' })[0]).toBeDisabled()
  })

  it('saves the normalised object and takes the returned data back', async () => {
    await renderLoaded()
    fireEvent.click(box('Migrate a guest'))
    fireEvent.change(screen.getByLabelText('Max actions per conversation'), { target: { value: '99' } })
    fireEvent.blur(screen.getByLabelText('Max actions per conversation'))
    fireEvent.click(save())

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('AI actions settings saved'))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!

    expect(put[0]).toBe('/api/v1/settings/ai-actions')
    expect(JSON.parse(put[1].body)).toEqual({
      enabled: true,
      actions: { ...off, snapshot: true, migrate: true },
      maxPerConversation: 20,
    })
    expect(save()).toBeDisabled()
  })

  it('reports a failed save through the toast, never a native dialog', async () => {
    await renderLoaded()
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === 'PUT' ? respond(500, { error: 'boom' }) : respond(200, { data: stored }))
    fireEvent.click(box('Start a guest'))
    fireEvent.click(save())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save the AI actions settings: boom'))
  })
})
