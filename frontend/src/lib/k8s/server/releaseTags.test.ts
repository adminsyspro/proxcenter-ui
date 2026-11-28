import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearReleaseCache, flavourOf, parseReleaseTags, releasesOf } from './releaseTags'

const advert = [
  '001e# service=git-upload-pack',
  '0000015aabc HEAD\u0000multi_ack side-band-64k',
  '003fabc refs/heads/master',
  '0044abc refs/tags/v1.36.6+k3s1',
  '0047abc refs/tags/v1.36.6+k3s1^{}',
  '0048abc refs/tags/v1.37.0-rc1+k3s1',
  '0044abc refs/tags/v1.37.2+k3s1',
  '0044abc refs/tags/v1.37.2+k3s1',
  '0040abc refs/tags/v0.9.1',
  '',
].join('\n')

describe('parseReleaseTags', () => {
  it('keeps release tags once, without candidates nor peeled refs', () => {
    expect(parseReleaseTags(advert)).toEqual(['v1.36.6+k3s1', 'v1.37.2+k3s1'])
  })
})

describe('flavourOf', () => {
  it('reads the distribution of a running version', () => {
    expect(flavourOf('v1.36.6+k3s1')).toBe('k3s')
    expect(flavourOf('v1.36.6+rke2r2')).toBe('rke2r')
    expect(flavourOf('1.34.9')).toBeNull()
  })
})

describe('releasesOf', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { clearReleaseCache(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the tags of the official repository once per hour', async () => {
    fetchMock.mockResolvedValue(new Response(advert))
    expect(await releasesOf('k3s')).toEqual(['v1.36.6+k3s1', 'v1.37.2+k3s1'])
    expect(await releasesOf('k3s')).toEqual(['v1.36.6+k3s1', 'v1.37.2+k3s1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://github.com/k3s-io/k3s.git/info/refs?service=git-upload-pack')
  })
  it('answers null when the repository cannot be read', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await releasesOf('rke2r')).toBeNull()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await releasesOf('rke2r')).toBeNull()
    expect(await releasesOf('talos')).toBeNull()
  })
})
