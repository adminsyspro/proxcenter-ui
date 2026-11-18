/**
 * Dissociating a cluster: the guests each side stops recognising, the cluster keeping its rules, and the call only
 * once the name has been typed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, reply, resetMocks, zone } from './microsegTestKit'
import DissociateClusterDialog from './DissociateClusterDialog'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const GUESTS = [
  { connectionId: 'c2', tags: ['zone-web'] },
  { connectionId: 'c2', tags: ['zone-web'] },
  { connectionId: 'c2', tags: ['zone-web'] },
  { connectionId: 'c1', tags: ['zone-web'] },
]

function open(guests: typeof GUESTS | null = GUESTS) {
  const handlers = { onDone: vi.fn(), onCancel: vi.fn() }
  renderWithProviders(
    <DissociateClusterDialog
      connectionId='c1'
      target={{ id: 'c2', name: 'PVE-DR' }}
      guests={guests ?? undefined}
      zones={[zone('web', { state: 'enforce' })]}
      tagPrefix='zone-'
      {...handlers}
    />,
  )
  return handlers
}

const confirm = () => screen.getByRole('button', { name: 'Dissociate' }) as HTMLButtonElement

describe('DissociateClusterDialog', () => {
  it('shows the guests each side will no longer recognise, and that the cluster keeps its rules', () => {
    open()
    expect(screen.getByText('3 guests of PVE-DR will no longer be recognised by the other clusters, 1 guest the other way.')).toBeTruthy()
    expect(screen.getByText('PVE-DR keeps its rules, with its own copy of the policy.')).toBeTruthy()
  })

  it('shows no count while the guests of the group are unknown', () => {
    open(null)
    expect(screen.queryByText(/will no longer be recognised/)).toBeNull()
    expect(screen.getByText('PVE-DR keeps its rules, with its own copy of the policy.')).toBeTruthy()
  })

  it('dissociates only once the name has been typed', async () => {
    mock.routes['DELETE /clusters/c2'] = () => reply(200, { clusters: [], max: 8 })
    const { onDone } = open()
    expect(confirm().disabled).toBe(true)
    fireEvent.click(confirm())
    expect(calls('DELETE /clusters/c2')).toHaveLength(0)

    fireEvent.change(screen.getByRole('textbox', { name: 'Type PVE-DR to confirm' }), { target: { value: 'PVE-DR' } })
    fireEvent.click(confirm())
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(calls('DELETE /clusters/c2')).toHaveLength(1)
  })

  it('keeps the dialog open with the error of a refusal', async () => {
    mock.routes['DELETE /clusters/c2'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    const { onDone } = open()
    fireEvent.change(screen.getByRole('textbox', { name: 'Type PVE-DR to confirm' }), { target: { value: 'PVE-DR' } })
    fireEvent.click(confirm())
    await waitFor(() => expect(calls('DELETE /clusters/c2')).toHaveLength(1))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })
})
