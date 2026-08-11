/**
 * Component tests for SharedTaskDetailDialog.tsx (#608)
 *
 * Strategy: the dialog reads the task through useSWRFetch, which the harness
 * SWRConfig would never fire (revalidateOnMount: false), so the hook is mocked
 * at module level and fed a per-test fixture. The cancel POST goes through the
 * real fetch and is seeded with MSW. Revalidation is asserted through the
 * mocked bound mutate (detail key) and a mocked useSWRConfig mutate (list key).
 *
 * Dialogs render into MUI portals; query with screen.* / within(dialog).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  within,
  fireEvent,
  waitFor,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import SharedTaskDetailDialog from '@/components/SharedTaskDetailDialog'
import type { SharedTask } from '@/lib/tasks/sharedTask'

// ------------------------------------------------------------------ //
// Module mocks (hoisted so the factories can reference them)
// ------------------------------------------------------------------ //

const { mutateDetail, mutateList, state } = vi.hoisted(() => ({
  mutateDetail: vi.fn(),
  mutateList: vi.fn(),
  state: { task: null as SharedTask | null },
}))

// The dialog only reads { data, mutate } from useSWRFetch.
vi.mock('@/hooks/useSWRFetch', () => ({
  useSWRFetch: (url: string | null) => ({
    data: url && state.task ? { data: state.task } : undefined,
    mutate: mutateDetail,
  }),
}))

// Keep the real swr module (the harness needs SWRConfig) but intercept the
// scoped mutate the component uses to revalidate the footer list key.
vi.mock('swr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('swr')>()
  return { ...actual, useSWRConfig: () => ({ mutate: mutateList }) }
})

// ------------------------------------------------------------------ //
// Fixtures
// ------------------------------------------------------------------ //

const JOB_ID = 'job-608'

function makeTask(overrides: Partial<SharedTask> = {}): SharedTask {
  return {
    id: JOB_ID,
    kind: 'migration',
    label: 'web-01 (ESXi -> Proxmox)',
    sourceVmName: 'web-01',
    targetNode: 'pve-1',
    targetVmid: 105,
    status: 'full_copy',
    currentStep: 'Copying disk 1/2',
    progress: 42,
    totalDisks: 2,
    currentDisk: 1,
    bytesTransferred: 1024,
    totalBytes: 4096,
    transferSpeed: '100 MiB/s',
    error: null,
    isMine: false,
    createdByName: 'Alice',
    createdAt: '2026-07-29T10:00:00.000Z',
    startedAt: '2026-07-29T10:00:05.000Z',
    completedAt: null,
    ...overrides,
  }
}

function renderDialog() {
  return renderWithProviders(<SharedTaskDetailDialog jobId={JOB_ID} onClose={vi.fn()} />)
}

/** Open the confirmation dialog and return its root element. */
function openConfirm(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Cancel migration' }))
  const title = screen.getByText('Cancel this migration?')
  return title.closest('[role="dialog"]') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  state.task = makeTask()
})

afterEach(() => {
  cleanup()
})

// ------------------------------------------------------------------ //
// 1. Button visibility
// ------------------------------------------------------------------ //

