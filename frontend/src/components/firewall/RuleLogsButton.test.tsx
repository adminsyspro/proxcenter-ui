import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import RuleLogsButton from './RuleLogsButton'

afterEach(cleanup)

describe('RuleLogsButton', () => {
  it('opens the log of a logging rule', () => {
    const onClick = vi.fn()

    renderWithProviders(<RuleLogsButton rule={{ type: 'in', log: 'info' }} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Logs of this rule' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('is disabled on a nolog rule and says why', async () => {
    renderWithProviders(<RuleLogsButton rule={{ type: 'in', log: 'nolog' }} onClick={() => {}} />)

    const button = screen.getByRole('button', { name: 'Logs of this rule' })

    expect(button).toBeDisabled()
    fireEvent.mouseOver(button.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('does not log (nolog)')
  })

  it('stays enabled on a group reference, which logs through its group', () => {
    renderWithProviders(<RuleLogsButton rule={{ type: 'group' }} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Logs of this rule' })).toBeEnabled()
  })
})
