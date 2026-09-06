import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { ReplicationJob } from '@/lib/orchestrator/site-recovery.types'
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
