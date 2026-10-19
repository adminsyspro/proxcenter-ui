import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import MigrationLogLines from './MigrationLogLines'

const ts = new Date(2026, 9, 19, 10, 23, 50).toISOString()

afterEach(cleanup)

describe('MigrationLogLines (#1000)', () => {
  it('renders a step as a translated phase header and its lines under it', () => {
    renderWithProviders(<MigrationLogLines logs={[
      { ts, level: 'step', step: 'conversion', msg: 'Guest conversion' },
      { ts, level: 'success', msg: 'Guest converted in 65s' },
      { ts, level: 'warn', msg: 'random seed could not be set' },
      { ts, level: 'error', msg: 'boom' },
    ]} />)
    const header = screen.getByTestId('migration-log-step')
    expect(header.textContent).toContain('Guest conversion')
    expect(header.querySelector('i.ri-magic-line')).not.toBeNull()
    expect(screen.getByText('Guest converted in 65s')).toBeInTheDocument()
    expect(screen.getByText('✓')).toBeInTheDocument()
    expect(screen.getByText('⚠')).toBeInTheDocument()
    expect(screen.getByText('✗')).toBeInTheDocument()
  })

  it('keeps the engine title for an unknown step and names the VM in a bulk view', () => {
    renderWithProviders(<MigrationLogLines showVm logs={[
      { ts, level: 'step', step: 'something-new', msg: 'Something new', vmName: 'r9' },
      { ts, level: 'info', msg: 'copying', vmName: 'c7' },
    ]} />)
    expect(screen.getByTestId('migration-log-step').textContent).toContain('[r9] Something new')
    expect(screen.getByText('[c7]')).toBeInTheDocument()
  })

  it('leaves a log without phases flat, as the other pipelines write it', () => {
    renderWithProviders(<MigrationLogLines logs={[{ ts, msg: 'virt-v2v conversion completed' }]} />)
    expect(screen.queryByTestId('migration-log-step')).toBeNull()
    expect(screen.getByText('virt-v2v conversion completed')).toBeInTheDocument()
  })
})
