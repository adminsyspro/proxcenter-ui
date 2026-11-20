// frameworksTab.download.test.tsx
// jsdom project test — exercises the DOM-dependent triggerUrlDownload helper.
// Must be .tsx so vitest.config.ts routes it to the jsdom project.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { triggerUrlDownload } from './frameworksTab.helpers'

describe('triggerUrlDownload', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Spy on HTMLAnchorElement.prototype.click so we do not trigger navigation.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* no-op */ })
  })

  afterEach(() => {
    clickSpy.mockRestore()
  })

  it('clicks a download anchor pointing at the url, then removes it', () => {
    const anchors: HTMLAnchorElement[] = []
    const originalCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') anchors.push(el as HTMLAnchorElement)
      return el
    })

    triggerUrlDownload('/api/v1/compliance/report-jobs/j1/download')

    expect(anchors).toHaveLength(1)
    expect(anchors[0].getAttribute('href')).toBe('/api/v1/compliance/report-jobs/j1/download')
    expect(anchors[0].hasAttribute('download')).toBe(true)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(anchors[0].isConnected).toBe(false)
    createSpy.mockRestore()
  })
})
