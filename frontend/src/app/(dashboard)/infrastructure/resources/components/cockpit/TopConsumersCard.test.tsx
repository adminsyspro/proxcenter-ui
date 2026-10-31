import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import type { TopVm } from '../../types'
import { DEFAULT_THRESHOLDS } from '../../constants'
import TopConsumersCard from './TopConsumersCard'

afterEach(cleanup)

const GiB = 1024 ** 3

function vm(id: string, name: string, cpu: number, ram: number): TopVm {
  return { id, name, node: id.split(':')[2], cpu, ram, cpuAllocated: 8, ramAllocated: 16 * GiB }
}

const topCpu = [vm('conn1:qemu:pve1:101', 'db-01', 92, 40), vm('conn1:lxc:pve2:202', 'web-ct', 61, 20)]
const topRam = [vm('conn1:qemu:pve3:303', 'cache-01', 10, 88)]

const rowOf = (name: string) => within(screen.getByText(name).closest('button') as HTMLButtonElement)

describe('TopConsumersCard', () => {
  it('lists the CPU consumers first, with their node, vCPU and usage', () => {
    renderWithProviders(<TopConsumersCard topCpu={topCpu} topRam={topRam} thresholds={DEFAULT_THRESHOLDS} onOpenVm={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'CPU' })).toHaveAttribute('aria-pressed', 'true')

    const db = rowOf('db-01')

    expect(db.getByText('pve1')).toBeInTheDocument()
    expect(db.getByText('8 vCPU')).toBeInTheDocument()
    expect(db.getByText('92%')).toBeInTheDocument()
    expect(rowOf('web-ct').getByText('61%')).toBeInTheDocument()
    expect(screen.queryByText('cache-01')).toBeNull()
  })

  it('switches to the RAM consumers and keeps the choice when the active button is clicked again', () => {
    renderWithProviders(<TopConsumersCard topCpu={topCpu} topRam={topRam} thresholds={DEFAULT_THRESHOLDS} onOpenVm={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'RAM' }))

    const cache = rowOf('cache-01')

    expect(cache.getByText('16 GB')).toBeInTheDocument()
    expect(cache.getByText('88%')).toBeInTheDocument()
    expect(screen.queryByText('db-01')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'RAM' }))
    expect(screen.getByText('cache-01')).toBeInTheDocument()
  })

  it('opens the clicked guest with the identity parsed from its id', () => {
    const onOpenVm = vi.fn()

    renderWithProviders(<TopConsumersCard topCpu={topCpu} topRam={topRam} thresholds={DEFAULT_THRESHOLDS} onOpenVm={onOpenVm} />)
    fireEvent.click(screen.getByText('web-ct'))

    expect(onOpenVm).toHaveBeenCalledWith({ id: 'conn1:lxc:pve2:202', name: 'web-ct', node: 'pve2', connId: 'conn1', type: 'lxc', vmid: '202' })
  })

  it('says when no guest is running', () => {
    renderWithProviders(<TopConsumersCard topCpu={[]} topRam={[]} thresholds={DEFAULT_THRESHOLDS} onOpenVm={vi.fn()} />)

    expect(screen.getByText('No running guest')).toBeInTheDocument()
  })
})