describe('SharedTaskDetailDialog - cancel button visibility', () => {
  it('shows the cancel button for a non-terminal migration task', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Cancel migration' })).toBeInTheDocument()
  })

  it.each(['completed', 'failed', 'cancelled'])('hides the cancel button for a %s task', (status) => {
    state.task = makeTask({ status })
    renderDialog()
    expect(screen.queryByRole('button', { name: 'Cancel migration' })).not.toBeInTheDocument()
  })

  it('hides the cancel button for a non-migration task kind', () => {
    state.task = makeTask({ kind: 'backup' as SharedTask['kind'] })
    renderDialog()
    expect(screen.queryByRole('button', { name: 'Cancel migration' })).not.toBeInTheDocument()
  })

  it('hides the cancel button while the task is still loading', () => {
    state.task = null
    renderDialog()
    expect(screen.queryByRole('button', { name: 'Cancel migration' })).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 1b. Live progress readout (warm fallback UX: speed/bytes/disk were in the
//     SharedTask payload but never rendered)
// ------------------------------------------------------------------ //

describe('SharedTaskDetailDialog - live progress readout', () => {
  it('renders the full readout: translated step, disk counter, GB progress, speed and ETA', () => {
    state.task = makeTask({
      currentStep: 'full_copy',
      currentDisk: 0, // pipelines write the 0-based loop index
      totalDisks: 2,
      bytesTransferred: 32 * 1073741824,
      totalBytes: 64 * 1073741824,
      transferSpeed: '128 MB/s',
    })
    renderDialog()
    // 32 GiB to go at 128 MB/s -> 256 s -> "4m"
    expect(screen.getByText('Full copy · Disk 1 of 2 · 32.0 / 64.0 GB · 128 MB/s · ~4m remaining')).toBeInTheDocument()
  })

  it('collapses numbered delta passes to the shared translated label', () => {
    state.task = makeTask({ currentStep: 'delta_2', currentDisk: null, bytesTransferred: null, totalBytes: null, transferSpeed: null })
    renderDialog()
    expect(screen.getByText('Delta sync')).toBeInTheDocument()
  })

  it('falls back to the raw currentStep string for unknown steps', () => {
    state.task = makeTask({ currentDisk: null, bytesTransferred: null, totalBytes: null, transferSpeed: null })
    renderDialog()
    expect(screen.getByText('Copying disk 1/2')).toBeInTheDocument()
  })

  it('omits the readout entirely when the task has no live fields', () => {
    state.task = makeTask({ currentStep: null, currentDisk: null, totalDisks: null, bytesTransferred: null, totalBytes: null, transferSpeed: null })
    renderDialog()
    expect(screen.queryByText(/GB|remaining|Disk \d/)).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 2. Confirmation gate
// ------------------------------------------------------------------ //

describe('SharedTaskDetailDialog - confirmation', () => {
  it('requires an explicit confirmation and fires nothing before it', () => {
    const posted = vi.fn()
    server.use(http.post(`*/api/v1/migrations/${JOB_ID}/cancel`, () => {
      posted()
      return HttpResponse.json({ data: { status: 'cancelled' } })
    }))
    renderDialog()

    const confirm = openConfirm()
    // The warning must spell out the leftovers on the target node.
    expect(within(confirm).getByText(/partially created VMID may remain on the target node/i)).toBeInTheDocument()
    expect(posted).not.toHaveBeenCalled()
  })

  it('keeps migrating when the confirmation is declined', async () => {
    const posted = vi.fn()
    server.use(http.post(`*/api/v1/migrations/${JOB_ID}/cancel`, () => {
      posted()
      return HttpResponse.json({ data: { status: 'cancelled' } })
    }))
    renderDialog()

    const confirm = openConfirm()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep migrating' }))
    expect(posted).not.toHaveBeenCalled()
    // MUI keeps the dialog mounted during the close transition.
    await waitFor(() => expect(screen.queryByText('Cancel this migration?')).not.toBeInTheDocument())
  })
})

// ------------------------------------------------------------------ //
// 3. Success path
// ------------------------------------------------------------------ //

describe('SharedTaskDetailDialog - cancel success', () => {
  it('POSTs the cancel endpoint and revalidates detail + footer list keys', async () => {
    const posted = vi.fn()
    server.use(http.post(`*/api/v1/migrations/${JOB_ID}/cancel`, () => {
      posted()
      return HttpResponse.json({ data: { status: 'cancelled' } })
    }))
    renderDialog()

    const confirm = openConfirm()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel migration' }))

    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(mutateDetail).toHaveBeenCalled()
      expect(mutateList).toHaveBeenCalledWith('/api/v1/tasks/shared')
    })
    // Confirmation dialog is gone; no error surfaced.
    await waitFor(() => expect(screen.queryByText('Cancel this migration?')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 4. Error path
// ------------------------------------------------------------------ //

describe('SharedTaskDetailDialog - cancel errors', () => {
  it('surfaces the server 403 message in the dialog', async () => {
    server.use(http.post(`*/api/v1/migrations/${JOB_ID}/cancel`, () =>
      HttpResponse.json({ error: 'Permission denied: vm.migrate' }, { status: 403 }),
    ))
    renderDialog()

    const confirm = openConfirm()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel migration' }))

    await waitFor(() => expect(screen.getByText('Permission denied: vm.migrate')).toBeInTheDocument())
    // Confirm dialog closed so the error alert is not hidden behind it.
    await waitFor(() => expect(screen.queryByText('Cancel this migration?')).not.toBeInTheDocument())
    expect(mutateList).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the server sends no error body', async () => {
    server.use(http.post(`*/api/v1/migrations/${JOB_ID}/cancel`, () =>
      new HttpResponse(null, { status: 500 }),
    ))
    renderDialog()

    const confirm = openConfirm()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel migration' }))

    await waitFor(() => expect(screen.getByText('Failed to cancel the migration')).toBeInTheDocument())
  })
})
