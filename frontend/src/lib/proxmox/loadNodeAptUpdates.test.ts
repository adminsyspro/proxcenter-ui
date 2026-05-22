import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  aggregatePermissionErrors,
  loadNodeAptUpdates,
  type AptUpdateEntry,
} from './loadNodeAptUpdates'

function makeSetter() {
  const state: Record<string, AptUpdateEntry> = {}
  const setter = vi.fn((updater: (prev: typeof state) => typeof state) => {
    Object.assign(state, updater(state))
  })
  return { state, setter }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('loadNodeAptUpdates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('stores the package list, count and pve-manager version on success', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          { package: 'pve-manager', currentVersion: '9.1.1', newVersion: '9.1.9' },
          { package: 'qemu-server', currentVersion: '8.0.0', newVersion: '8.1.0' },
        ],
        count: 2,
        nodeVersion: '9.1.1',
      }),
    )

    await loadNodeAptUpdates({ connId: 'c1', nodeName: 'pve1', setNodeUpdates: setter, fetcher })

    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/connections/c1/nodes/pve1/apt',
    )
    expect(state.pve1).toMatchObject({
      count: 2,
      version: '9.1.1',
      loading: false,
      permissionError: null,
    })
    expect(state.pve1.updates).toHaveLength(2)
  })

  it('falls back to nodeVersion when pve-manager is not in the update list', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({ data: [], count: 0, nodeVersion: '9.1.1' }),
    )

    await loadNodeAptUpdates({ connId: 'c1', nodeName: 'pve1', setNodeUpdates: setter, fetcher })

    expect(state.pve1.version).toBe('9.1.1')
  })

  it('falls back to versionFallback when both pve-manager and nodeVersion are missing', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({ data: [], count: 0 }),
    )

    await loadNodeAptUpdates({
      connId: 'c1',
      nodeName: 'pve1',
      setNodeUpdates: setter,
      versionFallback: '8.4.1',
      fetcher,
    })

    expect(state.pve1.version).toBe('8.4.1')
  })

  it('surfaces permissionError from the GET response body', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({ data: [], count: 0, permissionError: 'Sys.Modify', nodeVersion: '9.1.1' }),
    )

    await loadNodeAptUpdates({ connId: 'c1', nodeName: 'pve1', setNodeUpdates: setter, fetcher })

    expect(state.pve1.permissionError).toBe('Sys.Modify')
    expect(state.pve1.version).toBe('9.1.1')
  })

  it('triggers POST then re-GETs when needsRefresh is true', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ needsRefresh: true, data: [], count: 0, nodeVersion: '9.1.1' }))
      .mockResolvedValueOnce(jsonResponse({ data: ['upid'] }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ package: 'pve-manager', currentVersion: '9.1.1', newVersion: '9.1.9' }],
          count: 1,
          nodeVersion: '9.1.1',
        }),
      )

    await loadNodeAptUpdates({ connId: 'c1', nodeName: 'pve1', setNodeUpdates: setter, fetcher })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[1]).toEqual(['/api/v1/connections/c1/nodes/pve1/apt', { method: 'POST' }])
    expect(state.pve1).toMatchObject({ count: 1, version: '9.1.1', permissionError: null })
  })

  it('sets permissionError when POST refresh returns 403, preserving nodeVersion from re-GET', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ needsRefresh: true, data: [], count: 0, nodeVersion: '9.1.1' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'permissionDenied', requiredPermission: 'Sys.Modify' }, 403))
      .mockResolvedValueOnce(jsonResponse({ data: [], count: 0, nodeVersion: '9.1.1' }))

    await loadNodeAptUpdates({ connId: 'c1', nodeName: 'pve1', setNodeUpdates: setter, fetcher })

    expect(state.pve1.permissionError).toBe('Sys.Modify')
    expect(state.pve1.version).toBe('9.1.1')
    expect(state.pve1.count).toBe(0)
  })

  it('defaults permissionError to Sys.Modify when POST 403 body lacks requiredPermission', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ needsRefresh: true, data: [], count: 0 }))
      .mockResolvedValueOnce(jsonResponse({}, 403))
      .mockResolvedValueOnce(jsonResponse({ data: [], count: 0 }))

    await loadNodeAptUpdates({ connId: 'c1', nodeName: 'pve1', setNodeUpdates: setter, fetcher })

    expect(state.pve1.permissionError).toBe('Sys.Modify')
  })

  it('still sets a permissionError on POST 403 even when the re-GET itself fails', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ needsRefresh: true, data: [], count: 0 }))
      .mockResolvedValueOnce(jsonResponse({ requiredPermission: 'Sys.Modify' }, 403))
      .mockRejectedValueOnce(new Error('network down'))

    await loadNodeAptUpdates({ connId: 'c1', nodeName: 'pve1', setNodeUpdates: setter, fetcher })

    expect(state.pve1).toMatchObject({
      count: 0,
      updates: [],
      version: null,
      permissionError: 'Sys.Modify',
    })
  })

  it('resets the entry on a top-level fetch failure', async () => {
    const { state, setter } = makeSetter()
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('boom'))

    await loadNodeAptUpdates({ connId: 'c1', nodeName: 'pve1', setNodeUpdates: setter, fetcher })

    expect(state.pve1).toEqual({
      count: 0,
      updates: [],
      version: null,
      loading: false,
      permissionError: null,
    })
  })

  it('encodes connection id and node name into the apt URL', async () => {
    const { setter } = makeSetter()
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [], count: 0 }))

    await loadNodeAptUpdates({
      connId: 'conn with space',
      nodeName: 'pve/01',
      setNodeUpdates: setter,
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/connections/conn%20with%20space/nodes/pve%2F01/apt',
    )
  })

  describe('aggregatePermissionErrors', () => {
    it('returns null when no node has a permission error', () => {
      const result = aggregatePermissionErrors({
        pve1: { permissionError: null },
        pve2: { permissionError: undefined },
        pve3: {},
      })
      expect(result).toBeNull()
    })

    it('returns null on an empty map', () => {
      expect(aggregatePermissionErrors({})).toBeNull()
    })

    it('skips undefined entries (e.g. nodes still loading)', () => {
      const result = aggregatePermissionErrors({
        pve1: undefined,
        pve2: { permissionError: 'Sys.Modify' },
      })
      expect(result).toEqual({ nodes: ['pve2'], permission: 'Sys.Modify' })
    })

    it('collects every affected node name and picks the first permission as representative', () => {
      const result = aggregatePermissionErrors({
        pve1: { permissionError: 'Sys.Modify' },
        pve2: { permissionError: null },
        pve3: { permissionError: 'Sys.Audit' },
        pve4: { permissionError: 'Sys.Modify' },
      })
      expect(result?.nodes).toEqual(['pve1', 'pve3', 'pve4'])
      expect(result?.permission).toBe('Sys.Modify')
    })
  })

  describe('forceRefresh', () => {
    it('POSTs first then GETs, skipping the initial GET', async () => {
      const { state, setter } = makeSetter()
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ data: ['upid'] }))
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ package: 'pve-manager', currentVersion: '9.1.1', newVersion: '9.1.9' }],
            count: 1,
            nodeVersion: '9.1.1',
          }),
        )

      await loadNodeAptUpdates({
        connId: 'c1',
        nodeName: 'pve1',
        setNodeUpdates: setter,
        forceRefresh: true,
        fetcher,
      })

      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(fetcher.mock.calls[0]).toEqual(['/api/v1/connections/c1/nodes/pve1/apt', { method: 'POST' }])
      expect(fetcher.mock.calls[1]).toEqual(['/api/v1/connections/c1/nodes/pve1/apt'])
      expect(state.pve1).toMatchObject({ count: 1, version: '9.1.1', permissionError: null })
    })

    it('sets permissionError and keeps version when the POST is rejected with 403', async () => {
      const { state, setter } = makeSetter()
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ requiredPermission: 'Sys.Modify' }, 403))
        .mockResolvedValueOnce(jsonResponse({ data: [], count: 0, nodeVersion: '9.1.1' }))

      await loadNodeAptUpdates({
        connId: 'c1',
        nodeName: 'pve1',
        setNodeUpdates: setter,
        forceRefresh: true,
        fetcher,
      })

      expect(state.pve1).toMatchObject({
        count: 0,
        version: '9.1.1',
        permissionError: 'Sys.Modify',
      })
    })

    it('resets the entry when the POST itself throws', async () => {
      const { state, setter } = makeSetter()
      const fetcher = vi.fn().mockRejectedValueOnce(new Error('network'))

      await loadNodeAptUpdates({
        connId: 'c1',
        nodeName: 'pve1',
        setNodeUpdates: setter,
        forceRefresh: true,
        fetcher,
      })

      expect(state.pve1).toEqual({
        count: 0,
        updates: [],
        version: null,
        loading: false,
        permissionError: null,
      })
    })
  })
})
