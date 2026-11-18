import type { UIEvent } from 'react'
import { describe, expect, it } from 'vitest'

import { scrollContainerOf } from './scrollSource'

describe('scrollContainerOf', () => {
  it('returns the container PerfectScrollbar hands over', () => {
    const container = document.createElement('div')

    expect(scrollContainerOf(container)).toBe(container)
  })

  it('returns the target of a native scroll event', () => {
    const container = document.createElement('div')
    const event = { target: container } as unknown as UIEvent<HTMLElement>

    expect(scrollContainerOf(event)).toBe(container)
  })

  it('returns null when the event target is not an element', () => {
    const event = { target: document } as unknown as UIEvent<HTMLElement>

    expect(scrollContainerOf(event)).toBeNull()
  })
})
