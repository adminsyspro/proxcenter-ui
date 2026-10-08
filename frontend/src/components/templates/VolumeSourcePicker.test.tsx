import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import VolumeSourcePicker, { type VolumeLocation } from './VolumeSourcePicker'

// The picker of a volume image's source or of one of its copies (#44): each
// level is fetched from the one above it, and only the chosen volume is
// reported back through onChange.
const CONNS = [{ id: 'c-prod', name: 'PVE-PROD' }, { id: 'c-dr', name: 'PVE-DR' }]
const VOL = 'local:import/golden.qcow2'

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    let data: unknown[] = []
    if (url.endsWith('/nodes')) data = [{ node: 'pve1', status: 'online' }, { node: 'pve9', status: 'offline' }]
    else if (url.endsWith('/storages')) data = [{ storage: 'local', type: 'dir' }, { storage: 'off', type: 'dir', enabled: 0 }]
    else if (url.endsWith('/content')) data = [{ volid: VOL, content: 'import', size: 2147483648 }, { volid: 'local:backup/x.vma', content: 'backup' }]
    return { json: async () => ({ data }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function Harness({ initial, onChange }: { initial: VolumeLocation; onChange: (v: VolumeLocation) => void }) {
  return <VolumeSourcePicker connections={CONNS} value={initial} onChange={onChange} />
}

describe('VolumeSourcePicker', () => {
  beforeEach(() => { stubFetch() })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('auto-picks the only online node of the cluster', async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness initial={{ connectionId: 'c-prod', node: '', volumeId: '' }} onChange={onChange} />)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ connectionId: 'c-prod', node: 'pve1', volumeId: '' }))
  })

  it('lists the importable volumes of the stored storage and reports the one clicked', async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness initial={{ connectionId: 'c-prod', node: 'pve1', volumeId: VOL }} onChange={onChange} />)
    const volume = await screen.findByText(VOL, { selector: 'p' })
    expect(screen.getByText('2.0 GB')).toBeTruthy()
    expect(screen.queryByText('local:backup/x.vma')).toBeNull()
    await userEvent.click(volume)
    expect(onChange).toHaveBeenLastCalledWith({ connectionId: 'c-prod', node: 'pve1', volumeId: VOL })
  })

  it('resets the node when another cluster is chosen, and accepts a typed volume ID', async () => {
    const onChange = vi.fn()
    renderWithProviders(<Harness initial={{ connectionId: 'c-prod', node: 'pve1', volumeId: '' }} onChange={onChange} />)
    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByRole('option', { name: 'PVE-DR' }))
    expect(onChange).toHaveBeenCalledWith({ connectionId: 'c-dr', node: '', volumeId: '' })

    await userEvent.type(screen.getByLabelText(/Volume ID/), 'x')
    expect(onChange).toHaveBeenLastCalledWith({ connectionId: 'c-prod', node: 'pve1', volumeId: 'x' })
  })

  it('says so when the chosen storage holds no importable volume', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      json: async () => ({ data: url.endsWith('/storages') ? [{ storage: 'local', type: 'dir' }] : url.endsWith('/nodes') ? [{ node: 'pve1', status: 'online' }] : [] }),
    })))
    renderWithProviders(<Harness initial={{ connectionId: 'c-prod', node: 'pve1', volumeId: 'local:import/gone.qcow2' }} onChange={vi.fn()} />)
    expect(await screen.findByText('No image files found on this storage.')).toBeTruthy()
  })
})
