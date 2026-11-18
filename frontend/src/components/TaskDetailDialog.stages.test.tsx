/**
 * The migration timeline of the task viewer (#1392): drawn from the task log
 * for migration tasks, absent for any other task or an unrecognised log.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import TaskDetailDialog from './TaskDetailDialog'

const { detail } = vi.hoisted(() => ({ detail: { current: null as any } }))

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/hooks/useTaskDetail', () => ({ useTaskDetail: () => ({ data: detail.current }) }))

afterEach(cleanup)

const UPID = 'UPID:pve3:0007AF11:06604734:6AFD3A3C:qmigrate:116:root@pam!root:'
const lines = (...t: string[]) => t.map((text, i) => ({ n: i + 1, t: text }))
const stage = (id: string) => screen.getByTestId(`migration-stage-${id}`).dataset.state

function show(task: Record<string, unknown>, details: Record<string, unknown>) {
  // The viewer clears its state when it opens, then takes what the poll
  // brings: the details arrive on a later render, as they do with SWR.
  const ui = () => <TaskDetailDialog open task={{ id: UPID, connectionId: 'c1', node: 'pve3', ...task }} onClose={() => {}} />
  detail.current = null
  const view = render(ui())
  detail.current = details
  view.rerender(ui())
}

describe('TaskDetailDialog - migration stages', () => {
  it('shows the running stage of a live migration', () => {
    show({ type: 'qmigrate', status: 'running' }, {
      status: 'running',
      logs: lines("starting migration of VM 116 to node 'pve2' (10.42.0.102)", 'start remote tunnel', 'migration active, transferred 139.7 MiB of 2.0 GiB VM-state, 160.3 MiB/s'),
    })

    expect(stage('prepare')).toBe('done')
    expect(stage('memory')).toBe('active')
    expect(stage('finalize')).toBe('pending')
    expect(screen.queryByTestId('migration-stage-disks')).not.toBeInTheDocument()
  })

  it('marks the stage a failed migration stopped at, reading the type from the UPID', () => {
    show({ status: 'migration aborted' }, {
      status: 'stopped',
      exitstatus: 'migration aborted',
      logs: lines("starting migration of VM 116 to node 'pve2' (10.42.0.102)", "found local disk 'ZFS-Pool:vm-116-disk-0' (attached)", 'ERROR: migration aborted'),
    })

    expect(stage('prepare')).toBe('error')
    expect(stage('disks')).toBe('pending')
  })

  it('draws nothing for another task type or an unrecognised log', () => {
    show({ id: 'UPID:pve3:1:2:3:qmstart:116:root@pam:', type: 'qmstart', status: 'OK' }, { status: 'stopped', exitstatus: 'OK', logs: lines("starting migration of VM 116 to node 'pve2'", 'TASK OK') })
    expect(screen.queryByTestId('migration-stages')).not.toBeInTheDocument()
    cleanup()

    show({ type: 'qmigrate', status: 'OK' }, { status: 'stopped', exitstatus: 'OK', logs: lines('trying to acquire lock...', 'TASK OK') })
    expect(screen.queryByTestId('migration-stages')).not.toBeInTheDocument()
  })

  it('offers the log export next to the copy', () => {
    show({ type: 'qmigrate', status: 'OK' }, { status: 'stopped', exitstatus: 'OK', logs: lines('TASK OK') })

    expect(screen.getByTestId('task-export-logs')).toBeEnabled()
  })

  it('exports the whole log as a text file named after the task', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:task-log')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clicked: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download) })
    show({ type: 'qmigrate', status: 'OK' }, { status: 'stopped', exitstatus: 'OK', logs: lines('2026-11-18 06:39:19 start remote tunnel', 'TASK OK') })

    fireEvent.click(screen.getByTestId('task-export-logs'))

    expect(clicked).toEqual(['task-qmigrate-116-6AFD3A3C.log'])
    expect(await createObjectURL.mock.calls[0][0].text()).toBe('2026-11-18 06:39:19 start remote tunnel\nTASK OK\n')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:task-log')
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
