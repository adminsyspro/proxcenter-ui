import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import VmActions from './VmActions'

/**
 * Translation keys used by VmActions (resolved from en.json):
 *   audit.actions.start          -> 'Start'
 *   vmActions.resume             -> 'Resume'
 *   inventoryPage.shutdownClean  -> 'Shutdown (clean stop)'
 *   audit.actions.stop           -> 'Stop'
 *   audit.actions.suspend        -> 'Suspend'
 *   audit.actions.migrate        -> 'Migrate'
 *   audit.actions.clone          -> 'Clone'
 *   templates.convertToTemplate  -> 'Convert to Template'
 *   inventory.vmRunningWarning   -> 'Stop the VM before deleting it'
 *   inventory.deleteVm           -> 'Delete VM'
 *   inventory.unlock             -> 'Unlock'
 *
 * Button order (canMigrate=true):
 *   [0] Start/Resume  [1] Shutdown  [2] Stop  [3] Pause
 *   [4] Migrate  [5] Clone  [6] ConvertTemplate  [7] Delete
 *   [8] Unlock (only when isLocked && onUnlock provided)
 *
 * Note: userEvent.click cannot reach buttons through MUI's tooltip <span>
 * wrapper when pointer-events styling is involved; fireEvent.click is used
 * for callback assertions throughout.
 */

function makeCallbacks() {
  return {
    onStart: vi.fn(),
    onShutdown: vi.fn(),
    onStop: vi.fn(),
    onPause: vi.fn(),
    onMigrate: vi.fn(),
    onClone: vi.fn(),
    onConvertTemplate: vi.fn(),
    onDelete: vi.fn(),
  }
}

// ------------------------------------------------------------------ //
// Branch 1: vmStatus='running'
// Start disabled; Shutdown/Stop/Pause enabled; ConvertTemplate/Delete disabled
// ------------------------------------------------------------------ //
describe('VmActions - vmStatus=running', () => {
  it('renders 8 buttons', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    expect(container.querySelectorAll('button').length).toBe(8)
  })

  it('Start button (index 0) is disabled', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    const buttons = container.querySelectorAll('button')
    expect(buttons[0]).toBeDisabled()
  })

  it('Shutdown (index 1) and Stop (index 2) are enabled', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    const buttons = container.querySelectorAll('button')
    expect(buttons[1]).not.toBeDisabled() // Shutdown
    expect(buttons[2]).not.toBeDisabled() // Stop
  })

  it('Pause (index 3) is enabled', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    const buttons = container.querySelectorAll('button')
    expect(buttons[3]).not.toBeDisabled()
  })

  it('clicking Shutdown fires onShutdown', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    fireEvent.click(container.querySelectorAll('button')[1])
    expect(cbs.onShutdown).toHaveBeenCalledOnce()
  })

  it('clicking Stop fires onStop', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    fireEvent.click(container.querySelectorAll('button')[2])
    expect(cbs.onStop).toHaveBeenCalledOnce()
  })

  it('clicking Pause fires onPause', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    fireEvent.click(container.querySelectorAll('button')[3])
    expect(cbs.onPause).toHaveBeenCalledOnce()
  })

  it('ConvertTemplate (index 6) is disabled while running', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    expect(container.querySelectorAll('button')[6]).toBeDisabled()
  })

  it('Delete (index 7) is disabled while running', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    expect(container.querySelectorAll('button')[7]).toBeDisabled()
  })
})

// ------------------------------------------------------------------ //
// Branch 2: vmStatus='stopped' and vmStatus='unknown'
// Start enabled; Shutdown/Stop/Pause disabled
// ------------------------------------------------------------------ //
describe('VmActions - vmStatus=stopped', () => {
  it('Start button (index 0) is enabled when stopped', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    expect(container.querySelectorAll('button')[0]).not.toBeDisabled()
  })

  it('Shutdown (index 1) is disabled when stopped', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    expect(container.querySelectorAll('button')[1]).toBeDisabled()
  })

  it('Stop (index 2) and Pause (index 3) are disabled when stopped', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    const buttons = container.querySelectorAll('button')
    expect(buttons[2]).toBeDisabled()
    expect(buttons[3]).toBeDisabled()
  })

  it('clicking Start fires onStart when stopped', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    fireEvent.click(container.querySelectorAll('button')[0])
    expect(cbs.onStart).toHaveBeenCalledOnce()
  })

  it('Delete (index 7) is enabled when stopped', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    expect(container.querySelectorAll('button')[7]).not.toBeDisabled()
  })
})

