import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

import BackupPoolSelect from './BackupPoolSelect'

afterEach(() => cleanup())

describe('BackupPoolSelect', () => {
  it('lists the pools with their comment and reports the picked one', () => {
    const onChange = vi.fn()
    render(
      <BackupPoolSelect label="Pool" emptyLabel="None" value="" onChange={onChange}
        options={[{ poolid: 'prod', comment: 'Production' }, { poolid: 'lab' }]} />,
    )
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Pool' }))
    expect(screen.getByRole('option', { name: 'prod (Production)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'lab' }))
    expect(onChange).toHaveBeenCalledWith('lab')
  })

  it('says when the cluster has no pool', () => {
    render(<BackupPoolSelect label="Pool" emptyLabel="None" value="" onChange={vi.fn()} options={[]} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Pool' }))
    expect(screen.getByRole('option', { name: 'None' }).getAttribute('aria-disabled')).toBe('true')
  })
})
