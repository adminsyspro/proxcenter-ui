import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, within, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import HaNodeCard from './HaNodeCard'
import type { PatroniMember } from './useHaCluster'

// MUI refuses to attach hover listeners to a disabled <button> passed directly
// as a Tooltip child (it logs "You are providing a disabled button child to the
// Tooltip component" and the tooltip never opens). The promote IconButton is
// therefore wrapped in a <span>: these tests hover that wrapper and assert the
// tooltip still appears, both while enabled and while disabled by an in-flight
// switchover.

const MEMBER: PatroniMember = {
  name: 'pc-node-2',
  host: '10.0.0.12',
  role: 'replica',
  state: 'streaming',
  timeline: 3,
  lagBytes: 0,
  version: '4.0.4',
}

const PROMOTE_TOOLTIP = 'Promote to leader'

function promoteButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: PROMOTE_TOOLTIP }) as HTMLButtonElement
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HaNodeCard promote tooltip', () => {
  it('shows the promote tooltip on hover while the button is enabled', async () => {
    renderWithProviders(<HaNodeCard member={MEMBER} maintenance={false} onSwitchover={vi.fn()} />)

    const button = promoteButton()

    expect(button).toBeEnabled()

    // The Tooltip's listeners live on the <span> wrapper, not on the button.
    fireEvent.mouseOver(button.parentElement!)

    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent(PROMOTE_TOOLTIP)
  })

  it('does not render the promote button without an onSwitchover handler', () => {
    renderWithProviders(<HaNodeCard member={MEMBER} maintenance={false} />)

    expect(document.querySelector('.ri-swap-line')).toBeNull()
  })

  it('still shows the promote tooltip on hover while a switchover is in flight and the button is disabled', async () => {
    // handleSwitchover() sets `loading` before awaiting the POST; a fetch that
    // never settles keeps the button disabled for the whole test.
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))

    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWithProviders(<HaNodeCard member={MEMBER} maintenance={false} onSwitchover={vi.fn()} />)

    const button = promoteButton()

    expect(button).toBeEnabled()

    fireEvent.click(button)

    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveTextContent('Confirm Switchover')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Switchover' }))

    await waitFor(() => expect(button).toBeDisabled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/ha/switchover',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ candidate: MEMBER.name }) })
    )

    // The confirm dialog closes on confirm; wait for its modal to unmount so
    // the card is no longer aria-hidden behind it.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Regression: a disabled button is inert for MUI's hover listeners, so the
    // tooltip must be driven by the wrapping <span>.
    fireEvent.mouseOver(button.parentElement!)

    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent(PROMOTE_TOOLTIP)

    // MUI logs this exact warning when a disabled button is a Tooltip's direct
    // child. The <span> wrapper is what keeps it away.
    const logged = errorSpy.mock.calls.map(call => call.map(String).join(' ')).join('\n')

    expect(logged).not.toMatch(/disabled button child to the Tooltip/)
  })
})
