import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import RestoreTagsSwitch from './RestoreTagsSwitch'

afterEach(() => { cleanup() })

describe('RestoreTagsSwitch (#965)', () => {
  it('explains what keeping the tags does, and reports the toggle', () => {
    const onChange = vi.fn()
    renderWithProviders(<RestoreTagsSwitch checked onChange={onChange} />)

    expect(screen.getByText(/tag-based Site Recovery jobs/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Restore tags'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('renders as a checkbox in the PBS storage browser and explains the opt-out', () => {
    const onChange = vi.fn()
    renderWithProviders(<RestoreTagsSwitch control='checkbox' checked={false} onChange={onChange} />)

    const box = screen.getByLabelText('Restore tags') as HTMLInputElement
    expect(box.type).toBe('checkbox')
    expect(box.closest('.MuiCheckbox-root')).not.toBeNull()
    expect(screen.getByText(/restored without any tag, before it can start/)).toBeInTheDocument()
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
