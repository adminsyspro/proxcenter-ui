import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import NodeUpdateOutput from './NodeUpdateOutput'

afterEach(cleanup)

describe('NodeUpdateOutput', () => {
  it.each([
    ['empty', ''],
    ['undefined', undefined]
  ])('renders nothing when output is %s', (_label, output) => {
    const { container } = renderWithProviders(<NodeUpdateOutput nodeName='pve1' output={output} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('is collapsed by default', () => {
    renderWithProviders(<NodeUpdateOutput nodeName='pve1' output='Setting up pve-manager ...' />)

    expect(screen.getByRole('button', { name: 'Show apt output' })).toBeInTheDocument()
    expect(screen.queryByTestId('rolling-update-output-pve1')).not.toBeInTheDocument()
  })

  it('reveals the output when clicked', async () => {
    renderWithProviders(<NodeUpdateOutput nodeName='pve1' output='Setting up pve-manager ...' />)

    await userEvent.click(screen.getByRole('button', { name: 'Show apt output' }))

    expect(screen.getByTestId('rolling-update-output-pve1')).toHaveTextContent('Setting up pve-manager ...')
    expect(screen.getByRole('button', { name: 'Hide apt output' })).toBeInTheDocument()
  })

  it('renders expanded when requested initially', () => {
    renderWithProviders(
      <NodeUpdateOutput nodeName='pve1' output='Setting up pve-manager ...' defaultExpanded />
    )

    expect(screen.getByTestId('rolling-update-output-pve1')).toHaveTextContent('Setting up pve-manager ...')
  })

  it('opens when defaultExpanded changes after mount', async () => {
    const { rerender } = renderWithProviders(
      <NodeUpdateOutput nodeName='pve1' output='Setting up pve-manager ...' defaultExpanded={false} />
    )

    rerender(<NodeUpdateOutput nodeName='pve1' output='Setting up pve-manager ...' defaultExpanded />)

    expect(await screen.findByTestId('rolling-update-output-pve1')).toHaveTextContent('Setting up pve-manager ...')
  })
})
