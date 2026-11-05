import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import GuestPoolRow from './GuestPoolRow'

afterEach(() => cleanup())

function setup(reply: () => Response = () => HttpResponse.json({ data: {} })) {
  const puts: any[] = []

  server.use(
    http.get('*/api/v1/connections/:id/pools', () => HttpResponse.json({ data: [{ poolid: 'team' }, { poolid: 'other' }, { poolid: 'vdc-acme' }] })),
    http.put('*/api/v1/connections/:id/pools', async ({ request }) => {
      puts.push(await request.json())

      return reply()
    }),
  )

  return puts
}

function render(pool: string | null, canManage = true) {
  const onChanged = vi.fn()

  renderWithProviders(<table><tbody><GuestPoolRow connId="c1" vmid="101" pool={pool} canManage={canManage} onChanged={onChanged} /></tbody></table>)

  return onChanged
}

const choose = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Resource pool' }))
  fireEvent.click(within(screen.getByRole('listbox')).getByText(name))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('GuestPoolRow', () => {
  it('moves a pooled guest to another pool with allow-move, never offering a vDC pool', async () => {
    const puts = setup()
    const onChanged = render('team')

    expect(screen.getByText('team')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Resource pool' }))
    expect(within(screen.getByRole('listbox')).queryByText('vdc-acme')).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('listbox')).getByText('other'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(puts).toEqual([{ poolid: 'other', vms: [101], allowMove: true }])
  })

  it('adds a guest without pool, without allow-move', async () => {
    const puts = setup()

    render(null)
    expect(screen.getByText('No pool')).toBeInTheDocument()
    await choose('team')

    await waitFor(() => expect(puts).toEqual([{ poolid: 'team', vms: [101] }]))
  })

  it('takes a guest out of its pool', async () => {
    const puts = setup()

    render('team')
    await choose('No pool')

    await waitFor(() => expect(puts).toEqual([{ poolid: 'team', vms: [101], delete: true }]))
  })

  it('shows a refusal in the dialog', async () => {
    setup(() => HttpResponse.json({ error: 'refused' }, { status: 500 }))
    const onChanged = render('team')

    await choose('other')

    expect(await screen.findByText('refused')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('locks a guest of a vDC pool and hides the action without connection.manage', () => {
    render('vdc-acme')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    cleanup()
    render('team', false)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
