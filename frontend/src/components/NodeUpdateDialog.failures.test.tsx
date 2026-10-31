/**
 * NodeUpdateDialog on a cluster node, when PVE refuses part of the plan:
 * a failed guest discovery is not "no guest", a refused maintenance step stops
 * the pre-flight before anything moves, and a refused post-action is not
 * marked done. Every request is answered by a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

const { migrateMock } = vi.hoisted(() => ({ migrateMock: vi.fn() }))

vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ hasPermission: () => true, isAdmin: true, permissions: [] }),
}))
vi.mock('@/lib/proxmox/aptRepositories', () => ({ loadNodeRepoIssues: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/migration/guestMigrateClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/migration/guestMigrateClient')>()),
  migrateGuestAndWait: migrateMock,
}))

import NodeUpdateDialog from './NodeUpdateDialog'

const BASE = '/api/v1/connections/c1'
type Answer = { status?: number; body?: unknown }
let answers: Record<string, Answer>
let calls: string[]
/** `METHOD url body` of every request that carried a body. */
let bodies: string[]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function stubFetch() {
  calls = []
  bodies = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method || 'GET'} ${url}`
    calls.push(key)
    if (typeof init?.body === 'string') bodies.push(`${key} ${init.body}`)
    const a = answers[key]
    if (a) return json(a.body ?? {}, a.status ?? 200)

    return json({})
  }))
}

/** `'unknown'` leaves the dialog to read hasCeph from the connection record. */
function renderDialog(ceph: boolean | 'unknown' = false) {
  stubFetch()
  renderWithProviders(
    <NodeUpdateDialog
      open
      onClose={vi.fn()}
      connectionId="c1"
      nodeName="pve3"
      vmCount={1}
      nodeUpdates={{ pve3: { count: 1, updates: [{ Package: 'pve-manager', OldVersion: '1', Version: '2' }], version: '9' } }}
      isCluster
      {...(ceph === 'unknown' ? {} : { hasCeph: ceph })}
    />,
  )
}

const next = () => screen.getByRole('button', { name: 'Next' })

beforeEach(() => {
  migrateMock.mockReset()
  migrateMock.mockResolvedValue({ ok: true })
  answers = {
    [`GET ${BASE}`]: { body: { data: { sshEnabled: true } } },
    [`GET ${BASE}/nodes/pve3/maintenance`]: { body: { data: { maintenance: null } } },
    [`GET ${BASE}/ceph/flags`]: { body: { data: { flags: [] } } },
    [`GET ${BASE}/nodes`]: { body: { data: [{ node: 'pve1', status: 'online', maxmem: 100, mem: 10 }, { node: 'pve3', status: 'online' }] } },
    [`GET ${BASE}/resources`]: { body: { data: [{ vmid: 101, name: 'web-01', node: 'pve3', status: 'running', type: 'qemu', maxmem: 1 }] } },
    [`GET ${BASE}/nodes/pve3/local-vms`]: { body: { data: { localVms: [] } } },
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NodeUpdateDialog guest discovery', () => {
  it('lists the running guests it found', async () => {
    renderDialog()

    expect(await screen.findByText(/1 VMs running/)).toBeInTheDocument()
    await waitFor(() => expect(next()).not.toBeDisabled())
  })

  it('reports a failed discovery and refuses to go on, instead of showing no guest', async () => {
    answers[`GET ${BASE}/resources`] = { status: 500, body: { error: 'resources unavailable' } }
    renderDialog()

    expect(await screen.findByText(/could not be listed \(resources unavailable\)/)).toBeInTheDocument()
    expect(next()).toBeDisabled()
    expect(screen.queryByText(/VMs running/)).not.toBeInTheDocument()
  })
})

describe('NodeUpdateDialog pre-flight', () => {
  it('stops at a refused maintenance mode: nothing is migrated, the update step is not reached', async () => {
    answers[`POST ${BASE}/nodes/pve3/maintenance`] = { status: 500, body: { error: 'maintenance mode refused' } }
    renderDialog()
    await waitFor(() => expect(next()).not.toBeDisabled())

    await userEvent.click(next())

    expect(await screen.findByText(/Pre-flight stopped, nothing was updated: maintenance mode refused/)).toBeInTheDocument()
    expect(migrateMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Start update' })).not.toBeInTheDocument()
  })

  it('stops at a refused Ceph flag before moving any guest', async () => {
    answers[`PUT ${BASE}/ceph/flags`] = { status: 403, body: { error: 'storage.admin required' } }
    renderDialog(true)
    await waitFor(() => expect(next()).not.toBeDisabled())

    await userEvent.click(next())

    expect(await screen.findByText(/Pre-flight stopped, nothing was updated: storage.admin required/)).toBeInTheDocument()
    expect(migrateMock).not.toHaveBeenCalled()
  })

  it('goes on to the configuration once every step was accepted', async () => {
    renderDialog()
    await waitFor(() => expect(next()).not.toBeDisabled())

    await userEvent.click(next())

    expect(await screen.findByRole('button', { name: 'Start update' })).toBeInTheDocument()
    expect(calls).toContain(`POST ${BASE}/nodes/pve3/maintenance`)
    expect(migrateMock).toHaveBeenCalledTimes(1)
  })
})

describe('NodeUpdateDialog post-actions', () => {
  async function reachPostActions() {
    answers[`POST ${BASE}/nodes/pve3/upgrade`] = { body: { data: { started: true } } }
    answers[`GET ${BASE}/nodes/pve3/upgrade`] = { body: { status: 'COMPLETED', logs: 'done', reboot_required: false } }
    renderDialog(true)
    await waitFor(() => expect(next()).not.toBeDisabled())
    await userEvent.click(next())
    await userEvent.click(await screen.findByRole('button', { name: 'Start update' }))
    expect(await screen.findByRole('button', { name: 'Exit maintenance mode' }, { timeout: 5000 })).toBeInTheDocument()
  }

  it('does not mark maintenance exited when PVE refused it', async () => {
    await reachPostActions()
    answers[`DELETE ${BASE}/nodes/pve3/maintenance`] = { status: 500, body: { error: 'node still busy' } }

    await userEvent.click(screen.getByRole('button', { name: 'Exit maintenance mode' }))

    expect(await screen.findByText('The action failed: node still busy')).toBeInTheDocument()
    expect(screen.queryByText('Maintenance mode exited')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exit maintenance mode' })).toBeInTheDocument()
  })

  it('does not mark the Ceph flags removed when PVE refused one', async () => {
    await reachPostActions()
    answers[`DELETE ${BASE}/ceph/flags`] = { status: 500, body: { error: 'mon unreachable' } }

    await userEvent.click(screen.getByRole('button', { name: 'Remove Ceph maintenance flags' }))

    expect(await screen.findByText('The action failed: mon unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Ceph maintenance flags' })).toBeInTheDocument()
  })

  it('marks maintenance exited once PVE accepted it', async () => {
    await reachPostActions()

    await userEvent.click(screen.getByRole('button', { name: 'Exit maintenance mode' }))

    expect(await screen.findByText('Maintenance mode exited')).toBeInTheDocument()
  })
})

const UPID = 'UPID:pve3:00001:shutdown'
const TASK = `GET /api/v1/tasks/c1/pve3/${encodeURIComponent(UPID)}?summary=1`

async function finishUpdate() {
  await userEvent.click(await screen.findByRole('button', { name: 'Start update' }))
  expect(await screen.findByRole('button', { name: 'Exit maintenance mode' }, { timeout: 5000 })).toBeInTheDocument()
}

describe('NodeUpdateDialog local guest shutdown', () => {
  beforeEach(() => {
    answers[`GET ${BASE}/nodes/pve3/local-vms`] = { body: { data: { localVms: [{ vmid: 101, localDisks: ['local-lvm:vm-101-disk-0'] }] } } }
    answers[`POST ${BASE}/guests/qemu/pve3/101/shutdown`] = { body: { data: UPID } }
    answers[`POST ${BASE}/nodes/pve3/upgrade`] = { body: { data: { started: true } } }
    answers[`GET ${BASE}/nodes/pve3/upgrade`] = { body: { status: 'COMPLETED', logs: 'done', reboot_required: false } }
  })

  async function shutDownAndGoOn() {
    renderDialog()
    await waitFor(() => expect(next()).not.toBeDisabled())
    await userEvent.click(screen.getByRole('switch', { name: 'Shutdown local-storage VMs before update' }))
    await userEvent.click(next())
  }

  it('counts a guest as shut down only once its PVE task ended OK, then offers to start it again', async () => {
    answers[TASK] = { body: { status: 'stopped', exitstatus: 'OK' } }
    await shutDownAndGoOn()

    expect(await screen.findByRole('button', { name: 'Start update' })).toBeInTheDocument()
    expect(calls).toContain(TASK)

    await finishUpdate()
    expect(screen.getByText('Restart Local VMs')).toBeInTheDocument()
  })

  it('reports the task failure and does not restart a guest that never stopped', async () => {
    answers[TASK] = { body: { status: 'stopped', exitstatus: 'command failed', failureReason: 'VM quit/powerdown failed - got timeout' } }
    await shutDownAndGoOn()

    expect(await screen.findAllByText('VM quit/powerdown failed - got timeout')).not.toHaveLength(0)

    await finishUpdate()
    expect(screen.queryByText('Restart Local VMs')).not.toBeInTheDocument()
  })

  it('does not claim the guest stopped when PVE returned no task to follow', async () => {
    answers[`POST ${BASE}/guests/qemu/pve3/101/shutdown`] = { body: { data: null } }
    await shutDownAndGoOn()

    expect(await screen.findAllByText(/The shutdown could not be followed to the end/)).not.toHaveLength(0)
    expect(screen.queryByText('Shut down')).not.toBeInTheDocument()
  })

  it('shows the refusal of the shutdown request itself', async () => {
    answers[`POST ${BASE}/guests/qemu/pve3/101/shutdown`] = { status: 403, body: { error: 'vm.stop required' } }
    await shutDownAndGoOn()

    expect(await screen.findAllByText('vm.stop required')).not.toHaveLength(0)
    expect(calls).not.toContain(TASK)
  })
})

describe('NodeUpdateDialog Ceph flags', () => {
  beforeEach(() => {
    answers[`POST ${BASE}/nodes/pve3/upgrade`] = { body: { data: { started: true } } }
    answers[`GET ${BASE}/nodes/pve3/upgrade`] = { body: { status: 'COMPLETED', logs: 'done', reboot_required: false } }
  })

  it('reads from the connection record whether the cluster runs Ceph when the caller does not say', async () => {
    answers[`GET ${BASE}`] = { body: { data: { sshEnabled: true, hasCeph: true } } }
    renderDialog('unknown')

    expect(await screen.findByText('Ceph OSD Flags')).toBeInTheDocument()
    await waitFor(() => expect(calls).toContain(`GET ${BASE}/ceph/flags`))
  })

  it('shows no Ceph section and reads no flag on a cluster without Ceph', async () => {
    answers[`GET ${BASE}`] = { body: { data: { sshEnabled: true, hasCeph: false } } }
    renderDialog('unknown')
    await waitFor(() => expect(next()).not.toBeDisabled())

    expect(screen.queryByText('Ceph OSD Flags')).not.toBeInTheDocument()
    expect(calls).not.toContain(`GET ${BASE}/ceph/flags`)
  })

  it('sets only the missing flags and removes only those after the update, keeping a flag set before', async () => {
    answers[`GET ${BASE}/ceph/flags`] = { body: { data: { flags: ['noout'] } } }
    renderDialog(true)
    await waitFor(() => expect(next()).not.toBeDisabled())
    await userEvent.click(next())
    await finishUpdate()

    expect(bodies.filter(b => b.startsWith(`PUT ${BASE}/ceph/flags`))).toEqual([
      `PUT ${BASE}/ceph/flags {"flag":"norebalance"}`,
      `PUT ${BASE}/ceph/flags {"flag":"norecover"}`,
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Remove Ceph maintenance flags' }))

    expect(await screen.findByText('Ceph maintenance flags removed')).toBeInTheDocument()
    expect(bodies.filter(b => b.startsWith(`DELETE ${BASE}/ceph/flags`))).toEqual([
      `DELETE ${BASE}/ceph/flags {"flag":"norebalance"}`,
      `DELETE ${BASE}/ceph/flags {"flag":"norecover"}`,
    ])
  })

  it('offers to remove the flag it did set when a later one was refused', async () => {
    renderDialog(true)
    await waitFor(() => expect(next()).not.toBeDisabled())
    let puts = 0
    const stub = vi.mocked(fetch)
    const base = stub.getMockImplementation()!
    stub.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT' && String(url).endsWith('/ceph/flags') && ++puts === 2) {
        return json({ error: 'mon unreachable' }, 500)
      }

      return base(url, init)
    })

    await userEvent.click(next())

    expect(await screen.findByText(/Pre-flight stopped, nothing was updated: mon unreachable/)).toBeInTheDocument()
    expect(puts).toBe(2)
  })

  it('leaves the flags alone when they could not be read', async () => {
    answers[`GET ${BASE}/ceph/flags`] = { status: 500, body: { error: 'ceph not answering' } }
    renderDialog(true)

    expect(await screen.findByText(/The Ceph flags could not be read \(ceph not answering\)/)).toBeInTheDocument()
    await waitFor(() => expect(next()).not.toBeDisabled())
    await userEvent.click(next())

    expect(await screen.findByRole('button', { name: 'Start update' })).toBeInTheDocument()
    expect(calls).not.toContain(`PUT ${BASE}/ceph/flags`)
  })
})
