import { describe, expect, it } from 'vitest'

import { NO_SEGMENT_KEY } from '@/lib/proxmox/nicSegment'

import { getSegmentColor, segmentIcon } from './topologyColors'

describe('getSegmentColor', () => {
  it('paints the segment-less bucket grey', () => {
    expect(getSegmentColor(null)).toBe('#9e9e9e')
    expect(getSegmentColor(undefined)).toBe('#9e9e9e')
  })

  it('gives one stable colour per segment id', () => {
    const first = getSegmentColor(137)

    expect(first).toMatch(/^#[0-9a-f]{6}$/)
    expect(getSegmentColor(137)).toBe(first)
    expect(getSegmentColor(250)).not.toBe(first)
  })

  it('colours a VXLAN VNI, whose id is far outside the VLAN range', () => {
    expect(getSegmentColor(4242)).toMatch(/^#[0-9a-f]{6}$/)
    expect(getSegmentColor(16_777_215)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('never indexes outside the palette, negatives included', () => {
    for (const tag of [0, 1, 5, 6, 7, -1, -6, 4094]) {
      expect(getSegmentColor(tag), `tag ${tag}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('segmentIcon', () => {
  it('marks an SDN VNet with the branch icon', () => {
    expect(segmentIcon('vnet-tv1', 'tv1')).toBe('ri-git-branch-line')
    expect(segmentIcon(NO_SEGMENT_KEY, 'tv1')).toBe('ri-git-branch-line')
  })

  it('marks the segment-less bucket with a broken link', () => {
    expect(segmentIcon(NO_SEGMENT_KEY)).toBe('ri-link-unlink')
  })

  it('marks a plain VLAN with the router icon', () => {
    expect(segmentIcon('vlan-137')).toBe('ri-router-line')
    expect(segmentIcon('vlan-99', undefined)).toBe('ri-router-line')
  })
})