describe('VmActions - vmStatus=unknown', () => {
  it('Start button is enabled when status is unknown', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="unknown" />)
    expect(container.querySelectorAll('button')[0]).not.toBeDisabled()
  })

  it('Shutdown is disabled when status is unknown', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="unknown" />)
    expect(container.querySelectorAll('button')[1]).toBeDisabled()
  })
})

// ------------------------------------------------------------------ //
// Branch 3: vmStatus='paused'
// Start acts as Resume - the tooltip switches to the resume label.
// 'paused' is NOT in the isStopped guard (isStopped = stopped | unknown),
// so Start is enabled (not running) and Shutdown/Stop/Pause are disabled.
// ------------------------------------------------------------------ //
describe('VmActions - vmStatus=paused', () => {
  it('Start button (index 0) is enabled when paused', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="paused" />)
    expect(container.querySelectorAll('button')[0]).not.toBeDisabled()
  })

  it('Shutdown and Stop are disabled when paused', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="paused" />)
    const buttons = container.querySelectorAll('button')
    expect(buttons[1]).toBeDisabled() // Shutdown
    expect(buttons[2]).toBeDisabled() // Stop
  })

  it('clicking the Start/Resume button when paused fires onStart', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="paused" />)
    fireEvent.click(container.querySelectorAll('button')[0])
    expect(cbs.onStart).toHaveBeenCalledOnce()
  })

  it('tooltip aria-label switches to Resume when paused (not Start)', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="paused" />)
    // MUI places the Tooltip accessible name as aria-label on the wrapper <span> (not the <button>), so the span is queried deliberately.
    // When paused the component passes t('vmActions.resume') = 'Resume'.
    const startSpan = container.querySelectorAll('button')[0].closest('span')
    expect(startSpan?.getAttribute('aria-label')).toBe('Resume')
  })

  it('tooltip aria-label is Start when not paused (stopped)', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    // MUI places the Tooltip accessible name as aria-label on the wrapper <span> (not the <button>), so the span is queried deliberately.
    // When not paused the component passes t('audit.actions.start') = 'Start'.
    const startSpan = container.querySelectorAll('button')[0].closest('span')
    expect(startSpan?.getAttribute('aria-label')).toBe('Start')
  })
})

// ------------------------------------------------------------------ //
// Branch 4: canMigrate=false hides the Migrate button entirely
// ------------------------------------------------------------------ //
describe('VmActions - canMigrate=false', () => {
  it('renders one fewer button when canMigrate is false', () => {
    const cbs = makeCallbacks()
    const { container: c1 } = renderWithProviders(
      <VmActions {...cbs} vmStatus="stopped" canMigrate />,
    )
    const { container: c2 } = renderWithProviders(
      <VmActions {...makeCallbacks()} vmStatus="stopped" canMigrate={false} />,
    )
    expect(c2.querySelectorAll('button').length).toBe(
      c1.querySelectorAll('button').length - 1,
    )
  })

  it('Clone is still present and clickable when canMigrate is false', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmActions {...cbs} vmStatus="stopped" canMigrate={false} />,
    )
    // Without migrate: [0]=Start [1]=Shutdown [2]=Stop [3]=Pause [4]=Clone [5]=ConvertTemplate [6]=Delete
    const buttons = container.querySelectorAll('button')
    fireEvent.click(buttons[4])
    expect(cbs.onClone).toHaveBeenCalledOnce()
  })
})

