import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import TopTalkers, { talkersUrl } from './TopTalkers'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const GUESTS = [{ key: 'c2|lxc/205', node: 'pve9', tags: [], vlans: [], ips: [] }]

function render(body: unknown, props: Partial<Parameters<typeof TopTalkers>[0]> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body })))
  return renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, provider: () => new Map() }}>
      <TopTalkers readIds={['c1', 'c2']} shown={['c2']} enabled guests={GUESTS} {...props} />
    </SWRConfig>,
  )
}

describe('TopTalkers', () => {
  it('asks the orchestrator for one cluster, or the fleet for several', () => {
    expect(talkersUrl(['c1'])).toBe('/api/v1/orchestrator/sflow?endpoint=top-talkers&n=100&connection_id=c1')
    expect(talkersUrl(['c1', 'c2'])).toBe('/api/v1/orchestrator/sflow?endpoint=top-talkers&n=100')
  })

  it('keeps the guests of the clusters shown, with the type the guest list gives, and says when none talks', async () => {
    render([
      { vmid: 205, vm_name: 'ct', node: 'pve9', bytes_in: 10, bytes_out: 20, packets: 2, connection_id: 'c2' },
      { vmid: 101, vm_name: 'vm', node: 'pve1', bytes_in: 10, bytes_out: 20, packets: 2, connection_id: 'c1' },
      { vmid: 300, node: '', bytes_in: 0, bytes_out: 0, packets: 0, connection_id: 'c2' },
    ])
    const rows = await screen.findAllByTestId('talker-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('ct')
    expect(rows[0].querySelector('.ri-instance-line, [class*="instance"]')).toBeTruthy()
    cleanup()

    render([{ vmid: 300, vm_name: 'idle', node: '', bytes_in: 0, bytes_out: 0, packets: 0, connection_id: 'c2' }])
    expect(await screen.findByTestId('talkers-empty')).toBeTruthy()
  })

  it('reads nothing and shows nothing while sFlow does not measure the clusters', async () => {
    render([], { enabled: false })
    await waitFor(() => expect(screen.queryByTestId('talkers-card')).toBeNull())
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
