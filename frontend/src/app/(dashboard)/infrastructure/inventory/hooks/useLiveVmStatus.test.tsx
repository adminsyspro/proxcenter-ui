import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useLiveVmStatus } from './useLiveVmStatus'

const panel = (vmRealStatus: string) => ({ status: vmRealStatus === 'running' ? 'ok' : 'crit', vmRealStatus, title: 't-ccm-882' }) as any

function mount(liveStatus: string | undefined, data: any) {
  const setData = vi.fn()
  const hook = renderHook(({ live, d }) => useLiveVmStatus(live, d, setData), { initialProps: { live: liveStatus, d: data } })

  return { setData, rerender: (live: string | undefined, d: any) => hook.rerender({ live, d }) }
}

describe('useLiveVmStatus', () => {
  it('follows the tree when the guest status changes', () => {
    const { setData, rerender } = mount('stopped', panel('stopped'))

    rerender('running', panel('stopped'))
    expect(setData).toHaveBeenCalledWith({ status: 'ok', vmRealStatus: 'running', title: 't-ccm-882' })

    rerender('paused', panel('running'))
    expect(setData).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'warn', vmRealStatus: 'paused' }))
  })

  it('puts the tree status back over a details reload that read the older status', () => {
    // The tree already shows the started guest; the reload the finished task
    // triggers still reads it stopped from /cluster/resources.
    const { setData, rerender } = mount('running', panel('running'))
    expect(setData).not.toHaveBeenCalled()

    rerender('running', panel('stopped'))
    expect(setData).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok', vmRealStatus: 'running' }))
  })

  it('leaves the panel alone with no tree status or no details yet', () => {
    const { setData, rerender } = mount(undefined, panel('stopped'))

    rerender('running', null)
    expect(setData).not.toHaveBeenCalled()
  })
})
