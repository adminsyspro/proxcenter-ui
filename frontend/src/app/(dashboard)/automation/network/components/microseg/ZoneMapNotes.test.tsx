/**
 * Overview sub-tab: keyboard access to the zones, names of the edges, legend, partial map and refit of the canvas.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { GUESTS_ROUTE, mock, reply } from './microsegTestKit'
import { db, installFreshMocks, vm, web } from './policyTestKit'
import { fitView } from './xyflowTestMock'
import { flowOf, node, pathOf, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()
beforeEach(() => fitView.mockClear())

describe('keyboard', () => {
  const nodeButton = (name: string | RegExp) => screen.findByRole('button', { name })

  it('opens the panel of a zone with Enter or Space on its node, which has a name that says what it is', async () => {
    setup({ zones: [web(), db({ state: 'enforce' })], vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'])] })
    const w = await nodeButton('Zone web, Observation, 2 members')
    expect(await nodeButton('Zone db, Enforced, 0 members')).toBeTruthy()
    expect(w.getAttribute('tabindex')).toBe('0')

    fireEvent.keyDown(w, { key: 'a' })
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.keyDown(w, { key: 'Enter' })
    expect(await screen.findByRole('complementary', { name: 'Zone web' })).toBeTruthy()
    expect(w.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(await nodeButton('Zone db, Enforced, 0 members'), { key: ' ' })
    expect(await screen.findByRole('complementary', { name: 'Zone db' })).toBeTruthy()
  })

  it('gives the node of a zone whose guests are unknown a name without a count', async () => {
    setup()
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(500, { error: 'boom' })
    expect(await nodeButton(/^Zone web, Observation, members unknown$/)).toBeTruthy()
  })

  it('leaves the focus to the zone button, not to the wrapper of the canvas library, and the edges unfocusable but named', async () => {
    setup({ flows: [flowOf('f1')] })
    expect((await node('zone:zw')).getAttribute('data-focusable')).toBe('false')
    const edge = await screen.findByTestId('edge-allowed:zone:zw>zone:zd')
    expect(edge.getAttribute('data-focusable')).toBe('false')
    expect(edge.getAttribute('aria-label')).toBe('web to db: tcp/443')
  })

  it('names the edges to External and Outside', async () => {
    setup({
      flows: [flowOf('f1', { src_zone_id: '', src_cidr: '10.0.0.0/8' }), flowOf('f2', { dst_zone_id: '', dst_cidr: '8.8.8.0/24', proto: 'udp', dport: '53' })],
    })
    expect((await screen.findByTestId('edge-allowed:external>zone:zd')).getAttribute('aria-label')).toBe('Unknown / External to db: tcp/443')
    expect((await screen.findByTestId('edge-outside:zone:zw>outside')).getAttribute('aria-label')).toBe('web to Outside: udp/53')
  })
})

describe('map notes', () => {
  it('names the three kinds of flows in the toolbar, with the draft and Outside lines', async () => {
    setup()
    const group = await screen.findByRole('group', { name: 'Flows:' })
    expect(within(group).getAllByRole('checkbox').map(c => c.closest('label')?.textContent)).toEqual(['Unprotected', 'Blocked', 'Allowed'])
    expect(screen.getByText('Allowed, not applied yet')).toBeTruthy()
    expect(screen.getByText('To Outside: not applied in v1')).toBeTruthy()
  })

  it('says the map is partial when the suggestions page is full', async () => {
    const full = Array.from({ length: 200 }, (_, i) => wouldBlock(`s${i}`))
    setup({ suggestions: full })
    expect(await screen.findByText('Partial: only the first 200 pending flows are drawn.')).toBeTruthy()
  })

  it('does not say it with fewer than 200 suggestions', async () => {
    setup({ suggestions: Array.from({ length: 199 }, (_, i) => wouldBlock(`s${i}`)) })
    await pathOf('unprotected:zone:zw>zone:zd')
    expect(screen.queryByText(/Partial:/)).toBeNull()
  })

  it('refits the canvas when the panel opens and when it closes', async () => {
    setup()
    await node('zone:zw')
    await waitFor(() => expect(fitView).toHaveBeenCalled())
    fitView.mockClear()
    fireEvent.click(await node('zone:zw'))
    await screen.findByRole('complementary', { name: 'Zone web' })
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(1))
    fitView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(1))
  })

  it('refits the canvas when the guests arrive and the circles grow', async () => {
    let release: () => void = () => undefined
    const arrived = new Promise<void>(resolve => { release = resolve })
    const members = Array.from({ length: 9 }, (_, i) => vm(100 + i, `web-${i}`, ['zone-web']))
    setup()
    mock.routes[`GET ${GUESTS_ROUTE}`] = async () => { await arrived; return reply(200, { data: { vms: members } }) }
    await node('zone:zw')
    await waitFor(() => expect(fitView).toHaveBeenCalled())
    fitView.mockClear()
    release()
    await screen.findByTestId('node-guest:zw:qemu/100')
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(1))
  })

  it('starts the panel of another zone on its first page', async () => {
    const guests = (tag: string, prefix: string) => Array.from({ length: 12 }, (_, i) => vm(100 + i + (tag === 'zone-db' ? 100 : 0), `${prefix}-${String(i).padStart(2, '0')}`, [tag]))
    setup({ vms: [...guests('zone-web', 'web'), ...guests('zone-db', 'db')] })
    fireEvent.click(await node('zone:zw'))
    const panel = await screen.findByRole('complementary', { name: 'Zone web' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'Next page' }))
    expect(await within(panel).findByText('web-10')).toBeTruthy()

    fireEvent.click(await node('zone:zd'))
    const other = await screen.findByRole('complementary', { name: 'Zone db' })
    expect(await within(other).findByText('db-00')).toBeTruthy()
    expect(within(other).queryByText('db-10')).toBeNull()
  })
})
