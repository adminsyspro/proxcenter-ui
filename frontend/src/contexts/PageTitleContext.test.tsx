import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PageTitleProvider, usePageTitle } from './PageTitleContext'

const wrapper = ({ children }: { children: ReactNode }) => <PageTitleProvider>{children}</PageTitleProvider>

afterEach(() => cleanup())

describe('PageTitleProvider', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => usePageTitle(), { wrapper })
    expect(result.current).toMatchObject({ title: '', subtitle: '', icon: '' })
  })

  it('sets the title and the subtitle separately', () => {
    const { result } = renderHook(() => usePageTitle(), { wrapper })
    act(() => result.current.setPageTitle('Backups'))
    act(() => result.current.setPageSubtitle('32 jobs'))
    expect(result.current).toMatchObject({ title: 'Backups', subtitle: '32 jobs', icon: '' })
  })

  it('sets title, subtitle and icon at once, and clears what is not given', () => {
    const { result } = renderHook(() => usePageTitle(), { wrapper })
    act(() => result.current.setPageInfo('DRS', 'Balancing', 'ri-loop-left-fill'))
    expect(result.current).toMatchObject({ title: 'DRS', subtitle: 'Balancing', icon: 'ri-loop-left-fill' })
    act(() => result.current.setPageInfo('Storage'))
    expect(result.current).toMatchObject({ title: 'Storage', subtitle: '', icon: '' })
    act(() => result.current.setPageInfo('Ceph', null, null))
    expect(result.current).toMatchObject({ title: 'Ceph', subtitle: '', icon: '' })
  })
})

describe('usePageTitle outside a provider', () => {
  it('returns inert defaults', () => {
    const { result } = renderHook(() => usePageTitle())
    expect(result.current).toMatchObject({ title: '', subtitle: '', icon: '' })
    expect(() => {
      result.current.setPageTitle('x')
      result.current.setPageSubtitle('y')
      result.current.setPageInfo('x', 'y', 'z')
    }).not.toThrow()
  })
})
