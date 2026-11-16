import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import CopyRateLimitField from './CopyRateLimitField'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, unknown>) => (vals ? `${k} ${JSON.stringify(vals)}` : k),
}))

afterEach(() => cleanup())

function setup(value = 0) {
  const onChange = vi.fn()
  const utils = render(<CopyRateLimitField label="Cap" value={value} onChange={onChange} testId="cap" />)
  const slider = screen.getByTestId('cap-slider') as HTMLInputElement
  const field = screen.getByTestId('cap-input') as HTMLInputElement
  return { onChange, slider, field, ...utils }
}

describe('CopyRateLimitField', () => {
  // Same layout as the downtime budget: label and cap in force on a title line,
  // the slider and a narrow field under it.
  it('shows the label and the cap in force above the slider and its field', () => {
    setup(50)
    const head = screen.getByTestId('cap-head')
    expect(head).toHaveTextContent('Cap')
    expect(screen.getByTestId('cap-value')).toHaveTextContent('50 copyRate.unit')
    const row = screen.getByTestId('cap-row')
    expect(row).toContainElement(screen.getByTestId('cap-slider'))
    expect(row).toContainElement(screen.getByTestId('cap-input'))
    expect(head).not.toContainElement(screen.getByTestId('cap-slider'))
  })

  it('shows the value in the field and on the slider', () => {
    const { slider, field } = setup(75)
    expect(field.value).toBe('75')
    expect(slider.value).toBe('75')
  })

  it('reads 0 as unlimited: empty field, unlimited on the title line', () => {
    const { field } = setup(0)
    expect(field.value).toBe('')
    expect(screen.getByTestId('cap-value')).toHaveTextContent('copyRate.unlimited')
  })

  it('takes a value typed in the field', () => {
    const { onChange, field } = setup(0)
    fireEvent.change(field, { target: { value: '75' } })
    expect(onChange).toHaveBeenLastCalledWith(75)
  })

  it('takes a value from the slider', () => {
    const { onChange, slider } = setup(0)
    fireEvent.change(slider, { target: { value: '300' } })
    expect(onChange).toHaveBeenLastCalledWith(300)
  })

  it('keeps a value above the slider range and pins the slider at its end', () => {
    const { onChange, slider, field, rerender } = setup(0)
    fireEvent.change(field, { target: { value: '1500' } })
    expect(onChange).toHaveBeenLastCalledWith(1500)
    rerender(<CopyRateLimitField label="Cap" value={1500} onChange={onChange} testId="cap" />)
    expect(slider.value).toBe('1000')
    expect(field.value).toBe('1500')
  })

  it('reads an emptied field as unlimited', () => {
    const { onChange, field } = setup(50)
    fireEvent.change(field, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('flags a value out of bounds without passing it on', () => {
    const { onChange, field } = setup(50)
    fireEvent.change(field, { target: { value: '100001' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(field, { target: { value: '2.5' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('tells its parent while the typed text is not a cap', () => {
    const onValidityChange = vi.fn()
    render(<CopyRateLimitField label="Cap" value={50} onChange={vi.fn()} testId="cap" onValidityChange={onValidityChange} />)
    const field = screen.getByTestId('cap-input')
    fireEvent.change(field, { target: { value: '1.5' } })
    expect(onValidityChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(field, { target: { value: '15' } })
    expect(onValidityChange).toHaveBeenLastCalledWith(true)
  })
})