// ------------------------------------------------------------------ //
// Branch 5: isLocked / onUnlock
// ------------------------------------------------------------------ //
describe('VmActions - isLocked with onUnlock', () => {
  it('Unlock button appears when isLocked=true and onUnlock is provided', () => {
    const cbs = makeCallbacks()
    const onUnlock = vi.fn()
    const { container: cLocked } = renderWithProviders(
      <VmActions {...cbs} vmStatus="stopped" isLocked onUnlock={onUnlock} />,
    )
    const { container: cUnlocked } = renderWithProviders(
      <VmActions {...makeCallbacks()} vmStatus="stopped" />,
    )
    expect(cLocked.querySelectorAll('button').length).toBe(
      cUnlocked.querySelectorAll('button').length + 1,
    )
  })

  it('clicking Unlock fires onUnlock', () => {
    const cbs = makeCallbacks()
    const onUnlock = vi.fn()
    const { container } = renderWithProviders(
      <VmActions {...cbs} vmStatus="stopped" isLocked onUnlock={onUnlock} lockType="migrate" />,
    )
    const buttons = container.querySelectorAll('button')
    // Unlock is the last button (index 8)
    fireEvent.click(buttons[buttons.length - 1])
    expect(onUnlock).toHaveBeenCalledOnce()
  })

  it('Unlock button absent when isLocked is false', () => {
    const cbs = makeCallbacks()
    const onUnlock = vi.fn()
    const { container: cFalse } = renderWithProviders(
      <VmActions {...cbs} vmStatus="stopped" isLocked={false} onUnlock={onUnlock} />,
    )
    const { container: cBase } = renderWithProviders(
      <VmActions {...makeCallbacks()} vmStatus="stopped" />,
    )
    expect(cFalse.querySelectorAll('button').length).toBe(
      cBase.querySelectorAll('button').length,
    )
  })

  it('Unlock button absent when onUnlock callback is not provided', () => {
    const cbs = makeCallbacks()
    const { container: cLocked } = renderWithProviders(
      <VmActions {...cbs} vmStatus="stopped" isLocked />,
    )
    const { container: cBase } = renderWithProviders(
      <VmActions {...makeCallbacks()} vmStatus="stopped" />,
    )
    expect(cLocked.querySelectorAll('button').length).toBe(
      cBase.querySelectorAll('button').length,
    )
  })
})

// ------------------------------------------------------------------ //
// Branch 6: disabled=true - all action buttons become disabled
// ------------------------------------------------------------------ //
describe('VmActions - disabled=true', () => {
  it('all buttons are disabled when disabled=true', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmActions {...cbs} vmStatus="stopped" disabled />,
    )
    const buttons = container.querySelectorAll('button')
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled()
    })
  })

  it('Migrate button (index 4) is disabled when disabled=true', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(
      <VmActions {...cbs} vmStatus="stopped" disabled canMigrate />,
    )
    expect(container.querySelectorAll('button')[4]).toBeDisabled()
  })
})

// ------------------------------------------------------------------ //
// Clone and ConvertTemplate
// ------------------------------------------------------------------ //
describe('VmActions - Clone and ConvertTemplate', () => {
  it('clicking Clone (index 5) fires onClone', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    fireEvent.click(container.querySelectorAll('button')[5])
    expect(cbs.onClone).toHaveBeenCalledOnce()
  })

  it('clicking ConvertTemplate (index 6) fires onConvertTemplate when stopped', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    fireEvent.click(container.querySelectorAll('button')[6])
    expect(cbs.onConvertTemplate).toHaveBeenCalledOnce()
  })

  it('ConvertTemplate (index 6) is disabled when running', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="running" />)
    expect(container.querySelectorAll('button')[6]).toBeDisabled()
  })

  it('clicking Migrate (index 4) fires onMigrate', () => {
    const cbs = makeCallbacks()
    const { container } = renderWithProviders(<VmActions {...cbs} vmStatus="stopped" />)
    fireEvent.click(container.querySelectorAll('button')[4])
    expect(cbs.onMigrate).toHaveBeenCalledOnce()
  })
})
