import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import ColorPicker from './ColorPicker'

describe('ColorPicker', () => {
  // renderWithProviders wraps @testing-library/react's render, whose auto-cleanup
  // only registers when `afterEach` is a real global; this project runs vitest
  // without `globals: true`, so each test must clean up its own render or
  // getByTestId('color-picker-native') collides across the five cases below.
  afterEach(() => cleanup())

  it('renders the hex field with the current value', () => {
    renderWithProviders(<ColorPicker value="#f59e0b" onChange={() => {}} label="Background" fallback="#000000" />)
    expect(screen.getByLabelText('Background')).toHaveValue('#f59e0b')
  })

  it('reports a change from the hex field', () => {
    const onChange = vi.fn()
    renderWithProviders(<ColorPicker value="#f59e0b" onChange={onChange} label="Background" fallback="#000000" />)
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#123456' } })
    expect(onChange).toHaveBeenCalledWith('#123456')
  })

  it('reports a change from the native colour input', () => {
    const onChange = vi.fn()
    renderWithProviders(<ColorPicker value="#f59e0b" onChange={onChange} label="Background" fallback="#000000" />)
    fireEvent.change(screen.getByTestId('color-picker-native'), { target: { value: '#abcdef' } })
    expect(onChange).toHaveBeenCalledWith('#abcdef')
  })

  it('shows the reset button only when a reset handler and a value are present', () => {
    const onReset = vi.fn()
    const { unmount } = renderWithProviders(
      <ColorPicker value="#f59e0b" onChange={() => {}} label="Background" fallback="#000000" onReset={onReset} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(onReset).toHaveBeenCalledOnce()
    unmount()

    renderWithProviders(<ColorPicker value="" onChange={() => {}} label="Background" fallback="#000000" onReset={onReset} />)
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull()
  })

  it('renders two independent pickers without id collision', () => {
    renderWithProviders(
      <>
        <ColorPicker value="#111111" onChange={() => {}} label="Background" fallback="#000000" />
        <ColorPicker value="#222222" onChange={() => {}} label="Text" fallback="#ffffff" />
      </>,
    )
    expect(screen.getAllByTestId('color-picker-native')).toHaveLength(2)
    expect(screen.getByLabelText('Background')).toHaveValue('#111111')
    expect(screen.getByLabelText('Text')).toHaveValue('#222222')
  })
})
