// frameworksTab.download.test.tsx
// jsdom project test — exercises the DOM-dependent triggerDownload helper.
// Must be .tsx so vitest.config.ts routes it to the jsdom project.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { triggerDownload } from './frameworksTab.helpers'

describe('triggerDownload', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    createObjectURLSpy = vi.fn().mockReturnValue('blob:http://localhost/test-uuid')
    revokeObjectURLSpy = vi.fn()
    // jsdom does not implement URL.createObjectURL; install stubs on the
    // global URL constructor the same way jest-dom examples do.
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURLSpy, writable: true, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURLSpy, writable: true, configurable: true })

    // Spy on HTMLAnchorElement.prototype.click so we do not trigger navigation.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* no-op */ })
  })

  afterEach(() => {
    clickSpy.mockRestore()
  })

  it('calls URL.createObjectURL with the blob', () => {
    const blob = new Blob(['hello'], { type: 'application/pdf' })
    triggerDownload(blob, 'report.pdf')
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(createObjectURLSpy).toHaveBeenCalledWith(blob)
  })

  it('sets anchor.download to the given filename', () => {
    const anchors: HTMLAnchorElement[] = []
    const originalCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') anchors.push(el as HTMLAnchorElement)
      return el
    })

    triggerDownload(new Blob(['x']), 'compliance-report.pdf')

    expect(anchors).toHaveLength(1)
    expect(anchors[0].download).toBe('compliance-report.pdf')
    createSpy.mockRestore()
  })

  it('calls click() on the anchor element', () => {
    triggerDownload(new Blob(['x']), 'f.pdf')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('calls URL.revokeObjectURL after the click', () => {
    triggerDownload(new Blob(['x']), 'f.pdf')
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/test-uuid')
  })
})
