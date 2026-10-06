import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import PendingChangesWarning from './PendingChangesWarning'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, unknown>) => (vals ? `${k} ${JSON.stringify(vals)}` : k),
}))

const CHANGES: Record<string, unknown[]> = {
  '100': [{ key: 'memory', value: '2048', pending: '4096' }, { key: 'net1', delete: true }],
  '101': [],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    const vmid = url.split('/')[8]
    if (vmid === '102') return new Response('{}', { status: 403 })
    return new Response(JSON.stringify({ data: { changes: CHANGES[vmid] } }))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const guest = (vmid: string, name: string) => ({ connId: 'conn-1', node: 'pve1', type: 'qemu', vmid, name })

describe('PendingChangesWarning (#926)', () => {
  it('names the guests with changes waiting for a restart and their keys', async () => {
    render(<PendingChangesWarning guests={[guest('100', 'web'), guest('101', 'db'), guest('102', 'secret')]} />)

    expect(await screen.findByText('migrationPreflight.pendingTitle {"count":1}')).toBeInTheDocument()
    expect(screen.getByText('migrationPreflight.pendingBody')).toBeInTheDocument()
    expect(screen.getByText('web')).toBeInTheDocument()
    expect(screen.getByText(/memory, net1/)).toBeInTheDocument()
    expect(screen.queryByText('db')).not.toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('renders nothing when no guest has pending changes', async () => {
    const { container } = render(<PendingChangesWarning guests={[guest('101', 'db')]} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('asks nothing without guests', () => {
    const { container } = render(<PendingChangesWarning guests={[]} />)

    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
