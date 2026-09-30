import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, within, userEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import PbsServicesTab from './PbsServicesTab'

const PBS_ID = 'pbs-1'
const SERVICE = 'proxmox-backup-proxy'

function mockPbs() {
  const calls = { list: 0, actions: [] as string[] }
  server.use(
    http.get(`*/api/v1/pbs/${PBS_ID}/services`, () => {
      calls.list++
      return HttpResponse.json({
        data: [{ service: SERVICE, state: 'running', 'unit-state': 'enabled', desc: 'Proxmox Backup API Proxy Server' }],
      })
    }),
    http.post(`*/api/v1/pbs/${PBS_ID}/services/:name/:action`, ({ params }) => {
      calls.actions.push(`${params.name}/${params.action}`)
      return HttpResponse.json({ data: null })
    }),
  )
  return calls
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  const row = (await screen.findByText(SERVICE)).closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button'))
}

describe('PbsServicesTab', () => {
  afterEach(cleanup)

  it('loads the service list for the PBS on mount', async () => {
    const calls = mockPbs()
    renderWithProviders(<PbsServicesTab pbsId={PBS_ID} />)

    expect(await screen.findByText(SERVICE)).toBeInTheDocument()
    expect(screen.getByText('Proxmox Backup API Proxy Server')).toBeInTheDocument()
    expect(calls.list).toBe(1)
  })

  it('runs reload straight away, then refreshes the list one second later', async () => {
    const calls = mockPbs()
    const user = userEvent.setup()
    renderWithProviders(<PbsServicesTab pbsId={PBS_ID} />)

    await openRowMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /Reload/ }))

    await waitFor(() => expect(calls.actions).toEqual([`${SERVICE}/reload`]))
    expect(await screen.findByText(`Service ${SERVICE}: reload succeeded`)).toBeInTheDocument()
    expect(screen.queryByText('Confirm action')).not.toBeInTheDocument()
    await waitFor(() => expect(calls.list).toBe(2), { timeout: 3000 })
  })

  it('asks for confirmation before a restart and posts it once confirmed', async () => {
    const calls = mockPbs()
    const user = userEvent.setup()
    renderWithProviders(<PbsServicesTab pbsId={PBS_ID} />)

    await openRowMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: /Restart/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(`Are you sure you want to restart service "${SERVICE}"?`)).toBeInTheDocument()
    expect(calls.actions).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: 'Restart' }))

    await waitFor(() => expect(calls.actions).toEqual([`${SERVICE}/restart`]))
  })
})
