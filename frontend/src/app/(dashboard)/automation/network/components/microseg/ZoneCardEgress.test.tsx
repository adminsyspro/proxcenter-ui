/**
 * The outbound of a zone is blocked and reopened from its card on the Policy sub-tab, as from the zone panel of
 * the map: blocking asks (the name when the zone is not ready), reopening is one click.
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, reply } from './microsegTestKit'
import { body, installFreshMocks, run, setup, web } from './policyTestKit'

installFreshMocks()

const OUT_ROUTE = 'GET /suggestions?kind=would_block&status=pending&zone=zw&direction=out&limit=200'
const card = () => screen.findByRole('listitem', { name: 'web' })

describe('outbound actions of a zone card', () => {
  it('has none while the outbound is not controlled', async () => {
    setup({ zones: [web({ state: 'enforce' })] })
    const row = await card()
    expect(within(row).queryByRole('button', { name: 'Block outbound' })).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Reopen outbound' })).toBeNull()
  })

  it('reopens the outbound in one click, without a dialog', async () => {
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'enforce', egress_state: 'enforce' })] })
    const row = await card()
    expect(within(row).queryByRole('button', { name: 'Block outbound' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Reopen outbound' }))
    await waitFor(() => expect(calls('POST /zones/zw/egress-state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'observe' })
    expect(screen.queryByRole('dialog')).toBeNull()
    // The run is followed like any state change: the card says so and takes no other change meanwhile.
    expect(await within(row).findByLabelText('State change in progress')).toBeTruthy()
    expect((within(row).getByRole('button', { name: 'Reopen outbound' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuses to reopen the outbound while the draft has pending changes, with the way to the plan', async () => {
    setup({ zones: [web({ state: 'enforce', egress_state: 'enforce' })], pending_changes: true })
    fireEvent.click(within(await card()).getByRole('button', { name: 'Reopen outbound' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reopen outbound of zone web?' })
    expect(within(dialog).getByRole('button', { name: 'View plan' })).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Reopen outbound' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
  })

  it('asks before blocking the outbound, the name of a zone whose readiness cannot be read', async () => {
    mock.routes[OUT_ROUTE] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ egress_state: 'observe' })] })
    const row = await card()
    expect(within(row).queryByRole('button', { name: 'Reopen outbound' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Block outbound' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block outbound of zone web?' })
    const confirm = await within(dialog).findByRole('button', { name: 'Block outbound' }) as HTMLButtonElement
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
    fireEvent.change(await within(dialog).findByLabelText('Type web to confirm'), { target: { value: 'web' } })
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => expect(calls('POST /zones/zw/egress-state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'enforce' })
  })
})
