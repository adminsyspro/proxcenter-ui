import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { RecoveryPlan, RecoveryPlanVM, ReplicationJob } from '@/lib/orchestrator/site-recovery.types'
import CreatePlanDialog from './CreatePlanDialog'

const jobs = ['rbd', 'zfs'].map((engine, index) => ({ id: `job-${index}`, name: `Protection ${engine}`, storage_engine: engine, source_cluster: 'src', target_cluster: 'dst', vm_ids: [100], vm_names: ['database'] })) as ReplicationJob[]
const connections = [{ id: 'src', name: 'Source', hasCeph: false, engines: [] }, { id: 'dst', name: 'Target', hasCeph: false, engines: [] }]

afterEach(cleanup)

it('lists a VM once per job and submits the selected replication_job_id even without discovery', async () => {
  const submit = vi.fn()
  renderWithProviders(<CreatePlanDialog open onClose={vi.fn()} onSubmit={submit} connections={connections} jobs={jobs} />)
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  expect(screen.getByText('Protection rbd')).toBeInTheDocument()
  expect(screen.getByText('Protection zfs')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(/Plan Name/), 'DR plan')
  await userEvent.click(screen.getByRole('checkbox', { name: /database.*Protection zfs/ }))
  fireEvent.mouseDown(screen.getByRole('combobox'))
  await userEvent.click(screen.getByRole('option', { name: 'T1' }))
  await userEvent.click(screen.getByRole('button', { name: 'Create Plan' }))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ source_cluster: 'src', target_cluster: 'dst', vms: [{ vm_id: 100, replication_job_id: 'job-1', tier: 1, boot_order: 1 }] }))
})

it('removes only the selected VM/job assignment and renumbers boot order', async () => {
  renderWithProviders(<CreatePlanDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={connections} jobs={jobs} />)
  const boxes = screen.getAllByRole('checkbox')
  await userEvent.click(boxes[0])
  await userEvent.click(boxes[1])
  await userEvent.click(boxes[0])
  expect(boxes[0]).not.toBeChecked()
  expect(boxes[1]).toBeChecked()
  expect(screen.queryByText('#2')).not.toBeInTheDocument()
  expect(screen.getByText('#1')).toBeInTheDocument()
})

