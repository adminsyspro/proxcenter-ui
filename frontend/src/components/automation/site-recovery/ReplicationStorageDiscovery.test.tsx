import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, waitFor } from '@/__tests__/setup/renderWithProviders'
import ReplicationStorageDiscovery from './ReplicationStorageDiscovery'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it.each([200, 502])('reports a storage discovery response with status %i', async status => {
  const data = { engines: ['zfs'], zfs: [], rbd: [] }
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status }))
  vi.stubGlobal('fetch', fetchMock)
  const onChange = vi.fn()
  renderWithProviders(<SWRConfig value={{ revalidateOnMount: true, shouldRetryOnError: false }}>
    <ReplicationStorageDiscovery connectionId='src' onChange={onChange} />
  </SWRConfig>)
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('src', expect.objectContaining({ loading: false, error: status !== 200 })))
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/connections/src/replication-storages')
  if (status === 200) expect(onChange).toHaveBeenLastCalledWith('src', { data, error: false, loading: false })
})
