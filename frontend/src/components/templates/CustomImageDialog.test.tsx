import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import CustomImageDialog from './CustomImageDialog'

// The hardware spec inputs are the ones discussion #634 is about: they used to
// coerce every keystroke with `parseInt(e.target.value) || <default>`, so the
// field could never be emptied and a retyped value landed glued behind the old
// default ('4' over '1' gave '14'). Nothing else in the dialog needs stubbing:
// the volume browser only fetches in "PVE volume" mode, which is provider-only
// and off by default, and `useTenant()` falls back to its own default context.
const open = () => renderWithProviders(<CustomImageDialog open onClose={() => {}} />)

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

describe('CustomImageDialog hardware spec fields', () => {
  // This suite renders repeatedly; RTL is not auto-cleaned up in this repo.
  afterEach(cleanup)

  it('lets min cores be cleared and retyped', async () => {
    open()

    const minCores = field('Min Cores')

    expect(minCores.value).toBe('1')

    await userEvent.clear(minCores)
    expect(minCores.value).toBe('')

    await userEvent.type(minCores, '4')
    expect(minCores.value).toBe('4')
  })

  it('lets min memory be cleared and retyped', async () => {
    open()

    const minMemory = field('Min Memory')

    expect(minMemory.value).toBe('512')

    await userEvent.clear(minMemory)
    expect(minMemory.value).toBe('')

    await userEvent.type(minMemory, '1024')
    expect(minMemory.value).toBe('1024')
  })

  it('restores the default when min memory is left empty', async () => {
    open()

    const minMemory = field('Min Memory')

    await userEvent.clear(minMemory)
    await userEvent.tab()

    expect(minMemory.value).toBe('512')
  })
})
