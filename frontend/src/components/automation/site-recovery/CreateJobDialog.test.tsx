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

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import CreateJobDialog from './CreateJobDialog'

afterEach(cleanup)

function renderDialog() {
  renderWithProviders(
    <CreateJobDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={[]} allVMs={[]} />,
  )
}

// No bandwidth window and no cluster selected, so the VMID prefix is the only
// number input on the dialog.
const prefix = () => screen.getByRole('spinbutton') as HTMLInputElement
const blur = () => userEvent.click(screen.getByText('VMID Prefix'))

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
