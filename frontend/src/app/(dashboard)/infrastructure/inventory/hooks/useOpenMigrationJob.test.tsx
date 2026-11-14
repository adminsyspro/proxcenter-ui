import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

import { requestOpenMigrationJob } from '@/lib/migration/migrationJobOpen'
import { useOpenMigrationJob } from './useOpenMigrationJob'

const JOB = { id: 'j1', sourceConnectionId: 'vc1', sourceVmId: 'vm-20128', sourceVmName: 'i317-src', config: { sourceType: 'vcenter' } }
const VM = { vmid: 'vm-20128', name: 'i317-src', connId: 'vc1', connName: '', hostType: 'vcenter', restoreJobId: 'j1' }

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: JOB }) } as any)
  window.history.replaceState(null, '', '/infrastructure/inventory')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useOpenMigrationJob', () => {
  it('reopens the migrate dialog of a run asked for from the task bar or the menu', async () => {
    const onOpen = vi.fn()
    renderHook(() => useOpenMigrationJob({ onOpen, onError: vi.fn(), ready: true }))

    expect(requestOpenMigrationJob('j1')).toBe(true)
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(VM))
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/migrations/j1')
  })

  it('reopens the run named in the address once, after a navigation or a reload', async () => {
    window.history.replaceState(null, '', '/infrastructure/inventory?selectType=ext&selectId=vc1&openMigration=j1')
    const onOpen = vi.fn()
    const { rerender } = renderHook(() => useOpenMigrationJob({ onOpen, onError: vi.fn(), ready: true }))

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(VM))
    rerender()
    expect(onOpen).toHaveBeenCalledTimes(1)
    // dropped from the address, so a reload or a back does not reopen a dialog the operator closed
    expect(window.location.search).toBe('?selectType=ext&selectId=vc1')
  })

  it('waits for the page to have selected the source host before opening the run of the address', async () => {
    // Seen at the bench: opened before the deep link applied its selection, the
    // dialog was gone once the page settled on the host.
    window.history.replaceState(null, '', '/infrastructure/inventory?selectType=ext&selectId=vc1&openMigration=j1')
    const onOpen = vi.fn()
    const { rerender } = renderHook(({ ready }) => useOpenMigrationJob({ onOpen, onError: vi.fn(), ready }), { initialProps: { ready: false } })

    await new Promise(r => setTimeout(r, 20))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(window.location.search).toContain('openMigration=j1')
    rerender({ ready: true })
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(VM))
  })

  it('tells the page a run is asked for in the address, so it does not open the batch of that host instead', async () => {
    // Read when the page decides, not frozen at mount: after a navigation the
    // address can still be the previous page's when the panel mounts.
    const { result, rerender } = renderHook(({ ready }) => useOpenMigrationJob({ onOpen: vi.fn(), onError: vi.fn(), ready }), { initialProps: { ready: false } })
    expect(result.current.askedInAddress()).toBe(false)
    window.history.replaceState(null, '', '/infrastructure/inventory?selectType=ext&selectId=vc1&openMigration=j1')
    expect(result.current.askedInAddress()).toBe(true)
    // still true once handled and dropped from the address
    rerender({ ready: true })
    await waitFor(() => expect(window.location.search).not.toContain('openMigration'))
    expect(result.current.askedInAddress()).toBe(true)
  })

  it('says so when the run cannot be read, instead of opening nothing in silence', async () => {
    fetchSpy.mockResolvedValue({ ok: false, json: async () => ({ error: 'Forbidden' }) } as any)
    const onOpen = vi.fn()
    const onError = vi.fn()
    renderHook(() => useOpenMigrationJob({ onOpen, onError, ready: true }))

    requestOpenMigrationJob('j1')
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Forbidden'))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('stops listening once the page is gone', () => {
    const { unmount } = renderHook(() => useOpenMigrationJob({ onOpen: vi.fn(), onError: vi.fn(), ready: true }))
    unmount()
    expect(requestOpenMigrationJob('j1')).toBe(false)
  })
})
