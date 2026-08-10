/**
 * Component tests for CreateJobDialog's VMID-prefix field (discussion #634).
 *
 * The field is a sentinel-blank one: 0 means "no prefix" and must display as an
 * empty box. It used to do that with `value={vmidPrefix || ''}` on the way in
 * plus `Number(v) || 0` on the way out — a round trip that made the box
 * impossible to correct, since the JSX rewrote whatever the parent recomputed.
 * The blank now comes from `format`, so the buffer is the user's to edit.
 *
 * The dialog is rendered with no connections and no VMs: every fetch it owns is
 * keyed off a selected cluster, so nothing hits the network here.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, userEvent, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import CreateJobDialog from './CreateJobDialog'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDialog() {
  renderWithProviders(
    <CreateJobDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={[]} allVMs={[]} />,
  )
}

// No bandwidth window and no cluster selected, so the numeric inputs are, in
// DOM order: retention-source, retention-target, VMID prefix.
const prefix = () => screen.getAllByRole('spinbutton').at(-1) as HTMLInputElement
const blur = () => userEvent.click(screen.getByText('VMID Prefix'))
// getByRole('spinbutton'): the sliders now carry the same accessible name, so
// getByLabelText would match two elements per retention setting.
const retentionSource = () => screen.getByRole('spinbutton', { name: 'Keep on source' }) as HTMLInputElement
const retentionTarget = () => screen.getByRole('spinbutton', { name: 'Keep on target (DR)' }) as HTMLInputElement

describe('CreateJobDialog VMID prefix', () => {
  it('renders blank rather than 0 when no prefix is set', () => {
    renderDialog()
    expect(prefix().value).toBe('')
  })

  it('accepts a typed prefix', async () => {
    renderDialog()
    await userEvent.type(prefix(), '9')
    expect(prefix().value).toBe('9')
  })

  it('can be corrected without gluing the old digit in front', async () => {
    renderDialog()
    await userEvent.type(prefix(), '9')
    await userEvent.clear(prefix())
    expect(prefix().value).toBe('')
    await userEvent.type(prefix(), '12')
    expect(prefix().value).toBe('12')
  })

  it('falls back to blank (0) when left empty', async () => {
    renderDialog()
    await userEvent.type(prefix(), '9')
    await userEvent.clear(prefix())
    await blur()
    expect(prefix().value).toBe('')
  })
})

describe('CreateJobDialog snapshot retention (issue #664)', () => {
  it('shows the default retention of 3 on both source and target', () => {
    renderDialog()
    expect(retentionSource().value).toBe('3')
    expect(retentionTarget().value).toBe('3')
  })

  it('includes snapshot_keep_source/target in the submitted payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/connections/src/ceph-vms') {
        return new Response(JSON.stringify({ data: [{ vmid: 100, cephDiskGb: 10 }] }), { status: 200 })
      }
      if (url === '/api/v1/orchestrator/replication/check-ssh' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ connected: true, source_node: 'node1', target_ip: '10.0.0.1' }),
          { status: 200 },
        )
      }
      if (url === '/api/v1/connections/dst/ceph') {
        return new Response(
          JSON.stringify({
            data: { pools: { list: [{ name: 'rbd', percentUsed: 0.1, bytesUsed: 100, maxAvail: 900, bytesUsedFormatted: '100 MB', maxAvailFormatted: '900 MB' }] } },
          }),
          { status: 200 },
        )
      }
      if (url === '/api/v1/orchestrator/replication/preflight' && init?.method === 'POST') {
        return new Response(JSON.stringify({ checks: [], can_create: true }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }))

    const onSubmit = vi.fn()
    renderWithProviders(
      // renderWithProviders's own SWRConfig sets revalidateOnMount:false (to
      // keep other tests from triggering background fetches); this dialog's
      // VM list depends on a real SWR fetch resolving, so override it back
      // on for this one render — SWRConfig context merges when nested.
      <SWRConfig value={{ revalidateOnMount: true }}>
        <CreateJobDialog
          open
          onClose={vi.fn()}
          onSubmit={onSubmit}
          connections={[
            { id: 'src', name: 'Source', hasCeph: true },
            { id: 'dst', name: 'Target', hasCeph: true },
          ]}
          allVMs={[{ vmid: 100, name: 'web-01', node: 'node1', connId: 'src', type: 'qemu', status: 'running', tags: [], diskGb: 10 }]}
        />
      </SWRConfig>,
    )

    // Source cluster
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByRole('option', { name: 'Source' }))

    // Select the only VM (its ceph-vms entry must resolve first)
    await userEvent.click(await screen.findByRole('checkbox', { name: /web-01/ }))

    // Target cluster
    fireEvent.mouseDown(screen.getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Target' }))

    // Target pool (Select enables once the Ceph pools fetch resolves)
    await waitFor(() => expect(screen.getAllByRole('combobox')[2]).not.toHaveAttribute('aria-disabled', 'true'))
    fireEvent.mouseDown(screen.getAllByRole('combobox')[2])
    await userEvent.click(await screen.findByRole('option', { name: /rbd/ }))

    // The Create button only enables once the SSH check succeeds
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Job' })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: 'Create Job' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      snapshot_keep_source: 3,
      snapshot_keep_target: 3,
    }))
  })
})
