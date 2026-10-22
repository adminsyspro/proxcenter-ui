import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { notifyCephFlagsChanged, useCephFlagsChanged } from './flagsEvents'

/*
   ui#1164 recette: noup set from the Ceph tab never reached the maintenance
   banner, each piece of the node view holding its own copy of the flags.
*/

afterEach(() => cleanup())

describe('useCephFlagsChanged', () => {
  it('calls back on a change of the same connection made by another writer, not on its own', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useCephFlagsChanged('c1', onChange))

    act(() => notifyCephFlagsChanged('c1', 'someone-else'))
    expect(onChange).toHaveBeenCalledTimes(1)

    act(() => notifyCephFlagsChanged('c1', result.current))
    act(() => notifyCephFlagsChanged('c2', 'someone-else'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not listen while disabled or without a connection, and stops on unmount', () => {
    const onChange = vi.fn()
    renderHook(() => useCephFlagsChanged('c1', onChange, false))
    renderHook(() => useCephFlagsChanged(null, onChange))
    act(() => notifyCephFlagsChanged('c1'))
    expect(onChange).not.toHaveBeenCalled()

    const { unmount } = renderHook(() => useCephFlagsChanged('c1', onChange))
    unmount()
    act(() => notifyCephFlagsChanged('c1'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores an empty connection id when notifying', () => {
    const listener = vi.fn()
    window.addEventListener('proxcenter:ceph-flags-changed', listener)
    notifyCephFlagsChanged('')
    window.removeEventListener('proxcenter:ceph-flags-changed', listener)
    expect(listener).not.toHaveBeenCalled()
  })
})
