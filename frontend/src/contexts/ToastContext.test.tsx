import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ToastProvider, useToast } from './ToastContext'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Trigger({ withAction }: { withAction?: () => void }) {
  const toast = useToast()

  return (
    <button onClick={() => toast.showToast('Report ready', 'success', 5000, withAction ? { label: 'Download', onClick: withAction } : undefined)}>
      show
    </button>
  )
}

describe('ToastProvider', () => {
  it('shows a toast without a button by default and closes it after its duration', () => {
    vi.useFakeTimers()
    render(<ToastProvider><Trigger /></ToastProvider>)

    fireEvent.click(screen.getByText('show'))
    expect(screen.getByText('Report ready')).toBeInTheDocument()
    expect(screen.queryByText('Download')).toBeNull()

    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.queryByText('Report ready')).toBeNull()
  })

  it('runs the action of its button and closes the toast', () => {
    const onClick = vi.fn()
    render(<ToastProvider><Trigger withAction={onClick} /></ToastProvider>)

    fireEvent.click(screen.getByText('show'))
    fireEvent.click(screen.getByText('Download'))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Report ready')).toBeNull()
  })
})
