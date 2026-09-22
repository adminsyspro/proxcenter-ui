/**
 * Tests for the stop glyph a task row carries (#974).
 *
 * Three things matter here and none of them is geometry: the click must not
 * reach the row underneath (rows open a detail dialog on click, stopping must
 * not do both), the button must go quiet while the stop is in flight, and the
 * glyph must switch to the spinner at that moment.
 *
 * next-intl is mocked to echo the key, so the assertions name the catalogue
 * entry the button chose rather than a translated string.
 */

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import StopTaskButton from './StopTaskButton'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

/** Render the button inside a row that opens a dialog when clicked. */
function renderInRow(props: Partial<React.ComponentProps<typeof StopTaskButton>> = {}) {
  const onClick = vi.fn()
  const openRow = vi.fn()

  // A plain div, not a button: the real row is a DataGrid cell whose click
  // handler sits on the row, and nesting two buttons would give the test two
  // things answering to the same accessible name.
  const view = render(
    <div onClick={openRow} data-testid='row'>
      <StopTaskButton onClick={onClick} {...props} />
    </div>
  )

  return { ...view, onClick, openRow }
}

const stopButton = () => screen.getByRole('button', { name: 'tasks.stop.action' })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StopTaskButton', () => {
  it('stops the task without opening the row it sits on', () => {
    const { onClick, openRow } = renderInRow()

    fireEvent.click(stopButton())

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(openRow).not.toHaveBeenCalled()
  })

  it('shows the stop glyph while the task is still running', () => {
    const { container } = renderInRow()

    expect(stopButton()).toBeEnabled()
    expect(container.querySelector('i')).toHaveClass('ri-stop-circle-line')
  })

  it('goes quiet and spins while the stop is in flight', () => {
    const { container, onClick } = renderInRow({ stopping: true })

    expect(stopButton()).toBeDisabled()
    expect(container.querySelector('i')).toHaveClass('ri-loader-4-line')

    fireEvent.click(stopButton())
    expect(onClick).not.toHaveBeenCalled()
  })

  it('draws the glyph at the size the row asks for, and at 16 by default', () => {
    const { container } = renderInRow()

    expect(container.querySelector('i')).toHaveStyle({ fontSize: '16px' })

    cleanup()

    const sized = renderInRow({ size: 24 })

    expect(sized.container.querySelector('i')).toHaveStyle({ fontSize: '24px' })
  })
})