// The same dialog now edits a plan: given a `plan`, it prefills itself from it,
// changes its title and its confirm button, and hands back the assignments the
// operator leaves behind. A plan only stores guest ids, tiers and job ids, so
// the rest of every row has to be rebuilt from the replication jobs.
describe('CreatePlanDialog editing an existing plan', () => {
  function plan(overrides: Partial<RecoveryPlan> = {}): RecoveryPlan {
    return {
      id: 'plan-1',
      name: 'Prod DR',
      description: 'Yearly drill',
      status: 'ready',
      source_cluster: 'src',
      target_cluster: 'dst',
      vms: [{ vm_id: 100, vm_name: 'database', replication_job_id: 'job-1', tier: 2, boot_order: 1 }],
      last_test: null,
      last_failover: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  const renderEdit = (edited: RecoveryPlan | null, onSubmit = vi.fn()) => {
    renderWithProviders(
      <CreatePlanDialog open onClose={vi.fn()} onSubmit={onSubmit} connections={connections} jobs={jobs} plan={edited} />,
    )

    return onSubmit
  }

  it('announces it is editing the plan and prefills its name, description and guests', () => {
    renderEdit(plan())

    expect(screen.getByText('Edit recovery plan')).toBeInTheDocument()
    expect((screen.getByLabelText(/Plan Name/) as HTMLInputElement).value).toBe('Prod DR')
    expect((screen.getByLabelText(/Description/) as HTMLInputElement).value).toBe('Yearly drill')

    // The guest comes back ticked in its own job's row, not in the other job's.
    expect(screen.getByRole('checkbox', { name: /database.*Protection zfs/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /database.*Protection rbd/ })).not.toBeChecked()

    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('database · Protection zfs')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('T2')
  })

  it('confirms with Save rather than Create Plan and submits the edited plan', async () => {
    const onSubmit = renderEdit(plan())

    expect(screen.queryByRole('button', { name: 'Create Plan' })).not.toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText(/Plan Name/))
    await userEvent.type(screen.getByLabelText(/Plan Name/), 'Prod DR 2026')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Prod DR 2026',
      description: 'Yearly drill',
      source_cluster: 'src',
      target_cluster: 'dst',
      vms: [{ vm_id: 100, replication_job_id: 'job-1', tier: 2, boot_order: 1 }],
    }))
  })

  it('keeps a guest whose replication job is gone and refuses to save a plan with no name', () => {
    renderEdit(plan({
      name: '',
      description: '',
      // An older backend: no tier, no boot order, and the job has been deleted since.
      vms: [
        { vm_id: 700, vm_name: 'archive-01', replication_job_id: 'job-gone' } as RecoveryPlanVM,
        { vm_id: 701, replication_job_id: 'job-gone' } as RecoveryPlanVM,
      ],
    }))

    expect((screen.getByLabelText(/Plan Name/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Description/) as HTMLInputElement).value).toBe('')
    expect(screen.getByText('archive-01 · job-gone')).toBeInTheDocument()
    // Nameless in the plan and unknown to every job: it still has to be identifiable.
    expect(screen.getByText('VM 701 · job-gone')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('T3')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows an empty boot order for a plan that carries no guest yet', () => {
    renderEdit(plan({ vms: undefined as unknown as RecoveryPlanVM[] }))

    expect(screen.queryByText('Boot Order & Tiers')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('waits for the dialog to open before prefilling it', async () => {
    const edited = plan()

    const { rerender } = renderWithProviders(
      <CreatePlanDialog open={false} onClose={vi.fn()} onSubmit={vi.fn()} connections={connections} jobs={jobs} plan={edited} />,
    )

    expect(screen.queryByText('Edit recovery plan')).not.toBeInTheDocument()

    rerender(
      <CreatePlanDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={connections} jobs={jobs} plan={edited} />,
    )

    expect(await screen.findByDisplayValue('Prod DR')).toBeInTheDocument()
    expect(screen.getByText('database · Protection zfs')).toBeInTheDocument()
  })
})

// Nothing stops a guest from sitting in two plans, and that is a legitimate
// pattern (a broad plan plus a narrow rehearsal one). The picker says which
// other plans already list a guest instead of forbidding it.
describe('CreatePlanDialog surfacing guests already in another plan', () => {
  const rehearsal: RecoveryPlan = {
    id: 'plan-2',
    name: 'Rehearsal',
    description: '',
    status: 'ready',
    source_cluster: 'src',
    target_cluster: 'dst',
    vms: [{ vm_id: 100, vm_name: 'database', replication_job_id: 'job-0', tier: 3, boot_order: 1 }],
    last_test: null,
    last_failover: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  it('names the other plan under the guest and still lets the guest be ticked', async () => {
    renderWithProviders(<CreatePlanDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={connections} jobs={jobs} plans={[rehearsal]} />)

    // The guest is listed once per replication job, both rows on the same pair.
    expect(screen.getAllByText('Also in plan: Rehearsal')).toHaveLength(2)

    const box = screen.getByRole('checkbox', { name: /database.*Protection rbd/ })
    expect(box).toBeEnabled()
    await userEvent.click(box)
    expect(box).toBeChecked()
    expect(screen.getByText('#1')).toBeInTheDocument()
  })

  it('joins several plans in one caption', () => {
    const drill = { ...rehearsal, id: 'plan-3', name: 'Drill' }
    renderWithProviders(<CreatePlanDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={connections} jobs={jobs} plans={[rehearsal, drill]} />)

    expect(screen.getAllByText('Also in plan: Rehearsal, Drill')).toHaveLength(2)
  })

  it('ignores the plan being edited and a plan on another cluster pair', () => {
    const elsewhere = { ...rehearsal, id: 'plan-3', name: 'Elsewhere', target_cluster: 'dst-2' }
    renderWithProviders(<CreatePlanDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={connections} jobs={jobs} plan={rehearsal} plans={[rehearsal, elsewhere]} />)

    expect(screen.queryByText(/Also in plan/)).not.toBeInTheDocument()
  })

  it('says nothing without the plans prop', () => {
    renderWithProviders(<CreatePlanDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={connections} jobs={jobs} />)

    expect(screen.queryByText(/Also in plan/)).not.toBeInTheDocument()
  })
})
