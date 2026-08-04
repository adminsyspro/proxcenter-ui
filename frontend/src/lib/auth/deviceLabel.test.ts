import { describe, it, expect } from 'vitest'

import { deviceLabel } from './deviceLabel'

describe('deviceLabel recognises the browsers and platforms that matter', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Chrome', 'Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari', 'macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari', 'iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Chrome', 'Linux'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox', 'Windows'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'Chrome', 'Android'],
  ])('parses %s', (ua, browser, os) => {
    expect(deviceLabel(ua)).toEqual({ browser, os })
  })

  it('prefers Edge over the Chrome token it also carries', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
    expect(deviceLabel(ua)).toEqual({ browser: 'Edge', os: 'Windows' })
  })

  it('prefers Chrome over the Safari token it also carries', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    expect(deviceLabel(ua)).toEqual({ browser: 'Chrome', os: 'macOS' })
  })

  it('returns nulls rather than guessing on unknown, empty or missing input', () => {
    expect(deviceLabel('some-cli/1.0')).toEqual({ browser: null, os: null })
    expect(deviceLabel('')).toEqual({ browser: null, os: null })
    expect(deviceLabel(null)).toEqual({ browser: null, os: null })
    expect(deviceLabel(undefined)).toEqual({ browser: null, os: null })
  })

  it('still reports the OS when only the browser is unknown', () => {
    expect(deviceLabel('curl/8.5.0 (Windows NT 10.0)')).toEqual({ browser: null, os: 'Windows' })
  })
})
