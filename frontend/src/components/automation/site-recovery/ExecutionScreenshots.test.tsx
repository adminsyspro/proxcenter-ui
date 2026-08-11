import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import ExecutionScreenshots from './ExecutionScreenshots'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Distinct execution ids per test: SWR caches by key across renders.
function stubList(shots: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(shots), { status: 200, headers: { 'content-type': 'application/json' } })
  )

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

describe('ExecutionScreenshots', () => {
  it('renders one clickable thumbnail per screenshot', async () => {
    stubList([
      { vm_id: 100, target_vmid: 9100, captured_at: '2026-08-10T20:00:00Z' },
      { vm_id: 101, target_vmid: 9101, captured_at: '2026-08-10T20:00:05Z' },
    ])

    renderWithProviders(
      // renderWithProviders's own SWRConfig sets revalidateOnMount:false (to keep
      // other tests from triggering background fetches); this component's thumbnail
      // list depends on a real SWR fetch resolving, so override it back on here —
      // SWRConfig context merges when nested (see CreateJobDialog.test.tsx).
      <SWRConfig value={{ revalidateOnMount: true }}>
        <ExecutionScreenshots executionId='exec-thumbs' vmNameMap={{ 100: 'web-01' }} />
      </SWRConfig>
    )

    await waitFor(() => {
      expect(screen.getByAltText('web-01')).toBeInTheDocument()
    })
    expect(screen.getByAltText('VM 101')).toBeInTheDocument()
    expect(screen.getByAltText('web-01').getAttribute('src')).toBe(
      '/api/v1/orchestrator/replication/executions/exec-thumbs/screenshots/100'
    )
  })

  it('renders nothing when the execution has no screenshots', async () => {
    const fetchMock = stubList([])

    const { container } = renderWithProviders(
      // Same override as above: renderWithProviders disables revalidateOnMount,
      // so without this the fetch never fires and the assertion below would
      // pass for the wrong reason (never-fetched, not empty-after-fetch).
      <SWRConfig value={{ revalidateOnMount: true }}>
        <ExecutionScreenshots executionId='exec-empty' />
      </SWRConfig>
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(container.innerHTML).toBe('')
  })
})
