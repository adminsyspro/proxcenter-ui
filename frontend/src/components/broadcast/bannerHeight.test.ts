import { describe, expect, it, vi } from 'vitest'

import { TOP_BANNER_HEIGHT_VAR, publishBannerHeight } from './bannerHeight'

describe('publishBannerHeight', () => {
  it('exposes the documented custom property name', () => {
    expect(TOP_BANNER_HEIGHT_VAR).toBe('--top-banner-height')
  })

  it('writes a pixel value on the root element', () => {
    const set = vi.fn()
    const remove = vi.fn()
    publishBannerHeight(64, { setProperty: set, removeProperty: remove })
    expect(set).toHaveBeenCalledWith('--top-banner-height', '64px')
  })

  it('clears the property for null so the layout falls back to 0px', () => {
    const set = vi.fn()
    const remove = vi.fn()
    publishBannerHeight(null, { setProperty: set, removeProperty: remove })
    expect(remove).toHaveBeenCalledWith('--top-banner-height')
    expect(set).not.toHaveBeenCalled()
  })

  it('clears the property for a zero or negative height', () => {
    const set = vi.fn()
    const remove = vi.fn()
    publishBannerHeight(0, { setProperty: set, removeProperty: remove })
    publishBannerHeight(-5, { setProperty: set, removeProperty: remove })
    expect(remove).toHaveBeenCalledTimes(2)
    expect(set).not.toHaveBeenCalled()
  })
})
