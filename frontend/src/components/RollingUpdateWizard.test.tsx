/**
 * Component tests for the three advanced numeric settings of
 * RollingUpdateWizard (discussion #634).
 *
 * They used to be coerced with `Number.parseInt(v) || <default>` inside
 * onChange, so deleting the last digit wrote the default straight back into the
 * config object and the old digits stayed glued in front of the new ones. The
 * fields are now buffered and clamp on blur, and the patch shape they write
 * (a partial merge into the config) must be unchanged.
 *
 * The wizard is rendered with no nodes, which short-circuits the per-node
 * network fetches; only the connection lookup is seeded.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import RollingUpdateWizard from './RollingUpdateWizard'

afterEach(cleanup)

async function renderWizard() {
  server.use(
    http.get('*/api/v1/connections/conn-1', () => HttpResponse.json({ data: { sshEnabled: true } })),
  )

  renderWithProviders(
    <RollingUpdateWizard
      open
      onClose={vi.fn()}
      connectionId="conn-1"
      nodes={[]}
      nodeUpdates={{}}
    />,
  )

  // The three fields live behind the collapsed "Advanced options" panel.
  await userEvent.click(screen.getByRole('button', { name: /Advanced options/ }))
}

const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement

describe('RollingUpdateWizard advanced numeric settings', () => {
  it('shows the default configuration values', async () => {
    await renderWizard()
    expect(field('Migration timeout (seconds)').value).toBe('600')
    expect(field('Reboot timeout (seconds)').value).toBe('300')
    expect(field('Minimum healthy nodes').value).toBe('2')
  })

  it('lets the migration timeout be cleared and retyped', async () => {
    await renderWizard()
    const input = field('Migration timeout (seconds)')

    await userEvent.clear(input)
    expect(input.value).toBe('')
    await userEvent.type(input, '900')
    expect(input.value).toBe('900')
    // The sibling settings in the same config object are untouched.
    expect(field('Reboot timeout (seconds)').value).toBe('300')
    expect(field('Minimum healthy nodes').value).toBe('2')
  })

  it('commits the migration timeout fallback of 600 when left empty', async () => {
    await renderWizard()
    const input = field('Migration timeout (seconds)')

    await userEvent.clear(input)
    await userEvent.tab()
    expect(input.value).toBe('600')
  })

  it('lets the reboot timeout be cleared and retyped', async () => {
    await renderWizard()
    const input = field('Reboot timeout (seconds)')

    await userEvent.clear(input)
    expect(input.value).toBe('')
    await userEvent.type(input, '120')
    expect(input.value).toBe('120')
  })

  it('commits the reboot timeout fallback of 300 when left empty', async () => {
    await renderWizard()
    const input = field('Reboot timeout (seconds)')

    await userEvent.clear(input)
    await userEvent.tab()
    expect(input.value).toBe('300')
  })

  it('lets the minimum healthy nodes be cleared and retyped, then clamps on blur', async () => {
    await renderWizard()
    const input = field('Minimum healthy nodes')

    await userEvent.clear(input)
    expect(input.value).toBe('')
    await userEvent.type(input, '99')
    expect(input.value).toBe('99')
    await userEvent.tab()
    expect(input.value).toBe('10')
  })

  it('commits the minimum healthy nodes fallback of 2 when left empty', async () => {
    await renderWizard()
    const input = field('Minimum healthy nodes')

    await userEvent.clear(input)
    await userEvent.tab()
    expect(input.value).toBe('2')
  })
})
