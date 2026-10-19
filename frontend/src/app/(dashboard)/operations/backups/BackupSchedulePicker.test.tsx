import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import BackupSchedulePicker from './BackupSchedulePicker'

afterEach(() => cleanup())

describe('BackupSchedulePicker', () => {
  it('offers the raw expression by default', () => {
    renderWithProviders(<BackupSchedulePicker value='*/15' onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('*/15')).toBeInTheDocument()
  })

  it('structuredOnly hides the raw expression and keeps a structured value as is', () => {
    const onChange = vi.fn()
    renderWithProviders(<BackupSchedulePicker value='mon,fri 03:30' onChange={onChange} structuredOnly />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByDisplayValue('03:30')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('structuredOnly replaces a value it cannot show by the daily default it displays', () => {
    const onChange = vi.fn()
    renderWithProviders(<BackupSchedulePicker value='minutely' onChange={onChange} structuredOnly />)
    expect(screen.queryByDisplayValue('minutely')).toBeNull()
    expect(screen.getByDisplayValue('02:00')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith('02:00')
  })
})
